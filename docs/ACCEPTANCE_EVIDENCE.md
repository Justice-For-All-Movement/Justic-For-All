# Acceptance evidence

## Baseline — 2026-10-10

- Full planning document committed: yes.
- Initial accessible static web routes committed: yes; build and browser acceptance **not yet verified**.
- Starter source-level tests committed: yes; CI results **pending**.
- Engine Room 50-work-package manifest committed: yes; Engine Room production reconciliation **not verified**.
- Neon/Render environment: **not provisioned or verified**.
- E2EESA compliance: **not assessed/certified**.
- Production claims: **none**.

Bootstrap commits on main are *not* mapped completed work-package PRs. Register completed work only using real PR numbers and evidence, not by counting bootstrap commits.

## Preview deployment — 2026-11-15

- Render web service `justice-for-all-web`: https://justice-for-all-web.onrender.com (free plan; may sleep when idle). Provisioned by the lead engineer, not by an agent.
- Dedicated Neon PostgreSQL 16 database; migrations applied by `pnpm start:render`.
- `EMAIL_PROVIDER=disabled`: accounts, sign-in and news email intentionally unavailable.
- Status: **preview**, not production (JFA-49 launch checklist not complete). Re-verify `/health` and `/ready` before relying on it.
