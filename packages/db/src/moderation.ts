import type { PoolClient } from "pg";
import { isWellFormedToken, newBearerToken, tokenDigest } from "../../security/src/crypto.ts";
import { assertAuthorized, AuthorizationError } from "./authorization.ts";

/**
 * JFA-26 content reporting and moderation. Reporter identity is never
 * returned to reviewers or authors; reports carry no draft evidence. Holds are
 * temporary and reversible; every decision is an immutable action and an
 * appeal is decided by a different reviewer.
 */
export const REPORT_REASONS = ["privacy_exposure", "harassment_or_threat", "inaccurate", "copyright", "safety_risk", "other"] as const;
export type ReportReason = typeof REPORT_REASONS[number];
export const MODERATION_POLICY = "community-guidelines/2026-11-15";
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Anonymous or signed-in report against currently public content. Returns a private receipt. */
export async function submitReport(client: PoolClient, input: { slug: unknown; locale?: unknown; reason: unknown; details?: unknown; reporterId?: string | null }):
  Promise<{ status: "received"; receipt: string } | { status: "not_found" | "invalid" }> {
  const slug = typeof input.slug === "string" ? input.slug : "";
  const locale = typeof input.locale === "string" && input.locale ? input.locale : "en";
  if (!SLUG.test(slug) || slug.length > 80 || !/^[a-z]{2}(-[A-Z]{2})?$/.test(locale)) return { status: "invalid" };
  if (typeof input.reason !== "string" || !(REPORT_REASONS as readonly string[]).includes(input.reason)) return { status: "invalid" };
  const details = typeof input.details === "string" ? input.details.replace(/[\u0000-\u0008\u000b-\u001f]/g, "").trim().slice(0, 1000) : "";
  const entry = await client.query<{ id: string }>(`SELECT e.id FROM cms_entries e JOIN cms_revisions r ON r.entry_id=e.id AND r.version=e.current_revision
    WHERE e.slug=$1 AND e.locale=$2 AND e.visibility='public' AND r.editorial_state='published'`, [slug, locale]);
  if (!entry.rows[0]) return { status: "not_found" };
  const receipt = newBearerToken();
  const r = await client.query<{ id: string }>(`INSERT INTO content_reports(content_ref,reason_category,reporter_identity_id,entry_id,details,receipt_digest)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING id`, [`cms:${entry.rows[0].id}`, input.reason, input.reporterId && UUID.test(input.reporterId) ? input.reporterId : null,
    entry.rows[0].id, details || null, tokenDigest(receipt)]);
  await client.query("INSERT INTO audit_events(actor_ref,action,resource_ref,policy_result) VALUES('reporter','content_reported',$1,'allow')", [`report:${r.rows[0].id}`]);
  return { status: "received", receipt };
}

/** Reporter follow-up by receipt: status only, never reviewer notes or identities. */
export async function reportStatus(client: PoolClient, receipt: unknown): Promise<{ status: string } | null> {
  if (!isWellFormedToken(receipt)) return null;
  const r = await client.query<{ review_status: string }>("SELECT review_status FROM content_reports WHERE receipt_digest=$1", [tokenDigest(receipt)]);
  return r.rows[0] ? { status: r.rows[0].review_status } : null;
}

export type QueueItem = Readonly<{ reportId: string; contentRef: string; slug: string; reason: string; details: string | null; status: string; receivedAt: Date; held: boolean }>;

/** Reviewer queue. Deliberately omits reporter identity and receipt. */
export async function reportQueue(client: PoolClient, actorId: string, limit = 50): Promise<QueueItem[]> {
  await assertAuthorized(client, actorId, "moderation.review");
  const r = await client.query<{ id: string; content_ref: string; slug: string; reason_category: string; details: string | null; review_status: string; created_at: Date; moderation_hold: boolean }>(`
    SELECT c.id,c.content_ref,e.slug,c.reason_category,c.details,c.review_status,c.created_at,e.moderation_hold FROM content_reports c
    JOIN cms_entries e ON e.id=c.entry_id WHERE c.review_status IN ('received','triage') ORDER BY c.created_at LIMIT $1`, [Math.min(Math.max(limit, 1), 200)]);
  return r.rows.map(x => Object.freeze({ reportId: x.id, contentRef: x.content_ref, slug: x.slug, reason: x.reason_category, details: x.details, status: x.review_status, receivedAt: x.created_at, held: x.moderation_hold }));
}

async function recordAction(client: PoolClient, actorId: string, entryId: string, action: "hide" | "restore", reason: string, reportId: string | null, appealRef: string | null) {
  const row = await client.query<{ id: string }>(`INSERT INTO moderation_actions(content_ref,policy_ref,action,reviewer_ref,report_id,appeal_ref,reason_code)
    VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [`cms:${entryId}`, MODERATION_POLICY, action, actorId, reportId, appealRef, reason]);
  await client.query(`INSERT INTO outbox_events(event_type,subject_ref,schema_version,public_payload) SELECT $1,$2,'1',jsonb_build_object('slug',slug,'locale',locale) FROM cms_entries WHERE id=$3`,
    [action === "hide" ? "cms.hidden" : "cms.restored", `cms:${entryId}`, entryId]);
  await client.query("INSERT INTO audit_events(actor_ref,action,resource_ref,policy_result) VALUES($1,$2,$3,'allow')", [actorId, `moderation_${action}`, `moderation-action:${row.rows[0].id}`]);
  return row.rows[0].id;
}

/** Temporary hide: removes content from every public surface without deleting history. */
export async function hideContent(client: PoolClient, actorId: string, input: { reportId: string; reason: ReportReason }): Promise<{ actionId: string }> {
  if (!UUID.test(input.reportId) || !(REPORT_REASONS as readonly string[]).includes(input.reason)) throw new Error("Invalid moderation input");
  await client.query("BEGIN");
  try {
    await assertAuthorized(client, actorId, "moderation.review");
    const rep = await client.query<{ entry_id: string }>("SELECT entry_id FROM content_reports WHERE id=$1 FOR UPDATE", [input.reportId]);
    if (!rep.rows[0]?.entry_id) throw new Error("Report not found");
    await client.query("UPDATE cms_entries SET moderation_hold=true WHERE id=$1", [rep.rows[0].entry_id]);
    const actionId = await recordAction(client, actorId, rep.rows[0].entry_id, "hide", input.reason, input.reportId, null);
    await client.query("UPDATE content_reports SET review_status='reviewed' WHERE id=$1", [input.reportId]);
    await client.query("COMMIT");
    return { actionId };
  } catch (e) { await client.query("ROLLBACK").catch(() => undefined); throw e; }
}

/** Closes a report without action (content stays public). */
export async function dismissReport(client: PoolClient, actorId: string, reportId: string): Promise<void> {
  await assertAuthorized(client, actorId, "moderation.review");
  await client.query("UPDATE content_reports SET review_status='closed' WHERE id=$1 AND review_status IN ('received','triage')", [reportId]);
  await client.query("INSERT INTO audit_events(actor_ref,action,resource_ref,policy_result) VALUES($1,'report_dismissed',$2,'allow')", [actorId, `report:${reportId}`]);
}

/** The content's author may appeal a hide once. */
export async function appealAction(client: PoolClient, appellantId: string, actionId: string, statement: string): Promise<{ appealId: string }> {
  if (!UUID.test(actionId) || typeof statement !== "string" || statement.trim().length < 10) throw new Error("Invalid appeal");
  const a = await client.query<{ action: string; author_id: string | null }>(`SELECT m.action,(SELECT r.author_id FROM cms_revisions r JOIN cms_entries e ON e.id=r.entry_id
    WHERE 'cms:'||e.id::text=m.content_ref ORDER BY r.version DESC LIMIT 1) AS author_id FROM moderation_actions m WHERE m.id=$1`, [actionId]);
  if (!a.rows[0] || a.rows[0].action !== "hide") throw new Error("Only hide actions can be appealed");
  await assertAuthorized(client, appellantId, "self.update", { scope: "core", ownerId: a.rows[0].author_id ?? undefined });
  const r = await client.query<{ id: string }>("INSERT INTO moderation_appeals(action_id,appellant_id,statement) VALUES($1,$2,$3) RETURNING id", [actionId, appellantId, statement.trim().slice(0, 1000)]);
  await client.query("INSERT INTO audit_events(actor_ref,action,resource_ref,policy_result) VALUES($1,'moderation_appealed',$2,'allow')", [appellantId, `appeal:${r.rows[0].id}`]);
  return { appealId: r.rows[0].id };
}

/** A different reviewer decides; overturning restores the content (improper-removal recovery). */
export async function decideAppeal(client: PoolClient, actorId: string, appealId: string, decision: "upheld" | "overturned"): Promise<void> {
  if (!UUID.test(appealId) || (decision !== "upheld" && decision !== "overturned")) throw new Error("Invalid decision");
  await client.query("BEGIN");
  try {
    await assertAuthorized(client, actorId, "moderation.review");
    const a = await client.query<{ reviewer_ref: string; content_ref: string; status: string }>(`SELECT m.reviewer_ref,m.content_ref,p.status FROM moderation_appeals p
      JOIN moderation_actions m ON m.id=p.action_id WHERE p.id=$1 FOR UPDATE OF p`, [appealId]);
    const row = a.rows[0];
    if (!row || row.status !== "received") throw new Error("Appeal not open");
    if (row.reviewer_ref === actorId) throw new AuthorizationError({ allowed: false, reason: "denied_not_owner" });
    await client.query("UPDATE moderation_appeals SET status=$2,decided_by=$3,decided_at=now() WHERE id=$1", [appealId, decision, actorId]);
    if (decision === "overturned") {
      const entryId = row.content_ref.slice(4);
      await client.query("UPDATE cms_entries SET moderation_hold=false WHERE id=$1", [entryId]);
      await recordAction(client, actorId, entryId, "restore", "appeal_overturned", null, `appeal:${appealId}`);
    }
    await client.query("INSERT INTO audit_events(actor_ref,action,resource_ref,policy_result) VALUES($1,$2,$3,'allow')", [actorId, `appeal_${decision}`, `appeal:${appealId}`]);
    await client.query("COMMIT");
  } catch (e) { await client.query("ROLLBACK").catch(() => undefined); throw e; }
}
