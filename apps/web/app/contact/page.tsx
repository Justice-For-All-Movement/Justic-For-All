import Link from "next/link";

export const metadata = {
  title: "Contact — Justice For All",
  description: "How to reach the Justice For All project and what not to send."
};

const repository = "https://github.com/Justice-For-All-Movement/Justic-For-All";

export default function Contact() {
  return <article className="wrap public-article">
    <p className="eyebrow">Contact</p>
    <h1>Contact and feedback</h1>
    <p className="lede">There is no private contact form or staffed inbox yet. We will not pretend otherwise.</p>
    <section aria-labelledby="site-feedback"><h2 id="site-feedback">Website feedback</h2>
      <p>To report a broken link, an accessibility barrier or a factual error on this website, open a public issue in the <a href={`${repository}/issues`} rel="noopener noreferrer external">project&apos;s GitHub repository</a>.</p>
      <p className="ui-note"><strong>Issues are public.</strong> Do not include your name, contact details, personal stories, evidence or anyone else&apos;s private information.</p>
    </section>
    <section aria-labelledby="security-reports"><h2 id="security-reports">Security vulnerabilities</h2>
      <p>Please follow the <a href={`${repository}/security/policy`} rel="noopener noreferrer external">security policy</a> and do not post vulnerabilities in public issues.</p>
    </section>
    <section aria-labelledby="not-here"><h2 id="not-here">If you need help now</h2>
      <p>If you are in immediate danger, contact local emergency services. For possible civil rights violations, see the <Link href="/resources">official resources</Link>.</p>
    </section>
  </article>;
}
