import { getSharedPool, requestSignInLink } from "@jfa/db";
import { authDeps, clientKeyFrom, isSameOriginPost } from "../../../lib/auth";
import { forbidden, seeOther } from "../../../lib/http";
import { clientAddress, rateLimit } from "../../../lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOriginPost(request)) return forbidden();
  // Coarse per-instance guard in front of the DB-backed per-address throttle.
  if (!rateLimit(`sign-in:${clientAddress(request)}`, 30, 3_600_000).allowed) return seeOther(request, "/account/sign-in?status=sent");
  if (Number(request.headers.get("content-length") ?? "0") > 4096) return seeOther(request, "/account/sign-in?status=invalid");
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
