import Link from "next/link";
import { publicResources } from "@jfa/core";

export const metadata = {
  title: "Resources — Justice For All",
  description: "A short, reviewed list of Justice For All pages and official public resources."
};

const topics = [
  { id: "rights", label: "Know and assert your rights" },
  { id: "records", label: "Public records" },
  { id: "safety", label: "Safety" },
  { id: "site", label: "About this site" }
] as const;

export default function Resources() {
  return <article className="wrap public-article">
    <p className="eyebrow">Resources</p>
    <h1>Reliable places to start</h1>
    <p className="lede">This list is short on purpose. External links go only to official government sites. They are not legal advice, and we do not control them.</p>
    {topics.map(topic => {
      const items = publicResources.filter(item => item.topic === topic.id);
      return items.length ? <section key={topic.id} aria-labelledby={`topic-${topic.id}`}>
        <h2 id={`topic-${topic.id}`}>{topic.label}</h2>
        <ul>{items.map(item => <li key={item.href}>
          {item.kind === "internal"
            ? <Link href={item.href}>{item.title}</Link>
            : <a href={item.href} rel="noopener noreferrer external">{item.title} <span className="ui-hint">(official external site)</span></a>}
          {" — "}{item.description}
        </li>)}</ul>
      </section> : null;
    })}
  </article>;
}
