import { reportQueue, REPORT_REASONS } from "@jfa/db";
import { ActionForm, Status } from "../../../components/admin-bits";
import { staffContext, withStaffClient } from "../../../lib/staff";

export default async function Reports({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = (await staffContext())!;
  const items = await withStaffClient(c => reportQueue(c, ctx.session.identityId));
  return <><h1>Content reports</h1><p>Reporter identities are never shown.</p><Status status={(await searchParams).status} />
    {items === null ? <p>You do not have access to reports.</p> : items.length === 0 ? <p>No open reports.</p> :
      <ul>{items.map(i => <li key={i.reportId}><strong>{i.slug}</strong>: {i.reason.replace(/_/g, " ")}{i.details ? <>: “{i.details}”</> : null}{i.held ? " (already hidden)" : ""}{" "}
        <ActionForm op="hide" fields={{ id: i.reportId, reason: (REPORT_REASONS as readonly string[]).includes(i.reason) ? i.reason : "other" }} label="Hide temporarily" />{" "}
        <ActionForm op="dismiss" fields={{ id: i.reportId }} label="Dismiss" /></li>)}</ul>}</>;
}
