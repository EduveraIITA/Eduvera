type EventListView = "upcoming" | "draft" | "past";
type EventDetailView = "sessions" | "participants" | "finance";

function searchParams(search: URLSearchParams | string) {
  return typeof search === "string" ? new URLSearchParams(search) : search;
}

function safePlanningReturn(search: URLSearchParams | string) {
  const value = searchParams(search).get("return_to");
  return value?.startsWith("/principal/planner")
    || value?.startsWith("/principal/timetable?")
    || value?.startsWith("/areas/timetable")
    ? value
    : null;
}

export function eventListView(search: URLSearchParams | string): EventListView {
  const value = searchParams(search).get("list_view");
  return value === "draft" || value === "past" ? value : "upcoming";
}

export function eventDetailView(search: URLSearchParams | string): EventDetailView {
  const value = searchParams(search).get("view");
  return value === "participants" || value === "finance" ? value : "sessions";
}

export function eventListHref(prefix: string, search: URLSearchParams | string) {
  const planningReturn = safePlanningReturn(search);
  if (prefix === "/principal" && planningReturn) return planningReturn;
  const view = eventListView(search);
  return `${prefix}/events${view === "upcoming" ? "" : `?view=${view}`}`;
}

export function eventDetailSuffix(search: URLSearchParams | string, view = eventDetailView(search)) {
  const params = new URLSearchParams();
  const listView = eventListView(search);
  if (listView !== "upcoming") params.set("list_view", listView);
  if (view !== "sessions") params.set("view", view);
  const planningReturn = safePlanningReturn(search);
  if (planningReturn) params.set("return_to", planningReturn);
  return params.size ? `?${params}` : "";
}

export function eventDetailHref(prefix: string, eventId: string, search: URLSearchParams | string) {
  return `${prefix}/events/${eventId}${eventDetailSuffix(search)}`;
}

/**
 * Neutral Events workspace navigation. Unlike the historical helper above, the
 * caller supplies the complete Area surface root (for example
 * `/areas/events/manage`). This keeps responsibility and relationship scope in
 * the route instead of manufacturing a Principal, Teacher, Parent or Student
 * portal.
 */
export function eventWorkspaceListHref(basePath: string, search: URLSearchParams | string) {
  const planningReturn = safePlanningReturn(search);
  if (planningReturn) return planningReturn;
  const view = eventListView(search);
  return `${basePath}${view === "upcoming" ? "" : `?view=${view}`}`;
}

export function eventWorkspaceDetailHref(basePath: string, eventId: string, search: URLSearchParams | string) {
  return `${basePath}/${encodeURIComponent(eventId)}${eventDetailSuffix(search)}`;
}

export function eventRelationshipParams(
  search: URLSearchParams | string,
  relationship: "self" | "dependent",
  studentId: string,
) {
  const source = searchParams(search);
  const params = new URLSearchParams();
  params.set("scope", relationship);
  params.set("student_id", studentId);
  if (source.get("view") === "past" || source.get("list_view") === "past") params.set("view", "past");
  return params;
}
