import { apiFetch } from "../../lib/api";

export interface CampusPersonInvitation { id: string; expires_at: string; state: "pending" | "expired" }
export interface CampusParticipant {
  id: string; label: string; affiliations: string[]; has_account: boolean;
  account_state?: "active" | "inactive" | "not_linked"; is_you?: boolean;
  pending_invitation?: CampusPersonInvitation;
}
export interface ParticipantPage {
  results: CampusParticipant[]; page: number; page_size: number; total: number;
  capabilities?: { can_invite: boolean; can_manage_enrollment?: boolean };
}
export interface GroupMember { person_id: string; label: string; starts_on: string; ends_on: string | null }
export interface ParticipationGroup { id: string; name: string; revision: number; member_count?: number; member_ids?: string[]; members: GroupMember[] }
export interface PersonSourceProfile { kind: "learning" | "work" | "guardian"; id: string; label: string; href: string }
export interface PersonCapabilities { can_correct_name?: boolean; can_edit_profile?: boolean; can_manage_connections?: boolean; can_manage_groups?: boolean; can_invite?: boolean; can_enroll?: boolean; can_add_work_profile?: boolean; can_link_guardian?: boolean }
export interface ParticipantDetail extends Partial<CampusParticipant> {
  id: string; label: string; first_name: string; last_name: string; revision: number;
  affiliation_sources: Array<{ affiliation: string; source: string }>;
  profile?: { contact_email: string; contact_phone: string };
  source_profiles?: PersonSourceProfile[]; capabilities?: PersonCapabilities;
}
export interface PeoplePage<T> { results: T[]; page: number; page_size: number; total: number }
export type CampusGroupKind = "participation" | "class" | "organization";
export interface PersonGroupMembership { id: string; source_id: string; kind: CampusGroupKind; name: string; starts_on: string | null; ends_on: string | null; href: string }
export interface CampusGroupSummary { id: string; source_id: string; kind: CampusGroupKind; name: string; member_count: number; parent: { id: string; name: string } | null; href: string | null }
export interface NativeGroupDetail { id: string; kind: "class" | "organization"; name: string; members: Array<{ person_id: string; label: string }>; member_count: number; page: number; page_size: number; total: number; source_href: string | null }
export interface PersonConnection { id: string; revision: number; type: "mentor_of" | "guardian_of"; direction: "outgoing" | "incoming"; related_person: { id: string; label: string }; starts_on: string | null; ends_on: string | null; source_kind: "people" | "guardian"; source_href: string | null; can_end: boolean; history?: Array<{ revision: number; effective_on: string; reason: string; recorded_at: string }> }
export interface ParticipationGroupDetail extends ParticipationGroup { is_active: boolean; member_ids: string[]; member_count: number; parent: { id: string; name: string; starts_on: string } | null; parent_history: Array<{ id: string; parent_group_id: string | null; parent_name: string | null; starts_on: string; ends_on: string | null }>; page: number; page_size: number; total: number; capabilities: { can_manage: boolean } }
const root = (schoolId: string) => `/api/v1/schools/${encodeURIComponent(schoolId)}/people`;
export const listParticipants = (schoolId: string, search = "", page = 1) => apiFetch<ParticipantPage>(`${root(schoolId)}/participants?${new URLSearchParams({ search, page: String(page) })}`);
export const createParticipant = (schoolId: string, body: { first_name: string; last_name: string; affiliation?: string; contact_email?: string; contact_phone?: string; idempotency_key: string }) => apiFetch<CampusParticipant>(`${root(schoolId)}/participants`, { method: "POST", body: JSON.stringify(body) });
export const listParticipationGroups = (schoolId: string, search = "", page = 1) => apiFetch<{ results: ParticipationGroup[]; page: number; page_size: number; total: number }>(`${root(schoolId)}/participation-groups?${new URLSearchParams({ search, page: String(page) })}`);
export const createParticipationGroup = (schoolId: string, body: { name: string; person_ids: string[]; starts_on: string; ends_on: string | null; idempotency_key: string }) => apiFetch<{ id: string; revision: number }>(`${root(schoolId)}/participation-groups`, { method: "POST", body: JSON.stringify(body) });
export const getParticipant = (schoolId: string, id: string) => apiFetch<ParticipantDetail>(`${root(schoolId)}/participants/${encodeURIComponent(id)}`);
export const correctParticipantName = (schoolId: string, id: string, body: { first_name: string; last_name: string; expected_revision: number; reason: string; idempotency_key: string }) => apiFetch<{ id: string; label: string; revision: number }>(`${root(schoolId)}/participants/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) });
export const replaceParticipationGroupMembers = (schoolId: string, id: string, body: { person_ids: string[]; effective_on: string; expected_revision: number; idempotency_key: string }) => apiFetch<{ id: string; revision: number }>(`${root(schoolId)}/participation-groups/${encodeURIComponent(id)}/members`, { method: "PATCH", body: JSON.stringify(body) });
export const savePersonContact = (schoolId: string, id: string, body: { expected_revision: number; contact_email: string; contact_phone: string; reason: string; idempotency_key: string }) => apiFetch<{ id: string; revision: number; profile: { contact_email: string; contact_phone: string } }>(`${root(schoolId)}/participants/${encodeURIComponent(id)}/profile`, { method: "PATCH", body: JSON.stringify(body) });
export const listPersonConnections = (schoolId: string, id: string, page = 1) => apiFetch<PeoplePage<PersonConnection>>(`${root(schoolId)}/participants/${encodeURIComponent(id)}/connections?page=${page}`);
export const createPersonConnection = (schoolId: string, id: string, body: { type: "mentor_of"; target_person_id: string; starts_on: string; ends_on: string | null; reason: string; idempotency_key: string }) => apiFetch<{ id: string; revision: number }>(`${root(schoolId)}/participants/${encodeURIComponent(id)}/connections`, { method: "POST", body: JSON.stringify(body) });
export const endPersonConnection = (schoolId: string, id: string, body: { expected_revision: number; ends_on: string; reason: string; idempotency_key: string }) => apiFetch<{ id: string; revision: number }>(`${root(schoolId)}/connections/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) });
export const getParticipationGroup = (schoolId: string, id: string, page = 1) => apiFetch<ParticipationGroupDetail>(`${root(schoolId)}/participation-groups/${encodeURIComponent(id)}?page=${page}`);
export const setParticipationGroupParent = (schoolId: string, id: string, body: { parent_group_id: string | null; effective_on: string; expected_revision: number; reason: string; idempotency_key: string }) => apiFetch<{ id: string; revision: number }>(`${root(schoolId)}/participation-groups/${encodeURIComponent(id)}/parent`, { method: "POST", body: JSON.stringify(body) });
export const resolvePersonSource = (schoolId: string, source_kind: "student" | "staff" | "guardian", source_id: string) => apiFetch<{ person_id: string }>(`${root(schoolId)}/resolve-person?${new URLSearchParams({ source_kind, source_id })}`);
export const listPersonGroups = (schoolId: string, id: string, page = 1) => apiFetch<PeoplePage<PersonGroupMembership>>(`${root(schoolId)}/participants/${encodeURIComponent(id)}/groups?page=${page}`);
export const listCampusGroups = (schoolId: string, search = "", page = 1) => apiFetch<PeoplePage<CampusGroupSummary>>(`${root(schoolId)}/group-catalogue?${new URLSearchParams({ search, page: String(page) })}`);
export const getNativeGroup = (schoolId: string, kind: "class" | "organization", id: string, page = 1) => apiFetch<NativeGroupDetail>(`${root(schoolId)}/group-catalogue/${kind}/${encodeURIComponent(id)}?page=${page}`);
export const getParticipationGroupHistory = (schoolId: string, id: string, page = 1) => apiFetch<PeoplePage<GroupMember & { id: string; revision: number; recorded_at: string }>>(`${root(schoolId)}/participation-groups/${encodeURIComponent(id)}/history?page=${page}`);
