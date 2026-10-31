/** Read-only scheduled context for an illustrative campus population.
 * Keys are opaque to the viewer/campus/world. These are not tracked positions. */
export interface CampusMotionSource {
  domain: string;
  record_id: string;
  revision: number | null;
}

export interface CampusMotionClaim {
  id: string;
  space_id: string | null;
  starts_at: string;
  ends_at: string;
  expected_count: number;
  spatial_claim: "expected_context_only";
  source: CampusMotionSource & { revision: number };
}

export interface CampusMotionSubject {
  subject_key: string;
  kind: "self" | "person" | "group";
  claims: CampusMotionClaim[];
}

export interface CampusMotionPoint {
  id: string;
  space_id: string;
  observed_at: string;
  dimension: "observed" | "accepted";
  spatial_claim: "point_observation_only";
  source: CampusMotionSource;
}

export interface CampusMotionProjection {
  schema_version: 1;
  school_id: string;
  campus_id: string | null;
  as_of: string;
  environment: { kind: "live" | "simulation"; namespace_id: string | null };
  subjects: CampusMotionSubject[];
  points: CampusMotionPoint[];
  limits: { subjects: 128; claims: 512; points: 64; source_limited: boolean };
  limitations: string[];
}
