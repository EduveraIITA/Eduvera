/** Shared declaration-only contracts used by the universal frontend.
 * Keep domain authority and HTTP execution with the owning services. */
import type { ActivityRegisterCategory, ActivityRegisterSummary } from '../../../activity-register';

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

export interface ActivityPage<T> {
  items: T[]; page: number; page_size: number; total: number; total_pages: number;
  from?: string; until?: string;
  timezone?: string; can_manage?: boolean;
}

export interface ActivityRegisterPage { date: string; page: number; page_size: number; total: number; total_pages: number; registers: ActivityRegisterSummary[]; counts?: Record<"all" | Exclude<ActivityRegisterCategory, "awaiting_review" | "automatic_pending">, number> & { awaiting_review?: number; automatic_pending?: number }; available_kinds?: Array<{ kind: string; count: number }>; unfiltered_total?: number }
