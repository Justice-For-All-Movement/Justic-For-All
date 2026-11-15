# Independent developer / agent handoff

**Authoritative scope:** [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) (50 numbered work packages). **Current product (2026-11-15):** a public portal with editorial publishing, search, participation hub, optional accounts, consent, subscriptions, moderation, privacy requests, audit chain and signed integration inbox/outbox, all source-merged and tested. It is **not deployed** (blueprint ready), no external provider is configured, and there is no staff UI. See the status table in [ROADMAP.md](ROADMAP.md).

## First actions in another account

1. Read `README.md`, this handoff, `docs/DEVELOPMENT_PLAN.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/ACCEPTANCE_EVIDENCE.md`, all ADRs and `.exechub/project.yml`.
2. List real GitHub PRs and GitHub Actions runs. Never mistake JFA work-package IDs for actual PR numbers or infer completion from main-branch bootstrap commits.
3. Read the pinned integration repository's public code/docs and version metadata. Do not infer authentication or a live endpoint from a README/example.
4. Check the actual Render/Neon resources in the authorized workspace before provisioning or billing anything. No verified deployment exists merely because a repository was initialized.
5. Pick the next uncompleted package with dependencies satisfied. Develop in a branch; open PR; run test/CI; merge only after checks and acceptance evidence, then update approved real-PR mapping.
6. Configure Engine Room's authenticated reconciliation to import live GitHub records; verify visible timestamps. A checked-in manifest alone is not proof the dashboard has updated.

## Core invariants

- Public browsing without signup; consent required for optional features.
- No generic testimony upload or public display of private allegations.
- Distinguish anonymization, pseudonymity, E2EE and public permanence accurately.
- Never invent external provider capabilities, CI passes or production monitoring.
- No payment or external infrastructure cost without owner authorization.

## Open decisions

License and media rights, domain, Render/Neon credentials and billing, CMS editorial personnel, contact/security channels, and audit/conformance evidence. Choose safe documented engineering defaults, but escalate material product decisions.

## Deployment configuration

- Blueprint: [`render.yaml`](../render.yaml). Runbook: [DEPLOYMENT_RENDER.md](DEPLOYMENT_RENDER.md). Nothing has been provisioned.
- **Build:** `corepack enable && pnpm install --frozen-lockfile && pnpm build`
- **Start:** `pnpm start:render` = `node scripts/check-runtime-env.mjs && pnpm db:migrate && pnpm start` (`next start --hostname ${HOST:-0.0.0.0} --port ${PORT:-3000}`). Migrations are locked and idempotent, and a failure keeps the previous release serving. Health check: `/health`. Readiness: `/ready`.
- The source of truth for variables is `scripts/lib/runtime-env.mjs` (validated at start; names only are printed).

| Variable | Required? | Service | Effect when unset |
|---|---|---|---|
| `NODE_ENV=production` | **Required** | Node runtime | Start-up check fails |
| `DATABASE_URL` | **Required** | Neon PostgreSQL (`sslmode=require`) | Start-up check fails |
| `APP_PUBLIC_URL` | **Required** | Public https origin (Render URL or domain); set before the first build | Start-up check fails; no canonical/sitemap host |
| `HOST`, `PORT`, `NODE_VERSION` | Set by blueprint/Render | Render | Defaults 0.0.0.0 / 3000 |
| `IDENTITY_LOOKUP_KEY`, `CONTACT_ENCRYPTION_KEY` | Optional (pair) | App secrets (two different 32-byte base64 keys) | Accounts closed ("not open yet") |
| `EMAIL_PROVIDER` (`resend`), `EMAIL_PROVIDER_API_KEY`, `EMAIL_FROM_ADDRESS` | Optional | Resend (verified sender domain) | Sign-in links and news email unavailable |
| `SERVICE_WEBHOOK_SIGNING_KEYS` | Optional | Per-module HMAC keys (JSON) | Event ingestion returns 503 |
| `OUTBOX_WEBHOOK_URL`, `OUTBOX_SIGNING_KEY_ID`, `OUTBOX_SIGNING_KEY` | Optional, worker only | Outbox receiver | `pnpm worker:outbox` delivers nothing |

## Remaining units and blockers (as of 2026-11-15)

| Unit(s) | Blocker |
|---|---|
| JFA-20 staff passkeys/MFA/step-up | Engineering only (add a maintained WebAuthn library such as `@simplewebauthn/server` and test with virtual authenticators). Unblocks privileged staff routes |
| JFA-25 volunteer interest intake | None. Dependencies met (needs `volunteer_contact` consent) |
| JFA-29 completion | Nonce-based CSP, anomaly reporting and alerts (overlaps JFA-43) |
| JFA-31 identity federation | Requires a confirmed upstream identity contract |
| JFA-32–40 upstream adapters | Verified live upstream APIs, base URLs and credentials for Secure Intake, Injustice Archive, FOIA Aggregator, Public Record, Civic Registry, Justice Teams, Compliance Engine and Liberty Nodes. Contracts and fakes can be built now on the JFA-30 SDK |
| JFA-41 admin workspace | JFA-20 (step-up) first |
| JFA-42 public measures | JFA-41. Must show "unverified", never zero |
| JFA-43 telemetry and alerts | Alert destination (`SECURITY_ALERT_DESTINATION`) and a scheduler (Render cron is an owner cost decision) |
| JFA-44 backups/restore | Neon project access to run and measure a restore drill |
| JFA-45 staging, JFA-49 production | Owner-authorized Render/Neon provisioning and billing, domain and verified email sender |
| JFA-46 performance/load | Deployed environment |
| JFA-47 cross-browser/AT acceptance | Manual assistive-technology walkthroughs and a browser matrix (headless Chrome hangs in the agent sandbox) |
| JFA-48 security review | External review is deferred per AGENTS.md. AI review and tests continue |
| JFA-50 Engine Room closure | All of the above |

## Process note
PR #59 was merged while its `database` check had failed, because an agent CI-wait helper treated "completed" as "passed". The failure was a real audit-verification race, fixed in #60 (all green). The helper now requires every check to conclude `success`. Merge only on fully green required checks.
