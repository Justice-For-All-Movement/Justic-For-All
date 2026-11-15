import { getSharedPool, requestSignInLink } from "@jfa/db";
import { authDeps, clientKeyFrom, isSameOriginPost } from "../../../lib/auth";
import { forbidden, seeOther } from "../../../lib/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOriginPost(request)) return forbidden();
  const deps = authDeps();
  const pool = getSharedPool();
  if (!deps || !pool) return seeOther(request, "/account/sign-in?status=unavailable");
  const form = await request.formData().catch(() => null);
  const email = form?.get("email");
  try {
    const client = await pool.connect();
    try {
      const result = await requestSignInLink(client, { email: typeof email === "string" ? email : "", clientKey: clientKeyFrom(request) }, deps);
      return seeOther(request, `/account/sign-in?status=${result.status === "accepted" ? "sent" : result.status === "invalid_email" ? "invalid" : "unavailable"}`);
    } finally { client.release(); }
  } catch {
    return seeOther(request, "/account/sign-in?status=unavailable");
  }
}
