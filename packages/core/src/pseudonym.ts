/**
 * JFA-22 public pseudonyms. A pseudonym is a display label, not anonymity:
 * it must not contain contact details or impersonate staff.
 */
/** Exact-match words, plus impersonation fragments blocked anywhere in the name. */
const RESERVED_EXACT = ["admin", "staff", "jfa", "support", "system", "team"];
const RESERVED_FRAGMENTS = ["administrator", "moderator", "official", "justiceforall"];

export type PseudonymCheck = { ok: true; value: string } | { ok: false; reason: "length" | "characters" | "contact_details" | "reserved" };

export function checkPseudonym(input: unknown): PseudonymCheck {
  if (typeof input !== "string") return { ok: false, reason: "characters" };
  const value = input.normalize("NFKC").replace(/\s+/g, " ").trim();
  if ([...value].length < 3 || [...value].length > 40) return { ok: false, reason: "length" };
  const lower = value.toLowerCase();
  if (/@|https?|www\.|\.(com|org|net|gov|io)\b/.test(lower) || /\d[\d .-]{6,}\d/.test(value)) return { ok: false, reason: "contact_details" };
  if (!/^[\p{L}\p{N}][\p{L}\p{N} ._'-]*$/u.test(value)) return { ok: false, reason: "characters" };
  const letters = lower.replace(/[^\p{L}]/gu, "");
  if (RESERVED_EXACT.some(r => lower.split(/[ ._'-]+/).includes(r)) || RESERVED_FRAGMENTS.some(r => letters.includes(r))) return { ok: false, reason: "reserved" };
  return { ok: true, value };
}
