import { Copy, KeyRound, Mail, Search, ShieldCheck, UserCog, Users } from "lucide-react";
import { useState } from "react";
import { Empty, Initials, Pill, SectionTitle, Status, Tabs, fmtDate, useToast } from "../../components/ui";
import { type Administration, fullName, save } from "../../features/administration";
import { RecordForm } from "./RecordForm";

const ROLE: Record<string, string> = { student: "Student", guardian: "Guardian", staff: "Staff", admin: "Administrator" };
const PERMISSION: Array<{ id: string; label: string; hint: string }> = [
  { id: "sis.manage", label: "Manage student records", hint: "Academic setup, students, guardians, imports and invitations." },
  { id: "fees.manage", label: "Manage fees", hint: "Post invoices and record offline receipts." },
];

/* Invitation email status is distinct from account acceptance. */
export function People({ school, data, refresh }: { school: string; data: Administration; refresh: () => Promise<void> }) {
  const toast = useToast();
  const [invite, setInvite] = useState<{ token: string; email: string; role: string; expires_at?: string; delivery?: string } | null>(null);
  const [memberId, setMemberId] = useState("");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "admin" | "staff" | "guardian" | "student">("all");
  const [limit, setLimit] = useState(25);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const member = data.members.find((item) => item.id === memberId);
  const inviteState = (i: Administration["invitations"][number]) =>
    i.accepted_at ? ["Accepted", "pos"] as const : i.revoked_at ? ["Revoked", "neu"] as const : new Date(i.expires_at) < new Date() ? ["Expired", "cri"] as const : ["Pending", "cau"] as const;
  const pending = data.invitations.filter((i) => inviteState(i)[0] === "Pending").length;
  const joinUrl = `${window.location.origin}/staff/join`;
  const q = search.trim().toLowerCase();
  const members = data.members.filter((m) => (roleFilter === "all" || m.role === roleFilter) && (!q || `${fullName(m)} ${m.email}`.toLowerCase().includes(q)));
  const shown = members.slice(0, limit);
  const roleCount = (r: string) => data.members.filter((m) => m.role === r).length;

  async function copy(text: string, what: string) {
    try { await navigator.clipboard.writeText(text); toast(`${what} copied.`); } catch { toast("Copy failed — select the text and copy it manually.", true); }
  }

  return (
    <div className="col">
      <div className="grid12">
        <div className="col-5 col">
          <RecordForm icon={Mail} title="Invite a school member" submitLabel="Create invitation code" fields={[
            { name: "email", label: "Recipient email", type: "email", wide: true },
            { name: "role", label: "School role", options: Object.entries(ROLE).map(([value, label]) => ({ value, label })), hint: "Students must already exist in the directory." },
          ]} onSave={async (values) => {
            setInvite(null);
            const result = await save<{ token: string; expires_at?: string; delivery?: string }>(school, "invitations", values);
            setInvite({ token: result.token, email: values.email!, role: values.role!, expires_at: result.expires_at, delivery: result.delivery });
            await refresh();
          }}>
            <p className="t-bsm ink2">Codes are single-use and expire after 72 hours. Email is attempted when configured; a private code remains available.</p>
          </RecordForm>

          {invite ? (
            <section className="panel tight card ring">
              <SectionTitle small icon={KeyRound} title="Invitation ready" aside={<Pill kind="tint">{ROLE[invite.role] ?? invite.role}</Pill>} />
              <p className="t-bsm ink2">For <b>{invite.email}</b>. They open <a href="/staff/join" target="_blank" rel="noreferrer">{joinUrl}</a>, enter this code with the same email, and set a password.{invite.expires_at ? ` Expires ${fmtDate(invite.expires_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}.` : ""}</p>
              <p className="t-bsm ink2">{invite.delivery === 'email_accepted' ? 'Invitation email accepted by the mail server. Check inbox and spam.' : invite.delivery === 'failed' ? 'Email delivery could not be confirmed. Share the code privately or create a replacement.' : 'No email has been sent. Share the code privately.'}</p>
              <div className="code-box big" aria-label="Invitation code">{invite.token}</div>
              <div className="btnrow">
                <button className="btn pri" onClick={() => void copy(invite.token, "Invitation code")}><Copy size={16} />Copy code</button>
                <button className="btn" onClick={() => void copy(`Join ${data.school.name} on OmniSchool: ${joinUrl}\nInvitation code: ${invite.token}\nUse the email ${invite.email}. The code expires in 72 hours.`, "Message")}>Copy message</button>
                <button className="btn ghost" onClick={() => setInvite(null)}>Hide</button>
              </div>
            </section>
          ) : null}
        </div>

        <div className="col-7 card">
          <div className="card-h"><b><Mail size={18} />Invitations</b>{pending ? <Pill kind="cau">{pending} pending</Pill> : <span className="aside">{data.invitations.length}</span>}</div>
          {data.invitations.length === 0 ? <Empty>No invitations yet.</Empty> : (
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>Email</th><th>Role</th><th>Expires</th><th>Status</th><th></th></tr></thead>
              <tbody>{data.invitations.map((i) => { const [label, tone] = inviteState(i); return (
                <tr key={i.id}>
                  <td className="t-llg">{i.email}</td>
                  <td><Pill kind="soft">{ROLE[i.role] ?? i.role}</Pill></td>
                  <td className="ink2">{fmtDate(i.expires_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                  <td><Status tone={tone}>{label}</Status></td>
                  <td className="num">{label === "Pending" ? <button className="btn sm danger" disabled={busy} onClick={async () => { setBusy(true); setError(""); try { await save(school, `invitations/${i.id}/revoke`, {}); toast("Invitation revoked."); await refresh(); } catch (err) { setError((err as Error).message); } finally { setBusy(false); } }}>Revoke</button> : null}</td>
                </tr>
              ); })}</tbody>
            </table></div>
          )}
          {error ? <p className="t-bsm cri-c" role="alert" style={{ padding: "10px 20px" }}>{error}</p> : null}
        </div>
      </div>

      <div className="grid12">
        <div className="col-8 card">
          <div className="card-h" style={{ flexWrap: "wrap" }}>
            <b><Users size={18} />School members</b>
            <div className="btnrow">
              <Tabs value={roleFilter} onChange={(r) => { setRoleFilter(r); setLimit(25); }} items={[{ id: "all", label: `All ${data.members.length}` }, { id: "admin", label: `Admins ${roleCount("admin")}` }, { id: "staff", label: `Staff ${roleCount("staff")}` }, { id: "guardian", label: `Guardians ${roleCount("guardian")}` }, { id: "student", label: `Students ${roleCount("student")}` }]} />
              <label className="field inline" style={{ gap: 6 }}><Search size={16} color="var(--muted)" /><input className="input sm" type="search" placeholder="Name or email" value={search} onChange={(e) => { setSearch(e.target.value); setLimit(25); }} style={{ width: 200 }} aria-label="Find a member" /></label>
            </div>
          </div>
          {members.length === 0 ? <Empty>{data.members.length ? "No members match." : "No members yet."}</Empty> : (
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>Member</th><th>Role</th><th>Permissions</th><th>Access</th><th></th></tr></thead>
              <tbody>{shown.map((m) => {
                const perms = data.grants.filter((g) => g.user_id === m.user_id).map((g) => g.permission);
                return (
                  <tr key={m.id} style={memberId === m.id ? { background: "var(--brand-tint)" } : undefined}>
                    <td><div style={{ display: "flex", alignItems: "center", gap: 10 }}><Initials name={fullName(m)} /><div className="rowtxt"><b>{fullName(m)}</b><span>{m.email}</span></div></div></td>
                    <td><Pill kind={m.role === "admin" ? "tint" : "soft"}>{ROLE[m.role] ?? m.role}</Pill></td>
                    <td>{m.role === "admin" ? <span className="t-bsm ink2">Everything</span> : perms.length ? <div className="btnrow" style={{ gap: 4 }}>{perms.map((p) => <Pill key={p} kind="high">{PERMISSION.find((x) => x.id === p)?.label ?? p}</Pill>)}</div> : <span className="faint">—</span>}</td>
                    <td>{m.is_active ? <Status tone="pos">Active</Status> : <Status tone="neu">Inactive</Status>}</td>
                    <td className="num" style={{ whiteSpace: "nowrap" }}><button className="btn sm" aria-pressed={memberId === m.id} onClick={() => setMemberId(memberId === m.id ? "" : m.id)}>Manage</button></td>
                  </tr>
                );
              })}</tbody>
            </table></div>
          )}
          {members.length > shown.length ? <div className="btnrow" style={{ padding: "12px 20px", borderTop: "1px solid var(--line-3)" }}><button className="btn sm" onClick={() => setLimit((n) => n + 50)}>Show more</button><span className="t-bsm faint">{shown.length} of {members.length}</span></div> : null}
        </div>
        <div className="col-4">
          {member ? (
            <RecordForm key={member.id} icon={UserCog} title={`Manage ${fullName(member)}`} fields={[]} onCancel={() => setMemberId("")}
              onSave={async (values) => {
                const permissions = PERMISSION.map((p) => p.id).filter((p) => values[p] === "on");
                await save(school, `members/${member.id}`, { is_active: values.active === "on", permissions }, "PATCH");
                await refresh(); setMemberId("");
              }}>
              <div className="col xs">
                <label className="check"><input type="checkbox" name="active" defaultChecked={member.is_active} /><span><b>Active school membership</b> — turning this off removes their access to this school only, not their account.</span></label>
                {member.role === "staff" ? PERMISSION.map((p) => (
                  <label key={p.id} className="check"><input name={p.id} type="checkbox" defaultChecked={data.grants.some((g) => g.user_id === member.user_id && g.permission === p.id)} /><span><b>{p.label}</b> — {p.hint}</span></label>
                )) : null}
              </div>
              <p className="t-bsm faint">The last administrator cannot be deactivated.</p>
            </RecordForm>
          ) : (
            <div className="panel tight">
              <SectionTitle small icon={ShieldCheck} title="Access rules" />
              <dl className="kv">
                <dt>Administrator</dt><dd>Full access, can invite and manage members.</dd>
                <dt>Staff</dt><dd>Registers and leave by default; grant permissions per person.</dd>
                <dt>Guardian</dt><dd>Sees only the students they are linked to.</dd>
                <dt>Student</dt><dd>Sees their own record.</dd>
              </dl>
              <p className="t-bsm faint">Pick a member to change their access.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
