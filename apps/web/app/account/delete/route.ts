import { requestAccountDeletion } from "@jfa/db";
import { accountAction } from "../../../lib/account-action";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return accountAction(request, { confirm: "delete", done: "/account/sign-in?status=deletion_requested" }, async (c, s) => { await requestAccountDeletion(c, s.identityId); });
}
