/** Shared declaration-only contracts used by the universal frontend.
 * Keep domain authority and HTTP execution with the owning services. */
import type { RepairState } from '../../../repair-state';
import type { Invitation } from '../onboarding/api';

export type RepairAction = "accept" | "assign" | "update" | "complete" | "verify" | "reopen";

export type RepairWait = "parts" | "contractor" | "approval" | "access" | "other";

export interface FacilitiesPerson { id: string; label: string; revision?: number; has_app_access?: boolean; can_manage?: boolean }

export interface RepairExternalAccess {
  id: string; person: FacilitiesPerson & { revision: number; has_app_access: boolean };
  starts_at: string; ends_at: string; instructions: string; shared_photo_ids: string[];
  state: "scheduled" | "awaiting_sign_in" | "ready" | "active" | "expired" | "ended";
  can_manage: boolean; can_activate: boolean;
  invitation?: Invitation | null;
}

export interface FacilitiesSettings {
  revision: number; handler_person_id: string | null; verifier_mode: "reporter" | "handler" | "named";
  verifier_person_id: string | null; emergency_contact: string; can_manage: boolean; configured: boolean;
  handler?: FacilitiesPerson | null; verifier?: FacilitiesPerson | null;
}

export interface RepairSummary {
  id: string; title: string; state: RepairState; revision: number; reporter: FacilitiesPerson; handler: FacilitiesPerson;
  place: { id: string; label: string } | null; item: { id: string; label: string; asset_tag?: string | null } | null;
  location_note: string; expected_finish_at: string | null; wait_reason: RepairWait | null; updated_at: string;
}

export interface RepairHistory {
  id: string; revision: number; action: string; actor_label: string; note: string | null; state: RepairState;
  wait_reason: RepairWait | null; expected_finish_at: string | null; recorded_at: string;
  previous_handler_label?: string | null; handler_label?: string | null;
  verifier_label?: string | null; previous_verifier_label?: string | null; assignment_target?: "handler" | "verifier" | "coordinator" | null;
  coordinator_label?: string | null; previous_coordinator_label?: string | null;
  reopen_kind?: "further_work" | "record_amendment" | null;
}

export interface RepairPhoto { id: string; file_name: string; content_type: string; size: number; created_at: string; href: string }

export interface RepairDetail extends RepairSummary {
  external_view?: boolean; external_access?: RepairExternalAccess | null; can_invite_external?: boolean;
  asset_impact?: "not_working" | "degraded" | null;
  problem: string; urgent: boolean; recorder: FacilitiesPerson; verifier: FacilitiesPerson;
  coordinator?: FacilitiesPerson; coordinator_person_id?: string;
  route_unavailable?: boolean; coordinator_unavailable?: boolean; verification_route_unavailable?: boolean;
  recovery_only?: boolean; emergency_contact?: string; access_transferred?: boolean;
  photos: RepairPhoto[]; history: RepairHistory[]; history_has_more?: boolean;
  latest_progress?: RepairHistory | null;
  history_pagination?: { page: number; page_size: number; total: number };
  allowed_actions: Record<RepairAction | "add_photo", boolean> & { assign_verifier?: boolean; assign_coordinator?: boolean };
}

export interface FacilitiesPage {
  view: "mine" | "all"; repairs: RepairSummary[]; can_report: boolean; can_manage: boolean; settings: FacilitiesSettings;
  totals: { open: number; awaiting_verification: number; closed: number }; pagination: { page: number; page_size: number; total: number };
}

export interface FacilitiesOptions {
  actor: { person_id: string; label: string }; people: FacilitiesPerson[]; places: Array<{ id: string; label: string }>;
  holdings: Array<{ id: string; label: string; asset_tag: string | null; map_status_supported?: boolean }>; settings: FacilitiesSettings;
  selected?: { holding: { id: string; label: string; asset_tag: string | null; map_status_supported?: boolean } | null; place: { id: string; label: string } | null };
  pagination: { page: number; page_size: number; people_has_more: boolean; places_has_more: boolean; holdings_has_more: boolean };
}
