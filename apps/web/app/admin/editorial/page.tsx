import { editorialQueue } from "@jfa/db";
import { ActionForm, Status } from "../../../components/admin-bits";
import { staffContext, withStaffClient } from "../../../lib/staff";

export default async function Editorial({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = (await staffContext())!;
  const items = await withStaffClient(c => editorialQueue(c, ctx.session.identityId));
  return <><h1>Editorial queue</h1><Status status={(await searchParams).status} />
    {items === null ? <p>You do not have access to this queue.</p> : items.length === 0 ? <p>Nothing is waiting for review.</p> :
      <ul>{items.map(i => <li key={i.workflowId}><strong>{i.title}</strong> ({i.slug}): {i.state.replace("_", " ")}, {i.approvals} of 2 approvals{i.ownItem ? " (your item: you cannot approve or publish it)" : ""}{" "}
        {!i.ownItem && i.state === "in_review" ? <><ActionForm op="approve" fields={{ id: i.workflowId, version: String(i.version) }} label="Approve" /> <ActionForm op="reject" fields={{ id: i.workflowId, version: String(i.version) }} label="Reject" /></> : null}
        {!i.ownItem && i.state === "approved" ? <ActionForm op="publish" fields={{ id: i.workflowId, version: String(i.version) }} label="Publish" /> : null}
      </li>)}</ul>}</>;
}
