# ADR-0005: Passwordless email-link identity with core-owned opaque sessions

Date: 2026-11-15. Status: accepted for JFA-19 (source implemented; accounts stay closed until production keys and a verified email sender are configured).

## Context
Public reading never requires an account (plan §3.2 D). Accounts are needed only for optional features: preferences, consent, subscriptions, and later staff roles. We must avoid unnecessary identity verification, resist account enumeration, never store passwords we do not need, and keep personal data minimal and encrypted.

## Options considered
1. **Hosted identity provider** (Auth0, Clerk, Cognito, Neon Auth). Fast to adopt, but it shares participant emails with another processor, adds cost and vendor lock-in, and its anonymity and data-location properties would need separate review. Rejected for now. It can sit behind the same session boundary later (JFA-31).
2. **Auth framework library** (Auth.js/NextAuth). Mature, but its adapter tables overlap our `identities` / `authenticators` schema, and the Next 16 integration surface changes often. Rejected to keep a small, fully tested boundary.
3. **Core-owned passwordless email link + opaque DB sessions** (chosen). Uses only `node:crypto` and PostgreSQL. Passkeys (WebAuthn) are added in JFA-20 for staff step-up through a maintained library, without inventing crypto.

## Decision
- **Sign-up, sign-in and recovery are one flow:** enter an email and receive a single-use link (256-bit random, 15 minutes, digest stored). No passwords.
- **Anti-enumeration:** an existing, new, disabled or throttled address all get the same `accepted` response. No link is sent to a disabled account, and per-address (5/h) and per-client (20/h) throttles use keyed-HMAC buckets, never raw IPs or emails.
- **Link scanners:** `GET /auth/verify` only renders a confirmation form, and consumption is a same-origin `POST`. Auth pages send `Referrer-Policy: no-referrer` and `no-store`.
- **Sessions:** an opaque 256-bit token whose SHA-256 digest is stored, with 7-day sliding idle expiry and 30-day absolute expiry. The cookie is `__Host-jfa_session` (`HttpOnly; Secure; SameSite=Lax; Path=/`) in production. Users can sign out, sign out everywhere, deactivate (revokes all sessions), or request deletion (creates a JFA-27 `privacy_requests` erase item, disables the account and revokes sessions).
- **CSRF:** every cookie-authenticated POST requires a matching `Origin` / `Sec-Fetch-Site: same-origin` in addition to SameSite=Lax.
- **Personal data:** the email is sealed with AES-256-GCM (`CONTACT_ENCRYPTION_KEY`, AAD-bound to its row) and found by HMAC-SHA-256 (`IDENTITY_LOOKUP_KEY`). The two keys must differ. Key IDs are stored for rotation, and a link issued under a previous seal key cannot be redeemed.
- **Fail closed:** accounts are enabled only when the DB, both keys, a real email sender (`EMAIL_PROVIDER=resend` plus key and verified sender) and `APP_PUBLIC_URL` are present. Otherwise `/account/sign-in` says "Accounts are not open yet". The `memory` and `log` senders are refused in production.

## Consequences
- Email deliverability is now part of sign-in availability. Sign-in shows "temporarily unavailable" rather than pretending to succeed.
- Key rotation needs a re-seal job (future JFA-44). HMAC-key rotation needs re-keying the lookup column.
- No external review yet. This is an AI-reviewed design with integration tests, and independent review stays pending per AGENTS.md.
