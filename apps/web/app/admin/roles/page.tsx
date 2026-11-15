import { listRoleGrants, ROLES_FOR_UI } from "../../../lib/roles";
import { ActionForm, Status } from "../../../components/admin-bits";
import { staffContext, withStaffClient } from "../../../lib/staff";

export default async function Roles({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = (await staffContext())!;
  const grants = await withStaffClient(c => listRoleGrants(c, ctx.session.identityId));
  return <><h1>Roles</h1><Status status={(await searchParams).status} />
    {grants === null ? <p>You do not have access, or need to confirm it is you first.</p> : <>
      <ul>{grants.map(g => <li key={g.grantId}><code>{g.subjectId}</code>: {g.role} @ {g.scope}{g.subjectId === ctx.session.identityId ? " (you)" : <>{" "}<ActionForm op="revoke_grant" fields={{ id: g.grantId }} label="Revoke" /></>}</li>)}</ul>
      <h2>Grant a role</h2>
      <ActionForm op="grant" fields={{}} label="Grant role">
        <label className="ui-label" htmlFor="g-subject">Account ID</label><input className="ui-input" id="g-subject" name="subject" required />
        <label className="ui-label" htmlFor="g-role">Role</label><select className="ui-input" id="g-role" name="role">{ROLES_FOR_UI.map(r => <option key={r} value={r}>{r}</option>)}</select>
        <label className="ui-label" htmlFor="g-scope">Scope</label><input className="ui-input" id="g-scope" name="scope" defaultValue="core" />
      </ActionForm></>}</>;
}
