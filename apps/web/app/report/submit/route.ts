import { getSharedPool, submitReport } from "@jfa/db";
import { isSameOriginPost } from "../../../lib/auth";
import { forbidden, seeOther } from "../../../lib/http";
import { clientAddress, rateLimit } from "../../../lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOriginPost(request)) return forbidden();
  if (Number(request.headers.get("content-length") ?? "0") > 8192) return seeOther(request, "/report?status=invalid");
  if (!rateLimit(`report:${clientAddress(request)}`, 10, 3_600_000).allowed) return seeOther(request, "/report?status=unavailable");
  const form = await request.formData().catch(() => null);
  const pool = getSharedPool();
  if (!form || !pool) return seeOther(request, "/report?status=unavailable");
  try {
    const c = await pool.connect();
    try {
      const r = await submitReport(c, { slug: form.get("slug"), reason: form.get("reason"), details: form.get("details") });
      return r.status === "received" ? seeOther(request, `/report?status=received&receipt=${r.receipt}`) : seeOther(request, `/report?status=${r.status}`);
    } finally { c.release(); }
  } catch { return seeOther(request, "/report?status=unavailable"); }
}
