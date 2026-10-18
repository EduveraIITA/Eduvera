import { BookOpen, BriefcaseBusiness, ChevronDown, ChevronRight, Network, Plus, UsersRound } from "lucide-react";
import { useState } from "react";
import { personName, type OrganizationNode, type StaffPerson } from "./api";

export const nodeIcons = { leadership: Network, department: BookOpen, team: UsersRound, position: BriefcaseBusiness };
export function StaffAvatar({ person }: { person: StaffPerson }) {
  const [failed, setFailed] = useState(false);
  return person.avatar_url && !failed ? <img className="org-person-photo" src={person.avatar_url} alt="" onError={() => setFailed(true)}/> : <>{person.first_name[0] ?? ""}{person.last_name[0] ?? ""}</>;
}
export function NodeAvatar({ node, staff }: { node: OrganizationNode; staff: StaffPerson[] }) {
  const person = staff.find(item => item.id === node.head_staff_id), Icon = nodeIcons[node.kind];
  return <span className={`org-avatar org-tone-${node.tone}`} aria-hidden="true">{node.kind === "leadership" && person ? <StaffAvatar key={person.id} person={person}/> : <Icon size={23}/>}</span>;
}
interface Props {
  nodes: OrganizationNode[]; staff: StaffPerson[]; selected: string | null; visible: Set<string>; list: boolean;
  editable: boolean; filtering?: boolean; onSelect: (id: string) => void; onMove: (id: string, parent: string | null) => void; onAdd: (parent: string | null) => void;
}
export function OrganizationTree(props: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(window.matchMedia("(max-width: 767px)").matches ? props.nodes.filter(node => node.kind === "department").slice(1).map(node => node.id) : []));
  const [dragging, setDragging] = useState<string | null>(null), [over, setOver] = useState<string | null>(null);
  const render = (parent: string | null, depth: number) => {
    const children = props.nodes.filter(node => node.parent_id === parent && props.visible.has(node.id));
    return children.length ? <ul className={depth === 0 ? "org-roots" : "org-branches"}>{children.map(node => {
      const head = props.staff.find(person => person.id === node.head_staff_id);
      const hasChildren = props.nodes.some(child => child.parent_id === node.id && props.visible.has(child.id));
      const folded = !props.filtering && collapsed.has(node.id);
      return <li key={node.id} className={`org-branch org-depth-${Math.min(depth, 2)}`}>
        <div className={`org-card-wrap ${over === node.id ? "org-drop-target" : ""}`} onDragOver={event => { if (dragging && dragging !== node.id) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setOver(node.id); } }} onDragLeave={() => setOver(null)} onDrop={event => { event.preventDefault(); if (dragging) props.onMove(dragging, node.id); setDragging(null); setOver(null); }}>
          <button type="button" className={`org-node org-tone-${node.tone} ${props.selected === node.id ? "is-selected" : ""}`} aria-pressed={props.selected === node.id} onClick={() => props.onSelect(node.id)} draggable={props.editable}
            onDragStart={event => { event.dataTransfer.setData("text/plain", node.id); event.dataTransfer.effectAllowed = "move"; setDragging(node.id); }} onDragEnd={() => { setDragging(null); setOver(null); }}>
            <NodeAvatar node={node} staff={props.staff}/><span className="org-node-copy"><strong>{node.name || "Untitled node"}</strong>{head ? <small>{node.kind === "leadership" ? personName(head) : `Head: ${personName(head)}`}</small> : null}<span className="org-node-meta">{node.kind === "leadership" ? "Leadership" : `${new Set([...node.member_ids, ...(node.head_staff_id ? [node.head_staff_id] : [])]).size} members`}</span></span>
          </button>
          {hasChildren && <button type="button" className="org-fold" aria-label={`${folded ? "Expand" : "Collapse"} ${node.name}`} aria-expanded={!folded} onClick={() => setCollapsed(previous => { const next = new Set(previous); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next; })}>{folded ? <ChevronRight size={16}/> : <ChevronDown size={16}/>}</button>}
        </div>
        {!folded && render(node.id, depth + 1)}
        {props.editable && !folded && node.kind === "department" && <button type="button" className="org-add-child" onClick={() => props.onAdd(node.id)}><Plus size={15}/>Add position</button>}
      </li>;
    })}</ul> : null;
  };
  return <div className={props.list ? "org-tree org-tree--list" : "org-tree"}>{render(null, 0)}</div>;
}
