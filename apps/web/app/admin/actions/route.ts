import {
  AuthorizationError, closePrivacyRequest, dismissReport, grantRole, hideContent, processErasure, requeueDeadLetter, revokeRole,
  setLegalHold, transitionEditorialReview, verifyAuditChain, authorizeStaffRequest, type DbClient, type SessionView
} from "@jfa/db";
import type { Action } from "@jfa/core";
import { withPostSession } from "../../../lib/mfa";
import { forbidden, seeOther } from "../../../lib/http";

export const dynamic = "force-dynamic";

type Op = { action: Action; back: string; run: (c: DbClient, s: SessionView, f: FormData) => Promise<string | void> };
const str = (f: FormData, k: string) => String(f.get(k) ?? "");
const ops: Record<string, Op> = {
  approve: { action: "cms.review", back: "/admin/editorial", run: (c, s, f) => transitionEditorialReview(c, s.identityId, str(f, "id"), "approve", Number(str(f, "version"))).then(() => undefined) },
  reject: { action: "cms.review", back: "/admin/editorial", run: (c, s, f) => transitionEditorialReview(c, s.identityId, str(f, "id"), "reject", Number(str(f, "version"))).then(() => undefined) },
  publish: { action: "cms.publish", back: "/admin/editorial", run: (c, s, f) => transitionEditorialReview(c, s.identityId, str(f, "id"), "publish", Number(str(f, "version"))).then(() => undefined) },
  withdraw: { action: "cms.withdraw", back: "/admin/editorial", run: (c, s, f) => transitionEditorialReview(c, s.identityId, str(f, "id"), "withdraw", Number(str(f, "version"))).then(() => undefined) },
  hide: { action: "moderation.review", back: "/admin/reports", run: (c, s, f) => hideContent(c, s.identityId, { reportId: str(f, "id"), reason: str(f, "reason") as never }).then(() => undefined) },
  dismiss: { action: "moderation.review", back: "/admin/reports", run: (c, s, f) => dismissReport(c, s.identityId, str(f, "id")) },
  hold: { action: "privacy.process", back: "/admin/privacy", run: (c, s, f) => setLegalHold(c, s.identityId, str(f, "id"), str(f, "hold") === "on", str(f, "reason") || "staff_decision") },
  erase: { action: "privacy.process", back: "/admin/privacy", run: async (c, s, f) => (await processErasure(c, s.identityId, str(f, "id"))).status },
  close: { action: "privacy.process", back: "/admin/privacy", run: (c, s, f) => closePrivacyRequest(c, s.identityId, str(f, "id"), "completed", str(f, "outcome") || "fulfilled") },
  grant: { action: "roles.manage", back: "/admin/roles", run: (c, s, f) => grantRole(c, s.identityId, { subjectId: str(f, "subject"), role: str(f, "role"), scope: str(f, "scope") || "core" }).then(() => undefined) },
  revoke_grant: { action: "roles.manage", back: "/admin/roles", run: (c, s, f) => revokeRole(c, s.identityId, str(f, "id")) },
  verify_audit: { action: "audit.read", back: "/admin/audit", run: async c => ((await verifyAuditChain(c)).ok ? "chain_ok" : "chain_broken") },
  requeue: { action: "integrations.manage", back: "/admin/integrations", run: async (c, _s, f) => ((await requeueDeadLetter(c, str(f, "id"))) ? "requeued" : "not_requeued") }
};

/** Every staff mutation: same-origin POST, session, MFA + per-session step-up (via authorizeStaffRequest), then the service's own checks. */
export async function POST(request: Request) {
  const form = await request.clone().formData().catch(() => null);
  const op = form ? ops[str(form, "op")] : undefined;
  if (!form || !op) return forbidden();
  let outcome = "done";
  try {
    const r = await withPostSession(request, async (c, s) => {
      await authorizeStaffRequest(c, s, op.action);
      const res = await op.run(c, s, form);
      if (res) outcome = res;
    });
    if (!r.ok) return r.status === 403 ? forbidden() : seeOther(request, "/account/sign-in");
  } catch (e) {
    outcome = e instanceof AuthorizationError ? "step_up_required" : "failed";
  }
  return seeOther(request, `${op.back}?status=${outcome}`);
}
