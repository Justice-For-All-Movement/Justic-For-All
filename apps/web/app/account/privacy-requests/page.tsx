import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSharedPool, listOwnRequests, type OwnRequest } from "@jfa/db";
import { currentSession } from "../../../lib/auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Privacy requests — Justice For All", robots: { index: false, follow: false } };

const messages: Record<string, string> = {
  received: "Your request was received. We respond within 30 days.",
  already_open: "You already have an open request of that kind.",
  invalid: "Please complete the form. For corrections, describe what is wrong."
};

export default async function PrivacyRequests({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const session = await currentSession();
  if (!session) redirect("/account/sign-in");
  const { status } = await searchParams;
  let requests: OwnRequest[] | null = null;
  const pool = getSharedPool();
  if (pool) { try { const c = await pool.connect(); try { requests = await listOwnRequests(c, session.identityId, session.identityId); } finally { c.release(); } } catch { requests = null; } }
  return <article className="wrap public-article">
    <p className="eyebrow">Account</p>
    <h1>Your data and privacy requests</h1>
    {status && messages[status] ? <p role="status" className="ui-note">{messages[status]}</p> : null}
    <section aria-labelledby="copy"><h2 id="copy">Get a copy of your data</h2>
      <p><a href="/account/data-export">Download your data (JSON)</a>. It includes your account dates, profile, subscriptions, consent history and requests.</p>
    </section>
    <section aria-labelledby="ask"><h2 id="ask">Ask us to correct or restrict</h2>
      <form method="post" action="/account/privacy-requests/submit">
        <fieldset><legend className="ui-label">Request</legend>
          <div><input type="radio" id="t-correct" name="type" value="correct" required /> <label htmlFor="t-correct">Correct something we hold about me</label></div>
          <div><input type="radio" id="t-restrict" name="type" value="restrict" /> <label htmlFor="t-restrict">Restrict how my data is used</label></div>
          <div><input type="radio" id="t-access" name="type" value="access" /> <label htmlFor="t-access">Ask a person to confirm everything you hold about me</label></div>
        </fieldset>
        <label className="ui-label" htmlFor="note">Details (needed for corrections)</label>
        <textarea className="ui-input" id="note" name="note" maxLength={1000} rows={4} />
        <button className="ui-button" type="submit">Send request</button>
      </form>
      <p>To delete your account and data, use <Link href="/account">Delete account</Link>.</p>
    </section>
    <section aria-labelledby="limits"><h2 id="limits">What we can and cannot do</h2>
      <ul>
        <li>We respond within 30 days and tell you if anything must be kept by law (a legal hold).</li>
        <li>We cannot recall copies that others have already republished or replicated, including on independent archives.</li>
        <li>Encrypted backups age out on our backup schedule, not instantly.</li>
        <li>Records of your consent decisions and security audit entries keep only an internal ID, never your email, as evidence that we acted lawfully.</li>
      </ul>
    </section>
    <section aria-labelledby="mine"><h2 id="mine">Your requests</h2>
      {requests === null ? <p>Your requests cannot be shown right now.</p> : requests.length === 0 ? <p>No requests yet.</p> :
        <ul>{requests.map(r => <li key={r.id}>{r.type}: <strong>{r.status.replace(/_/g, " ")}</strong>, opened <time dateTime={r.createdAt.toISOString()}>{r.createdAt.toISOString().slice(0, 10)}</time>{r.outcome ? ` (${r.outcome.replace(/_/g, " ")})` : ""}. Receipt: <code>{r.id}</code></li>)}</ul>}
    </section>
  </article>;
}
