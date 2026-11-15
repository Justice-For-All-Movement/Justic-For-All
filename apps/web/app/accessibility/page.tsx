import Link from "next/link";

export const metadata = {
  title: "Accessibility — Justice For All",
  description: "Our accessibility commitment, what we test today, and how to report a barrier."
};

export default function Accessibility() {
  return <article className="wrap public-article">
    <p className="eyebrow">Accessibility</p>
    <h1>Accessibility statement</h1>
    <p className="lede">We aim for this site to meet WCAG 2.2 Level AA. We have not yet completed an independent or manual assistive-technology audit, so we do not claim conformance.</p>
    <section aria-labelledby="what-we-do"><h2 id="what-we-do">What we do today</h2>
      <ul>
        <li>Every build automatically checks each page for a language attribute, a single main heading, a skip link, labelled form fields, image text alternatives, named links and unique IDs.</li>
        <li>Colour contrast of our design tokens is tested against WCAG AA ratios.</li>
        <li>Pages work without JavaScript, respect reduced-motion settings and keep downloads small for slow connections.</li>
      </ul>
    </section>
    <section aria-labelledby="still-pending"><h2 id="still-pending">Still to do</h2>
      <p>Manual keyboard and screen-reader walkthroughs of every public journey, cross-browser checks, and review by disabled users.</p>
    </section>
    <section aria-labelledby="report"><h2 id="report">Report a barrier</h2>
      <p>Please tell us about anything that is hard to use. See <Link href="/contact">how to contact us</Link>. Do not include personal or sensitive information in public issues.</p>
    </section>
  </article>;
}
