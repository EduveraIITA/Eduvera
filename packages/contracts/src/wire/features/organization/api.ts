/** Shared declaration-only contracts used by the universal frontend.
 * Keep domain authority and HTTP execution with the owning services. */
export type NodeKind = "leadership" | "department" | "team" | "position";

export type NodeTone = "violet" | "blue" | "teal" | "rose" | "slate";

export interface OrganizationNode {
  id: string; parent_id: string | null; kind: NodeKind; name: string; description: string;
  tone: NodeTone; head_staff_id: string | null; member_ids: string[];
}

export interface StaffPerson { id: string; first_name: string; last_name: string; designation: string; status: "active" | "inactive" | "onboarding"; avatar_url?: string }

export interface OrganizationWorkspace { revision: number; nodes: OrganizationNode[]; staff: StaffPerson[]; can_edit: boolean }
