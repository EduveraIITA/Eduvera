import type { SchoolMembership } from "./AuthContext";

export const TEACHER_TOOL_PERMISSIONS: Readonly<Record<string, string>> = {
  "student-pulse": "followups.manage",
  transport: "departure.collect",
  assessments: "assessments.view",
  "report-cards": "reports.comment",
  classes: "attendance.view",
  registers: "attendance.view",
  calendar: "timetable.view",
  weekly: "timetable.view",
  messages: "messages.view",
  events: "events.view",
  safeguarding: "safeguarding.review",
};

const TEACHER_SECTION_PERMISSIONS: Readonly<Record<string, string>> = {
  "student-pulse": "followups.manage",
  attendance: "attendance.view",
  classes: "attendance.view",
  calendar: "timetable.view",
  timetable: "timetable.view",
  messages: "messages.view",
  safeguarding: "safeguarding.review",
  events: "events.view",
  transport: "departure.collect",
  assessments: "assessments.view",
  "report-cards": "reports.comment",
  fees: "fees.manage",
  administration: "sis.manage",
  students: "sis.manage",
  invitations: "members.invite",
};

export function currentStaffMembership(memberships: SchoolMembership[]) {
  return memberships.find((membership) => membership.role === "staff");
}

export function hasStaffPermission(member: SchoolMembership | undefined, permission: string) {
  return !member || member.permissions?.includes(permission) === true;
}

export function teacherToolIsVisible(member: SchoolMembership | undefined, toolId: string) {
  const permission = TEACHER_TOOL_PERMISSIONS[toolId];
  return !permission || hasStaffPermission(member, permission);
}

export function teacherPathPermission(pathname: string) {
  const section = pathname.split("/")[2] ?? "";
  return TEACHER_SECTION_PERMISSIONS[section];
}

export function teacherPathIsAuthorized(member: SchoolMembership | undefined, pathname: string) {
  const permission = teacherPathPermission(pathname);
  return !permission || hasStaffPermission(member, permission);
}
