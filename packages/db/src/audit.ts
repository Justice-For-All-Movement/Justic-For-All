import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { assertAuthorized } from "./authorization.ts";

/**
 * JFA-28 audit chain. Hashes are computed in PostgreSQL by a trigger; this
 * module re-implements the same canonical encoding independently so a
 * verifier outside the database can check an exported chain.
 */
export type AuditRow = Readonly<{
  seq: number; previous_hash: string; event_hash: string; event_id: string; actor_ref: string | null;
  action: string; resource_ref: string | null; policy_result: string; occurred_at: string;
}>;

export const GENESIS_HASH = "0".repeat(64);

export function canonicalAuditString(r: Omit<AuditRow, "event_hash">): string {
  const fields = [String(r.seq), r.previous_hash, r.event_id, r.actor_ref ?? "", r.action, r.resource_ref ?? "", r.policy_result, r.occurred_at];
  return fields.map(v => `${[...v].length}:${v}`).join("|");
}

export function auditEventHash(r: Omit<AuditRow, "event_hash">): string {
  return createHash("sha256").update(canonicalAuditString(r), "utf8").digest("hex");
}

/** Pure verification of an ordered, exported chain segment. */
export function verifyAuditRows(rows: readonly AuditRow[], startPrevious = GENESIS_HASH, startSeq = 1):
  { ok: true; checked: number; headHash: string } | { ok: false; firstBadSeq: number; reason: string } {
  let prev = startPrevious, seq = startSeq;
  for (const r of rows) {
    if (r.seq !== seq) return { ok: false, firstBadSeq: r.seq, reason: "sequence_gap" };
    if (r.previous_hash !== prev) return { ok: false, firstBadSeq: r.seq, reason: "broken_link" };
    if (auditEventHash(r) !== r.event_hash) return { ok: false, firstBadSeq: r.seq, reason: "content_changed" };
    prev = r.event_hash; seq++;
  }
  return { ok: true, checked: rows.length, headHash: prev };
}

const SELECT_ROWS = `SELECT seq::float8 AS seq, previous_hash, event_hash, event_id::text AS event_id, actor_ref, action, resource_ref, policy_result,
  to_char(occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at FROM audit_events`;

/**
 * Database-side verification plus an independent recomputation in Node, both
 * inside one REPEATABLE READ snapshot so concurrent appends cannot produce a
 * false "broken" result.
 */
export async function verifyAuditChain(client: PoolClient): Promise<{ ok: boolean; checked: number; firstBadSeq: number | null; headSeq: number; headHash: string; independent: boolean }> {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const db = await client.query<{ ok: boolean; checked: string; first_bad_seq: string | null; head_seq: string; head_hash: string }>("SELECT * FROM jfa_verify_audit_chain()");
    const d = db.rows[0];
    const rows = await client.query<AuditRow>(`${SELECT_ROWS} WHERE seq IS NOT NULL AND seq <= $1 ORDER BY seq`, [d.head_seq]);
    await client.query("COMMIT");
    const independent = verifyAuditRows(rows.rows);
    return {
      ok: d.ok && independent.ok && independent.headHash === d.head_hash,
      checked: Number(d.checked), firstBadSeq: d.first_bad_seq === null ? (independent.ok ? null : independent.firstBadSeq) : Number(d.first_bad_seq),
      headSeq: Number(d.head_seq), headHash: d.head_hash, independent: independent.ok
    };
  } catch (e) { await client.query("ROLLBACK").catch(() => undefined); throw e; }
}

/** Current head, suitable for external anchoring (JFA-38) or a signed report. */
export async function auditChainHead(client: PoolClient): Promise<{ seq: number; hash: string }> {
  const r = await client.query<{ seq: string; last_hash: string }>("SELECT seq,last_hash FROM audit_chain_head WHERE id=1");
  return { seq: Number(r.rows[0].seq), hash: r.rows[0].last_hash };
}

/** Paged audit reading for administrators (`audit.read`). */
export async function listAuditEvents(client: PoolClient, actorId: string, opts: { beforeSeq?: number; limit?: number } = {}): Promise<AuditRow[]> {
  await assertAuthorized(client, actorId, "audit.read");
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const before = Number.isSafeInteger(opts.beforeSeq) ? opts.beforeSeq! : Number.MAX_SAFE_INTEGER;
  const r = await client.query<AuditRow>(`${SELECT_ROWS} WHERE seq IS NOT NULL AND seq < $1 ORDER BY seq DESC LIMIT $2`, [before, limit]);
  await client.query("INSERT INTO audit_events(actor_ref,action,resource_ref,policy_result) VALUES($1,'audit_read','audit:page','allow')", [actorId]);
  return r.rows;
}
