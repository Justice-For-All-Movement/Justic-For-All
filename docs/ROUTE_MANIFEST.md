# Public route manifest — JFA-10

Route | Purpose | Sensitive input
---|---|---
/ | General landing page | None
/about | Organizational overview | None
/stories | Story program information; no intake | None
/records | Records program information; no filing | None
/principles | Civic principles | None
/initiatives | Validated public informational initiative directory | None
/initiatives/[slug] | Approved public informational initiative detail | None
/articles/{slug} | Current reviewed published editorial article | Validated slug only
/get-involved | JFA-16 participation paths with honest availability | None
/resources | JFA-16 curated internal and official-government resources | None
/safety | JFA-16 participation safety guidance | None
/search | JFA-17 approved-only search (GET, noindex) | Search terms only, never stored
/api/v1/search | JFA-17 search API (no-store, noindex) | Search terms only, never stored
/accessibility | JFA-18 accessibility statement (no conformance claim) | None
/sitemap.xml | JFA-18 indexable public pages and current published articles; empty without APP_PUBLIC_URL | None
/robots.txt | JFA-18 crawler rules (disallows /api/, /search, /design-system, /health, /ready) | None
/account/sign-in | JFA-19 email-link sign-in; shows "not open yet" unless fully configured (noindex) | Email address (sealed, HMAC lookup)
/auth/sign-in (POST) | JFA-19 request link; same response for existing/new/disabled/throttled | Email address
/auth/verify | JFA-19 confirm page; POST-only consumption, no-referrer | Single-use token
/auth/verify/confirm (POST) | JFA-19 consume link, set `__Host-` session cookie | Single-use token
/auth/sign-out (POST) | JFA-19 revoke session | Session cookie
/account | JFA-19 sessions, sign-out everywhere, deactivate, delete request (noindex, no-store) | Session cookie, typed confirmation
/anonymity | JFA-22 plain-language anonymity boundaries | None
/account/public-name (POST) | JFA-22 set or hide a validated pseudonym (requires display consent) | Pseudonym
/account/privacy | JFA-23 consent toggles | Session
/account/consent/export | JFA-23 own consent history JSON (no-store) | Session
/contact | JFA-16 contact center (public issue tracker, security policy; no form) | None
/privacy | Interim privacy disclosure | None
/terms | Interim information/terms boundary | None
/design-system | UI reference | None
/health | Stateless liveness | None

Core navigation links only to implemented pages. Missing routes receive an accessible 404 page. Unexpected render errors receive an accessible recovery page. The editorial article route fails closed until the draft and workflow schema are deployed and approved content is actually published. It never accepts intake, testimony or user-supplied allegations.
