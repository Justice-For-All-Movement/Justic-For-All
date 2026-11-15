import { cookies } from "next/headers";

import type { NextResponse } from "next/server";
import { getSession, getSharedPool, type DbClient, type SessionView } from "@jfa/db";
import { isSameOriginPost, sessionCookieName } from "./auth";
import { forbidden, seeOther } from "./http";

/**
 * Shared guard for signed-in account POSTs: same-origin, valid session and,
 * for destructive actions, an explicit typed confirmation.
 */
export async function accountAction(request: Request, opts: { confirm?: string; done: string; keepSession?: boolean },
  act: (client: DbClient, session: SessionView) => Promise<void>): Promise<NextResponse> {
  if (!isSameOriginPost(request)) return forbidden();
  const pool = getSharedPool();
  const token = (await cookies()).get(sessionCookieName())?.value;
  if (!pool || !token) return seeOther(request, "/account/sign-in");
  const form = await request.formData().catch(() => null);
  if (opts.confirm && form?.get("confirm") !== opts.confirm) return seeOther(request, "/account?status=confirm_required");
  try {
    const client = await pool.connect();
    try {
      const session = await getSession(client, token);
      if (!session) return seeOther(request, "/account/sign-in");
      await act(client, session);
    } finally { client.release(); }
  } catch {
    return seeOther(request, "/account?status=error");
  }
  const response = seeOther(request, opts.done);
  if (!opts.keepSession) response.cookies.delete(sessionCookieName());
  return response;
}
