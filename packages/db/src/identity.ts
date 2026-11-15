import type { PoolClient } from "pg";
import type { EmailSender } from "../../adapters/src/email.ts";
import {
  isWellFormedToken, lookupHmac, newBearerToken, normalizeEmail, openText, sealText, tokenDigest, type KeyMaterial
} from "../../security/src/crypto.ts";

/**
 * JFA-19 identity lifecycle: passwordless email-link sign-in (doubles as
 * sign-up and recovery), opaque server-side sessions, sign-out everywhere,
 * deactivation and deletion requests. Callers pass a dedicated client.
 */
export type IdentityDeps = Readonly<{
  lookupKey: KeyMaterial;
  sealKey: KeyMaterial;
  sender: EmailSender;
  publicOrigin: string;
  now?: () => Date;
}>;

export const SIGN_IN_TTL_MINUTES = 15;
export const SESSION_IDLE_HOURS = 24 * 7;
export const SESSION_ABSOLUTE_DAYS = 30;
export const THROTTLE_PER_EMAIL_PER_HOUR = 5;
export const THROTTLE_PER_CLIENT_PER_HOUR = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type SignInRequestResult = Readonly<{ status: "accepted" | "invalid_email" | "unavailable" }>;

async function throttled(client: PoolClient, bucket: Buffer, limit: number): Promise<boolean> {
  const r = await client.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM auth_throttle_events WHERE bucket=$1 AND occurred_at > now() - interval '1 hour'", [bucket]);
  return (r.rows[0]?.n ?? 0) >= limit;
}

/**
 * Same `accepted` response whether or not an account exists, is disabled or
 * is throttled, so the endpoint cannot be used to enumerate accounts.
 */
export async function requestSignInLink(client: PoolClient, input: { email: unknown; clientKey: string }, deps: IdentityDeps): Promise<SignInRequestResult> {
  const email = normalizeEmail(input.email);
  if (!email) return { status: "invalid_email" };
  if (!deps.sender.available) return { status: "unavailable" };
  const emailLookup = lookupHmac(deps.lookupKey, `email:${email}`);
  const emailBucket = lookupHmac(deps.lookupKey, `throttle:email:${email}`);
  const clientBucket = lookupHmac(deps.lookupKey, `throttle:client:${input.clientKey}`);
  await client.query("DELETE FROM auth_throttle_events WHERE occurred_at < now() - interval '1 day'");
  const limited = await throttled(client, emailBucket, THROTTLE_PER_EMAIL_PER_HOUR) || await throttled(client, clientBucket, THROTTLE_PER_CLIENT_PER_HOUR);
  await client.query("INSERT INTO auth_throttle_events(bucket) VALUES ($1),($2)", [emailBucket, clientBucket]);
  if (limited) return { status: "accepted" };

  const existing = await client.query<{ account_state: string }>(`SELECT i.account_state FROM contact_points c
    JOIN identities i ON i.id=c.identity_id
    WHERE c.lookup_hmac=$1 AND c.purpose='account_email' AND c.retention_state='active'`, [emailLookup]);
  if (existing.rows[0] && existing.rows[0].account_state !== "active") return { status: "accepted" };

  const token = newBearerToken();
  const now = deps.now?.() ?? new Date();
  const expires = new Date(now.getTime() + SIGN_IN_TTL_MINUTES * 60_000);
  const inserted = await client.query<{ id: string }>(`INSERT INTO auth_sign_in_tokens(token_digest,email_lookup,email_sealed,key_ref,created_at,expires_at)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
    [tokenDigest(token), emailLookup, sealText(deps.sealKey, email, "sign-in-email"), deps.sealKey.id, now, expires]);
  const link = new URL("/auth/verify", deps.publicOrigin);
  link.searchParams.set("token", token);
  const sent = await deps.sender.send({
    to: email, category: "sign_in_link", idempotencyKey: `sign-in-${inserted.rows[0].id}`,
    subject: "Your Justice For All sign-in link",
    text: `Use this link to sign in to Justice For All. It expires in ${SIGN_IN_TTL_MINUTES} minutes and works once.\n\n${link.toString()}\n\nIf you did not ask for this, you can ignore this email.`
  });
  if (sent.status !== "sent") {
    await client.query("UPDATE auth_sign_in_tokens SET consumed_at=now() WHERE id=$1", [inserted.rows[0].id]);
    return { status: "unavailable" };
  }
  return { status: "accepted" };
}

export type ConsumeResult = Readonly<
  { status: "signed_in"; sessionToken: string; identityId: string; newAccount: boolean; absoluteExpiresAt: Date } |
  { status: "invalid_or_expired" }>;

/** Single use: the token is consumed even if a later step refuses sign-in. */
export async function consumeSignInLink(client: PoolClient, token: unknown, deps: IdentityDeps): Promise<ConsumeResult> {
  if (!isWellFormedToken(token)) return { status: "invalid_or_expired" };
  await client.query("BEGIN");
  try {
    const found = await client.query<{ id: string; email_lookup: Buffer; email_sealed: Buffer; key_ref: string }>(`
      UPDATE auth_sign_in_tokens SET consumed_at=now()
      WHERE token_digest=$1 AND consumed_at IS NULL AND expires_at>now()
      RETURNING id,email_lookup,email_sealed,key_ref`, [tokenDigest(token)]);
    const row = found.rows[0];
    if (!row || row.key_ref !== deps.sealKey.id) { await client.query("COMMIT"); return { status: "invalid_or_expired" }; }
    // Serialize first sign-in for the same address so two links cannot create two accounts.
    await client.query("SELECT pg_advisory_xact_lock(hashtext(encode($1::bytea,'hex')))", [row.email_lookup]);
    const contact = await client.query<{ identity_id: string; account_state: string }>(`SELECT c.identity_id,i.account_state
      FROM contact_points c JOIN identities i ON i.id=c.identity_id
      WHERE c.lookup_hmac=$1 AND c.purpose='account_email' AND c.retention_state='active' FOR UPDATE OF i`, [row.email_lookup]);
    let identityId: string, newAccount = false;
    if (contact.rows[0]) {
      if (contact.rows[0].account_state !== "active") { await client.query("COMMIT"); return { status: "invalid_or_expired" }; }
      identityId = contact.rows[0].identity_id;
      await client.query(`UPDATE contact_points SET verified_at=coalesce(verified_at,now())
        WHERE lookup_hmac=$1 AND purpose='account_email' AND retention_state='active'`, [row.email_lookup]);
    } else {
      const email = openText(deps.sealKey, row.email_sealed, "sign-in-email");
      const created = await client.query<{ id: string }>("INSERT INTO identities(account_state) VALUES('active') RETURNING id");
      identityId = created.rows[0].id;
      newAccount = true;
      await client.query(`INSERT INTO contact_points(identity_id,purpose,address_ciphertext,crypto_key_ref,lookup_hmac,verified_at)
        VALUES($1,'account_email',$2,$3,$4,now())`, [identityId, sealText(deps.sealKey, email, `contact:${identityId}`), deps.sealKey.id, row.email_lookup]);
      await client.query("INSERT INTO profiles(identity_id) VALUES($1)", [identityId]);
      await client.query("INSERT INTO authenticators(identity_id,method,credential_ref) VALUES($1,'email_link','account_email')", [identityId]);
    }
    const session = await createSession(client, identityId, deps);
    await client.query("UPDATE authenticators SET last_used_at=now() WHERE identity_id=$1 AND method='email_link'", [identityId]);
    await audit(client, identityId, newAccount ? "account_created" : "auth_signed_in", `identity:${identityId}`);
    await client.query("COMMIT");
    return { status: "signed_in", sessionToken: session.token, identityId, newAccount, absoluteExpiresAt: session.absoluteExpiresAt };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function createSession(client: PoolClient, identityId: string, deps: IdentityDeps) {
  const token = newBearerToken();
  const now = deps.now?.() ?? new Date();
  const absoluteExpiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_DAYS * 86_400_000);
  const idle = new Date(Math.min(now.getTime() + SESSION_IDLE_HOURS * 3_600_000, absoluteExpiresAt.getTime()));
  await client.query(`INSERT INTO auth_sessions(identity_id,token_digest,created_at,last_seen_at,idle_expires_at,absolute_expires_at)
    VALUES($1,$2,$3,$3,$4,$5)`, [identityId, tokenDigest(token), now, idle, absoluteExpiresAt]);
  return { token, absoluteExpiresAt };
}

async function audit(client: PoolClient, actor: string, action: string, resource: string) {
  await client.query("INSERT INTO audit_events(actor_ref,action,resource_ref,policy_result) VALUES($1,$2,$3,'allow')", [actor, action, resource]);
}

export type SessionView = Readonly<{ sessionId: string; identityId: string; createdAt: Date; absoluteExpiresAt: Date }>;

/** Validates an opaque session token; slides idle expiry at most every 5 minutes. */
export async function getSession(client: PoolClient, token: unknown): Promise<SessionView | null> {
  if (!isWellFormedToken(token)) return null;
  const r = await client.query<{ id: string; identity_id: string; created_at: Date; absolute_expires_at: Date; last_seen_at: Date }>(`
    SELECT s.id,s.identity_id,s.created_at,s.absolute_expires_at,s.last_seen_at FROM auth_sessions s
    JOIN identities i ON i.id=s.identity_id AND i.account_state='active'
    WHERE s.token_digest=$1 AND s.revoked_at IS NULL AND s.idle_expires_at>now() AND s.absolute_expires_at>now()`, [tokenDigest(token)]);
  const row = r.rows[0];
  if (!row) return null;
  if (Date.now() - row.last_seen_at.getTime() > 5 * 60_000) {
    await client.query(`UPDATE auth_sessions SET last_seen_at=now(),
      idle_expires_at=least(now() + make_interval(hours => $2), absolute_expires_at) WHERE id=$1`, [row.id, SESSION_IDLE_HOURS]);
  }
  return Object.freeze({ sessionId: row.id, identityId: row.identity_id, createdAt: row.created_at, absoluteExpiresAt: row.absolute_expires_at });
}

export async function signOut(client: PoolClient, token: unknown): Promise<void> {
  if (!isWellFormedToken(token)) return;
  await client.query("UPDATE auth_sessions SET revoked_at=now(),revoke_reason='sign_out' WHERE token_digest=$1 AND revoked_at IS NULL", [tokenDigest(token)]);
}

async function revokeAll(client: PoolClient, identityId: string, reason: string): Promise<number> {
  const r = await client.query("UPDATE auth_sessions SET revoked_at=now(),revoke_reason=$2 WHERE identity_id=$1 AND revoked_at IS NULL", [identityId, reason]);
  return r.rowCount ?? 0;
}

export async function signOutEverywhere(client: PoolClient, identityId: string): Promise<number> {
  if (!UUID.test(identityId)) throw new Error("Invalid identity");
  const n = await revokeAll(client, identityId, "sign_out_all");
  await audit(client, identityId, "auth_signed_out_everywhere", `identity:${identityId}`);
  return n;
}

/** Disables sign-in and revokes every session. Reversible by an administrator. */
export async function deactivateAccount(client: PoolClient, identityId: string): Promise<void> {
  if (!UUID.test(identityId)) throw new Error("Invalid identity");
  await client.query("BEGIN");
  try {
    await client.query(`UPDATE identities SET account_state='disabled',disabled_at=now(),row_version=row_version+1
      WHERE id=$1 AND account_state='active'`, [identityId]);
    await revokeAll(client, identityId, "account_disabled");
    await audit(client, identityId, "account_deactivated", `identity:${identityId}`);
    await client.query("COMMIT");
  } catch (e) { await client.query("ROLLBACK").catch(() => undefined); throw e; }
}

/**
 * Records an erasure request for the privacy workflow (JFA-27), disables the
 * account and revokes sessions immediately. Returns the request ID as receipt.
 */
export async function requestAccountDeletion(client: PoolClient, identityId: string): Promise<{ requestId: string }> {
  if (!UUID.test(identityId)) throw new Error("Invalid identity");
  await client.query("BEGIN");
  try {
    const req = await client.query<{ id: string }>(`INSERT INTO privacy_requests(identity_id,request_type,due_at,status)
      VALUES($1,'erase',now()+interval '30 days','received') RETURNING id`, [identityId]);
    await client.query(`UPDATE identities SET account_state='disabled',disabled_at=now(),row_version=row_version+1
      WHERE id=$1 AND account_state='active'`, [identityId]);
    await revokeAll(client, identityId, "deletion_requested");
    await audit(client, identityId, "account_deletion_requested", `privacy-request:${req.rows[0].id}`);
    await client.query("COMMIT");
    return { requestId: req.rows[0].id };
  } catch (e) { await client.query("ROLLBACK").catch(() => undefined); throw e; }
}

export async function countActiveSessions(client: PoolClient, identityId: string): Promise<number> {
  const r = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM auth_sessions
    WHERE identity_id=$1 AND revoked_at IS NULL AND idle_expires_at>now() AND absolute_expires_at>now()`, [identityId]);
  return r.rows[0]?.n ?? 0;
}
