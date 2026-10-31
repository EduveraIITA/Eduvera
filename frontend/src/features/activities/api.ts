import type { ActivityRegisterSummary, ActivityRegisterCategory } from '../../../../packages/contracts/src/activity-register';
export type { ActivityRegisterSummary, ActivityRegisterCategory } from '../../../../packages/contracts/src/activity-register';
import { apiFetch } from "../../lib/api";

export type ActivityPurpose = "teaching" | "duty" | "training" | "meeting" | "other";
export interface ActivityChoice { id: string; label: string }
export interface ActivityPerson extends ActivityChoice { affiliations: string[] }
export interface ActivityCatalogue {
  school_id: string; timezone: string; can_manage: boolean;
  can_create_places?: boolean;
  campuses?: Array<ActivityChoice & { is_primary: boolean }>;
  people: ActivityPerson[]; recorders: ActivityChoice[]; reviewers: ActivityChoice[];
  groups: Array<ActivityChoice & { kind: "class" | "team" | "group" }>;
  spaces: ActivityChoice[]; classes: ActivityChoice[]; subjects: ActivityChoice[];
  terms: Array<ActivityChoice & { starts_on: string; ends_on: string }>;
  purposes: ActivityPurpose[];
  people_truncated?: boolean;
}
export interface ActivityPlanInput {
  title: string; purpose: ActivityPurpose; description: string; timezone: string;
  starts_on: string; ends_on: string | null; recurrence: "once" | "weekly";
  weekdays: number[]; starts_at: string; ends_at: string; end_day_offset: 0 | 1;
  space_id: string | null; person_ids: string[]; group_ids: string[];
  lead_person_id: string | null; recorder_person_id: string | null; reviewer_person_id: string | null;
  attendance_mode: "none" | "roll_call";
  class_section_id: string | null; term_id: string | null; subject_id: string | null;
  location_kind?: "on_campus" | "online" | "off_site" | "unspecified";
  location_label?: string; location_url?: string;
}
export interface ActivityPlan extends ActivityPlanInput {
  id: string; state: "draft" | "published" | "cancelled"; revision: number;
  can_edit: boolean; source: "activity" | "academic"; source_ref: string;
  source_href?: string;
  replaces_version_id?: string | null; revision_reason?: string | null; superseded_on?: string | null;
  can_plan_change?: boolean; pending_revision_id?: string | null;
  replacement_windows?: Array<{ replacement_plan_id: string; from: string; until: string | null }>;
  replacement_window_count?: number;
}
export interface ActivityOccurrence {
  id: string; school_id: string; activity_id: string; plan_version_id: string | null;
  title: string; purpose: ActivityPurpose; starts_at: string; ends_at: string;
  local_date: string; timezone: string; space_id: string | null; space_label: string | null;
  attendance_mode: "none" | "roll_call"; source_revision: number;
  source: "activity" | "academic" | "event" | "examination"; source_ref: string; source_href?: string;
  state: "expected" | "cancelled";
  teaching_session_href?: string;
  location_kind?: "on_campus" | "online" | "off_site" | "unspecified";
  location_label?: string; location_url?: string;
  can_open_register?: boolean;
  participants: Array<{ person_id: string; label: string; participation_role: "participant" | "lead"; source_kind: string; source_ref: string; source_revision: number; attendance_expected?: boolean }>;
}
export interface ActivityPage<T> {
  items: T[]; page: number; page_size: number; total: number; total_pages: number;
  from?: string; until?: string;
  timezone?: string; can_manage?: boolean;
}
const base = (school: string) => `/api/v1/schools/${encodeURIComponent(school)}/activities`;
const parameters = (values: Record<string, string | number>) => new URLSearchParams(Object.entries(values).map(([key, value]) => [key, String(value)]));
export const getActivityCatalogue = (school: string) => apiFetch<ActivityCatalogue>(`${base(school)}/catalogue`);
export const getActivityPlans = (school: string, from: string, until: string, page = 1) => apiFetch<ActivityPage<ActivityPlan>>(`${base(school)}/plans?${parameters({ from, until, page })}`);
export const getActivityPlan = (school: string, id: string) => apiFetch<ActivityPlan>(`${base(school)}/plans/${encodeURIComponent(id)}`);
export const getActivityOccurrences = (school: string, from: string, until: string, page = 1) => apiFetch<ActivityPage<ActivityOccurrence>>(`${base(school)}/occurrences?${parameters({ from, until, page, page_size: 25, state: "expected" })}`);
export const createActivityPlan = (school: string, input: ActivityPlanInput, key: string = crypto.randomUUID()) => apiFetch<ActivityPlan>(`${base(school)}/plans`, { method: "POST", body: JSON.stringify({ ...input, idempotency_key: key }) });
export const updateActivityPlan = (school: string, id: string, input: ActivityPlanInput, revision: number, key: string = crypto.randomUUID()) => apiFetch<ActivityPlan>(`${base(school)}/plans/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ ...input, expected_revision: revision, idempotency_key: key }) });
export const transitionActivityPlan = (school: string, plan: Pick<ActivityPlan, "id" | "revision">, action: "publish" | "cancel", reason?: string, key: string = crypto.randomUUID()) => apiFetch<ActivityPlan>(`${base(school)}/plans/${encodeURIComponent(plan.id)}/${action}`, { method: "POST", body: JSON.stringify({ expected_revision: plan.revision, idempotency_key: key, ...(reason ? { reason } : {}) }) });
export const reviseActivityPlan = (school: string, plan: Pick<ActivityPlan, "id" | "revision">, startsOn: string, reason: string, key: string = crypto.randomUUID()) => apiFetch<ActivityPlan>(`${base(school)}/plans/${encodeURIComponent(plan.id)}/revise`, { method: "POST", body: JSON.stringify({ expected_revision: plan.revision, starts_on: startsOn, reason, idempotency_key: key }) });

export type ParticipationStatus = "present" | "absent" | "late" | "excused" | "half_day";

export interface ActivityRegister {
  register: Omit<ActivityRegisterSummary, "participant_count" | "recorded_count" | "can_record" | "can_review" | "availability_reason"> & { submitted_at: string | null; finalized_at: string | null; policy_revision: number | null };
  roster: Array<{ person_id: string; name: string; roles: string[]; requirement: "required" | "optional"; status: ParticipationStatus | null; remarks: string; observed_at: string | null; revision: number }>;
  counts: { participants: number; recorded: number; unrecorded: number; present: number; absent: number; late: number; excused: number; half_day?: number };
  capabilities: { can_record: boolean; can_submit: boolean; can_finalize: boolean; can_reopen: boolean; can_review_evidence: boolean };
  allowed_statuses: ParticipationStatus[]; availability_reason: string | null;
  pending_evidence: Array<{ id: string; person_id: string; name: string; claimed_status: ParticipationStatus; capture_channel: string; observed_at: string; received_at: string; note: string; source_reference: string }>;
}

export interface ActivityRegisterFilters { search?: string; view?: "all" | ActivityRegisterCategory; kind?: string }
export interface ActivityRegisterPage { date: string; page: number; page_size: number; total: number; total_pages: number; registers: ActivityRegisterSummary[]; counts?: Record<"all" | Exclude<ActivityRegisterCategory, "awaiting_review" | "automatic_pending">, number> & { awaiting_review?: number; automatic_pending?: number }; available_kinds?: Array<{ kind: string; count: number }>; unfiltered_total?: number }
export interface ActivityRegisterHistory { page: number; page_size: number; total: number; total_pages: number; history: Array<{ id: string; action: string; person_id: string | null; name: string | null; previous_status: ParticipationStatus | null; status: ParticipationStatus | null; remarks: string | null; reason: string | null; actor_name: string; recorded_at: string; register_revision: number }> }
export interface AttendanceHistoryActivity {
  id: string; action: string; actor_name: string; recorded_at: string; reason: string | null;
  people_count: number; decision_count: number; correction_count: number; note_count: number;
  status_counts: Record<string, number>; person_name: string | null; previous_status: string | null; status: string | null;
}
export interface AttendanceHistoryActivities { page: number; page_size: number; total: number; total_pages: number; activities: AttendanceHistoryActivity[] }
export interface AttendanceHistoryEvidence extends Omit<ActivityRegisterHistory, "history"> {
  history: Array<Omit<ActivityRegisterHistory["history"][number], "previous_status" | "status"> & {
    previous_status: string | null; status: string | null; previous_remarks: string | null; capture_channel: string | null;
    observed_at: string | null; recorded_at_exact?: string; observed_at_exact?: string | null;
  }>;
}
export const getActivityRegisters = (school: string, date?: string, page = 1, filters: ActivityRegisterFilters = {}) => apiFetch<ActivityRegisterPage>(`${base(school)}/registers?${parameters({ ...(date ? { date } : {}), page, page_size: 8, ...(filters.search ? { search: filters.search } : {}), ...(filters.view && filters.view !== "all" ? { view: filters.view } : {}), ...(filters.kind ? { kind: filters.kind } : {}) })}`);
export const getActivityRegister = (school: string, id: string) => apiFetch<ActivityRegister>(`${base(school)}/registers/${encodeURIComponent(id)}`);
export const getActivityRegisterForOccurrence = (school: string, occurrenceId: string) => apiFetch<ActivityRegister>(`${base(school)}/registers/for-occurrence/${encodeURIComponent(occurrenceId)}`);
export const getActivityRegisterHistory = (school: string, id: string, page = 1) => apiFetch<ActivityRegisterHistory>(`${base(school)}/registers/${encodeURIComponent(id)}/history?${parameters({ page, page_size: 20 })}`);
export const getActivityRegisterHistoryActivities = (school: string, id: string, page = 1) => apiFetch<AttendanceHistoryActivities>(`${base(school)}/registers/${encodeURIComponent(id)}/history?${parameters({ view: "activities", page, page_size: 8 })}`);
export const getActivityRegisterHistoryEvidence = (school: string, id: string, batch: string, page = 1) => apiFetch<AttendanceHistoryEvidence>(`${base(school)}/registers/${encodeURIComponent(id)}/history?${parameters({ batch, page, page_size: 20 })}`);
export const saveActivityMarks = (school: string, id: string, revision: number, records: Array<{ person_id: string; status: ParticipationStatus | null; remarks: string }>, reason?: string, key = crypto.randomUUID()) => apiFetch<ActivityRegister>(`${base(school)}/registers/${encodeURIComponent(id)}/marks`, { method: "PUT", headers: { "Idempotency-Key": key }, body: JSON.stringify({ expected_revision: revision, records, ...(reason ? { reason } : {}) }) });
export const transitionActivityRegister = (school: string, id: string, revision: number, action: "submit" | "finalize" | "reopen", reason?: string, key = crypto.randomUUID()) => apiFetch<ActivityRegister>(`${base(school)}/registers/${encodeURIComponent(id)}/${action}`, { method: "POST", headers: { "Idempotency-Key": key }, body: JSON.stringify({ expected_revision: revision, ...(reason ? { reason } : {}) }) });
export const submitActivityRegister = (school: string, id: string, revision: number, records: Array<{ person_id: string; status: ParticipationStatus | null; remarks: string }>, reason?: string, key: string = crypto.randomUUID()) => apiFetch<ActivityRegister>(`${base(school)}/registers/${encodeURIComponent(id)}/submit`, { method: "POST", headers: { "Idempotency-Key": key }, body: JSON.stringify({ expected_revision: revision, ...(records.length ? { records } : {}), ...(reason ? { reason } : {}) }) });
export const reportActivityEvidence = (school: string, id: string, body: { expected_revision: number; person_id: string; claimed_status: ParticipationStatus; capture_channel: "offline_paper"; observed_at: string; source_reference: string; note: string }, key: string = crypto.randomUUID()) => apiFetch<ActivityRegister>(`${base(school)}/registers/${encodeURIComponent(id)}/evidence`, { method: "POST", headers: { "Idempotency-Key": key }, body: JSON.stringify(body) });
export const decideActivityEvidence = (school: string, id: string, evidenceId: string, body: { expected_revision: number; decision: "accepted" | "rejected"; reason: string }, key: string = crypto.randomUUID()) => apiFetch<ActivityRegister>(`${base(school)}/registers/${encodeURIComponent(id)}/evidence/${encodeURIComponent(evidenceId)}/decision`, { method: "POST", headers: { "Idempotency-Key": key }, body: JSON.stringify(body) });
