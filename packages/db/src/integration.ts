import type { PoolClient } from "pg";
import type { EventEnvelope } from "../../adapters/src/events.ts";

/**
 * Inbox: a signed, validated envelope from an *enabled and verified* module is
 * stored once per event_id. Disabled or unknown sources fail closed.
 */
export async function ingestEvent(client: PoolClient, envelope: EventEnvelope, keyId: string): Promise<{ status: "accepted" | "duplicate" | "source_not_enabled" }> {
  const mod = await client.query<{ enabled: boolean }>(
    "SELECT enabled FROM module_connections WHERE slug=$1 AND enabled AND verification_state='verified'", [envelope.source_service]);
  if (!mod.rows[0]) return { status: "source_not_enabled" };
  const r = await client.query(`INSERT INTO inbox_events(event_id,source_service,key_id,event_type,schema_version,source_resource_id,projection_version,occurred_at,public_payload)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) ON CONFLICT(event_id) DO NOTHING`,
    [envelope.event_id, envelope.source_service, keyId, envelope.event_type, envelope.schema_version, envelope.source_resource_id,
     envelope.projection_version, envelope.occurred_at, JSON.stringify(envelope.payload)]);
  if (!r.rowCount) return { status: "duplicate" };
  await client.query("INSERT INTO audit_events(actor_ref,action,resource_ref,policy_result) VALUES($1,'integration_event_accepted',$2,'allow')",
    [`service:${envelope.source_service}`, `inbox:${envelope.event_id}`]);
  return { status: "accepted" };
}

export type OutboxMessage = Readonly<{ eventId: string; eventType: string; subjectRef: string | null; schemaVersion: string; payload: Record<string, unknown>; attempts: number }>;
export type Deliverer = (message: OutboxMessage) => Promise<{ ok: true } | { ok: false; retryable: boolean; code: string }>;

export const OUTBOX_MAX_ATTEMPTS = 8;
export const OUTBOX_LEASE_SECONDS = 120;

/** Exponential backoff: 1, 2, 4 … minutes, capped at 6 hours. */
export function backoffSeconds(attempts: number): number {
  return Math.min(60 * 2 ** Math.max(0, attempts - 1), 6 * 3600);
}

/**
 * Claims due messages with SKIP LOCKED so concurrent workers never deliver the
 * same message at once. Expired leases (crashed workers) are reclaimed.
 */
export async function claimOutboxBatch(client: PoolClient, limit = 20): Promise<OutboxMessage[]> {
  const r = await client.query<{ event_id: string; event_type: string; subject_ref: string | null; schema_version: string; public_payload: Record<string, unknown>; attempts: number }>(`
    UPDATE outbox_events SET delivery_state='delivering', lease_expires_at=now()+make_interval(secs => $2)
    WHERE event_id IN (
      SELECT event_id FROM outbox_events
      WHERE (delivery_state IN ('pending','failed') AND (next_attempt_at IS NULL OR next_attempt_at<=now()))
         OR (delivery_state='delivering' AND lease_expires_at<now())
      ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED)
    RETURNING event_id,event_type,subject_ref,schema_version,public_payload,attempts`, [Math.min(Math.max(limit, 1), 100), OUTBOX_LEASE_SECONDS]);
  return r.rows.map(row => ({ eventId: row.event_id, eventType: row.event_type, subjectRef: row.subject_ref, schemaVersion: row.schema_version, payload: row.public_payload, attempts: row.attempts }));
}

export async function deliverOutbox(client: PoolClient, deliver: Deliverer, limit = 20): Promise<{ delivered: number; retried: number; deadLettered: number }> {
  const batch = await claimOutboxBatch(client, limit);
  const out = { delivered: 0, retried: 0, deadLettered: 0 };
  for (const m of batch) {
    let result: Awaited<ReturnType<Deliverer>>;
    try { result = await deliver(m); } catch { result = { ok: false, retryable: true, code: "deliverer_threw" }; }
    if (result.ok) {
      await client.query("UPDATE outbox_events SET delivery_state='delivered',delivered_at=now(),lease_expires_at=NULL,attempts=attempts+1,last_error=NULL WHERE event_id=$1 AND delivery_state='delivering'", [m.eventId]);
      out.delivered++;
      continue;
    }
    const attempts = m.attempts + 1;
    const code = /^[a-z0-9_]{1,60}$/.test(result.code) ? result.code : "delivery_failed";
    if (!result.retryable || attempts >= OUTBOX_MAX_ATTEMPTS) {
      await client.query("UPDATE outbox_events SET delivery_state='dead_letter',dead_lettered_at=now(),lease_expires_at=NULL,attempts=$2,last_error=$3 WHERE event_id=$1", [m.eventId, attempts, code]);
      out.deadLettered++;
    } else {
      await client.query("UPDATE outbox_events SET delivery_state='failed',next_attempt_at=now()+make_interval(secs => $2),lease_expires_at=NULL,attempts=$3,last_error=$4 WHERE event_id=$1",
        [m.eventId, backoffSeconds(attempts), attempts, code]);
      out.retried++;
    }
  }
  return out;
}

/** Operator action: put a dead-lettered message back in the queue after fixing the cause. */
export async function requeueDeadLetter(client: PoolClient, eventId: string): Promise<boolean> {
  const r = await client.query("UPDATE outbox_events SET delivery_state='pending',next_attempt_at=NULL,attempts=0,dead_lettered_at=NULL WHERE event_id=$1 AND delivery_state='dead_letter'", [eventId]);
  return (r.rowCount ?? 0) === 1;
}

export async function outboxBacklog(client: PoolClient): Promise<Record<string, number>> {
  const r = await client.query<{ delivery_state: string; n: number }>("SELECT delivery_state,count(*)::int AS n FROM outbox_events GROUP BY delivery_state");
  return Object.fromEntries(r.rows.map(x => [x.delivery_state, x.n]));
}
