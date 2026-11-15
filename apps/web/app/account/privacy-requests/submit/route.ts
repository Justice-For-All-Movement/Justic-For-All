import { openPrivacyRequest, SELF_SERVICE_TYPES, type SelfServiceType } from "@jfa/db";
import { accountAction } from "../../../../lib/account-action";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const form = await request.clone().formData().catch(() => null);
  const type = String(form?.get("type") ?? "");
  let outcome = "invalid";
  const response = await accountAction(request, { done: "/account/privacy-requests?status=x", keepSession: true }, async (client, session) => {
    if (!(SELF_SERVICE_TYPES as readonly string[]).includes(type) || type === "erase") return; // erasure uses the typed-confirmation delete flow
    outcome = (await openPrivacyRequest(client, session.identityId, session.identityId, type as SelfServiceType, String(form?.get("note") ?? ""))).status;
  });
  const location = response.headers.get("location");
  if (location?.endsWith("status=x")) response.headers.set("location", location.replace("status=x", `status=${outcome}`));
  return response;
}
