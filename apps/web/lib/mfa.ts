import { cookies } from "next/headers";
import { getSession, getSharedPool, relyingPartyFrom, type DbClient, type MfaDeps, type SessionView } from "@jfa/db";
import { parseKey } from "@jfa/security";
import { isSameOriginPost, sessionCookieName } from "./auth";
import { getSiteUrl } from "./site-url";

/** MFA needs the DB, both identity keys and an https APP_PUBLIC_URL (RP ID = its hostname). */
export function mfaDeps(env: NodeJS.ProcessEnv = process.env): MfaDeps | null {
  const site = getSiteUrl(env);
  const rp = site ? relyingPartyFrom(site.origin) : null;
  const lookupKey = parseKey(env.IDENTITY_LOOKUP_KEY), sealKey = parseKey(env.CONTACT_ENCRYPTION_KEY);
  if (!rp || !lookupKey || !sealKey || lookupKey.id === sealKey.id) return null;
  return { ...rp, rpName: "Justice For All", lookupKey, sealKey };
}

/** Runs `fn` with a validated session for a same-origin POST; null result means refused. */
export async function withPostSession<T>(request: Request, fn: (client: DbClient, session: SessionView) => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; status: number }> {
  if (!isSameOriginPost(request)) return { ok: false, status: 403 };
  const pool = getSharedPool();
  const token = (await cookies()).get(sessionCookieName())?.value;
  if (!pool || !token) return { ok: false, status: 401 };
  const client = await pool.connect();
  try {
    const session = await getSession(client, token);
    if (!session) return { ok: false, status: 401 };
    return { ok: true, value: await fn(client, session) };
  } finally { client.release(); }
}
