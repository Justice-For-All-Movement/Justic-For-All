import { signOutEverywhere } from "@jfa/db";
import { accountAction } from "../../../lib/account-action";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return accountAction(request, { done: "/account/sign-in?status=signed_out_everywhere" }, async (c, s) => { await signOutEverywhere(c, s.identityId); });
}
