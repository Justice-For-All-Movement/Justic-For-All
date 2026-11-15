# JFA-23 — Consent ledger and self-service preferences

- **Purposes** (`packages/core/src/consent.ts`): `public_display_name`, `news_email`, `volunteer_contact`. Each has its own plain-language text and a dated `version`. Raising `reconsentFrom` makes older grants show as `reconsent_required`, and they stop authorizing processing.
- **Ledger** (`consent_records`, append-only): every grant or withdrawal is a new row with the purpose's current policy version, scope `core.<purpose>`, channel and `supersedes_id`. Update, delete and **truncate** are rejected by triggers. Subjects are stored as `identity:<uuid>` only (a CHECK rejects raw emails or names). `core_current_consent` gives the latest decision per purpose.
- **Service** (`packages/db/src/consent.ts`): `recordConsent` is self-service only (`self.update` with owner check). Nobody, including admins, can consent on someone else's behalf. Each change is audited. `requireConsent` is the gate every optional feature must call: missing, withdrawn, other-purpose or outdated-version consent all throw `ConsentRequiredError`. `exportConsent` gives a JSON history of your own consent only.
- **UI**: `/account/privacy` shows each purpose, its status and version, with same-origin POST on/off toggles. `/account/consent/export` downloads the JSON history (`no-store`).
- **Evidence**: `tests/consent-policy.test.mjs`, `db/tests/007_consent_ledger.sql`, `packages/db/tests/consent.integration.mjs`.

Consumers so far: the JFA-22 public display name (requires `public_display_name`). JFA-24 email news must require `news_email`, and JFA-25 volunteer intake must require `volunteer_contact`.
