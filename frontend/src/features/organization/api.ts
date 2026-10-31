import { apiFetch } from "../../lib/api";

export type NodeKind = "leadership" | "department" | "team" | "position";
export type NodeTone = "violet" | "blue" | "teal" | "rose" | "slate";
export interface OrganizationNode {
  id: string; parent_id: string | null; kind: NodeKind; name: string; description: string;
  tone: NodeTone; head_staff_id: string | null; member_ids: string[];
}
export interface StaffPerson { id: string; first_name: string; last_name: string; designation: string; status: "active" | "inactive" | "onboarding"; avatar_url?: string }
export interface OrganizationWorkspace { revision: number; nodes: OrganizationNode[]; staff: StaffPerson[]; can_edit: boolean }
export const personName = (person: StaffPerson) => `${person.first_name} ${person.last_name}`.trim();
const root = (schoolId: string) => `/api/v1/schools/${encodeURIComponent(schoolId)}/organization/`;
export const getOrganization = (schoolId: string) => apiFetch<OrganizationWorkspace>(root(schoolId));
export const saveOrganization = (schoolId: string, input: { nodes: OrganizationNode[]; expected_revision: number; request_id: string }) =>
  apiFetch<{ revision: number; nodes: OrganizationNode[]; replayed: boolean }>(root(schoolId), { method: "PUT", body: JSON.stringify(input) });

export function descendants(nodes: OrganizationNode[], id: string): Set<string> {
  const found = new Set([id]);
  let changed = true;
  while (changed) { changed = false; for (const node of nodes) if (node.parent_id && found.has(node.parent_id) && !found.has(node.id)) { found.add(node.id); changed = true; } }
  return found;
}
export function moveNode(nodes: OrganizationNode[], id: string, parentId: string | null) {
  if (parentId && descendants(nodes, id).has(parentId)) return nodes;
  return nodes.map(node => node.id === id ? { ...node, parent_id: parentId } : node);
}
