import { NextResponse } from "next/server";
import {
  beginTotpEnrollment, confirmTotpEnrollment, passkeyRegistrationOptions, passkeyStepUpOptions, revokeFactor,
  stepUpWithRecoveryCode, stepUpWithTotp, verifyPasskeyRegistration, verifyPasskeyStepUp, AuthorizationError
} from "@jfa/db";
import { mfaDeps, withPostSession } from "../../../../../lib/mfa";

export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  const deps = mfaDeps();
  if (!deps) return json({ status: "unavailable" }, 503);
  if (Number(request.headers.get("content-length") ?? "0") > 16384) return json({ status: "too_large" }, 413);
  const body = await request.clone().json().catch(() => ({})) as Record<string, unknown>;
  try {
    const result = await withPostSession(request, async (client, session) => {
      switch (action) {
        case "register-options": return passkeyRegistrationOptions(client, session, deps);
        case "register-verify": return verifyPasskeyRegistration(client, session, body.response as never, String(body.nickname ?? ""), deps);
        case "stepup-options": return (await passkeyStepUpOptions(client, session, deps)) ?? { status: "no_passkey" };
        case "stepup-verify": return verifyPasskeyStepUp(client, session, body.response as never, deps);
        case "totp-begin": return (await beginTotpEnrollment(client, session, deps)) ?? { status: "step_up_required" };
        case "totp-confirm": return confirmTotpEnrollment(client, session, body.code, deps);
        case "totp-stepup": return stepUpWithTotp(client, session, body.code, deps);
        case "recovery-stepup": return stepUpWithRecoveryCode(client, session, body.code, deps);
        case "revoke": return revokeFactor(client, session, body.kind === "passkey" ? "passkey" : "totp", typeof body.id === "string" ? body.id : null, deps);
        default: return { status: "unknown_action" };
      }
    });
    return result.ok ? json(result.value) : json({ status: "refused" }, result.status);
  } catch (e) {
    return e instanceof AuthorizationError ? json({ status: "step_up_required" }, 403) : json({ status: "error" }, 500);
  }
}
