import { confirmSubscription, getSharedPool } from "@jfa/db";
import { isSameOriginPost } from "../../../../lib/auth";
import { forbidden, seeOther } from "../../../../lib/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOriginPost(request)) return forbidden();
  const pool = getSharedPool();
  const token = (await request.formData().catch(() => null))?.get("token");
  if (!pool) return seeOther(request, "/subscriptions/confirm?status=invalid");
  try {
    const c = await pool.connect();
    try { return seeOther(request, `/subscriptions/confirm?status=${(await confirmSubscription(c, token)).status === "active" ? "active" : "invalid"}`); }
    finally { c.release(); }
  } catch { return seeOther(request, "/subscriptions/confirm?status=invalid"); }
}
