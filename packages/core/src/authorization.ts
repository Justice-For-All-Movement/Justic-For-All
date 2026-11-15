/**
 * JFA-21 core authorization policy (pure). The database layer loads trusted
 * grants and calls `decide`; routes must never pass client-supplied roles.
 */
export const ROLES = ["admin", "editor", "reviewer", "support", "viewer"] as const;
export type Role = typeof ROLES[number];

export const PERMISSIONS = {
  "cms.read_draft": { roles: ["editor", "reviewer", "admin"], privileged: false },
  "cms.create_draft": { roles: ["editor", "admin"], privileged: false },
  "cms.upload_media": { roles: ["editor", "admin"], privileged: false },
  "cms.review": { roles: ["reviewer", "admin"], privileged: false },
  "cms.publish": { roles: ["editor", "admin"], privileged: true },
  "cms.withdraw": { roles: ["admin"], privileged: true },
  "moderation.review": { roles: ["reviewer", "admin"], privileged: false },
  "privacy.process": { roles: ["support", "admin"], privileged: true },
  "audit.read": { roles: ["admin"], privileged: true },
  "roles.manage": { roles: ["admin"], privileged: true },
  "integrations.manage": { roles: ["admin"], privileged: true },
  "admin.view": { roles: ["admin", "editor", "reviewer", "support", "viewer"], privileged: false },
  // Self-service actions need no role, only that the subject owns the resource.
  "self.read": { roles: [], privileged: false, self: true },
  "self.update": { roles: [], privileged: false, self: true }
} as const satisfies Record<string, { roles: readonly Role[]; privileged: boolean; self?: boolean }>;
export type Action = keyof typeof PERMISSIONS;

/** `core`, `org:<slug>` or `source:<slug>`; anything else is invalid. */
export const SCOPE = /^(core|org:[a-z0-9-]{1,60}|source:[a-z0-9-]{1,60})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type Grant = Readonly<{ role: string; scope: string; expiresAt: Date | null; revokedAt: Date | null }>;
export type Subject = Readonly<{ id: string; active: boolean; grants: readonly Grant[] }>;
export type Resource = Readonly<{ scope: string; ownerId?: string }>;
export type Decision = Readonly<{ allowed: boolean; reason: "role" | "self" | "denied_inactive" | "denied_invalid" | "denied_no_grant" | "denied_not_owner" | "denied_step_up" }>;

/** Privileged actions need a phishing-resistant step-up within this window (JFA-20). */
export const STEP_UP_WINDOW_MS = 10 * 60_000;

export function isAction(value: unknown): value is Action {
  return typeof value === "string" && Object.hasOwn(PERMISSIONS, value);
}

/**
 * Deny by default. `core` grants do not imply org/source scopes and vice
 * versa, except `admin` on `core`, which covers every scope.
 */
export function decide(subject: Subject, action: Action, resource: Resource, ctx: { now: Date; stepUpAt?: Date | null; enforceStepUp?: boolean }): Decision {
  if (!subject || !UUID.test(subject.id) || !isAction(action) || !resource || !SCOPE.test(resource.scope)) return { allowed: false, reason: "denied_invalid" };
  if (!subject.active) return { allowed: false, reason: "denied_inactive" };
  const rule: { roles: readonly string[]; privileged: boolean; self?: boolean } = PERMISSIONS[action];
  if (rule.self) {
    return resource.ownerId !== undefined && resource.ownerId === subject.id ? { allowed: true, reason: "self" } : { allowed: false, reason: "denied_not_owner" };
  }
  const now = ctx.now.getTime();
  const live = subject.grants.filter(g => g && !g.revokedAt && (g.expiresAt === null || g.expiresAt.getTime() > now) && (ROLES as readonly string[]).includes(g.role));
  const ok = live.some(g => rule.roles.includes(g.role) && (g.scope === resource.scope || (g.role === "admin" && g.scope === "core")));
  if (!ok) return { allowed: false, reason: "denied_no_grant" };
  if (rule.privileged && ctx.enforceStepUp && !(ctx.stepUpAt && now - ctx.stepUpAt.getTime() <= STEP_UP_WINDOW_MS && ctx.stepUpAt.getTime() <= now)) {
    return { allowed: false, reason: "denied_step_up" };
  }
  return { allowed: true, reason: "role" };
}

/** Grant administration rules (who may grant what to whom). */
export function mayGrant(actor: Subject, target: { id: string; role: string; scope: string }, now: Date): boolean {
  if (!UUID.test(target.id) || target.id === actor.id) return false;
  if (!(ROLES as readonly string[]).includes(target.role) || !SCOPE.test(target.scope)) return false;
  return decide(actor, "roles.manage", { scope: target.scope }, { now }).allowed;
}
