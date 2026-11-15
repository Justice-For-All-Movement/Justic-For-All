import { setPublicName } from "@jfa/db";
import { accountAction } from "../../../lib/account-action";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const form = await request.clone().formData().catch(() => null);
  const hide = form?.get("action") === "hide";
  const name = hide ? null : String(form?.get("name") ?? "");
  let outcome = "error";
  const response = await accountAction(request, { done: "/account?status=name", keepSession: true }, async (client, session) => {
    const r = await setPublicName(client, session.identityId, session.identityId, name);
    outcome = r.status === "rejected" ? `name_${r.reason}` : `name_${r.status}`;
  });
  const location = response.headers.get("location");
  if (location?.endsWith("/account?status=name")) response.headers.set("location", location.replace("status=name", `status=${outcome}`));
  return response;
}
