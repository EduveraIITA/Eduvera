import type { CampusSceneSpace } from "./campus-scenes/types";
import type { CampusMotionProjection } from "./campus-motion";

export interface CampusPersonalDestination {
  id: string;
  kind: "teaching_session" | "activity" | "responsibility" | "repair";
  title: string;
  detail: string;
  starts_at: string | null;
  ends_at: string | null;
  state: "in_progress" | "upcoming" | "assigned";
  space_id: string | null;
  place_label: string | null;
  target_path: string;
  action_label: string;
  dimension: "expected" | "accepted";
  spatial_claim: "expected_context_only" | "assigned_work_only";
  source: { domain: string; record_id: string; revision: number; label: string };
}

export interface CampusPersonalResponse {
  motion?: CampusMotionProjection;
  schema_version: 1;
  school_id: string;
  campus_id: string;
  as_of: string;
  local_date: string;
  timezone: string;
  environment: { kind: "live" | "simulation"; namespace_id: string | null };
  freshness: { status: "current"; as_of: string };
  places: Array<Omit<CampusSceneSpace, "campus_id">>;
  now: CampusPersonalDestination[];
  next: CampusPersonalDestination[];
  destinations: CampusPersonalDestination[];
  limitations: string[];
}

