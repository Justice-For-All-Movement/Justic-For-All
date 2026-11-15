# JFA-27 — Privacy requests, safe takedown and legal hold

- **Self-service** (`/account/privacy-requests`, signed in): an immediate JSON **data export** (`/account/data-export`: account dates, profile, subscriptions, consent history and requests; the email address is never written into files), plus correction (with details), restriction and human-confirmed access requests. **Deletion** uses the typed-confirmation delete flow (JFA-19), which disables the account and opens an `erase` request. The authenticated session is the authority check, and each subject can see and act on only their own requests (`self.*`; admins included). One open request per type.
- **Staff** (`privacy.process`: support/admin): the queue shows metadata only (type, status, due date, hold, overdue). Staff can set or release a legal hold with a reason code and close requests with an outcome code. Staff can never process their own request.
- **Erasure:** blocked as `denied/legal_hold` while a hold is set. Otherwise it clears the profile, crypto-shreds the contact ciphertext (replaced with random bytes, key ref `shredded`), removes the lookup HMAC so the address can't be matched again, ends subscriptions, revokes authenticators and sessions, marks the identity `deleted` and emits a **PII-free** `privacy.erasure_completed` outbox event for downstream modules (withdrawal propagation hook).
- **Retained by design and disclosed to users:** consent and audit ledgers keep only opaque identity IDs as evidence of lawful processing. Encrypted backups age out on the backup schedule (JFA-44). Copies republished or replicated by others cannot be recalled.
- **Auditable:** every status change is in the append-only `privacy_request_events` table and in the hash-chained audit log.
- **Not yet:** anonymous (non-account) requests with receipt-based identity checks, the 30-day due-date alerting (JFA-43) and a staff UI (JFA-41).

Evidence: `packages/db/tests/privacy-requests.integration.mjs`.
