type EventListView = "upcoming" | "draft" | "past";
type EventDetailView = "sessions" | "participants" | "finance";

function searchParams(search: URLSearchParams | string) {
  return typeof search === "string" ? new URLSearchParams(search) : search;
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
  const view = eventListView(search);
  return `${prefix}/events${view === "upcoming" ? "" : `?view=${view}`}`;
}

export function eventDetailSuffix(search: URLSearchParams | string, view = eventDetailView(search)) {
  const params = new URLSearchParams();
  const listView = eventListView(search);
  if (listView !== "upcoming") params.set("list_view", listView);
  if (view !== "sessions") params.set("view", view);
  return params.size ? `?${params}` : "";
}

export function eventDetailHref(prefix: string, eventId: string, search: URLSearchParams | string) {
  return `${prefix}/events/${eventId}${eventDetailSuffix(search)}`;
}
