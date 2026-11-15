# Justice For All — work-package register

The canonical scope and acceptance criteria are in [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md), §9.

- **JFA-01–08:** foundation and verifiable architecture
- **JFA-09–18:** public user experience and accessible publishing
- **JFA-19–29:** privacy, identity, consent and moderation
- **JFA-30–40:** cross-platform API integrations
- **JFA-41–50:** operations, resilience, release and handoff

**Progress rule:** 50 is the denominator for **planned work packages**, not GitHub pull request numbers. A work package counts complete only after an audited mapping to a real merged PR and validation of the required acceptance evidence. Direct bootstrap commits are setup progress and must **not** be counted as completed mapped PRs.

The .exechub manifest is approved as a project plan. Source status, working tests, readiness, and actual deployment are independent. Repository initialization does not establish running software.

## Source-controlled PR evidence mapping

Engine Room's importer reads `.exechub/approved-pr-mapping.json`: a 50-position array with explicit real GitHub PR numbers for audited merged milestones and `null` for pending/unverified items. JFA-01–12 are mapped in milestone order to #1, #2, #3, #4, #5, #6, #7, #12, #14, #15, #16, #17. Maintenance PRs and this mapping-only PR are deliberately excluded.

**Never** assume that sequential milestone IDs are the same as GitHub PR numbers. Before changing a mapping, verify PR merge status, exact scope, CI and acceptance evidence. Mapping availability does not prove a live Render deployment or security certification. A deployed Engine Room instance must still successfully reconcile GitHub and import the newly committed map.

## Current source status (canonical data: `registry/prs.json`)

Observed 2026-11-15. "Source-merged" means the mapped PR merged and its tests are in CI. It does **not** mean deployed, externally integrated or independently audited.

| Unit | Status | PRs | Notes / remaining gaps |
|---|---|---|---|
| JFA-01–12 | Source-merged | #1–#7, #12, #14–#17 | Foundations, UI, routes, home, initiative registry |
| JFA-13 | Source-merged | #19, #20, #41, #42 | Drafts, PG acceptance, fail-closed image intake. No scanner or object store is configured, and there is no staff editor route yet (needs JFA-20/41) |
| JFA-14 | Source-merged | #43 | Two-person review/publish/withdraw service (internal) |
| JFA-15 | Source-merged | #44 | `/articles/:slug`, `GET /api/v1/articles` |
| JFA-16 | Source-merged | #46 | Participation paths, resources, safety, contact |
| JFA-17 | Source-merged | #47 | Approved-only PostgreSQL full-text search |
| JFA-18 | Source-merged | #48 | Static a11y gate, i18n, sitemap/robots/OG. Manual AT audit pending (JFA-47) |
| JFA-19 | Source-merged | #50 | Email-link identity and sessions. Live email provider not configured |
| JFA-20 | **Not started** | — | Passkeys/MFA and step-up for staff. Blocks every privileged staff HTTP route |
| JFA-21 | Source-merged | #51 | Central RBAC/ABAC. Step-up is modelled and needs JFA-20 to enforce on routes |
| JFA-22 | Source-merged | #54 | Consented pseudonyms, anonymity page, leakage tests |
| JFA-23 | Source-merged | #52 | Append-only consent ledger, self-service, export |
| JFA-24 | Source-merged | #57 | Double opt-in, one-click unsubscribe, gated delivery. No scheduled sender or bounce webhook |
| JFA-25 | Not started | — | Volunteer interest intake (all dependencies now met) |
| JFA-26 | Source-merged | #58 | Reports, holds, appeals. Staff UI waits for JFA-41 |
| JFA-27 | Source-merged | #59 | Privacy requests, export, legal hold, crypto-shred erasure. #59 was merged with a failing check; the cause was fixed in #60 |
| JFA-28 | Source-merged | #53, #60 | Hash-chained audit. #60 fixed a verification race under concurrent writes |
| JFA-29 | Contributing | #56 | CSP/HSTS, rate limits, ASVS map. Nonce CSP, anomaly alerts and full negative-test sweep remain |
| JFA-30 | Source-merged | #55 | Adapter SDK, signed ingestion, inbox/outbox. Worker not scheduled |
| JFA-45 | Contributing | #45 | Render blueprint and start path. Staging resources not provisioned |
| Others (20, 25, 31–44, 46–50) | Not started | — | See HANDOFF.md for blockers |
