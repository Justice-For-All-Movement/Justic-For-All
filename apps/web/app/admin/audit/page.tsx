import { auditChainHead, listAuditEvents } from "@jfa/db";
import { ActionForm, Status } from "../../../components/admin-bits";
import { staffContext, withStaffClient } from "../../../lib/staff";

export default async function Audit({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = (await staffContext())!;
  const data = ctx.steppedUp ? await withStaffClient(async c => ({ head: await auditChainHead(c), rows: await listAuditEvents(c, ctx.session.identityId, { limit: 50 }) })) : null;
  return <><h1>Audit log</h1><Status status={(await searchParams).status} />
    {data === null ? <p>Viewing the audit log needs an administrator who has confirmed it is them in the last 10 minutes.</p> : <>
      <p>Chain head: #{data.head.seq} <code>{data.head.hash.slice(0, 16)}…</code> <ActionForm op="verify_audit" fields={{}} label="Verify whole chain" /></p>
      <table><thead><tr><th scope="col">#</th><th scope="col">Time (UTC)</th><th scope="col">Action</th><th scope="col">Result</th><th scope="col">Resource</th></tr></thead>
        <tbody>{data.rows.map(r => <tr key={r.seq}><td>{r.seq}</td><td>{r.occurred_at.slice(0, 19)}</td><td>{r.action}</td><td>{r.policy_result}</td><td><code>{r.resource_ref}</code></td></tr>)}</tbody></table></>}</>;
}
