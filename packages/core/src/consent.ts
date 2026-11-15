/**
 * JFA-23 consent purposes. Each optional processing purpose has its own
 * versioned policy text. Bumping `version` (with `reconsentFrom`) makes older
 * grants insufficient, so users must re-consent. Consent for one purpose
 * never authorizes another.
 */
export type ConsentPurpose = Readonly<{
  id: string;
  version: string;
  /** Grants for versions older than this no longer authorize processing. */
  reconsentFrom: string;
  title: string;
  description: string;
}>;

export const CONSENT_PURPOSES: readonly ConsentPurpose[] = Object.freeze([
  { id: "public_display_name", version: "2026-11-15", reconsentFrom: "2026-11-15", title: "Show my public name",
    description: "Show the public name I choose next to things I publish. My email and account details stay private." },
  { id: "news_email", version: "2026-11-15", reconsentFrom: "2026-11-15", title: "News by email",
    description: "Send me occasional news about Justice For All by email. I can unsubscribe at any time." },
  { id: "volunteer_contact", version: "2026-11-15", reconsentFrom: "2026-11-15", title: "Volunteer contact",
    description: "Let program coordinators contact me about the volunteer skills I offer. My details are never published." }
].map(p => Object.freeze(p)));

export function findPurpose(id: unknown): ConsentPurpose | undefined {
  return typeof id === "string" ? CONSENT_PURPOSES.find(p => p.id === id) : undefined;
}

export type ConsentEvent = Readonly<{ purpose: string; policyVersion: string; decision: "grant" | "withdraw"; recordedAt: Date }>;
export type ConsentState = Readonly<{ purpose: string; status: "granted" | "withdrawn" | "never" | "reconsent_required"; policyVersion: string | null; recordedAt: Date | null }>;

/** Latest event per purpose wins; grants for outdated policy versions require re-consent. */
export function summarizeConsent(events: readonly ConsentEvent[]): ConsentState[] {
  return CONSENT_PURPOSES.map(purpose => {
    // Input is in ledger order; on equal timestamps the later entry wins.
    let latest: ConsentEvent | undefined;
    for (const e of events) if (e.purpose === purpose.id && (!latest || e.recordedAt.getTime() >= latest.recordedAt.getTime())) latest = e;
    if (!latest) return { purpose: purpose.id, status: "never", policyVersion: null, recordedAt: null };
    if (latest.decision === "withdraw") return { purpose: purpose.id, status: "withdrawn", policyVersion: latest.policyVersion, recordedAt: latest.recordedAt };
    const current = latest.policyVersion >= purpose.reconsentFrom;
    return { purpose: purpose.id, status: current ? "granted" : "reconsent_required", policyVersion: latest.policyVersion, recordedAt: latest.recordedAt };
  });
}

export function hasConsent(events: readonly ConsentEvent[], purposeId: string): boolean {
  return summarizeConsent(events).some(s => s.purpose === purposeId && s.status === "granted");
}
