import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { assertAuthorized } from "./authorization.ts";
import { exportConsent } from "./consent.ts";

/**
 * JFA-27 privacy requests. Subjects act only on their own records (session =
 * authority check). Staff with `privacy.process` decide; legal holds block
 * erasure; every status change is an append-only event; erasure leaves an
 * opaque tombstone and emits a PII-free propagation event for other modules.
 */
export const SELF_SERVICE_TYPES = ["access", "correct", "erase", "restrict"] as const;
export type SelfServiceType = typeof SELF_SERVICE_TYPES[number];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TERMINAL = ["completed", "partially_completed", "denied", "closed"];

async function event(client: PoolClient, requestId: string, status: string, actor: string, note: string | null = null) {
  await client.query("INSERT INTO privacy_request_events(request_id,status,actor_ref,note_code) VALUES($1,$2,$3,$4)", [requestId, status, actor, note]);
}

export async function openPrivacyRequest(client: PoolClient, actorId: string, subjectId: string, type: SelfServiceType, correctionNote?: string):
  Promise<{ status: "received"; requestId: string } | { status: "already_open" | "invalid" }> {
  if (!(SELF_SERVICE_TYPES as readonly string[]).includes(type)) return { status: "invalid" };
  const note = type === "correct" && typeof correctionNote === "string" ? correctionNote.trim().slice(0, 1000) : null;
  if (type === "correct" && !note) return { status: "invalid" };
  await client.query("BEGIN");
  try {
    await assertAuthorized(client, actorId, "self.update", { scope: "core", ownerId: subjectId });
    const r = await client.query<{ id: string }>(`INSERT INTO privacy_requests(identity_id,request_type,due_at,status,correction_note)
      VALUES($1,$2,now()+interval '30 days','identity_or_authority_checked',$3) ON CONFLICT DO NOTHING RETURNING id`, [subjectId, type, note]);
    if (!r.rows[0]) { await client.query("ROLLBACK"); return { status: "already_open" }; }
    await event(client, r.rows[0].id, "identity_or_authority_checked", "subject", "authenticated_session");
    await client.query("INSERT INTO audit_events(actor_ref,action,resource_ref,policy_result) VALUES($1,'privacy_request_opened',$2,'allow')", [actorId, `privacy-request:${r.rows[0].id}`]);
    await client.query("COMMIT");
    return { status: "received", requestId: r.rows[0].id };
  } catch (e) { await client.query("ROLLBACK").catch(() => undefined); throw e; }
}

export type OwnRequest = Readonly<{ id: string; type: string; status: string; dueAt: Date | null; createdAt: Date; outcome: string | null }>;

/** A subject's own requests and receipts; never another person's. */
export async function listOwnRequests(client: PoolClient, actorId: string, subjectId: string): Promise<OwnRequest[]> {
  await assertAuthorized(client, actorId, "self.read", { scope: "core", ownerId: subjectId });
  const r = await client.query<{ id: string; request_type: string; status: string; due_at: Date | null; created_at: Date; outcome_code: string | null }>(
    "SELECT id,request_type,status,due_at,created_at,outcome_code FROM privacy_requests WHERE identity_id=$1 ORDER BY created_at DESC", [subjectId]);
  return r.rows.map(x => ({ id: x.id, type: x.request_type, status: x.status, dueAt: x.due_at, createdAt: x.created_at, outcome: x.outcome_code }));
}

/** Machine-readable copy of the subject's own data held by the core (no internal IDs of others). */
export async function exportOwnData(client: PoolClient, actorId: string, subjectId: string) {
  await assertAuthorized(client, actorId, "self.read", { scope: "core", ownerId: subjectId });
  const profile = await client.query<{ public_display_name: string | null; visibility: string; locale: string }>("SELECT public_display_name,visibility,locale FROM profiles WHERE identity_id=$1", [subjectId]);
  const account = await client.query<{ created_at: Date; account_state: string }>("SELECT created_at,account_state FROM identities WHERE id=$1", [subjectId]);
  const subs = await client.query<{ topic: string; confirmation_state: string; confirmed_at: Date | null }>(`SELECT s.topic,s.confirmation_state,s.confirmed_at FROM subscriptions s
    JOIN contact_points c ON c.id=s.contact_point_id WHERE c.identity_id=$1`, [subjectId]);
  const sessions = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM auth_sessions WHERE identity_id=$1 AND revoked_at IS NULL AND absolute_expires_at>now()", [subjectId]);
  const requests = await listOwnRequests(client, actorId, subjectId);
  return {
    format: "jfa-personal-data-export/1", exportedAt: new Date().toISOString(),
    account: { createdAt: account.rows[0]?.created_at.toISOString() ?? null, state: account.rows[0]?.account_state ?? null,
      email: "stored encrypted; shown in your account settings, not included in downloadable files" },
    profile: profile.rows[0] ?? null,
    subscriptions: subs.rows.map(s => ({ topic: s.topic, state: s.confirmation_state, confirmedAt: s.confirmed_at?.toISOString() ?? null })),
    activeSessions: sessions.rows[0]?.n ?? 0,
    consent: (await exportConsent(client, actorId, subjectId)).events,
    privacyRequests: requests.map(r => ({ type: r.type, status: r.status, createdAt: r.createdAt.toISOString(), dueAt: r.dueAt?.toISOString() ?? null, outcome: r.outcome })),
    limits: "Copies already published or replicated by others, and encrypted backups (aged out on the backup schedule), cannot be changed by this export."
  };
}

export type StaffQueueItem = Readonly<{ id: string; type: string; status: string; dueAt: Date | null; legalHold: boolean; overdue: boolean }>;

/** Staff queue: request metadata only, no profile or contact data. */
export async function privacyQueue(client: PoolClient, actorId: string): Promise<StaffQueueItem[]> {
  await assertAuthorized(client, actorId, "privacy.process");
  const r = await client.query<{ id: string; request_type: string; status: string; due_at: Date | null; legal_hold: boolean; overdue: boolean }>(`
    SELECT id,request_type,status,due_at,legal_hold,(due_at<now()) AS overdue FROM privacy_requests
    WHERE status NOT IN ('completed','partially_completed','denied','closed') ORDER BY due_at NULLS LAST LIMIT 200`);
  return r.rows.map(x => ({ id: x.id, type: x.request_type, status: x.status, dueAt: x.due_at, legalHold: x.legal_hold, overdue: x.overdue }));
}

export async function setLegalHold(client: PoolClient, actorId: string, requestId: string, hold: boolean, reasonCode: string): Promise<void> {
  if (!UUID.test(requestId) || !/^[a-z_]{3,60}$/.test(reasonCode)) throw new Error("Invalid legal hold input");
  await assertAuthorized(client, actorId, "privacy.process");
  await client.query("UPDATE privacy_requests SET legal_hold=$2 WHERE id=$1", [requestId, hold]);
  await event(client, requestId, hold ? "legal_hold_applied" : "legal_hold_released", `staff:${actorId}`, reasonCode);
  await client.query("INSERT INTO audit_events(actor_ref,action,resource_ref,policy_result) VALUES($1,$2,$3,'allow')", [actorId, hold ? "legal_hold_applied" : "legal_hold_released", `privacy-request:${requestId}`]);
}

/**
 * Executes an erasure request. Blocked (status `denied`, outcome
 * `legal_hold`) while a hold is set. Erasure: profile cleared, contact
 * ciphertext crypto-shredded (replaced by random bytes) and lookup removed,
 * subscriptions ended, sessions revoked, identity marked deleted. Consent and
 * audit ledgers keep only opaque IDs as evidence of lawful processing.
 */
export async function processErasure(client: PoolClient, actorId: string, requestId: string): Promise<{ status: "completed" | "denied" }> {
  if (!UUID.test(requestId)) throw new Error("Invalid request");
  await client.query("BEGIN");
  try {
    await assertAuthorized(client, actorId, "privacy.process");
    const r = await client.query<{ identity_id: string; request_type: string; status: string; legal_hold: boolean }>(
      "SELECT identity_id,request_type,status,legal_hold FROM privacy_requests WHERE id=$1 FOR UPDATE", [requestId]);
    const req = r.rows[0];
    if (!req || req.request_type !== "erase" || TERMINAL.includes(req.status)) throw new Error("Erasure request not open");
    if (req.identity_id === actorId) throw new Error("Staff cannot process their own erasure");
    if (req.legal_hold) {
      await client.query("UPDATE privacy_requests SET status='denied',outcome_code='legal_hold',decided_by=$2,closed_at=now() WHERE id=$1", [requestId, actorId]);
      await event(client, requestId, "denied", `staff:${actorId}`, "legal_hold");
      await client.query("COMMIT");
      return { status: "denied" };
    }
    const id = req.identity_id;
    await client.query("UPDATE profiles SET public_display_name=NULL,visibility='private',accessibility_prefs='{}'::jsonb,row_version=row_version+1 WHERE identity_id=$1", [id]);
    await client.query(`UPDATE subscriptions s SET confirmation_state='unsubscribed',unsubscribed_at=coalesce(unsubscribed_at,now()),token_digest=NULL,unsubscribe_digest=NULL
      FROM contact_points c WHERE c.id=s.contact_point_id AND c.identity_id=$1`, [id]);
    const contacts = await client.query<{ id: string }>("SELECT id FROM contact_points WHERE identity_id=$1", [id]);
    for (const c of contacts.rows) {
      await client.query("UPDATE contact_points SET address_ciphertext=$2,lookup_hmac=NULL,retention_state='erasure_pending',crypto_key_ref='shredded' WHERE id=$1", [c.id, randomBytes(32)]);
    }
    await client.query("UPDATE authenticators SET revoked_at=coalesce(revoked_at,now()) WHERE identity_id=$1", [id]);
    await client.query("UPDATE auth_sessions SET revoked_at=now(),revoke_reason='deletion_requested' WHERE identity_id=$1 AND revoked_at IS NULL", [id]);
    await client.query("UPDATE identities SET account_state='deleted',erased_at=now(),row_version=row_version+1 WHERE id=$1", [id]);
    await client.query("UPDATE privacy_requests SET status='completed',outcome_code='erased',decided_by=$2,closed_at=now() WHERE id=$1", [requestId, actorId]);
    await event(client, requestId, "completed", `staff:${actorId}`, "erased");
    // Propagation hook for downstream modules: opaque subject reference only.
    await client.query("INSERT INTO outbox_events(event_type,subject_ref,schema_version,public_payload) VALUES('privacy.erasure_completed',$1,'1','{}'::jsonb)", [`identity:${id}`]);
    await client.query("INSERT INTO audit_events(actor_ref,action,resource_ref,policy_result) VALUES($1,'privacy_erasure_completed',$2,'allow')", [actorId, `privacy-request:${requestId}`]);
    await client.query("COMMIT");
    return { status: "completed" };
  } catch (e) { await client.query("ROLLBACK").catch(() => undefined); throw e; }
}

/** Closes non-erasure requests (access fulfilled by export, correction applied, restriction set). */
export async function closePrivacyRequest(client: PoolClient, actorId: string, requestId: string, outcome: "completed" | "partially_completed" | "denied", outcomeCode: string): Promise<void> {
  if (!UUID.test(requestId) || !/^[a-z_]{3,60}$/.test(outcomeCode)) throw new Error("Invalid close input");
  await assertAuthorized(client, actorId, "privacy.process");
  const r = await client.query("UPDATE privacy_requests SET status=$2,outcome_code=$3,decided_by=$4,closed_at=now() WHERE id=$1 AND status NOT IN ('completed','partially_completed','denied','closed') AND identity_id<>$4",
    [requestId, outcome, outcomeCode, actorId]);
  if (!r.rowCount) throw new Error("Request not open or self-processing");
  await event(client, requestId, outcome, `staff:${actorId}`, outcomeCode);
  await client.query("INSERT INTO audit_events(actor_ref,action,resource_ref,policy_result) VALUES($1,'privacy_request_closed',$2,'allow')", [actorId, `privacy-request:${requestId}`]);
}
