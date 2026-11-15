import { cookies } from "next/headers";
import { emailSenderFromEnv } from "@jfa/adapters";
import { getSharedPool, getSession, type IdentityDeps, type SessionView } from "@jfa/db";
import { parseKey } from "@jfa/security";
import { getSiteUrl } from "./site-url";

/** `__Host-` prefix pins the cookie to this origin over HTTPS with Path=/. */
export function sessionCookieName(env: NodeJS.ProcessEnv = process.env) {
  return env.NODE_ENV === "production" ? "__Host-jfa_session" : "jfa_session";
}

/**
 * Accounts are enabled only when the DB, both keys, a real email sender and
 * the public origin are all configured. Otherwise the UI says "not open yet".
 */
export function authDeps(env: NodeJS.ProcessEnv = process.env): IdentityDeps | null {
  const lookupKey = parseKey(env.IDENTITY_LOOKUP_KEY);
  const sealKey = parseKey(env.CONTACT_ENCRYPTION_KEY);
  const sender = emailSenderFromEnv(env);
  const site = getSiteUrl(env);
  if (!lookupKey || !sealKey || lookupKey.id === sealKey.id || !sender.available || !site || !getSharedPool(env)) return null;
  return { lookupKey, sealKey, sender, publicOrigin: site.origin };
}

/** Coarse, keyed client bucket for throttling; never stores the IP itself. */
export function clientKeyFrom(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
}

/**
 * CSRF defence for cookie-authenticated POSTs: the browser-set Origin (or
 * Sec-Fetch-Site) must show the request came from this site.
 */
export function isSameOriginPost(request: Request, env: NodeJS.ProcessEnv = process.env): boolean {
  if (request.method !== "POST") return false;
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return false;
  const origin = request.headers.get("origin");
  if (!origin) return fetchSite === "same-origin";
  const site = getSiteUrl(env);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    const o = new URL(origin);
    return (site !== null && o.origin === site.origin) || (env.NODE_ENV !== "production" && o.host === host);
  } catch { return false; }
}

export function cookieOptions(expires: Date, env: NodeJS.ProcessEnv = process.env) {
  return { httpOnly: true, secure: env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", expires };
}

/** Current session for server components; null when signed out or accounts are off. */
export async function currentSession(): Promise<SessionView | null> {
  const token = (await cookies()).get(sessionCookieName())?.value;
  const pool = getSharedPool();
  if (!token || !pool) return null;
  try {
    const client = await pool.connect();
    try { return await getSession(client, token); } finally { client.release(); }
  } catch { return null; }
}

