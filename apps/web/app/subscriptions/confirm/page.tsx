import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Confirm subscription — Justice For All", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function Confirm({ searchParams }: { searchParams: Promise<{ token?: string; status?: string }> }) {
  const { token, status } = await searchParams;
  const valid = typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
  return <article className="wrap public-article">
    <h1>Confirm your subscription</h1>
    {status === "active" ? <p role="status" className="ui-note">You are subscribed. Every email includes a one-click unsubscribe link.</p>
      : status === "invalid" ? <p role="alert" className="ui-note ui-note--caution">This confirmation link has expired or was already used.</p>
      : valid ? <form method="post" action="/subscriptions/confirm/submit">
        <input type="hidden" name="token" value={token} />
        <p>Select the button to confirm that you want occasional Justice For All news by email.</p>
        <button className="ui-button" type="submit">Confirm subscription</button>
      </form> : <p>This confirmation link is not valid.</p>}
  </article>;
}
