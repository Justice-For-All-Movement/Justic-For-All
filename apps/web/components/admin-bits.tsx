import type { ReactNode } from "react";

const messages: Record<string, string> = {
  done: "Done.", step_up_required: "Confirm it is you first (sign-in security), then try again.", failed: "That action was refused or failed. Nothing was changed.",
  chain_ok: "Audit chain verified: no tampering detected.", chain_broken: "Audit chain verification FAILED. Escalate as a security incident.",
  completed: "Erasure completed.", denied: "Erasure denied because a legal hold is in place.", requeued: "Message requeued.", not_requeued: "Nothing to requeue."
};
export function Status({ status }: { status?: string }) {
  return status ? <p role="status" className="ui-note">{messages[status] ?? "Done."}</p> : null;
}
/** A one-button staff action form posting to the shared dispatcher. */
export function ActionForm({ op, fields, label, children }: { op: string; fields: Record<string, string>; label: string; children?: ReactNode }) {
  return <form method="post" action="/admin/actions" style={{ display: "inline" }}>
    <input type="hidden" name="op" value={op} />
    {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
    {children}
    <button className="ui-button" type="submit">{label}</button>
  </form>;
}
