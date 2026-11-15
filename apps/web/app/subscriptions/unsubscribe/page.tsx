import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Unsubscribe — Justice For All", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function Unsubscribe({ searchParams }: { searchParams: Promise<{ token?: string; status?: string }> }) {
  const { token, status } = await searchParams;
  return <article className="wrap public-article">
    <h1>Unsubscribe</h1>
    {status === "error" ? <p role="alert" className="ui-note ui-note--caution">We could not record that just now. Please try again.</p> : null}
    {status === "done" ? <p role="status" className="ui-note">You are unsubscribed. We will not email you news again unless you subscribe and confirm again.</p>
      : <form method="post" action={`/subscriptions/unsubscribe/submit?token=${encodeURIComponent(typeof token === "string" ? token : "")}`}>
        <p>Select the button to stop all Justice For All news emails to your address.</p>
        <button className="ui-button" type="submit">Unsubscribe</button>
      </form>}
  </article>;
}
