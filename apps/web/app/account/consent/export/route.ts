import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { exportConsent, getSession, getSharedPool } from "@jfa/db";
import { sessionCookieName } from "../../../../lib/auth";

export const dynamic = "force-dynamic";

/** GET is safe here: it only returns the signed-in person's own data, no-store. */
export async function GET() {
  const token = (await cookies()).get(sessionCookieName())?.value;
  const pool = getSharedPool();
  if (!token || !pool) return new NextResponse("Sign in required", { status: 401, headers: { "Cache-Control": "no-store" } });
  const client = await pool.connect();
  try {
    const session = await getSession(client, token);
    if (!session) return new NextResponse("Sign in required", { status: 401, headers: { "Cache-Control": "no-store" } });
    const body = await exportConsent(client, session.identityId, session.identityId);
    return new NextResponse(JSON.stringify(body, null, 2), { headers: {
      "Content-Type": "application/json", "Cache-Control": "no-store",
      "Content-Disposition": "attachment; filename=\"jfa-consent-history.json\"", "X-Content-Type-Options": "nosniff" } });
  } finally { client.release(); }
}
