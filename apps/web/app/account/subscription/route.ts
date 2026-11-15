import { startSubscription, unsubscribeIdentity } from "@jfa/db";
import { accountAction } from "../../../lib/account-action";
import { authDeps } from "../../../lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const form = await request.clone().formData().catch(() => null);
  const stop = form?.get("action") === "stop";
  let outcome = "news_unavailable";
  const response = await accountAction(request, { done: "/account?status=news", keepSession: true }, async (client, session) => {
    if (stop) { await unsubscribeIdentity(client, session.identityId); outcome = "news_stopped"; return; }
    const deps = authDeps();
    if (!deps) return;
    outcome = `news_${(await startSubscription(client, session.identityId, session.identityId, deps)).status}`;
  });
  const location = response.headers.get("location");
  if (location?.endsWith("/account?status=news")) response.headers.set("location", location.replace("status=news", `status=${outcome}`));
  return response;
}
