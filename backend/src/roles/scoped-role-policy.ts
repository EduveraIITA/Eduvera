import { BadRequestException } from "@nestjs/common";
import { PERMISSIONS } from "./permissions.js";

export const ROLE_CONTEXTS = [
  { code: "institution", label: "Institution", permissions: ["members.invite", "sis.manage", "fees.manage", "departure.manage", "messages.view", "messages.send", "groups.create", "ai.use"] },
  { code: "class", label: "Class", permissions: ["attendance.view", "attendance.record", "photo.use", "timetable.view", "followups.manage", "messages.view", "messages.send", "groups.create", "reports.comment", "events.view", "events.manage", "ai.use"] },
  { code: "event", label: "Event", permissions: ["events.view", "events.manage", "events.attendance"] },
  { code: "assessment", label: "Assessment", permissions: ["assessments.view", "assessments.mark", "assessments.moderate"] },
  { code: "trip", label: "Journey", permissions: ["departure.collect"] },
] as const;

const prerequisites: Record<string, string[]> = {
  "attendance.record": ["attendance.view"], "photo.use": ["attendance.view", "attendance.record"],
  "messages.send": ["messages.view"], "groups.create": ["messages.view", "messages.send"],
  "events.manage": ["events.view"], "events.attendance": ["events.view"],
  "assessments.mark": ["assessments.view"], "assessments.moderate": ["assessments.view"],
};

export function rolePermissions(context: string, requested: string[]) {
  const allowed: readonly string[] = ROLE_CONTEXTS.find((item) => item.code === context)?.permissions ?? [];
  if (!requested.length || requested.some((code) => !allowed.includes(code))) {
    throw new BadRequestException("Choose supported actions for this role's scope.");
  }
  if (requested.includes("assessments.mark") && requested.includes("assessments.moderate")) {
    throw new BadRequestException("Keep marking and independent review in separate roles.");
  }
  return [...new Set(requested.flatMap((code) => [code, ...(prerequisites[code] ?? [])]))].sort();
}

export function roleOptions() {
  return { contexts: ROLE_CONTEXTS, permissions: PERMISSIONS, prerequisites };
}
