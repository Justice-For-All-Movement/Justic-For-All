# JFA-19 — Identity provider evaluation and user lifecycle

Design and rationale: [ADR-0005](ADR/0005-identity-and-sessions.md).

| Capability | Where | Test evidence |
|---|---|---|
| Sign-up / sign-in / recovery by single-use email link | `packages/db/src/identity.ts`, `/account/sign-in`, `/auth/*` | `packages/db/tests/identity.integration.mjs` |
| Anti-enumeration (existing/new/disabled/throttled identical) | `requestSignInLink` | "responses do not reveal…" |
| Throttling (5/address/h, 20/client/h, keyed buckets) | `auth_throttle_events` | per-address cap test |
| Session validation, idle/absolute expiry, revocation | `getSession`, `auth_sessions` | sign-out / sign-out-everywhere tests |
| Failed recovery (expired, reused, rotated key, disabled account) | `consumeSignInLink` | "expired links … fail closed" |
| Concurrent first sign-in creates one account | advisory lock on lookup | concurrency test |
| Deactivate / deletion request | `deactivateAccount`, `requestAccountDeletion` | lifecycle tests |
| Encrypted email at rest; no clear email or token stored | `@jfa/security` crypto | leak query + unit tests |
| CSRF origin checks, `__Host-` cookie, POST-only token use, no-referrer | `apps/web/lib/auth.ts`, `next.config.mjs` | `tests/identity-boundary.test.mjs` + local E2E |
| Resend adapter contract (shape, 2xx, 429/5xx retryable, 4xx permanent, network) | `packages/adapters/src/email.ts` | contract test with a local fake server |

**Not claimed:** live delivery through Resend (no account or credentials yet; the adapter is contract-tested only), passkeys/MFA for staff (JFA-20), and an independent security review.

## Configuration (all optional; accounts stay closed without them)

| Variable | Purpose |
|---|---|
| `IDENTITY_LOOKUP_KEY` | 32-byte base64 HMAC key (email lookup, throttle buckets) |
| `CONTACT_ENCRYPTION_KEY` | 32-byte base64 AES-256-GCM key; must differ from the lookup key |
| `EMAIL_PROVIDER` | `disabled` (default) or `resend`. `memory`/`log` are local development only |
| `EMAIL_PROVIDER_API_KEY` | Resend API key |
| `EMAIL_FROM_ADDRESS` | Verified sender, e.g. `Justice For All <no-reply@your-domain>` |

Generate keys with `openssl rand -base64 32`. Local development: `EMAIL_PROVIDER=log` prints sign-in links to the dev server console.
