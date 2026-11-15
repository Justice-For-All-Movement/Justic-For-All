import type { PoolClient } from "pg";
import { decide, PERMISSIONS, type Action } from "../../core/src/authorization.ts";
import { assertAuthorized, loadSubject } from "./authorization.ts";

/**
 * JFA-41 read models for the staff workspace. Each requires its own
 * permission and returns only the fields a reviewer needs (no contact data,
 * no reporter identity, no case data).
 */
export async function staffPermissions(client: PoolClient, identityId: string): Promise<Action[]> {
  const subject = await loadSubject(client, identityId);
  if (!subject) return [];
  const now = (await client.query<{ now: Date }>("SELECT now() AS now")).rows[0].now;
  return (Object.keys(PERMISSIONS) as Action[]).filter(a => !("self" in PERMISSIONS[a]) && decide(subject, a, { scope: "core" }, { now }).allowed);
}

export async function editorialQueue(client: PoolClient, actorId: string) {
  await assertAuthorized(client, actorId, "cms.read_draft");
  const r = await client.query<{ id: string; state: string; row_version: number; slug: string; title: string; author_id: string; approvals: number; created_at: Date }>(`
    SELECT w.id,w.state,w.row_version,e.slug,r.content->>'title' AS title,r.author_id,w.created_at,
     (SELECT count(*)::int FROM (SELECT DISTINCT ON (approver_id) decision FROM publication_approvals WHERE revision_id=r.id ORDER BY approver_id,decision_order DESC) d WHERE d.decision='approve') AS approvals
    FROM cms_review_workflows w JOIN cms_entries e ON e.id=w.entry_id JOIN cms_revisions r ON r.id=w.source_revision_id
    WHERE w.state IN ('in_review','approved') ORDER BY w.created_at LIMIT 100`);
  return r.rows.map(x => ({ workflowId: x.id, state: x.state, version: x.row_version, slug: x.slug, title: x.title, ownItem: x.author_id === actorId, approvals: x.approvals, submittedAt: x.created_at }));
}

export async function listRoleGrants(client: PoolClient, actorId: string) {
  await assertAuthorized(client, actorId, "roles.manage");
  const r = await client.query<{ id: string; subject_id: string; role: string; resource_scope: string; expires_at: Date | null; created_at: Date }>(`
    SELECT g.id,g.subject_id,g.role,g.resource_scope,g.expires_at,g.created_at FROM role_grants g
    WHERE g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>now()) ORDER BY g.created_at DESC LIMIT 200`);
  return r.rows.map(x => ({ grantId: x.id, subjectId: x.subject_id, role: x.role, scope: x.resource_scope, expiresAt: x.expires_at, createdAt: x.created_at }));
}

export async function integrationStatus(client: PoolClient, actorId: string) {
  await assertAuthorized(client, actorId, "integrations.manage");
  const mods = await client.query<{ slug: string; verification_state: string; enabled: boolean; contract_version: string | null; verified_at: Date | null }>(
    "SELECT slug,verification_state,enabled,contract_version,verified_at FROM module_connections ORDER BY slug");
  const outbox = await client.query<{ delivery_state: string; n: number }>("SELECT delivery_state,count(*)::int AS n FROM outbox_events GROUP BY delivery_state");
  const inbox = await client.query<{ n: number; latest: Date | null }>("SELECT count(*)::int AS n,max(received_at) AS latest FROM inbox_events");
  return { modules: mods.rows, outbox: Object.fromEntries(outbox.rows.map(r => [r.delivery_state, r.n])), inbox: inbox.rows[0] };
}
