# JFA-26 — Content reporting and moderation workflow

- **Reporting** (`/report`, linked from every published article): reasons are versioned codes (`community-guidelines/2026-11-15`: privacy exposure, harassment or threat, inaccurate, copyright, safety risk, other), with optional details up to 1000 characters. Submissions are same-origin, rate-limited (10/h per client) and need no account. Only currently public content can be reported. The reporter gets a private receipt code (digest stored) for status-only follow-up.
- **Reporter protection:** the reviewer queue (`moderation.review`) never includes reporter identity or receipt, and authors never see reports. Audit entries name the reporter only as `reporter`.
- **Temporary hide:** `hideContent` sets `cms_entries.moderation_hold`. The public reader, `core_public_content` and `core_public_search` all exclude held entries immediately, and a `cms.hidden` outbox event is queued for caches. History is untouched.
- **Appeals and improper-removal recovery:** only the content's author can appeal a hide (once per action). The appeal must be decided by a **different** reviewer from the one who hid it, and overturning restores the content and records a `restore` action (`cms.restored` event).
- **Immutable record:** `moderation_actions` cannot be updated or deleted, and every step is in the hash-chained audit log.
- **Not yet:** a staff moderation UI (it needs the JFA-20 step-up and JFA-41 admin workspace, and services are internal until then), evidence-safe reporter/author notifications (needs a notification template plus JFA-24 delivery), and downstream-module content moderation (JFA-33+).

Evidence: `packages/db/tests/moderation.integration.mjs`.
