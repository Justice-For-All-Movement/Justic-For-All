import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { factorSummary, getSharedPool } from "@jfa/db";
import { SecuritySettings } from "../../../components/security-settings";
import { currentSession } from "../../../lib/auth";
import { mfaDeps } from "../../../lib/mfa";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign-in security — Justice For All", robots: { index: false, follow: false } };

export default async function Security() {
  const session = await currentSession();
  if (!session) redirect("/account/sign-in");
  const pool = getSharedPool();
  let summary: Awaited<ReturnType<typeof factorSummary>> | null = null;
  if (pool && mfaDeps()) { try { const c = await pool.connect(); try { summary = await factorSummary(c, session.identityId); } finally { c.release(); } } catch { summary = null; } }
  return <article className="wrap public-article">
    <p className="eyebrow">Account</p>
    <h1>Sign-in security</h1>
    <p className="lede">Staff accounts must add a passkey or an authenticator app. Passkeys resist phishing because they only work on this website.</p>
    {summary ? <SecuritySettings summary={{ ...summary, passkeys: summary.passkeys.map(p => ({ id: p.id, nickname: p.nickname })) }} />
      : <p>Extra sign-in security is not available on this site yet.</p>}
    <noscript><p>Setting up passkeys and authenticator apps needs JavaScript.</p></noscript>
    <p><Link href="/account">Back to account</Link></p>
  </article>;
}
