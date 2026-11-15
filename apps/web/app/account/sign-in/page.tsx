import type { Metadata } from "next";
import Link from "next/link";
import { authDeps } from "../../../lib/auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in — Justice For All", robots: { index: false, follow: false } };

const messages: Record<string, string> = {
  sent: "If that address can receive a sign-in link, one is on its way. It expires in 15 minutes and works once.",
  invalid: "Please enter a valid email address.",
  unavailable: "Sign-in is temporarily unavailable. Please try again later.",
  expired: "That sign-in link has expired or was already used. Request a new one below.",
  signed_out_everywhere: "You have been signed out on every device.",
  deactivated: "Your account has been deactivated and all sessions ended.",
  deletion_requested: "Your deletion request was recorded. Your account is disabled and every session has ended."
};

type Context = { searchParams: Promise<{ status?: string | string[] }> };

export default async function SignIn({ searchParams }: Context) {
  const { status } = await searchParams;
  const message = typeof status === "string" ? messages[status] : undefined;
  const enabled = authDeps() !== null;
  return <article className="wrap public-article">
    <p className="eyebrow">Account</p>
    <h1>Sign in or create an account</h1>
    <p className="lede">You never need an account to read this site. An account will only be needed for optional features such as managing preferences.</p>
    {message ? <p role="status" className="ui-note">{message}</p> : null}
    {enabled ? <form method="post" action="/auth/sign-in" className="ui-stack">
      <div>
        <label className="ui-label" htmlFor="email">Email address</label>
        <span className="ui-hint" id="email-hint">We email you a one-time link. There is no password. We use your address only to sign you in.</span>
        <input className="ui-input" id="email" name="email" type="email" autoComplete="email" required maxLength={254} aria-describedby="email-hint" />
      </div>
      <button className="ui-button" type="submit">Email me a sign-in link</button>
    </form> : <section aria-labelledby="closed"><h2 id="closed">Accounts are not open yet</h2>
      <p>Sign-in needs a verified email provider and protected key storage, and they are not configured on this site yet. Everything public stays available without an account.</p>
    </section>}
    <p><Link href="/privacy">How we handle personal information</Link></p>
  </article>;
}
