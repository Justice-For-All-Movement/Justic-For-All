import { privacyQueue } from "@jfa/db";
import { ActionForm, Status } from "../../../components/admin-bits";
import { staffContext, withStaffClient } from "../../../lib/staff";

export default async function Privacy({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = (await staffContext())!;
  const items = await withStaffClient(c => privacyQueue(c, ctx.session.identityId));
  return <><h1>Privacy requests</h1><p>Metadata only. Contact details are never shown here.</p><Status status={(await searchParams).status} />
    {items === null ? <p>You do not have access, or need to confirm it is you first.</p> : items.length === 0 ? <p>No open requests.</p> :
      <ul>{items.map(i => <li key={i.id}><code>{i.id}</code> {i.type}, {i.status.replace(/_/g, " ")}{i.overdue ? ", OVERDUE" : ""}{i.legalHold ? ", legal hold" : ""}{" "}
        <ActionForm op="hold" fields={{ id: i.id, hold: i.legalHold ? "off" : "on", reason: "staff_decision" }} label={i.legalHold ? "Release hold" : "Apply legal hold"} />{" "}
        {i.type === "erase" ? <ActionForm op="erase" fields={{ id: i.id }} label="Process erasure" /> : <ActionForm op="close" fields={{ id: i.id, outcome: "fulfilled" }} label="Mark fulfilled" />}
      </li>)}</ul>}</>;
}
