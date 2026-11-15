import Link from "next/link";
import { participationPaths, participationAvailability } from "@jfa/core";

export const metadata = {
  title: "Get Involved — Justice For All",
  description: "Choose how you want to take part and see honestly what is available today."
};

export default function GetInvolved() {
  return <article className="wrap public-article">
    <p className="eyebrow">Voluntary civic participation</p>
    <h1>There are many ways to help.</h1>
    <p className="lede">You do not need a special credential, a prior encounter with the government, or membership in a political party. Choose a path to see what it involves and what is available today.</p>
    <nav aria-label="Participation paths">
      <ul className="public-journeys">
        {participationPaths.map(path => <li key={path.id}><a href={`#${path.id}`}>{path.title}</a></li>)}
      </ul>
    </nav>
    {participationPaths.map(path => {
      const availability = participationAvailability(path);
      return <section key={path.id} id={path.id} aria-labelledby={`${path.id}-heading`} className="public-journey">
        <h2 id={`${path.id}-heading`}>{path.title}</h2>
        <p><span className="ui-status">{availability === "available" ? "Available" : "Information only — not open yet"}</span></p>
        <p><strong>For:</strong> {path.audience}</p>
        <p>{path.summary}</p>
        <h3>What you can do now</h3>
        <ul>{path.whatYouCanDoNow.map(item => <li key={item}>{item}</li>)}</ul>
        <p className="ui-note">{path.safetyNote}</p>
        <p><Link href={path.destination}>Learn more about {path.title.toLowerCase()}</Link></p>
      </section>;
    })}
    <section aria-labelledby="participation-status">
      <h2 id="participation-status">Registration is not open</h2>
      <p>We are not currently collecting volunteer identities, contact details, confidential stories, or evidence through this site. Future participation forms will disclose their purpose, privacy choices, and availability before asking for personal data.</p>
      <p>Read the <Link href="/safety">participation safety guidance</Link>, browse <Link href="/resources">resources</Link>, or see <Link href="/contact">how to contact us</Link>.</p>
    </section>
  </article>;
}
