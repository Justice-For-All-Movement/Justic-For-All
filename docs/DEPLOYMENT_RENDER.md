# Render deployment runbook (core web service)

**Status:** blueprint and start path verified locally. **No Render service or Neon database has been created by this repository or its agents.** An authorized operator deploys using the steps below.

## What `render.yaml` defines

| Setting | Value | Why |
|---|---|---|
| Runtime | Node `22.16.0` (`NODE_VERSION`, matches `.node-version`) | Supported LTS; `@types/node` is pinned to 22.x |
| Plan | `free` | Avoids unapproved cost. Moving to a paid plan needs owner approval |
| Build | `corepack enable && pnpm install --frozen-lockfile && pnpm build` | Corepack activates the pinned `pnpm@10.18.3` from `packageManager` |
| Start | `pnpm start:render` | `check-runtime-env` → `db:migrate` → `next start --hostname $HOST --port $PORT` |
| Health check | `/health` | Process liveness. `/ready` additionally checks DB + migration |
| Auto-deploy | on, from `main` | Only CI-green PRs are merged to `main` |

### Migrations

`pnpm db:migrate` applies every `db/migrations/NNNN_*.sql` that is not yet recorded in `jfa_schema_migrations`, in order, under a PostgreSQL advisory lock. It runs at start time so it works on every plan. If it fails, the new instance never binds its port, the deploy fails its health check, and Render keeps the previous release serving. On a paid plan you may instead set `preDeployCommand: pnpm db:migrate` and change `startCommand` to `pnpm start`. Both paths run the same idempotent runner.

`*_down.sql` files are manual rollback references only. Production rollback is forward-fix or point-in-time restore (Neon branch restore).

## Environment variables

`scripts/lib/runtime-env.mjs` is the source of truth; `scripts/check-runtime-env.mjs` validates it at start and prints variable **names only**.

### Required in production

| Name | Service | Notes |
|---|---|---|
| `NODE_ENV` | Node runtime | `production` (set by blueprint) |
| `DATABASE_URL` | Neon PostgreSQL | `sync: false`; paste the Neon connection string. Must include `sslmode=require` (or `verify-full`); otherwise start-up refuses. node-pg treats `require` as full certificate verification, which Neon supports. Use a least-privilege app role where possible |
| `APP_PUBLIC_URL` | Public origin | `sync: false`; bare `https://` origin with no path, e.g. `https://justice-for-all-web.onrender.com` or the custom domain |

### Set by blueprint / platform

| Name | Notes |
|---|---|
| `HOST` | `0.0.0.0` (blueprint) so Render can route to the process |
| `PORT` | Injected by Render (10000 by default); the start script binds to it |
| `NODE_VERSION` | `22.16.0` |

### Optional (later units; disabled-by-default when unset)

Every optional provider integration runs behind an interface. When its variables are absent it uses a **disabled** adapter: the feature reports "not available" and never pretends to succeed. The full list lives in `RUNTIME_ENV` and in [HANDOFF.md](HANDOFF.md#deployment-configuration).

## Operator steps

1. In Neon (org `org-soft-bird-04166848`), create a dedicated project/database for this app and copy the pooled connection string (with `sslmode=require`).
2. In Render (workspace `tea-dbp24r3m8hqs73dtq660`): **New → Blueprint**, select `Justice-For-All-Movement/Justic-For-All`, branch `main`.
3. Enter `DATABASE_URL` and `APP_PUBLIC_URL` when prompted (`APP_PUBLIC_URL` can be the `onrender.com` URL shown after the first create; update it after attaching a domain).
4. Deploy. Watch the logs for `Runtime configuration check passed.` and `Database schema is current (N known, N applied now).`
5. Verify: `GET /health` → 200; `GET /ready` → 200 `{"status":"ready"}`; `GET /` → 200; `GET /api/v1/initiatives` → 200 JSON.
6. Record the release SHA, URL and timestamp in `docs/ACCEPTANCE_EVIDENCE.md`. Do not label the deployment "production" until the JFA-49 launch checklist is complete.

## Local reproduction of the Render path

```bash
export NODE_ENV=production PORT=10000 HOST=0.0.0.0 APP_PUBLIC_URL=https://jfa.example.org
export DATABASE_URL='postgres://user:pass@localhost:5432/jfa?sslmode=require'   # local PG with SSL
corepack enable && pnpm install --frozen-lockfile && pnpm build
pnpm start:render
curl -s localhost:10000/ready
```
