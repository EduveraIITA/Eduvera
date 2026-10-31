type QueryValue = string | number | null | undefined;

function withQuery(path: string, entries: ReadonlyArray<readonly [string, QueryValue]> = []) {
  const query = new URLSearchParams();
  for (const [key, value] of entries) {
    if (value !== null && value !== undefined && String(value).length > 0) query.set(key, String(value));
  }
  return query.size ? `${path}?${query.toString()}` : path;
}

export type AssessmentWorkSurface = "assigned" | "manage";
export type EventWorkSurface = "assigned" | "manage";
export type RelationshipScope = "self" | "dependent";

export function assessmentWorkHref(
  surface: AssessmentWorkSurface,
  assessmentId?: string | null,
  extra: ReadonlyArray<readonly [string, QueryValue]> = [],
) {
  return withQuery(`/areas/assessments/${surface}`, [
    ["assessment", assessmentId],
    ...extra.filter(([key]) => key !== "assessment"),
  ]);
}

export function assessmentResultsHref(
  scope: RelationshipScope,
  studentId: string,
  extra: ReadonlyArray<readonly [string, QueryValue]> = [],
) {
  return withQuery("/areas/assessments/results", [
    ["scope", scope],
    ["student_id", studentId],
    ...extra.filter(([key]) => key !== "scope" && key !== "student_id"),
  ]);
}

export function eventWorkHref(
  surface: EventWorkSurface,
  eventId?: string | null,
  extra: ReadonlyArray<readonly [string, QueryValue]> = [],
) {
  const path = eventId
    ? `/areas/events/${surface}/${encodeURIComponent(eventId)}`
    : `/areas/events/${surface}`;
  return withQuery(path, extra);
}

export function eventSessionAttendanceHref(
  surface: EventWorkSurface,
  eventId: string,
  sessionId: string,
) {
  return `/areas/events/${surface}/${encodeURIComponent(eventId)}/sessions/${encodeURIComponent(sessionId)}/attendance`;
}

export function relationshipEventHref(
  scope: RelationshipScope,
  studentId: string,
  eventId?: string | null,
  extra: ReadonlyArray<readonly [string, QueryValue]> = [],
) {
  const path = eventId
    ? `/areas/events/calendar/${encodeURIComponent(eventId)}`
    : "/areas/events/calendar";
  return withQuery(path, [
    ["scope", scope],
    ["student_id", studentId],
    ...extra.filter(([key]) => key !== "scope" && key !== "student_id"),
  ]);
}
