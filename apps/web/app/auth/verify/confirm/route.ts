import { consumeSignInLink, getSharedPool } from "@jfa/db";
import { authDeps, cookieOptions, isSameOriginPost, sessionCookieName } from "../../../../lib/auth";
import { forbidden, seeOther } from "../../../../lib/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOriginPost(request)) return forbidden();
  const deps = authDeps();
  const pool = getSharedPool();
  if (!deps || !pool) return seeOther(request, "/account/sign-in?status=unavailable");
  const token = (await request.formData().catch(() => null))?.get("token");
  try {
    const client = await pool.connect();
    try {
      const result = await consumeSignInLink(client, token, deps);
      if (result.status !== "signed_in") return seeOther(request, "/account/sign-in?status=expired");
      const response = seeOther(request, result.newAccount ? "/account?welcome=1" : "/account");
      response.cookies.set(sessionCookieName(), result.sessionToken, cookieOptions(result.absoluteExpiresAt));
      return response;
    } finally { client.release(); }
  } catch {
    return seeOther(request, "/account/sign-in?status=unavailable");
  }
}
