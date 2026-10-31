import { Plus, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { descendants, personName, type NodeKind, type NodeTone, type OrganizationNode, type StaffPerson } from "./api";
import { NodeAvatar } from "./OrganizationTree";

interface Props { node: OrganizationNode; nodes: OrganizationNode[]; staff: StaffPerson[]; editable: boolean; onChange: (node: OrganizationNode) => void; onClose: () => void; onDelete: () => void; onSelect: (id: string) => void; onAdd: () => void }
export function OrganizationDetails({ node, nodes, staff, editable, onChange, onClose, onDelete, onSelect, onAdd }: Props) {
  const [tab, setTab] = useState<"details" | "members" | "reports">("details"), [search, setSearch] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const excluded = descendants(nodes, node.id), reports = nodes.filter(item => item.parent_id === node.id);
  const members = staff.filter(person => node.member_ids.includes(person.id) || person.id === node.head_staff_id);
  const update = (values: Partial<OrganizationNode>) => onChange({ ...node, ...values });
  useEffect(() => {
    const element = dialog.current!;
    const media = window.matchMedia("(max-width: 1099px)");
    const adjust = () => { element.close(); if (media.matches) element.showModal(); else element.show(); };
    adjust(); media.addEventListener("change", adjust);
    return () => { media.removeEventListener("change", adjust); element.close(); };
  }, []);
  return <dialog ref={dialog} className="org-details" aria-labelledby="org-detail-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><NodeAvatar node={node} staff={staff}/><div><h2 id="org-detail-title">{node.name || "New node"}</h2><p>{node.kind} · {members.length} members</p></div><button type="button" aria-label="Close details" onClick={onClose}><X size={19}/></button></header>
    <div className="org-detail-tabs" role="tablist" aria-label="Node information">{(["details", "members", "reports"] as const).map(value => <button key={value} id={`org-tab-${value}`} type="button" role="tab" aria-selected={tab === value} aria-controls="org-detail-panel" tabIndex={tab === value ? 0 : -1} onClick={() => setTab(value)} onKeyDown={event => { if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return; event.preventDefault(); const tabs = ["details", "members", "reports"] as const; const next = tabs[(tabs.indexOf(tab) + (event.key === "ArrowRight" ? 1 : 2)) % 3]!; setTab(next); document.getElementById(`org-tab-${next}`)?.focus(); }}>{value === "members" ? `Members (${members.length})` : value === "reports" ? `Reports (${reports.length})` : "Details"}</button>)}</div>
    <div className="org-detail-body" role="tabpanel" id="org-detail-panel" aria-labelledby={`org-tab-${tab}`}>
      {tab === "details" && <fieldset disabled={!editable}>
        <label>Node name<input value={node.name} maxLength={120} required onChange={event => update({ name: event.target.value })}/></label>
        <label>Type<select value={node.kind} onChange={event => update({ kind: event.target.value as NodeKind })}><option value="leadership">Leadership</option><option value="department">Department</option><option value="team">Team</option><option value="position">Position</option></select></label>
        <label>Head / person<select value={node.head_staff_id ?? ""} onChange={event => update({ head_staff_id: event.target.value || null })}><option value="">Unassigned</option>{staff.filter(person => person.status === "active" || person.id === node.head_staff_id).map(person => <option key={person.id} value={person.id}>{personName(person)}{person.status !== "active" ? ` (${person.status})` : ""}</option>)}</select></label>
        <label>Reports to<select value={node.parent_id ?? ""} onChange={event => update({ parent_id: event.target.value || null })}><option value="">Top level</option>{nodes.filter(item => !excluded.has(item.id)).map(item => <option key={item.id} value={item.id}>{item.name || "Untitled node"}</option>)}</select></label>
        <label>Description<textarea rows={3} value={node.description} maxLength={1000} placeholder="What this part of the institution does" onChange={event => update({ description: event.target.value })}/></label>
        <label>Card colour<select value={node.tone} onChange={event => update({ tone: event.target.value as NodeTone })}>{["violet", "blue", "teal", "rose", "slate"].map(tone => <option key={tone} value={tone}>{tone[0]!.toUpperCase() + tone.slice(1)}</option>)}</select></label>
        <p className="org-note">Reporting lines describe the organization. They do not change permissions or official appointments.</p>
      </fieldset>}
      {tab === "members" && <><p className="org-note">The head is included in the member count. Staff can belong to more than one team.</p><ul className="org-members">{members.map(person => <li key={person.id}><span className="org-initials">{person.first_name[0]}{person.last_name[0]}</span><div><strong>{personName(person)}</strong><small>{person.designation}{person.status !== "active" ? ` · ${person.status}` : ""}{node.head_staff_id === person.id ? " · Head" : ""}</small></div>{editable && node.member_ids.includes(person.id) && <button type="button" aria-label={`Remove ${personName(person)}`} onClick={() => update({ member_ids: node.member_ids.filter(id => id !== person.id) })}><X size={16}/></button>}</li>)}</ul>{!members.length && <p>No members yet.</p>}{editable && <><label>Find staff to add<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search staff names"/></label><ul className="org-member-options">{staff.filter(person => person.status === "active" && !members.some(member => member.id === person.id) && personName(person).toLowerCase().includes(search.toLowerCase())).map(person => <li key={person.id}><button type="button" onClick={() => update({ member_ids: [...node.member_ids, person.id] })}><Plus size={15}/>{personName(person)}<small>{person.designation}</small></button></li>)}</ul></>}</>}
      {tab === "reports" && <><p className="org-note">Direct reporting nodes</p><ul className="org-report-list">{reports.map(report => <li key={report.id}><button type="button" onClick={() => onSelect(report.id)}>{report.name}<small>{report.kind}</small></button></li>)}</ul>{!reports.length && <p>No direct reports yet.</p>}{editable && <button type="button" className="org-secondary" onClick={onAdd}><Plus size={16}/>Add reporting node</button>}</>}
    </div>
    <footer>{editable && <button type="button" className="org-danger" onClick={onDelete}><Trash2 size={15}/>Delete node</button>}<button type="button" className="org-primary" onClick={onClose}>Done</button></footer>
  </dialog>;
}
