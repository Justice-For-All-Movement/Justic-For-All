import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { DEFAULT_LOCALE, LOCALE_META, t } from "@jfa/core";
import { publicRoutes } from "../lib/public-routes";
import { getSiteUrl } from "../lib/site-url";
import "./styles.css";

const locale = DEFAULT_LOCALE;
const site = getSiteUrl();

export const metadata: Metadata = {
  title: t(locale, "site.name"),
  description: t(locale, "site.description"),
  ...(site ? { metadataBase: site } : {}),
  // Open Graph carries only public page metadata; no images of people.
  openGraph: { siteName: t(locale, "site.name"), type: "website", locale: LOCALE_META[locale].ogLocale }
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang={LOCALE_META[locale].htmlLang} dir={LOCALE_META[locale].dir}>
      <body>
        <a className="skip-link" href="#main">{t(locale, "a11y.skipToContent")}</a>
        <header className="site-header">
          <Link href="/" className="brand">{t(locale, "site.name")}</Link>
          <nav aria-label={t(locale, "nav.main")}>
            {publicRoutes.filter((route) => ["/about","/stories","/records","/initiatives","/get-involved","/search"].includes(route.href)).map((route) => <Link key={route.href} href={route.href}>{route.label}</Link>)}
          </nav>
        </header>
        <main id="main">{children}</main>
        <footer>
          <span>{t(locale, "site.name")}</span>
          <nav aria-label={t(locale, "nav.legal")}>
            <Link href="/privacy">{t(locale, "nav.privacy")}</Link>{" · "}
            <Link href="/terms">{t(locale, "nav.terms")}</Link>{" · "}
            <Link href="/accessibility">{t(locale, "nav.accessibility")}</Link>{" · "}
            <Link href="/safety">{t(locale, "nav.safety")}</Link>{" · "}
            <Link href="/resources">{t(locale, "nav.resources")}</Link>{" · "}
            <Link href="/contact">{t(locale, "nav.contact")}</Link>
          </nav>
          <span>{t(locale, "footer.notice")}</span>
        </footer>
      </body>
    </html>
  );
}
