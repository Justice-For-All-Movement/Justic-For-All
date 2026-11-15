import { recordConsent } from "@jfa/db";
import { accountAction } from "../../../lib/account-action";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const form = await request.clone().formData().catch(() => null);
  const purpose = String(form?.get("purpose") ?? "");
  const decision = form?.get("decision") === "grant" ? "grant" : "withdraw";
  return accountAction(request, { done: "/account/privacy?status=saved", keepSession: true },
    async (client, session) => { await recordConsent(client, session.identityId, session.identityId, purpose, decision); });
}
