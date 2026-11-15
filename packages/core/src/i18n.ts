/**
 * JFA-18 localization foundation. English is the launch locale. Adding a
 * locale means adding a catalog entry here; content already carries a
 * `locale` column, so no schema change is needed.
 */
export const SUPPORTED_LOCALES = ["en"] as const;
export type Locale = typeof SUPPORTED_LOCALES[number];
export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_META: Readonly<Record<Locale, Readonly<{ label: string; htmlLang: string; dir: "ltr" | "rtl"; ogLocale: string }>>> = Object.freeze({
  en: Object.freeze({ label: "English", htmlLang: "en", dir: "ltr", ogLocale: "en_US" })
});

const en = {
  "site.name": "Justice For All",
  "site.description": "Public information and peaceful civic participation.",
  "a11y.skipToContent": "Skip to content",
  "nav.main": "Main navigation",
  "nav.legal": "Legal information",
  "footer.notice": "Information only. Sensitive submissions are not accepted on this site.",
  "nav.privacy": "Privacy",
  "nav.terms": "Site information",
  "nav.safety": "Safety",
  "nav.resources": "Resources",
  "nav.contact": "Contact",
  "nav.accessibility": "Accessibility",
  "nav.anonymity": "Anonymity"
} as const;
export type MessageKey = keyof typeof en;

export const MESSAGES: Readonly<Record<Locale, Readonly<Record<MessageKey, string>>>> = Object.freeze({ en: Object.freeze(en) });

/** Unknown or malformed locales fall back to the default; never throws. */
export function resolveLocale(input: unknown): Locale {
  return typeof input === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(input) ? input as Locale : DEFAULT_LOCALE;
}

export function t(locale: Locale, key: MessageKey): string {
  return MESSAGES[locale]?.[key] ?? MESSAGES[DEFAULT_LOCALE][key];
}
