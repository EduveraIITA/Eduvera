import {
  BriefcaseBusiness,
  Building2,
  ChevronDown,
  ChevronRight,
  Network,
  UsersRound,
} from "lucide-react";
import { useState, type CSSProperties } from "react";
import {
  personName,
  type DropPosition,
  type OrganizationNode,
  type StaffPerson,
} from "./api";

import { OrganizationMoveHandle, type DropTarget } from "./OrganizationMoveHandle";

const nodeIcons = {
  leadership: Network,
  department: Building2,
  team: UsersRound,
  position: BriefcaseBusiness,
};

function StaffAvatar({ person }: { person: StaffPerson }) {
  const [failed, setFailed] = useState(false);
  if (person.avatar_url && !failed) {
    return <img src={person.avatar_url} alt="" onError={() => setFailed(true)} />;
  }
  return <>{person.first_name[0] ?? ""}{person.last_name[0] ?? ""}</>;
}

export function NodeAvatar({
  node,
  staff,
}: {
  node: OrganizationNode;
  staff: StaffPerson[];
}) {
  const head = staff.find((person) => person.id === node.head_staff_id);
  const Icon = nodeIcons[node.kind];
  return <span className={`organization-node__avatar is-${node.tone}`} aria-hidden="true">
    {node.kind === "leadership" && head
      ? <StaffAvatar key={head.id} person={head} />
      : <Icon size={20} strokeWidth={2} />}
  </span>;
}

interface OrganizationTreeProps {
  nodes: OrganizationNode[];
  staff: StaffPerson[];
  selected: string | null;
  visible: Set<string>;
  mode: "hierarchy" | "list";
  filtering: boolean;
  onSelect: (id: string) => void;
  editable: boolean;
  onMove: (id:string,target:string|null,position:DropPosition)=>void;
}

export function OrganizationTree({
  nodes,
  staff,
  selected,
  visible,
  mode,
  filtering,
  onSelect,
  editable,
  onMove,
}: OrganizationTreeProps) {
  const [dragging,setDragging] = useState<string|null>(null);
  const [drop,setDrop] = useState<DropTarget|null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const renderLevel = (parentId: string | null, depth: number) => {
    const children = nodes.filter(
      (node) => node.parent_id === parentId && visible.has(node.id),
    );
    if (!children.length) return null;
    return <ul className={depth === 0 ? "organization-tree__roots" : "organization-tree__children"}>
      {children.map((node) => {
        const head = staff.find((person) => person.id === node.head_staff_id);
        const memberCount = new Set([
          ...node.member_ids,
          ...(node.head_staff_id ? [node.head_staff_id] : []),
        ]).size;
        const hasChildren = nodes.some(
          (candidate) => candidate.parent_id === node.id && visible.has(candidate.id),
        );
        const folded = !filtering && collapsed.has(node.id);
        return <li key={node.id} className="organization-tree__branch" style={{ "--org-depth": depth } as CSSProperties}>
          <div data-org-node={node.id} className={`organization-tree__row${dragging===node.id?' is-dragging':''}${drop?.id===node.id?' is-drop-'+drop.position:''}`}>
            <OrganizationMoveHandle node={node} nodes={nodes} disabled={!editable || filtering}
              onDetails={()=>onSelect(node.id)}
              onPreview={(id,target)=>{setDragging(id);setDrop(target);}}
              onMove={(id,target,position)=>{
                onMove(id,target,position);
                if(target && position==='inside')setCollapsed(previous=>{const next=new Set(previous);next.delete(target);return next;});
              }}/>
            <button
              type="button"
              className={`organization-node is-${node.tone}${selected === node.id ? " is-selected" : ""}`}
              aria-pressed={selected === node.id}
              onClick={() => onSelect(node.id)}
            >
              <NodeAvatar node={node} staff={staff} />
              <span className="organization-node__copy">
                <strong>{node.name || "Untitled node"}</strong>
                <small>{head ? `${node.kind === "leadership" ? "Led by" : "Head"}: ${personName(head)}` : "No lead assigned"}</small>
                <span>{node.kind} · {memberCount} {memberCount === 1 ? "person" : "people"}</span>
              </span>
              <ChevronRight size={18} aria-hidden="true" />
            </button>
            {hasChildren ? <button
              type="button"
              className="organization-tree__fold"
              aria-label={`${folded ? "Expand" : "Collapse"} ${node.name}`}
              aria-expanded={!folded}
              onClick={() => setCollapsed((previous) => {
                const next = new Set(previous);
                if (next.has(node.id)) next.delete(node.id);
                else next.add(node.id);
                return next;
              })}
            >{folded ? <ChevronRight size={17} /> : <ChevronDown size={17} />}</button> : null}
          </div>
          {!folded ? renderLevel(node.id, mode === "list" ? 0 : depth + 1) : null}
        </li>;
      })}
    </ul>;
  };

  return <div className={`organization-tree organization-tree--${mode}`}>
    <p id="organization-drag-help" className="organization-drag-help">Drag the grip to move a role. Use arrow keys to reorder or change its level; Enter opens details.{filtering?' Clear search to drag.':''}</p>
    {editable ? <div data-org-drop-root className={`organization-root-drop${drop?.position==='root'?' is-active':''}`}>Drop here for top level</div> : null}
    <span className="organization-move-announcement" role="status">{dragging && drop ? drop.position==='root'?'Move to top level':`Move ${drop.position==='inside'?'under':drop.position} ${nodes.find(node=>node.id===drop.id)?.name??''}`:''}</span>
    {renderLevel(null, 0)}
  </div>;
}
