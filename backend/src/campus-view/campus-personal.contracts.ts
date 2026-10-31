import type { CampusMotionProjection } from "./campus-motion.contracts.js";

export interface CampusPersonalJourney {
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

export interface CampusPersonalPlace {
  id: string;
  parent_space_id: string | null;
  name: string;
  code: string | null;
  kind: string;
  capacity: number | null;
}

export interface CampusPersonalProjection {
  schema_version: 1;
  school_id: string;
  campus_id: string | null;
  as_of: string;
  local_date: string;
  timezone: string;
  environment: { kind: "live" | "simulation"; namespace_id: string | null };
  freshness: { status: "current"; as_of: string };
  places: CampusPersonalPlace[];
  now: CampusPersonalJourney[];
  next: CampusPersonalJourney[];
  destinations: CampusPersonalJourney[];
  motion: CampusMotionProjection;
  limitations: string[];
}

