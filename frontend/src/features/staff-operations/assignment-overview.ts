import type { RoleAssignment, RoleContext } from "./access-api";

export const contextLabels: Record<RoleContext, string> = {
  class: "Classes", assessment: "Assessments", event: "Events", trip: "Journeys", institution: "Institution",
};
const contextOrder: RoleContext[] = ["class", "assessment", "event", "trip", "institution"];
const currentStatuses = new Set(["active", "scheduled", "offered"]);
export const isCurrentAssignment = (item: RoleAssignment) => currentStatuses.has(item.display_status);
export const assignmentKey = (item: RoleAssignment) => `${item.source_kind}:${item.source_id}:${item.user_id}`;
export const assignmentScope = (item: RoleAssignment) =>
  item.subject_name && !item.scope_label.includes(item.subject_name)
    ? `${item.scope_label} · ${item.subject_name}` : item.scope_label;
export function assignmentStatus(item: RoleAssignment) {
  if (item.source_kind === "transport_trip" && item.trip_state === "cancelled") return { label: "Cancelled", tone: "inactive" };
  if (item.source_kind === "transport_trip" && item.trip_state === "completed") return { label: "Completed", tone: "inactive" };
  if (item.source_kind === "transport_trip" && ["active", "scheduled"].includes(item.display_status)) {
    if (item.trip_state === "planned") {
      if (item.trip_is_backup) return { label: "Backup assigned", tone: "scheduled" };
      if (item.trip_assignment_status === "pending") return { label: "Awaiting acceptance", tone: "offered" };
      if (item.trip_assignment_status === "declined") return { label: "Declined", tone: "inactive" };
      return { label: "Scheduled", tone: "scheduled" };
    }
    if (item.trip_state === "boarding") return { label: "Boarding", tone: "scheduled" };
    if (item.trip_state === "in_progress") return { label: "In progress", tone: "active" };
  }
  return { label: item.display_status === "offered" ? "Awaiting response" : item.display_status.replaceAll("_", " "), tone: item.display_status };
}
export const matchesSearch = (query: string, text: string) =>
  query.trim().toLocaleLowerCase().split(/\s+/).every((word) => text.toLocaleLowerCase().includes(word));

export interface AssignmentGroup {
  roleId: string;
  name: string;
  context: RoleContext;
  assignments: RoleAssignment[];
}

export function groupAssignments(assignments: RoleAssignment[]): AssignmentGroup[] {
  const groups = new Map<string, AssignmentGroup>();
  for (const item of assignments) {
    const group = groups.get(item.role_id) ?? {
      roleId: item.role_id, name: item.role_name, context: item.context_kind, assignments: [],
    };
    group.assignments.push(item);
    groups.set(item.role_id, group);
  }
  return [...groups.values()].sort((a, b) =>
    contextOrder.indexOf(a.context) - contextOrder.indexOf(b.context) || a.name.localeCompare(b.name),
  );
}

export function groupStatus(assignments: RoleAssignment[]) {
  const counts = new Map<string, number>();
  for (const item of assignments) {
    const status = assignmentStatus(item).label.toLocaleLowerCase();
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  return [...counts].map(([status, count]) => `${count} ${status}`).join(" · ");
}

export const assignmentDate = (date: string) => new Intl.DateTimeFormat("en-IN", {
  day: "numeric", month: "short", year: "numeric",
}).format(new Date(`${date.slice(0, 10)}T12:00:00`));

export function assignmentTripDate(item: RoleAssignment) {
  if (item.source_kind !== "transport_trip" || !item.trip_service_date) return null;
  const tripDate = new Date(`${item.trip_service_date.slice(0, 10)}T12:00:00`);
  const weekday = new Intl.DateTimeFormat("en-IN", { weekday: "short" }).format(tripDate);
  return `${weekday}, ${assignmentDate(item.trip_service_date)}`;
}

function tripDetails(item: RoleAssignment) {
  const time = item.trip_departure_time?.slice(0, 5);
  const hour = time ? Number(time.slice(0, 2)) : NaN;
  const departure = Number.isFinite(hour) && time ? `${hour % 12 || 12}:${time.slice(3)} ${hour < 12 ? "AM" : "PM"}` : null;
  const direction = item.trip_direction === "to_institution" ? "To institution" : item.trip_direction === "from_institution" ? "From institution" : null;
  return [departure, direction].filter(Boolean).join(" · ");
}

export function assignmentWhen(item: RoleAssignment, history = false) {
  const tripDate = assignmentTripDate(item);
  if (tripDate) return [tripDate, tripDetails(item)].filter(Boolean).join(" · ");
  return `${assignmentDate(item.starts_on)}${item.ends_on ? ` – ${assignmentDate(item.ends_on)}` : history ? "" : " · Ongoing"}`;
}

export function assignmentDetail(item: RoleAssignment, history = false) {
  if (assignmentTripDate(item)) return [assignmentScope(item), tripDetails(item)].filter(Boolean).join(" · ");
  return assignmentWhen(item, history);
}

export function assignmentLink(assignment: RoleAssignment, portal: "principal" | "teacher") {
  if (assignment.context_kind === "event") return `/${portal}/events/${assignment.scope_id}`;
  if (assignment.context_kind === "assessment") return `/${portal}/assessments?assessment=${assignment.scope_id}`;
  if (assignment.context_kind === "trip") return portal === "principal" ? "/principal/departure" : "/teacher/transport";
  if (assignment.context_kind === "class") {
    if (assignment.permissions.includes("attendance.view")) return `/${portal}/attendance?class_section_id=${assignment.scope_id}`;
    if (assignment.permissions.includes("reports.comment")) return `/${portal}/report-cards`;
    if (assignment.permissions.includes("events.view")) return `/${portal}/events`;
    if (assignment.permissions.includes("timetable.view")) return `/${portal}/timetable`;
  }
  return null;
}
