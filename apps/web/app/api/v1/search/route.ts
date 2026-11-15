import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { loadPublicSearch, parseSearchQuery } from "@jfa/db";
import { publicApiError } from "../../../../lib/api-response";
import { clientAddress, rateLimit } from "../../../../lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const limited = rateLimit(`search:${clientAddress(request)}`, 60, 60_000);
  if (!limited.allowed) {
    const r = publicApiError(429, "rate_limited", "Too many searches; please wait a moment");
    r.headers.set("Retry-After", String(limited.retryAfterSeconds));
    return r;
  }
  const params = new URL(request.url).searchParams;
  const query = parseSearchQuery({ q: params.get("q") ?? "", type: params.get("type") ?? "", locale: params.get("locale") ?? "", page: params.get("page") ?? "" });
  if (!query) return publicApiError(400, "invalid_request", "Provide q (2-100 characters) and optional type, locale and page (1-20)");
  const loaded = await loadPublicSearch(query);
  if (loaded.status !== "ok") return publicApiError(503, "service_unavailable", "Search is temporarily unavailable");
  const { result } = loaded;
  return NextResponse.json({
    api_version: "1", request_id: randomUUID(),
    data: { total: result.total, page: query.page, page_count: result.pageCount, results: result.hits }
  }, { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex" } });
}
