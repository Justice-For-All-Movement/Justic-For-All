import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { exportOwnData, getSession, getSharedPool } from "@jfa/db";
import { sessionCookieName } from "../../../lib/auth";

export const dynamic = "force-dynamic";

/** Self-only personal data export (no-store). */
export async function GET() {
  const token = (await cookies()).get(sessionCookieName())?.value;
  const pool = getSharedPool();
  const deny = () => new NextResponse("Sign in required", { status: 401, headers: { "Cache-Control": "no-store" } });
  if (!token || !pool) return deny();
  const client = await pool.connect();
  try {
    const session = await getSession(client, token);
    if (!session) return deny();
    const data = await exportOwnData(client, session.identityId, session.identityId);
    return new NextResponse(JSON.stringify(data, null, 2), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store",
      "Content-Disposition": "attachment; filename=\"jfa-my-data.json\"", "X-Content-Type-Options": "nosniff" } });
  } finally { client.release(); }
}
