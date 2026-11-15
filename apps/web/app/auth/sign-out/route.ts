import { cookies } from "next/headers";
import { getSharedPool, signOut } from "@jfa/db";
import { isSameOriginPost, sessionCookieName } from "../../../lib/auth";
import { forbidden, seeOther } from "../../../lib/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOriginPost(request)) return forbidden();
  const token = (await cookies()).get(sessionCookieName())?.value;
  const pool = getSharedPool();
  if (token && pool) {
    try { const c = await pool.connect(); try { await signOut(c, token); } finally { c.release(); } } catch { /* cookie is still cleared */ }
  }
  const response = seeOther(request, "/?signed_out=1");
  response.cookies.delete(sessionCookieName());
  return response;
}
