import type { PoolClient } from "pg";
import { decide, mayGrant, type Action, type Decision, type Resource, type Subject } from "../../core/src/authorization.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class AuthorizationError extends Error {
  readonly decision: Decision;
  constructor(decision: Decision) { super("Staff authorization required"); this.decision = decision; }
}

/** Loads the subject and its grants from the database (the only trusted source). */
export async function loadSubject(client: PoolClient, subjectId: string): Promise<Subject | null> {
  if (!UUID.test(subjectId)) return null;
  const identity = await client.query<{ account_state: string }>("SELECT account_state FROM identities WHERE id=$1", [subjectId]);
  if (!identity.rows[0]) return null;
  const grants = await client.query<{ role: string; resource_scope: string; expires_at: Date | null; revoked_at: Date | null }>(
    "SELECT role,resource_scope,expires_at,revoked_at FROM role_grants WHERE subject_id=$1", [subjectId]);
  return Object.freeze({
    id: subjectId, active: identity.rows[0].account_state === "active",
    grants: Object.freeze(grants.rows.map(g => Object.freeze({ role: g.role, scope: g.resource_scope, expiresAt: g.expires_at, revokedAt: g.revoked_at })))
  });
}

/** Database-time decision. Unknown subjects are denied like inactive ones. */
export async function authorize(client: PoolClient, actorId: string, action: Action, resource: Resource = { scope: "core" },
  ctx: { stepUpAt?: Date | null; enforceStepUp?: boolean } = {}): Promise<Decision> {
  const subject = await loadSubject(client, actorId);
  if (!subject) return { allowed: false, reason: "denied_invalid" };
  const now = (await client.query<{ now: Date }>("SELECT now() AS now")).rows[0].now;
  return decide(subject, action, resource, { now, ...ctx });
}

/** Throws AuthorizationError; safe to call inside a caller's transaction. */
export async function assertAuthorized(client: PoolClient, actorId: string, action: Action, resource: Resource = { scope: "core" },
  ctx: { stepUpAt?: Date | null; enforceStepUp?: boolean } = {}): Promise<void> {
  const decision = await authorize(client, actorId, action, resource, ctx);
  if (!decision.allowed) throw new AuthorizationError(decision);
}

/** Records a denial outside any business transaction so it survives rollback. */
export async function recordDenial(client: PoolClient, actorId: string, action: Action, resourceRef: string): Promise<void> {
  await client.query("INSERT INTO audit_events(actor_ref,action,resource_ref,policy_result) VALUES($1,$2,$3,'deny')",
    [UUID.test(actorId) ? actorId : "invalid", `authz:${action}`, resourceRef.replace(/[@\s]/g, "_").slice(0, 200)]);
}

export async function grantRole(client: PoolClient, actorId: string,
  input: { subjectId: string; role: string; scope: string; expiresAt?: Date | null }): Promise<{ grantId: string }> {
  await client.query("BEGIN");
  try {
    const actor = await loadSubject(client, actorId);
    const now = (await client.query<{ now: Date }>("SELECT now() AS now")).rows[0].now;
    if (!actor || !mayGrant(actor, { id: input.subjectId, role: input.role, scope: input.scope }, now)) {
      throw new AuthorizationError({ allowed: false, reason: "denied_no_grant" });
    }
    const target = await client.query<{ account_state: string }>("SELECT account_state FROM identities WHERE id=$1 FOR UPDATE", [input.subjectId]);
    if (target.rows[0]?.account_state !== "active") throw new Error("Grant target must be an active identity");
    const row = await client.query<{ id: string }>(`INSERT INTO role_grants(subject_id,role,resource_scope,approved_by,expires_at)
      VALUES($1,$2,$3,$4,$5) RETURNING id`, [input.subjectId, input.role, input.scope, actorId, input.expiresAt ?? null]);
    await client.query("INSERT INTO audit_events(actor_ref,action,resource_ref,policy_result) VALUES($1,'role_granted',$2,'allow')",
      [actorId, `role-grant:${row.rows[0].id}:${input.role}/${input.scope}`]);
    await client.query("COMMIT");
    return { grantId: row.rows[0].id };
  } catch (e) { await client.query("ROLLBACK").catch(() => undefined); throw e; }
}

export async function revokeRole(client: PoolClient, actorId: string, grantId: string): Promise<void> {
  if (!UUID.test(grantId)) throw new Error("Invalid grant");
  await client.query("BEGIN");
  try {
    // Serialize admin changes so two admins cannot revoke each other at once.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('jfa_role_admin'))");
    const g = await client.query<{ subject_id: string; role: string; resource_scope: string; revoked_at: Date | null }>(
      "SELECT subject_id,role,resource_scope,revoked_at FROM role_grants WHERE id=$1 FOR UPDATE", [grantId]);
    const grant = g.rows[0];
    if (!grant || grant.revoked_at) throw new Error("Grant not found or already revoked");
    if (grant.subject_id === actorId) throw new AuthorizationError({ allowed: false, reason: "denied_not_owner" });
    await assertAuthorized(client, actorId, "roles.manage", { scope: grant.resource_scope });
    if (grant.role === "admin" && grant.resource_scope === "core") {
      const others = await client.query<{ n: number }>(`SELECT count(DISTINCT subject_id)::int AS n FROM core_active_grants
        WHERE role='admin' AND resource_scope='core' AND subject_id<>$1`, [grant.subject_id]);
      if ((others.rows[0]?.n ?? 0) < 1) throw new Error("Cannot revoke the last active core administrator");
    }
    await client.query("UPDATE role_grants SET revoked_at=now(),revoked_by=$2 WHERE id=$1", [grantId, actorId]);
    await client.query("INSERT INTO audit_events(actor_ref,action,resource_ref,policy_result) VALUES($1,'role_revoked',$2,'allow')",
      [actorId, `role-grant:${grantId}`]);
    await client.query("COMMIT");
  } catch (e) { await client.query("ROLLBACK").catch(() => undefined); throw e; }
}
