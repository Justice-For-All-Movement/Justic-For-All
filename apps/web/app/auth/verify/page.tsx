import type { Metadata } from "next";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Confirm sign-in — Justice For All", robots: { index: false, follow: false }, referrer: "no-referrer" };

type Context = { searchParams: Promise<{ token?: string | string[] }> };

/** Requires a deliberate POST so link scanners and prefetchers cannot consume the token. */
export default async function Verify({ searchParams }: Context) {
  const { token } = await searchParams;
  const value = typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
  return <article className="wrap public-article">
    <h1>Confirm sign-in</h1>
    {value ? <form method="post" action="/auth/verify/confirm">
      <input type="hidden" name="token" value={value} />
      <p>Select the button to finish signing in on this device.</p>
      <button className="ui-button" type="submit">Sign in</button>
    </form> : <p>This sign-in link is not valid. <Link href="/account/sign-in">Request a new link</Link>.</p>}
  </article>;
}
