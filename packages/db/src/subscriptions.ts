import { createHmac } from "node:crypto";
import type { PoolClient } from "pg";
import { findPurpose } from "../../core/src/consent.ts";
import { isWellFormedToken, newBearerToken, openText, tokenDigest } from "../../security/src/crypto.ts";
import { assertAuthorized } from "./authorization.ts";
import { ConsentRequiredError, requireConsent } from "./consent.ts";
import type { IdentityDeps } from "./identity.ts";

/**
 * JFA-24 subscription lifecycle. Every send requires: an active (double
 * opt-in confirmed) subscription, current `news_email` consent, an active
 * account, and an unsuppressed address — checked when queued AND again at
 * send time. Emails carry only editorial text plus an unsubscribe link.
 */
export const CONFIRM_TTL_HOURS = 24;
export const NOTIFY_MAX_ATTEMPTS = 6;

/** Deterministic per-subscription unsubscribe token (only its digest is stored). */
export function unsubscribeToken(deps: Pick<IdentityDeps, "lookupKey">, subscriptionId: string): string {
  return createHmac("sha256", deps.lookupKey.key).update(`unsubscribe:${subscriptionId}`).digest("base64url");
}

async function accountContact(client: PoolClient, identityId: string) {
  const r = await client.query<{ id: string; lookup_hmac: Buffer; address_ciphertext: Buffer; key_ref: string }>(`
    SELECT c.id,c.lookup_hmac,c.address_ciphertext,c.crypto_key_ref AS key_ref FROM contact_points c
    JOIN identities i ON i.id=c.identity_id AND i.account_state='active'
    WHERE c.identity_id=$1 AND c.purpose='account_email' AND c.retention_state='active' AND c.verified_at IS NOT NULL`, [identityId]);
  return r.rows[0] ?? null;
}

export type SubscriptionState = "none" | "pending" | "active";

export async function subscriptionStatus(client: PoolClient, identityId: string): Promise<SubscriptionState> {
  const r = await client.query<{ confirmation_state: string }>(`SELECT s.confirmation_state FROM subscriptions s
    JOIN contact_points c ON c.id=s.contact_point_id WHERE c.identity_id=$1 AND s.topic='news'
    AND s.confirmation_state IN ('pending_verification','active')`, [identityId]);
  const s = r.rows[0]?.confirmation_state;
  return s === "active" ? "active" : s === "pending_verification" ? "pending" : "none";
}

/** Starts double opt-in: requires consent, then emails a confirmation link. */
export async function startSubscription(client: PoolClient, actorId: string, subjectId: string, deps: IdentityDeps):
  Promise<{ status: "pending" | "active" | "consent_required" | "unavailable" }> {
  await assertAuthorized(client, actorId, "self.update", { scope: "core", ownerId: subjectId });
  try { await requireConsent(client, subjectId, "news_email"); } catch (e) { if (e instanceof ConsentRequiredError) return { status: "consent_required" }; throw e; }
  if (!deps.sender.available) return { status: "unavailable" };
  const contact = await accountContact(client, subjectId);
  if (!contact) return { status: "unavailable" };
  const token = newBearerToken();
  await client.query("BEGIN");
  let subscriptionId: string;
  try {
    const live = await client.query<{ id: string; confirmation_state: string }>(`SELECT id,confirmation_state FROM subscriptions
      WHERE contact_point_id=$1 AND topic='news' AND confirmation_state IN ('pending_verification','active') FOR UPDATE`, [contact.id]);
    if (live.rows[0]?.confirmation_state === "active") { await client.query("COMMIT"); return { status: "active" }; }
    if (live.rows[0]) {
      subscriptionId = live.rows[0].id;
      await client.query(`UPDATE subscriptions SET token_digest=$2,confirm_expires_at=now()+make_interval(hours => $3) WHERE id=$1`, [subscriptionId, tokenDigest(token), CONFIRM_TTL_HOURS]);
    } else {
      subscriptionId = (await client.query<{ id: string }>(`INSERT INTO subscriptions(contact_point_id,topic,confirmation_state,token_digest,confirm_expires_at)
        VALUES($1,'news','pending_verification',$2,now()+make_interval(hours => $3)) RETURNING id`, [contact.id, tokenDigest(token), CONFIRM_TTL_HOURS])).rows[0].id;
      await client.query("UPDATE subscriptions SET unsubscribe_digest=$2 WHERE id=$1", [subscriptionId, tokenDigest(unsubscribeToken(deps, subscriptionId))]);
    }
    await client.query("COMMIT");
  } catch (e) { await client.query("ROLLBACK").catch(() => undefined); throw e; }
  const email = openText(deps.sealKey, contact.address_ciphertext, `contact:${subjectId}`);
  const link = new URL("/subscriptions/confirm", deps.publicOrigin); link.searchParams.set("token", token);
  const sent = await deps.sender.send({
    to: email, category: "subscription_confirmation", idempotencyKey: `confirm-${subscriptionId}-${tokenDigest(token).toString("hex").slice(0, 12)}`,
    subject: "Confirm your Justice For All news subscription",
    text: `Please confirm that you want occasional news from Justice For All.\n\n${link}\n\nThis link expires in ${CONFIRM_TTL_HOURS} hours. If you did not ask for this, ignore this email and nothing will be sent.`
  });
  return { status: sent.status === "sent" ? "pending" : "unavailable" };
}

/** Second opt-in step. Re-subscribing deliberately lifts an earlier unsubscribe suppression. */
export async function confirmSubscription(client: PoolClient, token: unknown): Promise<{ status: "active" | "invalid_or_expired" }> {
  if (!isWellFormedToken(token)) return { status: "invalid_or_expired" };
  await client.query("BEGIN");
  try {
    const r = await client.query<{ id: string; lookup_hmac: Buffer }>(`UPDATE subscriptions s SET confirmation_state='active',confirmed_at=now(),token_digest=NULL
      FROM contact_points c WHERE c.id=s.contact_point_id AND s.token_digest=$1 AND s.confirmation_state='pending_verification' AND s.confirm_expires_at>now()
      RETURNING s.id,c.lookup_hmac`, [tokenDigest(token)]);
    if (!r.rows[0]) { await client.query("COMMIT"); return { status: "invalid_or_expired" }; }
    await client.query("DELETE FROM email_suppressions WHERE lookup_hmac=$1 AND reason='unsubscribed'", [r.rows[0].lookup_hmac]);
    await client.query("INSERT INTO audit_events(actor_ref,action,resource_ref,policy_result) VALUES('subscriber','subscription_confirmed',$1,'allow')", [`subscription:${r.rows[0].id}`]);
    await client.query("COMMIT");
    return { status: "active" };
  } catch (e) { await client.query("ROLLBACK").catch(() => undefined); throw e; }
}

/** One-click unsubscribe from any email. Always succeeds from the user's view; adds a suppression. */
export async function unsubscribeByToken(client: PoolClient, token: unknown): Promise<{ status: "unsubscribed" }> {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) return { status: "unsubscribed" };
  const r = await client.query<{ id: string; lookup_hmac: Buffer }>(`UPDATE subscriptions s SET confirmation_state='unsubscribed',unsubscribed_at=now()
    FROM contact_points c WHERE c.id=s.contact_point_id AND s.unsubscribe_digest=$1 AND s.confirmation_state IN ('pending_verification','active')
    RETURNING s.id,c.lookup_hmac`, [tokenDigest(token)]);
  for (const row of r.rows) {
    await client.query("INSERT INTO email_suppressions(lookup_hmac,reason) VALUES($1,'unsubscribed') ON CONFLICT(lookup_hmac) DO NOTHING", [row.lookup_hmac]);
    await client.query("INSERT INTO audit_events(actor_ref,action,resource_ref,policy_result) VALUES('subscriber','subscription_unsubscribed',$1,'allow')", [`subscription:${row.id}`]);
  }
  return { status: "unsubscribed" };
}

/** Account-side unsubscribe (also used when news consent is withdrawn). */
export async function unsubscribeIdentity(client: PoolClient, identityId: string): Promise<number> {
  const r = await client.query(`UPDATE subscriptions s SET confirmation_state='unsubscribed',unsubscribed_at=now()
    FROM contact_points c WHERE c.id=s.contact_point_id AND c.identity_id=$1 AND s.confirmation_state IN ('pending_verification','active')`, [identityId]);
  return r.rowCount ?? 0;
}

/** Bounce/complaint handling and manual suppression (support/admin). */
export async function suppressAddress(client: PoolClient, actorId: string, lookupHmac: Buffer, reason: "bounced" | "complained" | "manual"): Promise<void> {
  await assertAuthorized(client, actorId, "privacy.process");
  await client.query(`INSERT INTO email_suppressions(lookup_hmac,reason) VALUES($1,$2) ON CONFLICT(lookup_hmac) DO UPDATE SET reason=EXCLUDED.reason`, [lookupHmac, reason]);
  await client.query("INSERT INTO audit_events(actor_ref,action,resource_ref,policy_result) VALUES($1,'email_suppressed',$2,'allow')", [actorId, `suppression:${reason}`]);
}

const ELIGIBLE = `s.confirmation_state='active' AND c.retention_state='active' AND i.account_state='active'
  AND NOT EXISTS (SELECT 1 FROM email_suppressions x WHERE x.lookup_hmac=c.lookup_hmac)
  AND EXISTS (SELECT 1 FROM core_current_consent cc WHERE cc.subject_ref='identity:'||c.identity_id::text
    AND cc.purpose='news_email' AND cc.decision='grant' AND cc.policy_version>=$REQ)`;

/** Editors/admins queue a plain-text campaign to currently eligible subscribers only. */
export async function queueCampaign(client: PoolClient, actorId: string, input: { subject: string; body: string }): Promise<{ campaignId: string; recipients: number }> {
  await assertAuthorized(client, actorId, "cms.publish");
  const reconsent = findPurpose("news_email")!.reconsentFrom;
  await client.query("BEGIN");
  try {
    const campaignId = (await client.query<{ id: string }>("INSERT INTO notification_campaigns(topic,subject,body_text,created_by) VALUES('news',$1,$2,$3) RETURNING id",
      [input.subject, input.body, actorId])).rows[0].id;
    const r = await client.query(`INSERT INTO notification_deliveries(campaign_id,subscription_id)
      SELECT $1,s.id FROM subscriptions s JOIN contact_points c ON c.id=s.contact_point_id JOIN identities i ON i.id=c.identity_id
      WHERE s.topic='news' AND ${ELIGIBLE.replace("$REQ", "$2")} ON CONFLICT DO NOTHING`, [campaignId, reconsent]);
    await client.query("INSERT INTO audit_events(actor_ref,action,resource_ref,policy_result) VALUES($1,'campaign_queued',$2,'allow')", [actorId, `campaign:${campaignId}`]);
    await client.query("COMMIT");
    return { campaignId, recipients: r.rowCount ?? 0 };
  } catch (e) { await client.query("ROLLBACK").catch(() => undefined); throw e; }
}

/** Sends due deliveries; every gate is re-checked at send time. Idempotent per delivery ID. */
export async function deliverNotifications(client: PoolClient, deps: IdentityDeps, limit = 50): Promise<{ sent: number; skipped: number; retried: number; dead: number }> {
  const reconsent = findPurpose("news_email")!.reconsentFrom;
  const claimed = await client.query<{ id: string; attempts: number }>(`UPDATE notification_deliveries SET state='sending',lease_expires_at=now()+interval '2 minutes'
    WHERE id IN (SELECT id FROM notification_deliveries WHERE (state IN ('pending','failed') AND (next_attempt_at IS NULL OR next_attempt_at<=now()))
      OR (state='sending' AND lease_expires_at<now()) ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED) RETURNING id,attempts`, [Math.min(Math.max(limit, 1), 200)]);
  const out = { sent: 0, skipped: 0, retried: 0, dead: 0 };
  for (const d of claimed.rows) {
    const row = (await client.query<{ subscription_id: string; identity_id: string; address_ciphertext: Buffer; subject: string; body_text: string; eligible: boolean }>(`
      SELECT s.id AS subscription_id,c.identity_id,c.address_ciphertext,k.subject,k.body_text,(${ELIGIBLE.replace("$REQ", "$2")}) AS eligible
      FROM notification_deliveries n JOIN notification_campaigns k ON k.id=n.campaign_id JOIN subscriptions s ON s.id=n.subscription_id
      JOIN contact_points c ON c.id=s.contact_point_id JOIN identities i ON i.id=c.identity_id WHERE n.id=$1`, [d.id, reconsent])).rows[0];
    if (!row?.eligible || !deps.sender.available) {
      await client.query("UPDATE notification_deliveries SET state='skipped',lease_expires_at=NULL,last_error=$2 WHERE id=$1", [d.id, row?.eligible ? "sender_unavailable" : "not_eligible"]);
      out.skipped++; continue;
    }
    const unsubToken = unsubscribeToken(deps, row.subscription_id);
    const unsub = new URL("/subscriptions/unsubscribe", deps.publicOrigin); unsub.searchParams.set("token", unsubToken);
    const oneClick = new URL("/subscriptions/unsubscribe/submit", deps.publicOrigin); oneClick.searchParams.set("token", unsubToken);
    const result = await deps.sender.send({
      to: openText(deps.sealKey, row.address_ciphertext, `contact:${row.identity_id}`), category: "notification", idempotencyKey: `delivery-${d.id}`,
      subject: row.subject,
      text: `${row.body_text}\n\n—\nYou receive this because you subscribed to Justice For All news.\nUnsubscribe instantly: ${unsub}`,
      headers: { "List-Unsubscribe": `<${oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }
    });
    const attempts = d.attempts + 1;
    if (result.status === "sent") {
      await client.query("UPDATE notification_deliveries SET state='sent',sent_at=now(),attempts=$2,provider_message_id=$3,lease_expires_at=NULL,last_error=NULL WHERE id=$1", [d.id, attempts, result.providerMessageId.slice(0, 200)]);
      out.sent++;
    } else if (!result.retryable || attempts >= NOTIFY_MAX_ATTEMPTS) {
      await client.query("UPDATE notification_deliveries SET state='dead',attempts=$2,last_error=$3,lease_expires_at=NULL WHERE id=$1", [d.id, attempts, /^[a-z0-9_]{1,60}$/.test(result.reason) ? result.reason : "send_failed"]);
      out.dead++;
    } else {
      await client.query("UPDATE notification_deliveries SET state='failed',attempts=$2,last_error=$3,next_attempt_at=now()+make_interval(secs => $4),lease_expires_at=NULL WHERE id=$1",
        [d.id, attempts, /^[a-z0-9_]{1,60}$/.test(result.reason) ? result.reason : "send_failed", Math.min(60 * 2 ** (attempts - 1), 6 * 3600)]);
      out.retried++;
    }
  }
  return out;
}
