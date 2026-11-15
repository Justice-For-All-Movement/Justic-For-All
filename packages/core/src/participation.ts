/**
 * JFA-16 participation catalog. Every destination is an implemented,
 * information-only page. A path becomes "available" only when every
 * related initiative has passed the verified release gate (none have yet),
 * so no path can advertise a working submission flow prematurely.
 */
export type ParticipationPath = Readonly<{
  id: string;
  title: string;
  audience: string;
  summary: string;
  whatYouCanDoNow: readonly string[];
  safetyNote: string;
  initiativeSlugs: readonly string[];
  destination: string;
}>;

export const participationPaths: readonly ParticipationPath[] = Object.freeze([
  {
    id: "tell-your-story",
    title: "Tell your story",
    audience: "People who experienced or witnessed a possible rights violation",
    summary: "Understand the choices you will have before you share anything: public, pseudonymous, identity-obscured or restricted.",
    whatYouCanDoNow: ["Read how protected intake will work and what each publication choice means.", "Write private notes for yourself, offline, if that feels safe."],
    safetyNote: "Do not send testimony, evidence or names through this website. Protected intake is a separate service that is not yet available.",
    initiativeSlugs: ["injustice-project"],
    destination: "/stories"
  },
  {
    id: "offer-skills",
    title: "Offer your skills",
    audience: "Lawyers, researchers, journalists, translators, accessibility specialists, artists, technologists and organizers",
    summary: "Learn how skilled volunteers will be matched with people who ask for help, with consent at every step.",
    whatYouCanDoNow: ["Read about Justice Teams and the planned consent and referral rules.", "Review the safety guidance for volunteers."],
    safetyNote: "No volunteer sign-up is open yet. We are not collecting names or contact details.",
    initiativeSlugs: ["justice-teams"],
    destination: "/initiatives/justice-teams"
  },
  {
    id: "public-records",
    title: "Use and request public records",
    audience: "Researchers, journalists and anyone curious about government activity",
    summary: "Learn how records requests work and where official public records can already be searched.",
    whatYouCanDoNow: ["Use the official public resources listed on our resources page.", "Read about The Public Record program."],
    safetyNote: "This site cannot file requests for you or act on your behalf.",
    initiativeSlugs: ["public-record"],
    destination: "/records"
  },
  {
    id: "observe-responsibly",
    title: "Observe and document responsibly",
    audience: "People who want to be peaceful, lawful witnesses to public events",
    summary: "Learn what the planned Witness Corps and Public Witness programs will involve and how observation stays peaceful and lawful.",
    whatYouCanDoNow: ["Read the participation safety guidance.", "Learn about the planned programs."],
    safetyNote: "Never put yourself or others at risk to record an event. This site gives no legal advice and no legal protection.",
    initiativeSlugs: ["witness-corps", "public-witness"],
    destination: "/initiatives/witness-corps"
  },
  {
    id: "ask-officials",
    title: "Ask officials accountable questions",
    audience: "Anyone who wants a clear public answer from a public official",
    summary: "Learn how One Question will track questions to officials and distinguish answers from silence.",
    whatYouCanDoNow: ["Read about One Question."],
    safetyNote: "Respectful, factual questions only. Harassment and threats are never acceptable.",
    initiativeSlugs: ["one-question"],
    destination: "/initiatives/one-question"
  },
  {
    id: "preserve-public-records",
    title: "Help preserve approved public material",
    audience: "Technically experienced volunteers",
    summary: "Learn how Liberty Nodes plans to replicate only material explicitly approved for public release.",
    whatYouCanDoNow: ["Read about Liberty Nodes."],
    safetyNote: "Ordinary participants never need technical tools, keys or cryptocurrency to take part.",
    initiativeSlugs: ["liberty-nodes"],
    destination: "/initiatives/liberty-nodes"
  }
].map(path => Object.freeze({ ...path, whatYouCanDoNow: Object.freeze([...path.whatYouCanDoNow]), initiativeSlugs: Object.freeze([...path.initiativeSlugs]) })));

export type PathAvailability = "information_only" | "available";

/**
 * Unknown or unverified initiatives always resolve to information only.
 * `verifiedLive` must come from the verified release gate, never a manifest flag.
 */
export function participationAvailability(path: ParticipationPath, verifiedLive: ReadonlySet<string> = new Set()): PathAvailability {
  return path.initiativeSlugs.length > 0 && path.initiativeSlugs.every(slug => verifiedLive.has(slug)) ? "available" : "information_only";
}

export type PublicResource = Readonly<{
  title: string;
  href: string;
  kind: "internal" | "official";
  topic: "rights" | "records" | "safety" | "site";
  description: string;
}>;

/** Curated, Git-reviewed index. External entries are official government sites only. */
export const publicResources: readonly PublicResource[] = Object.freeze([
  { title: "Participation safety guidance", href: "/safety", kind: "internal", topic: "safety", description: "How to take part peacefully and protect yourself and others." },
  { title: "Public records program", href: "/records", kind: "internal", topic: "records", description: "What The Public Record will do and what this site cannot do." },
  { title: "Initiative directory", href: "/initiatives", kind: "internal", topic: "site", description: "Every planned program with its honest availability status." },
  { title: "Privacy information", href: "/privacy", kind: "internal", topic: "site", description: "What this site collects (very little) and why." },
  { title: "FOIA.gov", href: "https://www.foia.gov/", kind: "official", topic: "records", description: "The U.S. government's official site for federal Freedom of Information Act requests." },
  { title: "U.S. DOJ Civil Rights Division — report a violation", href: "https://civilrights.justice.gov/", kind: "official", topic: "rights", description: "Official federal portal to report a possible civil rights violation." },
  { title: "ADA.gov", href: "https://www.ada.gov/", kind: "official", topic: "rights", description: "Official information about disability rights under the Americans with Disabilities Act." }
].map(item => Object.freeze(item as PublicResource)));
