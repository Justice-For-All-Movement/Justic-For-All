import { deactivateAccount } from "@jfa/db";
import { accountAction } from "../../../lib/account-action";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return accountAction(request, { confirm: "deactivate", done: "/account/sign-in?status=deactivated" }, async (c, s) => { await deactivateAccount(c, s.identityId); });
}
