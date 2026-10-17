type EventListView = "upcoming" | "draft" | "past";
type EventDetailView = "sessions" | "participants" | "finance";

function searchParams(search: URLSearchParams | string) {
  return typeof search === "string" ? new URLSearchParams(search) : search;
}

function safePlanningReturn(search: URLSearchParams | string) {
  const value = searchParams(search).get("return_to");
  return value?.startsWith("/principal/planner") || value?.startsWith("/principal/timetable?") ? value : null;
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
