export type CampusTruthDimension = "expected" | "observed" | "accepted" | "unknown";

export interface CampusAssertion {
  id: string;
  dimension: Exclude<CampusTruthDimension, "unknown">;
  label: string;
  detail?: string | null;
  source_label: string;
  valid_from?: string | null;
  valid_until?: string | null;
  observed_at?: string | null;
  expires_at?: string | null;
  freshness: "fresh" | "stale" | "historical" | "not_applicable";
  spatial_claim?: "expected_context_only" | "point_observation_only" | "bounded_space_presence";
  count?: number | null;
  target_path?: string | null;
}

export interface CampusExpectedUse {
  id: string;
  occurrence_id: string;
  space_id: string;
  title: string;
  slot_type: "class" | "break" | "activity";
  class_label: string;
  subject_label: string | null;
  teacher: { id: string; label: string } | null;
  expected_count: number;
  starts_at: string;
  ends_at: string;
  state: "in_progress" | "upcoming" | "ended";
  dimension: "expected";
  spatial_claim: "expected_context_only";
  source: { label: string; domain: string; record_id: string; revision: number };
}

export interface CampusGateActivityToday {
  entries: number;
  exits: number;
  accepted_points: number;
  latest_observed_at: string;
  dimension: "accepted";
  spatial_claim: "point_observation_only";
  source_label: string;
}

export interface CampusViewSpace {
  id: string;
  campus_id: string;
  parent_space_id: string | null;
  floor_id: string;
  floor_label: string;
  name: string;
  code: string;
  kind: string;
  capacity: number | null;
  assertions: {
    expected: CampusAssertion[];
    observed: CampusAssertion[];
    accepted: CampusAssertion[];
  };
  expected_now: CampusExpectedUse[];
  day_activity_count: number;
  gate_activity_today: CampusGateActivityToday | null;
  state_dimension: CampusTruthDimension;
  signal_count: number;
}

export interface CampusPlanElement {
  id: string;
  kind: "space";
  space_id: string;
  floor_id?: string | null;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CampusViewResponse {
  schema_version: 1;
  school: { id: string; name: string; timezone?: string | null };
  campuses: Array<{ id: string; name: string; code: string; is_primary: boolean; timezone?: string | null }>;
  selected_campus_id: string | null;
  generated_at: string;
  as_of: string;
  plan: {
    id: string;
    version: string;
    label: string;
    source_kind: "mapped" | "generated_schematic";
    placement_kind?: "configured_schematic" | "generated_grid";
    view_box: { x: number; y: number; width: number; height: number };
    elements: CampusPlanElement[];
  } | null;
  spaces: CampusViewSpace[];
  activity: Array<{
    id: string;
    occurred_at: string;
    title: string;
    detail: string;
    state_dimension: CampusTruthDimension;
    source_label: string;
    state?: "in_progress" | "upcoming" | "ended" | "point_event";
    ends_at?: string | null;
    space_id?: string | null;
    spatial_claim?: "expected_context_only" | "point_observation_only" | "bounded_space_presence";
    target_path?: string | null;
  }>;
  signals: Array<{
    id: string;
    severity: "review" | "important";
    title?: string;
    detail?: string;
    occurred_at?: string;
    target_path?: string | null;
  }>;
  operations: {
    local_date: string;
    current_expected_sessions: number;
    expected_teachers: number;
    gate_movements: {
      entries: number;
      exits: number;
      accepted_points: number;
      dimension: "accepted";
      spatial_claim: "point_observation_only";
      scope: "selected_campus" | "institution";
      source_label: string;
    };
    visitors_inside: {
      count: number;
      dimension: "accepted";
      scope: "institution";
      source_label: string;
    };
  } | null;
}

export interface CampusViewOverlayPerson {
  id: string;
  name: string;
  avatar_url?: string | null;
  descriptor: string;
}

export interface CampusViewZoneOverlay {
  space_id: string;
  title: string;
  count: number;
  state_dimension: Exclude<CampusTruthDimension, "unknown">;
  marker_label: string;
  source_label: string;
  source_detail: string;
  explanation: string;
  people_heading?: string;
  people_more_label?: string;
  people: CampusViewOverlayPerson[];
}

export interface CampusViewOverlay {
  status: "booting" | "running" | "paused" | "degraded" | "offline";
  badge_label: string;
  generated_at?: string;
  next_change_at?: string;
  zones: CampusViewZoneOverlay[];
  activity: CampusViewResponse["activity"];
}

export interface CampusFloorOption {
  id: string;
  label: string;
  spaces: CampusViewSpace[];
}
