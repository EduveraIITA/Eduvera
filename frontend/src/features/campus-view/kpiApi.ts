import { apiFetch } from "../../lib/api";

export type CampusKpiPage = "overview" | "teaching" | "movement" | "spaces" | "coordination" | "data_health";
export type CampusKpiRange = "today" | "7d" | "30d" | "90d" | "1y";
export type CampusKpiUnit = "count" | "percent" | "minutes" | "people" | "sessions" | "spaces" | "records";
export type CampusKpiAvailability = "available" | "partial" | "unavailable";
export type CampusKpiEvidenceDimension = "expected" | "observed" | "accepted";
export type CampusKpiValueContext = "active_at_as_of" | "current_at_as_of" | "trailing_15_minutes" | "selected_period" | "latest_interval_with_response_evidence";

export interface CampusKpiSeriesPoint {
  bucket_start: string;
  bucket_end: string;
  value: number | null;
  numerator: number | null;
  denominator: number | null;
  unknown_count: number;
}

export interface CampusKpiMetric {
  key: string;
  label: string;
  description: string;
  unit: CampusKpiUnit;
  value: number | null;
  numerator: number | null;
  denominator: number | null;
  unknown_count: number;
  availability: CampusKpiAvailability;
  scope: "selected_campus" | "institution";
  evidence_dimensions: CampusKpiEvidenceDimension[];
  source_label: string;
  source_max_at: string | null;
  unavailable_reason: string | null;
  value_context?: CampusKpiValueContext;
  target_path?: string | null;
  series: CampusKpiSeriesPoint[];
}

export interface CampusKpiHeadline {
  key: string;
  label: string;
  value: number | null;
  unit: CampusKpiUnit;
  availability: CampusKpiAvailability;
  value_context: CampusKpiValueContext;
  secondary?: {
    key: string;
    label: string;
    value: number | null;
    availability: CampusKpiAvailability;
  };
}

export interface CampusKpiResponse {
  schema_version: 1;
  page: CampusKpiPage;
  range: CampusKpiRange;
  generated_at: string;
  period: { from: string; to: string; timezone: string };
  bucket: { kind: "15_minute" | "hour" | "day"; label: string };
  scope: { campus_id: string | null; campus_label: string };
  metrics: CampusKpiMetric[];
  overview?: {
    headline_keys: string[];
    headlines?: CampusKpiHeadline[];
    evidence_state?: CampusKpiAvailability;
    composition: {
      label: string;
      unit: string;
      slices: Array<{
        key: string;
        label: string;
        value: number;
        tone: "accepted" | "observed" | "expected" | "unknown" | "review";
      }>;
    };
    bottlenecks: Array<{
      id: string;
      label: string;
      detail: string;
      count: number;
      severity: "review" | "important";
      scope: "selected_campus" | "institution";
      evidence_dimension: "expected" | "observed" | "accepted" | "unknown";
      source_label: string;
      target_path?: string | null;
    }>;
  };
}

export function getCampusKpis(
  schoolId: string,
  options: { campusId?: string; page: CampusKpiPage; range: CampusKpiRange },
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({ page: options.page, range: options.range });
  if (options.campusId) query.set("campus_id", options.campusId);
  return apiFetch<CampusKpiResponse>(
    `/api/v1/schools/${encodeURIComponent(schoolId)}/campus-view/kpis?${query.toString()}`,
    { signal },
  );
}
