# JFA-28 — Tamper-evident core audit

## Mechanism
- `audit_events` is append-only. Triggers reject UPDATE, DELETE and TRUNCATE.
- A `BEFORE INSERT` trigger (`jfa_audit_chain_link`) locks the single `audit_chain_head` row, assigns a gap-free `seq`, sets `previous_hash` to the head hash (genesis is 64 zeros), and computes
  `event_hash = SHA-256( canonical(seq, previous_hash, event_id, actor_ref, action, resource_ref, policy_result, occurred_at_utc_µs) )`.
  The canonical form length-prefixes every field (`len:value|…`) so field boundaries cannot be confused. Caller-supplied hash values are ignored. The head can only advance by one, through that trigger.
- **Verification** happens twice, independently. The SQL function `jfa_verify_audit_chain()` checks it in the database, and `verifyAuditRows()` in `packages/db/src/audit.ts` re-implements the encoding in Node, so an exported chain can be checked outside PostgreSQL. `verifyAuditChain()` requires both to agree with the head.
- **What it detects:** edited content, reordering, deleted or inserted rows (sequence gaps and broken links), and head mismatch. This includes edits by a superuser who bypasses triggers (`session_replication_role=replica`), which the integration test proves.
- **What it does not prevent:** a superuser rewriting the *entire* chain and head consistently. Defence against that is external anchoring: publish or sign `auditChainHead()` periodically (planned with the Compliance/Audit Engine adapter, JFA-38) and keep database backups (JFA-44).
- **Privacy-safe fields:** a CHECK rejects `@` and whitespace in actor and resource refs (so no email addresses or free text) and requires `action` to match `^[a-z][a-z0-9_.:]{2,80}$`. Services write only opaque IDs such as `identity:<uuid>`, `cms-review:<uuid>` or `consent:<purpose>:v<version>`. No stories, emails or names enter the ledger.
- **Reading:** `listAuditEvents` requires `audit.read` (admin, privileged) and records an `audit_read` event itself.
- Rows written before migration 0008 have `seq` NULL. They are reported as pre-chain and excluded from verification.

## Evidence
`db/tests/008_audit_chain.sql` (forged hashes ignored, no edit, delete, truncate or head rewind, email and free-text rejected) and `packages/db/tests/audit-chain.integration.mjs` (20 concurrent writers produce a gap-free verified chain; the pure verifier detects edit, reorder, gap and forged link; trigger-bypass tampering is detected at the exact seq; audit reading is authorized and audited).

Separation of duties is enforced where it matters today: two-person publication (JFA-14 trigger), no self-grants or self-revocation of roles (JFA-21), and no consent on someone else's behalf (JFA-23). Each is recorded in this chain.
