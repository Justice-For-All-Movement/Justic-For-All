import type { ParticipationPath, PublicResource } from "./participation";

/** Static, Git-reviewed public pages searched in memory (no database needed). */
export type SitePage = Readonly<{ title: string; href: string; text: string; section: string }>;
export type SiteHit = Readonly<{ title: string; href: string; section: string; score: number }>;

export const corePages: readonly SitePage[] = Object.freeze([
  { title: "About Justice For All", href: "/about", section: "About", text: "movement independence mission civic organization party membership" },
  { title: "Principles", href: "/principles", section: "About", text: "rights dignity nonviolence accuracy accountability consent privacy" },
  { title: "Stories", href: "/stories", section: "Stories", text: "tell your story testimony injustice experience witness protected intake publication choices pseudonymous anonymous" },
  { title: "Public records", href: "/records", section: "Records", text: "public records foia freedom of information requests government documents" },
  { title: "Privacy", href: "/privacy", section: "Site", text: "privacy data collection cookies personal information" },
  { title: "Site information and terms", href: "/terms", section: "Site", text: "terms of use information only no legal advice" }
]);

function tokens(value: string): string[] {
  return value.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter(t => t.length >= 2);
}

export function buildSiteIndex(
  initiatives: readonly { slug: string; name: string; description: string; overview: string }[],
  paths: readonly ParticipationPath[],
  resources: readonly PublicResource[]
): readonly SitePage[] {
  return Object.freeze([
    ...corePages,
    ...initiatives.map(i => ({ title: i.name, href: `/initiatives/${i.slug}`, section: "Initiatives", text: `${i.description} ${i.overview}` })),
    ...paths.map(p => ({ title: p.title, href: `/get-involved#${p.id}`, section: "Get involved", text: `${p.audience} ${p.summary} ${p.safetyNote}` })),
    ...resources.filter(r => r.kind === "internal").map(r => ({ title: r.title, href: r.href, section: "Resources", text: r.description }))
  ]);
}

/** Every query term must match (prefix for terms of 3+ characters); titles weigh more. */
export function searchSitePages(index: readonly SitePage[], query: string, limit = 8): SiteHit[] {
  const terms = [...new Set(tokens(query))].slice(0, 10);
  if (!terms.length) return [];
  const hits: SiteHit[] = [];
  for (const page of index) {
    const title = tokens(page.title), body = tokens(page.text);
    let score = 0, all = true;
    for (const term of terms) {
      const match = (t: string) => t === term || (term.length >= 3 && t.startsWith(term));
      const s = title.filter(match).length * 3 + body.filter(match).length;
      if (!s) { all = false; break; }
      score += s;
    }
    if (all) hits.push({ title: page.title, href: page.href, section: page.section, score });
  }
  return hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit);
}
