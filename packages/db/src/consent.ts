import type { PoolClient } from "pg";
import { findPurpose, summarizeConsent, type ConsentEvent, type ConsentState } from "../../core/src/consent.ts";
import { assertAuthorized } from "./authorization.ts";

export class ConsentRequiredError extends Error {
  readonly purpose: string;
  constructor(purpose: string) { super(`Consent required for ${purpose}`); this.purpose = purpose; }
}

const ref = (identityId: string) => `identity:${identityId}`;

export async function listConsentEvents(client: PoolClient, subjectId: string): Promise<ConsentEvent[]> {
  const r = await client.query<{ purpose: string; policy_version: string; decision: "grant" | "withdraw"; recorded_at: Date }>(
    "SELECT purpose,policy_version,decision,recorded_at FROM consent_records WHERE subject_ref=$1 ORDER BY seq", [ref(subjectId)]);
  return r.rows.map(row => ({ purpose: row.purpose, policyVersion: row.policy_version, decision: row.decision, recordedAt: row.recorded_at }));
}

/**
 * Self-service only: the actor must be the subject. Grants always record the
 * purpose's current policy version; consent for one purpose never covers another.
 */
export async function recordConsent(client: PoolClient, actorId: string, subjectId: string, purposeId: string, decision: "grant" | "withdraw",
  channel: "account_settings" | "signup_flow" = "account_settings"): Promise<ConsentState> {
  const purpose = findPurpose(purposeId);
  if (!purpose || (decision !== "grant" && decision !== "withdraw")) throw new Error("Unknown consent purpose or decision");
  await client.query("BEGIN");
  try {
    await assertAuthorized(client, actorId, "self.update", { scope: "core", ownerId: subjectId });
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`consent:${subjectId}:${purpose.id}`]);
    const prev = await client.query<{ id: string }>(
      "SELECT id FROM core_current_consent WHERE subject_ref=$1 AND purpose=$2", [ref(subjectId), purpose.id]);
    await client.query(`INSERT INTO consent_records(subject_ref,purpose,scope,policy_version,decision,supersedes_id,channel)
      VALUES($1,$2,$3,$4,$5,$6,$7)`, [ref(subjectId), purpose.id, `core.${purpose.id}`, purpose.version, decision, prev.rows[0]?.id ?? null, channel]);
    await client.query("INSERT INTO audit_events(actor_ref,action,resource_ref,policy_result) VALUES($1,$2,$3,'allow')",
      [actorId, decision === "grant" ? "consent_granted" : "consent_withdrawn", `consent:${purpose.id}@${purpose.version}`]);
    await client.query("COMMIT");
  } catch (e) { await client.query("ROLLBACK").catch(() => undefined); throw e; }
  return (await consentStatus(client, subjectId)).find(s => s.purpose === purpose.id)!;
}

export async function consentStatus(client: PoolClient, subjectId: string): Promise<ConsentState[]> {
  return summarizeConsent(await listConsentEvents(client, subjectId));
}

/** Gate for optional processing. Throws unless current-version consent is granted. */
export async function requireConsent(client: PoolClient, subjectId: string, purposeId: string): Promise<void> {
  if (!findPurpose(purposeId)) throw new ConsentRequiredError(purposeId);
  const state = (await consentStatus(client, subjectId)).find(s => s.purpose === purposeId);
  if (state?.status !== "granted") throw new ConsentRequiredError(purposeId);
}

/** Machine-readable export of the subject's own consent history. */
export async function exportConsent(client: PoolClient, actorId: string, subjectId: string) {
  await assertAuthorized(client, actorId, "self.read", { scope: "core", ownerId: subjectId });
  const events = await listConsentEvents(client, subjectId);
  return {
    format: "jfa-consent-export/1",
    exportedAt: new Date().toISOString(),
    events: events.map(e => ({ purpose: e.purpose, policyVersion: e.policyVersion, decision: e.decision, recordedAt: e.recordedAt.toISOString() })),
    current: summarizeConsent(events).map(s => ({ ...s, recordedAt: s.recordedAt?.toISOString() ?? null }))
  };
}
