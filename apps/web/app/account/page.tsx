import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { countActiveSessions, getOwnProfile, getSharedPool, subscriptionStatus, type SubscriptionState } from "@jfa/db";
import { currentSession } from "../../lib/auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your account — Justice For All", robots: { index: false, follow: false } };

type Context = { searchParams: Promise<{ welcome?: string; status?: string }> };

const newsMessages: Record<string, string> = {
  news_pending: "Check your email and select the confirmation link to finish subscribing.",
  news_active: "You are already subscribed.",
  news_stopped: "News emails are stopped.",
  news_consent_required: "First turn on “News by email” in your privacy choices.",
  news_unavailable: "Email is not available right now. Nothing was changed."
};

const nameMessages: Record<string, string> = {
  name_public: "Your public name is saved and visible.",
  name_private: "Your public name is hidden.",
  name_rejected: "That name cannot be used.",
  name_length: "Use 3 to 40 characters.",
  name_characters: "Use letters, numbers, spaces, dots, dashes or apostrophes only.",
  name_contact_details: "Public names cannot contain email addresses, phone numbers or links.",
  name_reserved: "That name could be mistaken for staff or the organization.",
  name_taken: "Someone else is already using that public name.",
  name_consent_required: "First turn on “Show my public name” in your privacy choices."
};

export default async function Account({ searchParams }: Context) {
  const session = await currentSession();
  if (!session) redirect("/account/sign-in");
  const { welcome, status } = await searchParams;
  let sessions: number | null = null;
  let profile: { name: string | null; visibility: "public" | "private" } = { name: null, visibility: "private" };
  let news: SubscriptionState | null = null;
  const pool = getSharedPool();
  if (pool) { try { const c = await pool.connect(); try { sessions = await countActiveSessions(c, session.identityId); profile = await getOwnProfile(c, session.identityId); news = await subscriptionStatus(c, session.identityId); } finally { c.release(); } } catch { sessions = null; } }
  return <article className="wrap public-article">
    <p className="eyebrow">Account</p>
    <h1>Your account</h1>
    {welcome ? <p role="status" className="ui-note">Your account is ready. It is private: no public profile is created.</p> : null}
    {status === "confirm_required" ? <p role="alert" className="ui-note ui-note--caution">Type the confirmation word exactly to continue.</p> : null}
    {status === "error" ? <p role="alert" className="ui-note ui-note--caution">Something went wrong. Nothing was changed.</p> : null}
    <section aria-labelledby="sessions"><h2 id="sessions">Sessions</h2>
      <p>Signed in since <time dateTime={session.createdAt.toISOString()}>{session.createdAt.toISOString().slice(0, 10)}</time>. This session ends by <time dateTime={session.absoluteExpiresAt.toISOString()}>{session.absoluteExpiresAt.toISOString().slice(0, 10)}</time>.</p>
      <p>{sessions === null ? "Active session count is unavailable." : `Active sessions: ${sessions}.`}</p>
      <form method="post" action="/auth/sign-out"><button className="ui-button" type="submit">Sign out</button></form>
      <form method="post" action="/account/sign-out-everywhere"><button className="ui-button" type="submit">Sign out on every device</button></form>
    </section>
    <section aria-labelledby="public-name"><h2 id="public-name">Public name (optional)</h2>
      <p>A public name is a label shown next to things you choose to publish. It is <strong>not</strong> anonymity: we still know which account it belongs to. It never shows your email address. To use one, first turn on <Link href="/account/privacy">Show my public name</Link>.</p>
      {status?.startsWith("name_") ? <p role="status" className="ui-note">{nameMessages[status] ?? "Nothing was changed."}</p> : null}
      <p>Current: {profile.visibility === "public" && profile.name ? <strong>{profile.name}</strong> : "no public name (private)"}.</p>
      <form method="post" action="/account/public-name">
        <label className="ui-label" htmlFor="public-name-input">Public name</label>
        <span className="ui-hint" id="public-name-hint">3 to 40 letters, numbers, spaces, dots, dashes or apostrophes. No email addresses, phone numbers or links.</span>
        <input className="ui-input" id="public-name-input" name="name" maxLength={40} aria-describedby="public-name-hint" defaultValue={profile.name ?? ""} />
        <button className="ui-button" type="submit" name="action" value="set">Save public name</button>
        <button className="ui-button" type="submit" name="action" value="hide">Hide my public name</button>
      </form>
    </section>
    <section aria-labelledby="news-h"><h2 id="news-h">News by email (optional)</h2>
      {status?.startsWith("news_") ? <p role="status" className="ui-note">{newsMessages[status] ?? "Nothing was changed."}</p> : null}
      <p>Status: <strong>{news === "active" ? "subscribed" : news === "pending" ? "waiting for you to confirm by email" : news === null ? "unavailable" : "not subscribed"}</strong>.</p>
      <p>We need your permission (<Link href="/account/privacy">News by email</Link>) and a confirmation click in the email we send. Every email has a one-click unsubscribe link.</p>
      <form method="post" action="/account/subscription">
        {news === "active" || news === "pending" ? <button className="ui-button" type="submit" name="action" value="stop">Stop news emails</button>
          : <button className="ui-button" type="submit" name="action" value="start">Subscribe to news</button>}
      </form>
    </section>
    <p><Link href="/account/privacy">Privacy choices and consent history</Link> · <Link href="/account/privacy-requests">Your data and privacy requests</Link> · <Link href="/account/security">Sign-in security</Link></p>
    <section aria-labelledby="deactivate-h"><h2 id="deactivate-h">Deactivate account</h2>
      <p>Ends every session and stops sign-in. Your data is kept until you ask us to delete it.</p>
      <form method="post" action="/account/deactivate">
        <label className="ui-label" htmlFor="confirm-deactivate">Type <strong>deactivate</strong> to confirm</label>
        <input className="ui-input" id="confirm-deactivate" name="confirm" autoComplete="off" required />
        <button className="ui-button" type="submit">Deactivate</button>
      </form>
    </section>
    <section aria-labelledby="delete-h"><h2 id="delete-h">Delete account</h2>
      <p>Records a deletion request, disables the account immediately and ends every session. Deletion finishes within 30 days unless the law requires us to keep something, and we will tell you if it does. We cannot remove copies that others have already republished.</p>
      <form method="post" action="/account/delete">
        <label className="ui-label" htmlFor="confirm-delete">Type <strong>delete</strong> to confirm</label>
        <input className="ui-input" id="confirm-delete" name="confirm" autoComplete="off" required />
        <button className="ui-button" type="submit">Request deletion</button>
      </form>
    </section>
  </article>;
}
