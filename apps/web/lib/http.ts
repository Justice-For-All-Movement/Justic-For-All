import { NextResponse } from "next/server";
import { getSiteUrl } from "./site-url";

/** 303 See Other to a same-site path (never to user-supplied absolute URLs). */
export function seeOther(request: Request, path: string): NextResponse {
  if (!path.startsWith("/") || path.startsWith("//")) path = "/";
  const base = getSiteUrl() ?? new URL(request.url);
  return NextResponse.redirect(new URL(path, base), { status: 303, headers: { "Cache-Control": "no-store" } });
}

export function forbidden(): NextResponse {
  return new NextResponse("Forbidden", { status: 403, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain" } });
}
