import { Plus, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  descendants,
  personName,
  type NodeKind,
  type NodeTone,
  type OrganizationNode,
  type StaffPerson,
} from "./api";
import { NodeAvatar } from "./OrganizationTree";

interface OrganizationDetailsProps {
  node: OrganizationNode;
  nodes: OrganizationNode[];
  staff: StaffPerson[];
  editable: boolean;
  onChange: (node: OrganizationNode) => void;
  onClose: () => void;
  onDelete: () => void;
  onSelect: (id: string) => void;
  onAdd: () => void;
}

export function OrganizationDetails({
  node,
  nodes,
  staff,
  editable,
  onChange,
  onClose,
  onDelete,
  onSelect,
  onAdd,
}: OrganizationDetailsProps) {
  const [tab, setTab] = useState<"details" | "people" | "reports">("details");
  const [search, setSearch] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const excludedParents = descendants(nodes, node.id);
  const reports = nodes.filter((item) => item.parent_id === node.id);
  const people = staff.filter(
    (person) => node.member_ids.includes(person.id) || person.id === node.head_staff_id,
  );
  const update = (values: Partial<OrganizationNode>) => onChange({ ...node, ...values });

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!element.open) element.showModal();
    return () => {
      if (element.open) element.close();
    };
  }, []);

  return <dialog
    ref={dialog}
    className="organization-sheet"
    aria-labelledby="organization-sheet-title"
    onCancel={(event) => {
      event.preventDefault();
      onClose();
    }}
  >
    <header>
      <NodeAvatar node={node} staff={staff} />
      <div>
        <span>{node.kind}</span>
        <h2 id="organization-sheet-title">{node.name || "New node"}</h2>
      </div>
      <button type="button" aria-label="Close details" onClick={onClose}><X size={20} /></button>
    </header>
    <div className="organization-sheet__tabs" role="tablist" aria-label="Organization node">
      {(["details", "people", "reports"] as const).map((value) => <button
        key={value}
        id={`organization-tab-${value}`}
        type="button"
        role="tab"
        aria-selected={tab === value}
        aria-controls="organization-detail-panel"
        onClick={() => setTab(value)}
      >
        {value === "people" ? `People (${people.length})` : value === "reports" ? `Reports (${reports.length})` : "Details"}
      </button>)}
    </div>
    <div
      className="organization-sheet__body"
      role="tabpanel"
      id="organization-detail-panel"
      aria-labelledby={`organization-tab-${tab}`}
    >
      {tab === "details" ? <fieldset disabled={!editable}>
        <label>Node name<input aria-label="Node name" value={node.name} maxLength={120} required onChange={(event) => update({ name: event.target.value })} /></label>
        <label>Type<select aria-label="Type" value={node.kind} onChange={(event) => update({ kind: event.target.value as NodeKind })}>
          <option value="leadership">Leadership</option>
          <option value="department">Department</option>
          <option value="team">Team</option>
          <option value="position">Position</option>
        </select></label>
        <label>Lead / person<select aria-label="Lead / person" value={node.head_staff_id ?? ""} onChange={(event) => update({ head_staff_id: event.target.value || null })}>
          <option value="">Unassigned</option>
          {staff.filter((person) => person.status === "active" || person.id === node.head_staff_id).map((person) => <option key={person.id} value={person.id}>
            {personName(person)}{person.status !== "active" ? ` (${person.status})` : ""}
          </option>)}
        </select></label>
        <label>Reports to<select aria-label="Reports to" value={node.parent_id ?? ""} onChange={(event) => update({ parent_id: event.target.value || null })}>
          <option value="">Top level</option>
          {nodes.filter((item) => !excludedParents.has(item.id)).map((item) => <option key={item.id} value={item.id}>{item.name || "Untitled node"}</option>)}
        </select></label>
        <label>Description<textarea aria-label="Description" rows={3} maxLength={1000} value={node.description} placeholder="What this part of the institution does" onChange={(event) => update({ description: event.target.value })} /></label>
        <label>Card colour<select aria-label="Card colour" value={node.tone} onChange={(event) => update({ tone: event.target.value as NodeTone })}>
          {(["violet", "blue", "teal", "rose", "slate"] as const).map((tone) => <option key={tone} value={tone}>{tone.charAt(0).toUpperCase() + tone.slice(1)}</option>)}
        </select></label>
        <p className="organization-sheet__note">This structure explains how people work together. It does not change account access, permissions or official appointments.</p>
      </fieldset> : null}
      {tab === "people" ? <>
        <p className="organization-sheet__note">A person can belong to more than one team. The lead is included in the count.</p>
        <ul className="organization-people">
          {people.map((person) => <li key={person.id}>
            <span>{person.first_name[0]}{person.last_name[0]}</span>
            <div><strong>{personName(person)}</strong><small>{person.designation}{person.id === node.head_staff_id ? " · Lead" : ""}</small></div>
            {editable && node.member_ids.includes(person.id) ? <button type="button" aria-label={`Remove ${personName(person)}`} onClick={() => update({ member_ids: node.member_ids.filter((id) => id !== person.id) })}><X size={17} /></button> : null}
          </li>)}
        </ul>
        {!people.length ? <p className="organization-sheet__empty">No people connected yet.</p> : null}
        {editable ? <div className="organization-add-people">
          <label>Find staff<input type="search" value={search} placeholder="Search staff" onChange={(event) => setSearch(event.target.value)} /></label>
          <ul>{staff.filter((person) => person.status === "active" && !people.some((member) => member.id === person.id) && personName(person).toLowerCase().includes(search.toLowerCase())).map((person) => <li key={person.id}>
            <button type="button" onClick={() => update({ member_ids: [...node.member_ids, person.id] })}><Plus size={17} /><span><strong>{personName(person)}</strong><small>{person.designation}</small></span></button>
          </li>)}</ul>
        </div> : null}
      </> : null}
      {tab === "reports" ? <>
        <p className="organization-sheet__note">Nodes that report directly here.</p>
        <ul className="organization-reports">
          {reports.map((report) => <li key={report.id}><button type="button" onClick={() => onSelect(report.id)}><span><strong>{report.name}</strong><small>{report.kind}</small></span><ChevronRightIcon /></button></li>)}
        </ul>
        {!reports.length ? <p className="organization-sheet__empty">No direct reports yet.</p> : null}
        {editable ? <button type="button" className="organization-secondary-button" onClick={onAdd}><Plus size={17} />Add reporting node</button> : null}
      </> : null}
    </div>
    <footer>
      {editable ? <button type="button" className="organization-danger-button" onClick={onDelete}><Trash2 size={17} />Delete node</button> : <span />}
      <button type="button" className="organization-primary-button" onClick={onClose}>Done</button>
    </footer>
  </dialog>;
}

function ChevronRightIcon() {
  return <span aria-hidden="true">›</span>;
}
