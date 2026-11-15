import { getSharedPool, unsubscribeByToken } from "@jfa/db";
import { seeOther } from "../../../../lib/http";

export const dynamic = "force-dynamic";

/**
 * Accepts RFC 8058 one-click POSTs from mail clients (cross-origin by design),
 * so no Origin check: the 256-bit token itself is the authority and the only
 * possible effect is stopping email.
 */
export async function POST(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  const pool = getSharedPool();
  const browser = request.headers.get("sec-fetch-mode") === "navigate";
  let ok = false;
  if (pool) {
    try { const c = await pool.connect(); try { await unsubscribeByToken(c, token); ok = true; } finally { c.release(); } } catch { ok = false; }
  }
  // Never report success we did not record; mail clients retry on 5xx.
  if (browser) return seeOther(request, ok ? "/subscriptions/unsubscribe?status=done" : `/subscriptions/unsubscribe?status=error&token=${encodeURIComponent(token ?? "")}`);
  return new Response(null, { status: ok ? 204 : 503, headers: { "Cache-Control": "no-store" } });
}
