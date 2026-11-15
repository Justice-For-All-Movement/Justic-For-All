# JFA-18 — Accessibility, localization and search-engine foundation

## Accessibility (target: WCAG 2.2 AA)

**Automated today (CI, every PR):**
- `pnpm check:a11y` runs after `pnpm build` and checks every prerendered page for: valid `lang`, non-empty `<title>`, exactly one `<h1>`, one `<main>` with a working skip link, unique IDs, `alt` on every image, no positive `tabindex`, accessible names on links and buttons, and labels on form fields (`scripts/lib/a11y-static.mjs`, with unit tests showing each rule fires).
- Design-token contrast tests (JFA-09, `tests/visual-system.test.mjs`).
- Pages render without JavaScript (server components) and honour `prefers-reduced-motion`.

**Pending (not claimed):** manual keyboard and screen-reader walkthroughs (NVDA/JAWS/VoiceOver/TalkBack) of each public journey, a browser/device matrix and Playwright E2E. These belong to JFA-47. The public `/accessibility` statement says plainly that conformance is not yet claimed.

## Localization

- `packages/core/src/i18n.ts` holds the supported locales (`en` at launch), locale metadata (`htmlLang`, `dir`, `ogLocale`) and typed message catalogs for the site chrome. `resolveLocale()` falls back to English and never throws.
- CMS content already has a `locale` column with `UNIQUE(slug, locale)`, and search and the public readers filter by locale, so **adding a locale requires no schema change**: add a catalog entry, translated content and routing.
- A test enforces that every locale has every message key.

## Search engines

- `APP_PUBLIC_URL` sets `metadataBase` (read at build time for static pages, so set it before the first Render build). In production, if it is unset or invalid, no canonical host, sitemap or robots sitemap line is emitted, rather than a wrong one.
- `/robots.txt` disallows `/api/`, `/search`, `/design-system`, `/health` and `/ready`.
- `/sitemap.xml` lists indexable public pages, initiative pages and *current published* articles from the `core_public_search` view only. Drafts, withdrawn content and noindex surfaces never appear.
- Open Graph: site-level `website` metadata and article-level `article` metadata with title, summary and published time. No images of people are generated.
- Search result pages are `noindex, follow`, and the search API sends `X-Robots-Tag: noindex`.

## Plain-language content standard

1. Write for a reader with no legal background. Aim for short sentences (about 20 words or fewer) and common words, and define any legal term the first time it appears.
2. Say what the reader can do now, and what is **not** available yet. Never imply an inactive feature works.
3. Keep a person's first-person account, independently corroborated facts, public records and editorial conclusions clearly separate. Never present an allegation as proven.
4. Give dates and jurisdictions when they matter. General information is not legal advice.
5. Use respectful, non-sensational language. Do not identify private individuals.
6. Every image needs meaningful alt text (or empty alt if decorative). Every audio/video item needs captions or a transcript before publication.
7. Use headings in order, write descriptive link text (not "click here"), and give one `<h1>` per page.

## Low-bandwidth notes

Public pages are server-rendered and static where possible, with about 100–110 kB of first-load JS shared across routes (see build output). They use no web fonts, no third-party scripts, no analytics or trackers, and no autoplay media.
