# JFA-29 — OWASP ASVS 4.0.3 control mapping (Level 2 target)

This maps implemented controls to ASVS chapters as engineering evidence. It is **not an ASVS certification** and not an independent review (deferred per AGENTS.md). "Gap" items are tracked work.

| Chapter | Implemented control | Evidence | Gap / follow-up |
|---|---|---|---|
| V2 Authentication | Passwordless single-use email links (256-bit, 15 min, digest-only), anti-enumeration, per-address/per-client DB throttles plus a per-instance limiter | `identity.integration.mjs`, `identity-boundary.test.mjs` | Phishing-resistant MFA/passkeys for staff (JFA-20) |
| V3 Session management | Opaque server-side sessions, `__Host-` HttpOnly/Secure/SameSite=Lax cookie, idle and absolute expiry, sign-out everywhere, revocation on deactivate/delete | identity tests | Step-up re-authentication (JFA-20) |
| V4 Access control | Central deny-by-default RBAC/ABAC, scope isolation, owner-only self-service, immutable revocable grants, two-person publication | `authorization-policy.test.mjs`, `006_authorization.sql`, review tests | Admin UI routes must pass `enforceStepUp` (JFA-41) |
| V5 Validation, sanitization, encoding | Strict structured editorial schema (no HTML), bounded search input with `websearch_to_tsquery`, envelope validation, pseudonym rules, React escaping, no `dangerouslySetInnerHTML` | validator, search and adapter tests | — |
| V7 Error handling & logging | Coarse public errors (no DB strings), SQLSTATE-only migration logs, hash-chained privacy-safe audit log | `audit-chain.integration.mjs` | Central log shipping and alerting (JFA-43) |
| V8 Data protection | Email sealed with AES-256-GCM plus HMAC lookup, `no-store` on private responses, no trackers or third-party loads | crypto tests, `pseudonymity-leakage.test.mjs` | Key rotation re-seal job (JFA-44) |
| V9 Communications | HSTS (production), `upgrade-insecure-requests`, DB TLS required in production (`sslmode`) | `security-hardening.test.mjs`, runtime-env tests | TLS is terminated by Render |
| V10 Malicious code | Pinned lockfile, `pnpm audit` gate, secret scanner | CI | SBOM/provenance (JFA-07 follow-up) |
| V12 Files | Fail-closed image preflight, mandatory scanner verdict, private storage only | editorial upload tests | Real scanner and object store not configured |
| V13 API & web services | Signed m2m webhooks with freshness, rotation and idempotency; CSRF Origin/Sec-Fetch-Site checks; JSON envelopes; payload caps; rate limits | `adapter-sdk.test.mjs`, identity boundary tests | — |
| V14 Configuration | CSP (`default-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, `form-action 'self'`), XFO DENY, nosniff, Referrer-Policy, Permissions-Policy, COOP/CORP, no `X-Powered-By`, fail-fast env validation | `security-hardening.test.mjs` | `script-src` still allows `'unsafe-inline'` because static pages embed inline bootstrap scripts. Moving to a nonce-based CSP is a follow-up |

## Anti-abuse stance
No CAPTCHA: assistive-technology and anonymous (Tor) users must not be blocked. Limits are generous per-instance sliding windows (search 60/min, sign-in 30/h per client, events 600/min per source and client) in front of the DB-backed per-address sign-in throttle. Over-limit sign-in requests get the same "sent" response, so the limiter cannot be used to enumerate accounts.
