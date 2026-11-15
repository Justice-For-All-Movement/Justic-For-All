# JFA-21 — Core RBAC/ABAC and service authorization

**Policy source:** `packages/core/src/authorization.ts` (pure, unit-tested). **Enforcement:** `packages/db/src/authorization.ts` loads the subject and grants from PostgreSQL and decides with database time. Routes must never trust client-supplied roles or IDs.

## Role matrix (core scope)

| Action | admin | editor | reviewer | support | viewer | Privileged (step-up) |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| cms.read_draft | ✓ | ✓ | ✓ | | | |
| cms.create_draft / cms.upload_media | ✓ | ✓ | | | | |
| cms.review (approve/revoke/reject) | ✓ | | ✓ | | | |
| cms.publish | ✓ | ✓ | | | | ✓ |
| cms.withdraw | ✓ | | | | | ✓ |
| moderation.review | ✓ | | ✓ | | | |
| privacy.process | ✓ | | | ✓ | | ✓ |
| audit.read, roles.manage, integrations.manage | ✓ | | | | | ✓ |
| admin.view | ✓ | ✓ | ✓ | ✓ | ✓ | |
| self.read / self.update | owner only, no role | | | | | |

Two-person rules sit on top of this matrix: an author can never approve or publish their own item, and every publication needs two distinct reviewers (JFA-14 service plus a DB trigger).

## Rules
- **Deny by default.** Inactive or unknown identities, expired or revoked grants, unknown roles, malformed scopes and unknown actions (including prototype keys like `constructor`) are all denied.
- **Scopes** are `core`, `org:<slug>` or `source:<slug>`, enforced by a DB CHECK. A grant applies only to its own scope, except that a `core` admin covers every scope.
- **ABAC self-service:** `self.*` actions need `resource.ownerId === subject.id`. Even admins cannot read another person's self-service data through these actions. Guessed IDs are denied.
- **Grant administration:** admins only, never to themselves, only to active identities. Grants are immutable except for revocation (DB trigger), never deleted, and revocation is final. A subject cannot revoke its own grant, and the last active core admin cannot be revoked. Changes are serialized with an advisory lock and audited.
- **Step-up:** privileged actions carry `privileged: true`. HTTP routes for them must pass `enforceStepUp: true` with the time of a phishing-resistant re-authentication (JFA-20). Until JFA-20 lands, **no privileged staff HTTP route exists**: these operations are reachable only through internal services.
- **Denials** can be audited with `recordDenial`, outside the business transaction so the record survives rollback.
- `core_active_grants` is the single SQL definition of "usable now" (active identity, unrevoked, unexpired).

## Evidence
`tests/authorization-policy.test.mjs` (full matrix, deny-by-default, scope isolation, self-service, step-up, grant rules), `db/tests/006_authorization.sql` (immutability, no delete, no self-revoke, scope format, disabled identity), `packages/db/tests/authorization.integration.mjs` (grant/revoke lifecycle, audit, expired and disabled editors refused by the editorial services).
