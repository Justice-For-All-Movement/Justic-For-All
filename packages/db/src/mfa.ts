import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
  type AuthenticationResponseJSON, type RegistrationResponseJSON
} from "@simplewebauthn/server";
import type { Action, Resource } from "../../core/src/authorization.ts";
import { STEP_UP_WINDOW_MS } from "../../core/src/authorization.ts";
import { base32Encode, lookupHmac, matchTotp, newTotpSecret, openText, otpauthUri, sealText, type KeyMaterial } from "../../security/src/index.ts";
import { assertAuthorized, AuthorizationError } from "./authorization.ts";
import type { SessionView } from "./identity.ts";

/**
 * JFA-20 phishing-resistant MFA and step-up. Passkeys (WebAuthn, via the
 * maintained @simplewebauthn/server library) are the primary factor; TOTP is a
 * fallback; single-use recovery codes cover device loss. Step-up is bound to
 * one server-side session and expires after STEP_UP_WINDOW_MS, so a stolen
 * session cookie without the authenticator cannot perform privileged actions.
 */
export type MfaDeps = Readonly<{ rpID: string; origin: string; rpName: string; sealKey: KeyMaterial; lookupKey: KeyMaterial; now?: () => Date }>;
export const ENROLL_FRESH_SESSION_MS = 15 * 60_000;
export const MFA_FAILURES_PER_15_MIN = 5;
const CHALLENGE_TTL_SECONDS = 300;

/** RP ID and origin derived from APP_PUBLIC_URL (e.g. https://jfa.example.org → rpID "jfa.example.org"). */
export function relyingPartyFrom(publicOrigin: string): { rpID: string; origin: string } | null {
  try {
    const u = new URL(publicOrigin);
    if (u.protocol !== "https:" && u.hostname !== "localhost") return null;
    return { rpID: u.hostname, origin: u.origin };
  } catch { return null; }
}

async function audit(client: PoolClient, actor: string, action: string, ref: string, result: "allow" | "deny" = "allow") {
  await client.query("INSERT INTO audit_events(actor_ref,action,resource_ref,policy_result) VALUES($1,$2,$3,$4)", [actor, action, ref, result]);
}

export async function hasMfa(client: PoolClient, identityId: string): Promise<boolean> {
  const r = await client.query<{ n: number }>(`SELECT
    (SELECT count(*) FROM webauthn_credentials WHERE identity_id=$1 AND revoked_at IS NULL)+
    (SELECT count(*) FROM totp_factors WHERE identity_id=$1 AND confirmed_at IS NOT NULL AND revoked_at IS NULL) AS n`, [identityId]);
  return Number(r.rows[0].n) > 0;
}

export async function getStepUp(client: PoolClient, sessionId: string): Promise<Date | null> {
  const r = await client.query<{ step_up_at: Date | null }>("SELECT step_up_at FROM auth_sessions WHERE id=$1 AND revoked_at IS NULL", [sessionId]);
  return r.rows[0]?.step_up_at ?? null;
}

function freshStepUp(stepUpAt: Date | null, now: Date) {
  return !!stepUpAt && now.getTime() - stepUpAt.getTime() <= STEP_UP_WINDOW_MS && stepUpAt.getTime() <= now.getTime();
}

/**
 * Adding a factor needs a fresh step-up if one exists already; the very first
 * factor needs a freshly created session (a just-used email link).
 */
export async function mayEnroll(client: PoolClient, session: SessionView, deps: Pick<MfaDeps, "now">): Promise<boolean> {
  const now = deps.now?.() ?? new Date();
  if (await hasMfa(client, session.identityId)) return freshStepUp(await getStepUp(client, session.sessionId), now);
  return now.getTime() - session.createdAt.getTime() <= ENROLL_FRESH_SESSION_MS;
}

async function markStepUp(client: PoolClient, session: SessionView, method: "passkey" | "totp" | "recovery_code") {
  await client.query("UPDATE auth_sessions SET step_up_at=now(),step_up_method=$2 WHERE id=$1 AND revoked_at IS NULL", [session.sessionId, method]);
  await audit(client, session.identityId, "mfa_step_up", `session:${session.sessionId}:${method}`);
}

async function throttled(client: PoolClient, identityId: string, deps: MfaDeps): Promise<boolean> {
  const bucket = lookupHmac(deps.lookupKey, `mfa-fail:${identityId}`);
  const r = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM auth_throttle_events WHERE bucket=$1 AND occurred_at>now()-interval '15 minutes'", [bucket]);
  return (r.rows[0]?.n ?? 0) >= MFA_FAILURES_PER_15_MIN;
}
async function recordFailure(client: PoolClient, session: SessionView, deps: MfaDeps, kind: string) {
  await client.query("INSERT INTO auth_throttle_events(bucket) VALUES($1)", [lookupHmac(deps.lookupKey, `mfa-fail:${session.identityId}`)]);
  await audit(client, session.identityId, "mfa_failure", `session:${session.sessionId}:${kind}`, "deny");
}

async function issueChallenge(client: PoolClient, session: SessionView, purpose: "register" | "step_up", challenge: string) {
  await client.query(`INSERT INTO webauthn_challenges(session_id,purpose,challenge,expires_at) VALUES($1,$2,$3,now()+make_interval(secs => $4))`,
    [session.sessionId, purpose, challenge, CHALLENGE_TTL_SECONDS]);
}

/** Single use, bound to the issuing session and purpose. */
async function consumeChallenge(client: PoolClient, session: SessionView, purpose: "register" | "step_up", clientDataJSON: unknown): Promise<string | null> {
  if (typeof clientDataJSON !== "string" || clientDataJSON.length > 4096) return null;
  let challenge: unknown;
  try { challenge = JSON.parse(Buffer.from(clientDataJSON, "base64url").toString("utf8")).challenge; } catch { return null; }
  if (typeof challenge !== "string") return null;
  const r = await client.query<{ challenge: string }>(`UPDATE webauthn_challenges SET consumed_at=now()
    WHERE challenge=$1 AND session_id=$2 AND purpose=$3 AND consumed_at IS NULL AND expires_at>now() RETURNING challenge`, [challenge, session.sessionId, purpose]);
  return r.rows[0]?.challenge ?? null;
}

async function issueRecoveryCodesIfFirst(client: PoolClient, identityId: string, deps: MfaDeps): Promise<string[] | null> {
  const existing = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM mfa_recovery_codes WHERE identity_id=$1", [identityId]);
  if (existing.rows[0].n > 0) return null;
  const codes = Array.from({ length: 10 }, () => base32Encode(randomBytes(10)).toLowerCase().replace(/(.{4})(.{4})(.{4})(.{4})/, "$1-$2-$3-$4"));
  for (const code of codes) await client.query("INSERT INTO mfa_recovery_codes(identity_id,code_digest) VALUES($1,$2)", [identityId, lookupHmac(deps.lookupKey, `recovery:${code}`)]);
  return codes;
}

export async function passkeyRegistrationOptions(client: PoolClient, session: SessionView, deps: MfaDeps) {
  if (!await mayEnroll(client, session, deps)) throw new AuthorizationError({ allowed: false, reason: "denied_step_up" });
  const existing = await client.query<{ credential_id: string; transports: string[] }>("SELECT credential_id,transports FROM webauthn_credentials WHERE identity_id=$1 AND revoked_at IS NULL", [session.identityId]);
  const options = await generateRegistrationOptions({
    rpName: deps.rpName, rpID: deps.rpID, userName: `account-${session.identityId.slice(0, 8)}`, userDisplayName: "Justice For All account",
    userID: Buffer.from(session.identityId.replace(/-/g, ""), "hex"), attestationType: "none", timeout: CHALLENGE_TTL_SECONDS * 1000,
    excludeCredentials: existing.rows.map(c => ({ id: c.credential_id, transports: c.transports })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "required" }
  });
  await issueChallenge(client, session, "register", options.challenge);
  return options;
}

export async function verifyPasskeyRegistration(client: PoolClient, session: SessionView, response: RegistrationResponseJSON, nickname: string, deps: MfaDeps):
  Promise<{ status: "registered"; recoveryCodes: string[] | null } | { status: "rejected" }> {
  if (!await mayEnroll(client, session, deps)) return { status: "rejected" };
  const challenge = await consumeChallenge(client, session, "register", response?.response?.clientDataJSON);
  if (!challenge) { await recordFailure(client, session, deps, "register_challenge"); return { status: "rejected" }; }
  let verified;
  try {
    verified = await verifyRegistrationResponse({ response, expectedChallenge: challenge, expectedOrigin: deps.origin, expectedRPID: deps.rpID, requireUserVerification: true });
  } catch { verified = { verified: false as const }; }
  if (!verified.verified) { await recordFailure(client, session, deps, "register_verify"); return { status: "rejected" }; }
  const cred = verified.registrationInfo.credential;
  const name = typeof nickname === "string" && /^[^<>]{1,60}$/.test(nickname.trim()) ? nickname.trim() : "Passkey";
  await client.query("BEGIN");
  try {
    await client.query(`INSERT INTO webauthn_credentials(identity_id,credential_id,public_key,counter,transports,nickname) VALUES($1,$2,$3,$4,$5,$6)`,
      [session.identityId, cred.id, Buffer.from(cred.publicKey), cred.counter, cred.transports ?? [], name]);
    const codes = await issueRecoveryCodesIfFirst(client, session.identityId, deps);
    await audit(client, session.identityId, "mfa_passkey_registered", `identity:${session.identityId}`);
    await client.query("COMMIT");
    return { status: "registered", recoveryCodes: codes };
  } catch (e) { await client.query("ROLLBACK").catch(() => undefined); throw e; }
}

export async function passkeyStepUpOptions(client: PoolClient, session: SessionView, deps: MfaDeps) {
  const creds = await client.query<{ credential_id: string; transports: string[] }>("SELECT credential_id,transports FROM webauthn_credentials WHERE identity_id=$1 AND revoked_at IS NULL", [session.identityId]);
  if (!creds.rows.length) return null;
  const options = await generateAuthenticationOptions({ rpID: deps.rpID, userVerification: "required", timeout: CHALLENGE_TTL_SECONDS * 1000,
    allowCredentials: creds.rows.map(c => ({ id: c.credential_id, transports: c.transports })) });
  await issueChallenge(client, session, "step_up", options.challenge);
  return options;
}

export async function verifyPasskeyStepUp(client: PoolClient, session: SessionView, response: AuthenticationResponseJSON, deps: MfaDeps): Promise<{ status: "stepped_up" | "rejected" | "locked" }> {
  if (await throttled(client, session.identityId, deps)) return { status: "locked" };
  const challenge = await consumeChallenge(client, session, "step_up", response?.response?.clientDataJSON);
  const cred = await client.query<{ id: string; credential_id: string; public_key: Buffer; counter: string; transports: string[] }>(
    "SELECT id,credential_id,public_key,counter,transports FROM webauthn_credentials WHERE credential_id=$1 AND identity_id=$2 AND revoked_at IS NULL",
    [typeof response?.id === "string" ? response.id : "", session.identityId]);
  const row = cred.rows[0];
  if (!challenge || !row) { await recordFailure(client, session, deps, "step_up_challenge"); return { status: "rejected" }; }
  let result;
  try {
    result = await verifyAuthenticationResponse({ response, expectedChallenge: challenge, expectedOrigin: deps.origin, expectedRPID: deps.rpID, requireUserVerification: true,
      credential: { id: row.credential_id, publicKey: new Uint8Array(row.public_key), counter: Number(row.counter), transports: row.transports } });
  } catch { result = null; }
  if (!result?.verified) { await recordFailure(client, session, deps, "step_up_verify"); return { status: "rejected" }; }
  await client.query("UPDATE webauthn_credentials SET counter=$2,last_used_at=now() WHERE id=$1", [row.id, result.authenticationInfo.newCounter]);
  await markStepUp(client, session, "passkey");
  return { status: "stepped_up" };
}

export async function beginTotpEnrollment(client: PoolClient, session: SessionView, deps: MfaDeps): Promise<{ secret: string; uri: string } | null> {
  if (!await mayEnroll(client, session, deps)) return null;
  const active = await client.query("SELECT 1 FROM totp_factors WHERE identity_id=$1 AND confirmed_at IS NOT NULL AND revoked_at IS NULL", [session.identityId]);
  if (active.rowCount) return null;
  const secret = newTotpSecret();
  await client.query(`INSERT INTO totp_factors(identity_id,secret_sealed,key_ref) VALUES($1,$2,$3)
    ON CONFLICT(identity_id) DO UPDATE SET secret_sealed=EXCLUDED.secret_sealed,key_ref=EXCLUDED.key_ref,confirmed_at=NULL,last_step=NULL,revoked_at=NULL,created_at=now()`,
    [session.identityId, sealText(deps.sealKey, secret, `totp:${session.identityId}`), deps.sealKey.id]);
  return { secret, uri: otpauthUri(secret, `account-${session.identityId.slice(0, 8)}`) };
}

async function loadTotp(client: PoolClient, identityId: string, deps: MfaDeps, confirmed: boolean) {
  const r = await client.query<{ secret_sealed: Buffer; key_ref: string; last_step: string | null }>(
    `SELECT secret_sealed,key_ref,last_step FROM totp_factors WHERE identity_id=$1 AND revoked_at IS NULL AND (confirmed_at IS NOT NULL)=$2 FOR UPDATE`, [identityId, confirmed]);
  const row = r.rows[0];
  if (!row || row.key_ref !== deps.sealKey.id) return null;
  return { secret: openText(deps.sealKey, row.secret_sealed, `totp:${identityId}`), lastStep: row.last_step === null ? null : Number(row.last_step) };
}

export async function confirmTotpEnrollment(client: PoolClient, session: SessionView, code: unknown, deps: MfaDeps): Promise<{ status: "active"; recoveryCodes: string[] | null } | { status: "rejected" | "locked" }> {
  if (await throttled(client, session.identityId, deps)) return { status: "locked" };
  await client.query("BEGIN");
  try {
    const pending = await loadTotp(client, session.identityId, deps, false);
    const step = pending ? matchTotp(pending.secret, code, (deps.now?.() ?? new Date()).getTime()) : null;
    if (!pending || step === null || !await mayEnroll(client, session, deps)) { await client.query("COMMIT"); await recordFailure(client, session, deps, "totp_enroll"); return { status: "rejected" }; }
    await client.query("UPDATE totp_factors SET confirmed_at=now(),last_step=$2 WHERE identity_id=$1", [session.identityId, step]);
    const codes = await issueRecoveryCodesIfFirst(client, session.identityId, deps);
    await audit(client, session.identityId, "mfa_totp_enrolled", `identity:${session.identityId}`);
    await client.query("COMMIT");
    return { status: "active", recoveryCodes: codes };
  } catch (e) { await client.query("ROLLBACK").catch(() => undefined); throw e; }
}

/** TOTP step-up; a time step can be used once (replay of an observed code fails). */
export async function stepUpWithTotp(client: PoolClient, session: SessionView, code: unknown, deps: MfaDeps): Promise<{ status: "stepped_up" | "rejected" | "locked" }> {
  if (await throttled(client, session.identityId, deps)) return { status: "locked" };
  await client.query("BEGIN");
  try {
    const f = await loadTotp(client, session.identityId, deps, true);
    const step = f ? matchTotp(f.secret, code, (deps.now?.() ?? new Date()).getTime()) : null;
    if (!f || step === null || (f.lastStep !== null && step <= f.lastStep)) {
      await client.query("COMMIT"); await recordFailure(client, session, deps, "totp"); return { status: "rejected" };
    }
    await client.query("UPDATE totp_factors SET last_step=$2 WHERE identity_id=$1", [session.identityId, step]);
    await markStepUp(client, session, "totp");
    await client.query("COMMIT");
    return { status: "stepped_up" };
  } catch (e) { await client.query("ROLLBACK").catch(() => undefined); throw e; }
}

export async function stepUpWithRecoveryCode(client: PoolClient, session: SessionView, code: unknown, deps: MfaDeps): Promise<{ status: "stepped_up" | "rejected" | "locked"; remaining?: number }> {
  if (await throttled(client, session.identityId, deps)) return { status: "locked" };
  const normalized = typeof code === "string" ? code.trim().toLowerCase() : "";
  if (!/^[a-z2-7]{4}-[a-z2-7]{4}-[a-z2-7]{4}-[a-z2-7]{4}$/.test(normalized)) { await recordFailure(client, session, deps, "recovery"); return { status: "rejected" }; }
  const r = await client.query("UPDATE mfa_recovery_codes SET used_at=now() WHERE identity_id=$1 AND code_digest=$2 AND used_at IS NULL RETURNING id",
    [session.identityId, lookupHmac(deps.lookupKey, `recovery:${normalized}`)]);
  if (!r.rowCount) { await recordFailure(client, session, deps, "recovery"); return { status: "rejected" }; }
  await markStepUp(client, session, "recovery_code");
  const left = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM mfa_recovery_codes WHERE identity_id=$1 AND used_at IS NULL", [session.identityId]);
  return { status: "stepped_up", remaining: left.rows[0].n };
}

/** Removing a factor requires a fresh step-up; the last factor of a staff member cannot be removed. */
export async function revokeFactor(client: PoolClient, session: SessionView, kind: "passkey" | "totp", id: string | null, deps: Pick<MfaDeps, "now">): Promise<{ status: "revoked" | "step_up_required" | "last_staff_factor" }> {
  const now = deps.now?.() ?? new Date();
  if (!freshStepUp(await getStepUp(client, session.sessionId), now)) return { status: "step_up_required" };
  const staff = await client.query("SELECT 1 FROM core_active_grants WHERE subject_id=$1 LIMIT 1", [session.identityId]);
  const counts = await client.query<{ p: number; t: number }>(`SELECT (SELECT count(*)::int FROM webauthn_credentials WHERE identity_id=$1 AND revoked_at IS NULL) AS p,
    (SELECT count(*)::int FROM totp_factors WHERE identity_id=$1 AND confirmed_at IS NOT NULL AND revoked_at IS NULL) AS t`, [session.identityId]);
  if (staff.rowCount && counts.rows[0].p + counts.rows[0].t <= 1) return { status: "last_staff_factor" };
  if (kind === "passkey") await client.query("UPDATE webauthn_credentials SET revoked_at=now() WHERE id=$1 AND identity_id=$2 AND revoked_at IS NULL", [id, session.identityId]);
  else await client.query("UPDATE totp_factors SET revoked_at=now() WHERE identity_id=$1 AND revoked_at IS NULL", [session.identityId]);
  await audit(client, session.identityId, `mfa_${kind}_revoked`, `identity:${session.identityId}`);
  return { status: "revoked" };
}

export async function factorSummary(client: PoolClient, identityId: string) {
  const p = await client.query<{ id: string; nickname: string; created_at: Date; last_used_at: Date | null }>(
    "SELECT id,nickname,created_at,last_used_at FROM webauthn_credentials WHERE identity_id=$1 AND revoked_at IS NULL ORDER BY created_at", [identityId]);
  const t = await client.query<{ confirmed_at: Date | null }>("SELECT confirmed_at FROM totp_factors WHERE identity_id=$1 AND revoked_at IS NULL", [identityId]);
  const rc = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM mfa_recovery_codes WHERE identity_id=$1 AND used_at IS NULL", [identityId]);
  return { passkeys: p.rows.map(r => ({ id: r.id, nickname: r.nickname, createdAt: r.created_at, lastUsedAt: r.last_used_at })),
    totp: t.rows[0] ? (t.rows[0].confirmed_at ? "active" : "pending") : "none", recoveryCodesLeft: rc.rows[0].n } as const;
}

/**
 * The gate every staff HTTP route must use: staff need an enrolled factor,
 * and privileged actions need a fresh step-up on *this* session.
 */
export async function authorizeStaffRequest(client: PoolClient, session: SessionView, action: Action, resource: Resource = { scope: "core" }): Promise<void> {
  if (!await hasMfa(client, session.identityId)) throw new AuthorizationError({ allowed: false, reason: "denied_step_up" });
  await assertAuthorized(client, session.identityId, action, resource, { enforceStepUp: true, stepUpAt: await getStepUp(client, session.sessionId) });
}
