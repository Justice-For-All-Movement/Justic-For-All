import Link from "next/link";

export const metadata = {
  title: "Participation Safety — Justice For All",
  description: "How to take part peacefully, lawfully and safely, and what this site cannot promise."
};

export default function Safety() {
  return <article className="wrap public-article">
    <p className="eyebrow">Safety guidance</p>
    <h1>Take part safely</h1>
    <p className="lede">Justice For All supports peaceful, voluntary and lawful civic participation. This guidance is general information, not legal advice.</p>
    <section aria-labelledby="peaceful"><h2 id="peaceful">Peaceful and voluntary</h2>
      <ul>
        <li>Never threaten, harass or intimidate anyone, including officials.</li>
        <li>Never publish someone&apos;s home address, family details or other private information.</li>
        <li>Participation is always your choice. You can stop at any time.</li>
      </ul>
    </section>
    <section aria-labelledby="protect"><h2 id="protect">Protect yourself and others</h2>
      <ul>
        <li>Do not put yourself or others at risk to record or document an event.</li>
        <li>Faces and voices in recordings can identify bystanders. Think before you share.</li>
        <li>Sensitive stories and evidence belong in a protected intake service. That service is not available on this site yet, so please do not send them here.</li>
      </ul>
    </section>
    <section aria-labelledby="limits"><h2 id="limits">What we cannot promise</h2>
      <ul>
        <li>This site cannot give legal advice or legal protection, and it cannot guarantee any outcome.</li>
        <li>Nothing published on the internet can be guaranteed to disappear later.</li>
        <li>Rules differ by place. Check the official sources for your jurisdiction.</li>
      </ul>
    </section>
    <p>See <Link href="/resources">official resources</Link> or go back to <Link href="/get-involved">ways to get involved</Link>.</p>
  </article>;
}
