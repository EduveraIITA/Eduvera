import type { RepairState } from "./repair-state";
export type CampusMapLayer = "none" | "classes" | "events" | "maintenance";

export interface CampusMapAsset {
  element_id: string; holding_id: string; name: string; asset_tag: string | null; space_id: string | null;
  native_state: "available" | "unavailable" | "retired" | "unknown"; reportable: boolean;
  signal: { state: "unknown" | "reported_fault" | "awaiting_verification" | "verified_resolution";
    impact: "not_working" | "degraded" | null; open_reports: number; updated_at: string | null };
  repairs: Array<{ id: string; state: RepairState; revision: number; target_path: string; action_label: string }>;
}

export interface CampusMapActivity {
  id: string; layer: Exclude<CampusMapLayer, "none">; title: string; detail: string;
  space_id: string | null; holding_id: string | null; starts_at: string | null; ends_at: string | null;
  state: string; target_path: string; action_label: string; dimension: "expected" | "accepted";
  source: { domain: string; record_id: string; revision: number; label: string };
}

export interface CampusOperationalProjection {
  schema_version: 1; school_id: string; campus_id: string; as_of: string;
  environment: { kind: "live" | "simulation"; namespace_id: string | null };
  publication: { id: string; version: number } | null;
  assets: CampusMapAsset[]; activities: CampusMapActivity[]; limitations: string[];
  personal_activities?: "separate";
  bounds?: { activities_per_layer: 20 };
}
