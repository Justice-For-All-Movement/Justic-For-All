import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { countActiveSessions, getSharedPool } from "@jfa/db";
import { currentSession } from "../../lib/auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your account — Justice For All", robots: { index: false, follow: false } };

type Context = { searchParams: Promise<{ welcome?: string; status?: string }> };

export default async function Account({ searchParams }: Context) {
  const session = await currentSession();
  if (!session) redirect("/account/sign-in");
  const { welcome, status } = await searchParams;
  let sessions: number | null = null;
  const pool = getSharedPool();
  if (pool) { try { const c = await pool.connect(); try { sessions = await countActiveSessions(c, session.identityId); } finally { c.release(); } } catch { sessions = null; } }
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
