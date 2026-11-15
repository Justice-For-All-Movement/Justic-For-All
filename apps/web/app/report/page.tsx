import type { Metadata } from "next";
import Link from "next/link";
import { REPORT_REASONS } from "@jfa/db";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Report a problem — Justice For All", robots: { index: false, follow: false } };

const labels: Record<string, string> = {
  privacy_exposure: "It exposes someone's private information",
  harassment_or_threat: "It harasses or threatens someone",
  inaccurate: "It is inaccurate or misleading",
  copyright: "It uses my work without permission",
  safety_risk: "It could put someone at risk",
  other: "Something else"
};

type Context = { searchParams: Promise<{ slug?: string; status?: string; receipt?: string }> };

export default async function Report({ searchParams }: Context) {
  const { slug, status, receipt } = await searchParams;
  const validSlug = typeof slug === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? slug : "";
  return <article className="wrap public-article">
    <p className="eyebrow">Safety</p>
    <h1>Report a problem with published content</h1>
    {status === "received" ? <div role="status" className="ui-note">
      <p>Thank you. A reviewer will look at your report. Your identity is never shown to the author or to anyone else.</p>
      {receipt ? <p>Private receipt code (keep it to check the status later): <code>{receipt}</code></p> : null}
    </div> : null}
    {status === "not_found" ? <p role="alert" className="ui-note ui-note--caution">We could not find that published article.</p> : null}
    {status === "invalid" ? <p role="alert" className="ui-note ui-note--caution">Please choose a reason.</p> : null}
    {status === "unavailable" ? <p role="alert" className="ui-note ui-note--caution">Reporting is temporarily unavailable. Please try again later.</p> : null}
    {status !== "received" ? <form method="post" action="/report/submit" className="ui-stack">
      <div>
        <label className="ui-label" htmlFor="report-slug">Article address name</label>
        <span className="ui-hint" id="report-slug-hint">The last part of the article&apos;s web address.</span>
        <input className="ui-input" id="report-slug" name="slug" required maxLength={80} defaultValue={validSlug} aria-describedby="report-slug-hint" />
      </div>
      <fieldset>
        <legend className="ui-label">What is the problem?</legend>
        {REPORT_REASONS.map(r => <div key={r}><input type="radio" id={`reason-${r}`} name="reason" value={r} required /> <label htmlFor={`reason-${r}`}>{labels[r]}</label></div>)}
      </fieldset>
      <div>
        <label className="ui-label" htmlFor="report-details">Anything else a reviewer should know (optional)</label>
        <span className="ui-hint" id="report-details-hint">Up to 1000 characters. Please do not include your own private information or upload evidence here.</span>
        <textarea className="ui-input" id="report-details" name="details" maxLength={1000} rows={5} aria-describedby="report-details-hint" />
      </div>
      <button className="ui-button" type="submit">Send report</button>
    </form> : null}
    <p>Reports go only to trained reviewers. If someone is in immediate danger, contact local emergency services. See our <Link href="/safety">safety guidance</Link>.</p>
  </article>;
}
