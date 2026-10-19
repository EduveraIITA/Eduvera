import { apiFetch } from "../../lib/api";

export type NodeKind = "leadership" | "department" | "team" | "position";
export type NodeTone = "violet" | "blue" | "teal" | "rose" | "slate";

export interface OrganizationNode {
  id: string;
  parent_id: string | null;
  kind: NodeKind;
  name: string;
  description: string;
  tone: NodeTone;
  head_staff_id: string | null;
  member_ids: string[];
}

export interface StaffPerson {
  id: string;
  first_name: string;
  last_name: string;
  designation: string;
  status: "active" | "inactive" | "onboarding";
  avatar_url?: string | null;
}

export interface OrganizationWorkspace {
  revision: number;
  nodes: OrganizationNode[];
  staff: StaffPerson[];
  can_edit: boolean;
  generated?: boolean;
  default_notice?: string;
}

export const personName = (person: StaffPerson) =>
  `${person.first_name} ${person.last_name}`.trim();

const organizationUrl = (schoolId: string) =>
  `/api/v1/schools/${encodeURIComponent(schoolId)}/organization/`;

export const getOrganization = (schoolId: string) =>
  apiFetch<OrganizationWorkspace>(organizationUrl(schoolId));

export const saveOrganization = (
  schoolId: string,
  input: {
    nodes: OrganizationNode[];
    expected_revision: number;
    request_id: string;
  },
) => apiFetch<{ revision: number; nodes: OrganizationNode[]; replayed: boolean }>(
  organizationUrl(schoolId),
  { method: "PUT", body: JSON.stringify(input) },
);

export function descendants(nodes: OrganizationNode[], id: string): Set<string> {
  const found = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (node.parent_id && found.has(node.parent_id) && !found.has(node.id)) {
        found.add(node.id);
        changed = true;
      }
    }
  }
  return found;
}

export function moveNode(
  nodes: OrganizationNode[],
  id: string,
  parentId: string | null,
): OrganizationNode[] {
  if (parentId && descendants(nodes, id).has(parentId)) return nodes;
  return nodes.map((node) => node.id === id ? { ...node, parent_id: parentId } : node);
}

export type DropPosition = 'before' | 'inside' | 'after' | 'root';
export function rearrangeNode(nodes: OrganizationNode[], id: string, targetId: string | null, position: DropPosition): OrganizationNode[] {
  const source = nodes.find(node => node.id === id);
  const target = nodes.find(node => node.id === targetId);
  if (!source || id === targetId || (position !== 'root' && !target)) return nodes;
  const parentId = position === 'root' ? null : position === 'inside' ? target!.id : target!.parent_id;
  if (parentId && descendants(nodes,id).has(parentId)) return nodes;
  const next = nodes.filter(node => node.id !== id);
  const moved = { ...source, parent_id: parentId };
  const index = target ? next.findIndex(node => node.id === target.id) : next.length;
  next.splice(position === 'before' ? index : position === 'after' ? index + 1 : next.length,0,moved);
  // Match the server's reporting-depth limit before changing the draft.
  if (next.some(node => {
    let depth = 1; let parent = node.parent_id;
    while (parent) { depth++; if (depth > 12) return true; parent = next.find(candidate => candidate.id === parent)?.parent_id ?? null; }
    return false;
  })) return nodes;
  return JSON.stringify(next) === JSON.stringify(nodes) ? nodes : next;
}
