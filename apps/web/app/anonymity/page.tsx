import Link from "next/link";

export const metadata = {
  title: "Anonymity and Privacy Boundaries — Justice For All",
  description: "Plain-language explanation of what is and is not anonymous on this site."
};

export default function Anonymity() {
  return <article className="wrap public-article">
    <p className="eyebrow">Anonymity</p>
    <h1>What is and is not anonymous here</h1>
    <p className="lede">You can read everything on this site without an account. We want you to understand exactly what that does and does not protect.</p>
    <section aria-labelledby="reading"><h2 id="reading">Reading the site</h2>
      <ul>
        <li>No account, no sign-up and no cookies are needed to read public pages.</li>
        <li>We do not use advertising, analytics or tracking scripts, and we load nothing from other websites.</li>
        <li>When you follow a link from this site, browsers send other sites only our domain name, not the page you were reading.</li>
        <li>Like every website, our hosting provider briefly records technical request data such as IP addresses for security and reliability. That is not anonymity. If you need strong anonymity, use a tool such as Tor Browser.</li>
      </ul>
    </section>
    <section aria-labelledby="accounts"><h2 id="accounts">Accounts and public names</h2>
      <ul>
        <li>An account is optional and needs only an email address, which is stored encrypted and never shown publicly.</li>
        <li>A <strong>public name</strong> is a pseudonym, not anonymity. We know which account it belongs to, and we may have to disclose that if the law requires it.</li>
        <li>You can hide your public name or withdraw permission to show it at any time. Copies others have already made cannot be recalled.</li>
      </ul>
    </section>
    <section aria-labelledby="sensitive"><h2 id="sensitive">Sensitive stories and evidence</h2>
      <p>This site does <strong>not</strong> accept testimony, evidence or confidential reports. Protected intake will be a separate, separately assessed service. Until it exists, please do not send sensitive information here. <Link href="/stories">Learn what is planned</Link>.</p>
    </section>
    <p><Link href="/privacy">Privacy information</Link> · <Link href="/safety">Safety guidance</Link></p>
  </article>;
}
