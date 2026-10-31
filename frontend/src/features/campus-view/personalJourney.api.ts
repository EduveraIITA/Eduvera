import { apiFetch } from "../../lib/api";
import type { ExecutionEnvironment } from "../simulation/executionEnvironment";
import type { CampusPersonalResponse } from "./personalJourney.types";

export const getCampusPersonalJourney = (schoolId: string, campusId: string, signal?: AbortSignal) =>
  apiFetch<CampusPersonalResponse>(`/api/v1/schools/${encodeURIComponent(schoolId)}/campus-view/mine?${new URLSearchParams({ campus_id: campusId })}`, { signal });

/** Never render a retained projection from a different campus or execution world. */
export function personalJourneyMatches(data: CampusPersonalResponse | undefined, schoolId: string, campusId: string, environment: ExecutionEnvironment) {
  return Boolean(data && data.schema_version === 1 && data.school_id === schoolId && data.campus_id === campusId
    && data.environment.kind === environment.mode
    && (environment.mode === "live" ? data.environment.namespace_id === null || data.environment.namespace_id === `live:${schoolId}`
      : !environment.unavailable && data.environment.namespace_id === environment.namespaceId));
}
