import type { ExecutionEnvironment } from "./execution-environment";
import type { CampusMotionProjection } from "./campus-motion";

const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 300;
const instant = (value: unknown): value is string => text(value) && Number.isFinite(Date.parse(value));
const source = (value: unknown, nullable = false) => object(value) && text(value.domain) && text(value.record_id)
  && (nullable && value.revision === null || Number.isSafeInteger(value.revision) && Number(value.revision) >= 0);

/** Reject malformed, overlarge or foreign-world populations before any geometry is resolved. */
export function campusMotionMatches(value: unknown, schoolId: string, campusId: string, environment: ExecutionEnvironment): value is CampusMotionProjection {
  if (!object(value) || value.schema_version !== 1 || value.school_id !== schoolId || value.campus_id !== campusId || !instant(value.as_of)
    || !object(value.environment) || value.environment.kind !== environment.mode || !object(value.limits)
    || value.limits.subjects !== 128 || value.limits.claims !== 512 || value.limits.points !== 64 || typeof value.limits.source_limited !== "boolean"
    || !Array.isArray(value.subjects) || value.subjects.length > 128 || !Array.isArray(value.points) || value.points.length > 64
    || !Array.isArray(value.limitations) || value.limitations.some(item => typeof item !== "string" || item.length > 1000)) return false;
  if (environment.mode === "simulation" ? environment.unavailable || value.environment.namespace_id !== environment.namespaceId
    : value.environment.namespace_id !== null && value.environment.namespace_id !== `live:${schoolId}`) return false;
  const keys = new Set<string>(); let count = 0;
  for (const subject of value.subjects) {
    if (!object(subject) || !text(subject.subject_key) || keys.has(subject.subject_key) || !["self", "person", "group"].includes(String(subject.kind)) || !Array.isArray(subject.claims)) return false;
    keys.add(subject.subject_key);
    for (const claim of subject.claims) {
      if (++count > 512 || !object(claim) || !text(claim.id) || claim.space_id !== null && !text(claim.space_id)
        || !instant(claim.starts_at) || !instant(claim.ends_at) || Date.parse(claim.ends_at) <= Date.parse(claim.starts_at)
        || !Number.isSafeInteger(claim.expected_count) || Number(claim.expected_count) < 1 || Number(claim.expected_count) > 1_000_000
        || subject.kind !== "group" && claim.expected_count !== 1 || claim.spatial_claim !== "expected_context_only" || !source(claim.source)) return false;
    }
  }
  return value.points.every(point => object(point) && text(point.id) && text(point.space_id) && instant(point.observed_at)
    && ["observed", "accepted"].includes(String(point.dimension)) && point.spatial_claim === "point_observation_only" && source(point.source, true));
}
