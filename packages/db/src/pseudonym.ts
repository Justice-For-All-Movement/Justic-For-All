import type { PoolClient } from "pg";
import { checkPseudonym, type PseudonymCheck } from "../../core/src/pseudonym.ts";
import { assertAuthorized } from "./authorization.ts";
import { requireConsent } from "./consent.ts";

export type SetNameResult = { status: "public" | "private" } | { status: "rejected"; reason: Exclude<PseudonymCheck, { ok: true }>["reason"] | "taken" | "consent_required" };

/**
 * Self-service. Making a name public requires current `public_display_name`
 * consent; `null` hides the name. The name is never linked to email or ID in
 * any public output.
 */
export async function setPublicName(client: PoolClient, actorId: string, subjectId: string, name: string | null): Promise<SetNameResult> {
  await assertAuthorized(client, actorId, "self.update", { scope: "core", ownerId: subjectId });
  if (name === null) {
    await client.query("UPDATE profiles SET visibility='private',row_version=row_version+1 WHERE identity_id=$1", [subjectId]);
    return { status: "private" };
  }
  const check = checkPseudonym(name);
  if (!check.ok) return { status: "rejected", reason: check.reason };
  try { await requireConsent(client, subjectId, "public_display_name"); } catch { return { status: "rejected", reason: "consent_required" }; }
  try {
    await client.query(`INSERT INTO profiles(identity_id,public_display_name,visibility) VALUES($1,$2,'public')
      ON CONFLICT(identity_id) DO UPDATE SET public_display_name=EXCLUDED.public_display_name,visibility='public',row_version=profiles.row_version+1`,
      [subjectId, check.value]);
  } catch (e) {
    if ((e as { code?: string }).code === "23505") return { status: "rejected", reason: "taken" };
    throw e;
  }
  await client.query("INSERT INTO audit_events(actor_ref,action,resource_ref,policy_result) VALUES($1,'public_name_set',$2,'allow')", [actorId, `profile:${subjectId}`]);
  return { status: "public" };
}

export async function getOwnProfile(client: PoolClient, subjectId: string): Promise<{ name: string | null; visibility: "public" | "private" }> {
  const r = await client.query<{ public_display_name: string | null; visibility: "public" | "private" }>(
    "SELECT public_display_name,visibility FROM profiles WHERE identity_id=$1", [subjectId]);
  return { name: r.rows[0]?.public_display_name ?? null, visibility: r.rows[0]?.visibility ?? "private" };
}
