import { integrationStatus } from "@jfa/db";
import { Status } from "../../../components/admin-bits";
import { staffContext, withStaffClient } from "../../../lib/staff";

export default async function Integrations({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = (await staffContext())!;
  const s = await withStaffClient(c => integrationStatus(c, ctx.session.identityId));
  return <><h1>Integrations</h1><Status status={(await searchParams).status} />
    {s === null ? <p>You do not have access.</p> : <>
      <h2>Modules</h2>{s.modules.length === 0 ? <p>No modules registered. Every integration is unconfigured.</p> :
        <ul>{s.modules.map(m => <li key={m.slug}>{m.slug}: {m.enabled ? "enabled" : "disabled"}, {m.verification_state}{m.contract_version ? `, contract ${m.contract_version}` : ""}</li>)}</ul>}
      <h2>Outbox</h2><p>{Object.entries(s.outbox).map(([k, v]) => `${k}: ${v}`).join(" · ") || "empty"}</p>
      <h2>Inbox</h2><p>{s.inbox.n} events{s.inbox.latest ? `, latest ${new Date(s.inbox.latest).toISOString().slice(0, 16)} UTC` : ""}</p></>}</>;
}
