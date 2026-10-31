import { apiFetch } from "../../lib/api";
import type { ExecutionEnvironment } from "../simulation/executionEnvironment";
import type { CampusOperationalProjection } from "./campusOperational.types";

export class CampusLayoutChangedError extends Error {}

export const getCampusOperationalLayers = (schoolId: string, campusId: string, signal?: AbortSignal) =>
  apiFetch<CampusOperationalProjection>(`/api/v1/schools/${encodeURIComponent(schoolId)}/campus-view/operations?${new URLSearchParams({ campus_id: campusId })}`, { signal });

export function campusOperationalMatches(data: CampusOperationalProjection | undefined, schoolId: string, campusId: string, environment: ExecutionEnvironment) {
  return Boolean(data && data.schema_version === 1 && data.school_id === schoolId && data.campus_id === campusId
    && data.environment.kind === environment.mode
    && (environment.mode === "live" ? data.environment.namespace_id === null || data.environment.namespace_id === `live:${schoolId}`
      : !environment.unavailable && data.environment.namespace_id === environment.namespaceId));
}
