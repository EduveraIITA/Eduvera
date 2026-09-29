import { useState } from "react";
import { type Administration, fullName, save } from "../../features/administration";
import { RecordForm } from "./RecordForm";

export function People({ school, data, refresh }: { school: string; data: Administration; refresh: () => Promise<void> }) {
  const [token, setToken] = useState("");
  const [memberId, setMemberId] = useState("");
  const member = data.members.find((item) => item.id === memberId);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  return <div className="ops-stack"><RecordForm title="Invite a school member" fields={[{ name: "email", label: "Recipient email", type: "email" }, { name: "role", label: "School role", options: ["student", "guardian", "staff", "admin"].map((role) => ({ value: role, label: role })) }]}
    onSave={async (values) => { setToken(""); const result = await save<{ token: string }>(school, "invitations", values); setToken(result.token); await refresh(); }}>
    <p className="muted">Administrator only. Codes are single-use and expire after 72 hours. No email is sent automatically.</p>
  </RecordForm>
    {token ? <section className="card ops-panel"><h2>Share privately with the recipient</h2><p>Open <a href="/staff/join">{window.location.origin}/staff/join</a> and enter this code:</p><p className="ops-code">{token}</p><button className="btn" onClick={() => setToken("")}>Hide invitation code</button></section> : null}
    <section className="card ops-panel"><h2>School access</h2><label>Select member<select className="input" value={memberId} onChange={(event) => setMemberId(event.target.value)}><option value="">Select…</option>{data.members.map((item) => <option key={item.id} value={item.id}>{fullName(item)} · {item.role} · {item.is_active ? "active" : "inactive"}</option>)}</select></label></section>
    {member ? <RecordForm key={member.id} title={`Manage ${fullName(member)}`} fields={[]} onSave={async (values) => {
      const permissions = ["sis.manage", "fees.manage"].filter((permission) => values[permission] === "on");
      await save(school, `members/${member.id}`, { is_active: values.active === "on", permissions }, "PATCH"); await refresh(); setMemberId("");
    }}>
      <label className="ops-check"><input type="checkbox" name="active" defaultChecked={member.is_active} />Active school membership</label>
      {member.role === "staff" ? ["sis.manage", "fees.manage"].map((permission) => <label key={permission} className="ops-check"><input name={permission} type="checkbox" defaultChecked={data.grants.some((grant) => grant.user_id === member.user_id && grant.permission === permission)} />{permission === "sis.manage" ? "Manage student records and academic setup" : "Manage fees and offline receipts"}</label>) : null}
      <p className="muted">The final school administrator cannot be deactivated. This changes school access, not the person’s global account.</p>
    </RecordForm> : null}
    <section className="card ops-panel"><h2>Recent invitations</h2><div className="ops-table"><table><thead><tr><th>Email</th><th>Role</th><th>Status</th><th>Action</th></tr></thead><tbody>{data.invitations.map((invite) => <tr key={invite.id}><td>{invite.email}</td><td>{invite.role}</td><td>{invite.accepted_at ? "Accepted" : invite.revoked_at ? "Revoked" : new Date(invite.expires_at) < new Date() ? "Expired" : "Pending"}</td><td>{!invite.accepted_at && !invite.revoked_at ? <button className="btn sm" disabled={busy} onClick={async () => { setBusy(true); setError(""); try { await save(school, `invitations/${invite.id}/revoke`, {}); await refresh(); } catch (err) { setError((err as Error).message); } finally { setBusy(false); } }}>Revoke</button> : null}</td></tr>)}</tbody></table></div>{error ? <p role="alert">{error}</p> : null}</section>
  </div>;
}
