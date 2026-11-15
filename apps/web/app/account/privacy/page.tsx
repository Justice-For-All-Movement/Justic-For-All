import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CONSENT_PURPOSES } from "@jfa/core";
import { consentStatus, getSharedPool } from "@jfa/db";
import { currentSession } from "../../../lib/auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Privacy choices — Justice For All", robots: { index: false, follow: false } };

const label = { granted: "On", withdrawn: "Off (withdrawn)", never: "Off", reconsent_required: "Off: our wording changed, please review" } as const;

export default async function PrivacyChoices({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const session = await currentSession();
  if (!session) redirect("/account/sign-in");
  const pool = getSharedPool();
  let states: Awaited<ReturnType<typeof consentStatus>> | null = null;
  if (pool) { try { const c = await pool.connect(); try { states = await consentStatus(c, session.identityId); } finally { c.release(); } } catch { states = null; } }
  const { status } = await searchParams;
  return <article className="wrap public-article">
    <p className="eyebrow">Account</p>
    <h1>Your privacy choices</h1>
    <p className="lede">Everything here is optional and off unless you turn it on. Turning something off stops future use straight away. Each choice covers only what it describes.</p>
    {status === "saved" ? <p role="status" className="ui-note">Your choice was saved.</p> : null}
    {status === "error" ? <p role="alert" className="ui-note ui-note--caution">Nothing was changed. Please try again.</p> : null}
    {states === null ? <p>Your choices cannot be shown right now.</p> : CONSENT_PURPOSES.map(p => {
      const s = states!.find(x => x.purpose === p.id)!;
      const on = s.status === "granted";
      return <section key={p.id} aria-labelledby={`c-${p.id}`} className="ui-panel">
        <h2 id={`c-${p.id}`}>{p.title}</h2>
        <p>{p.description}</p>
        <p>Status: <strong>{label[s.status]}</strong>{s.recordedAt ? <> since <time dateTime={s.recordedAt.toISOString()}>{s.recordedAt.toISOString().slice(0, 10)}</time></> : null}. Policy version {p.version}.</p>
        <form method="post" action="/account/consent">
          <input type="hidden" name="purpose" value={p.id} />
          <input type="hidden" name="decision" value={on ? "withdraw" : "grant"} />
          <button className="ui-button" type="submit">{on ? `Turn off: ${p.title}` : `Turn on: ${p.title}`}</button>
        </form>
      </section>;
    })}
    <p><a href="/account/consent/export">Download my consent history (JSON)</a> · <Link href="/account">Back to account</Link></p>
  </article>;
}
