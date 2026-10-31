import { executionNow } from "../campus-model-core/execution-time.runtime.js";
import { z } from "zod";
export type { TimetableOperationReadiness } from "../schedule-planning/activity-planning-readiness.js";

export const progressiveCapabilitySchema = z.enum([
  "attendance", "gate", "timetable", "assignments", "fees", "resources", "facilities", "accommodation", "dining", "examinations", "performance", "staff", "messages",
]);
export type ProgressiveCapability = z.infer<typeof progressiveCapabilitySchema>;

/** Discovery context only. The owning register rechecks authority, time and state. */
export interface AttendanceOperationReadiness {
  actor_user_id: string;
  action: "record" | "review" | "view";
  state: "ready" | "opens_later" | "waiting_for_recorder" | "waiting_for_review" | "automatic_pending" | "complete" | "requires_domain_check";
  scope: { kind: "occurrence" | "class"; id: string; date: string };
  source_revision: number | null;
  register_revision: number | null;
  evaluated_at: string;
  starts_at: string | null;
  requires_recheck: true;
}

const responsible = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("current_user"), self_teaches: z.literal(true), display_name: z.string().trim().min(2).max(120).optional() }).strict(),
  z.object({ kind: z.literal("staff"), user_id: z.uuid() }).strict(),
]);

export const attendanceProgressiveSetupSchema = z.object({
  group_name: z.string().trim().min(1).max(16).optional(),
  existing_class_id: z.uuid().optional(),
  participant_names: z.array(z.string().trim().min(2).max(120)).max(100).default([]),
  existing_student_ids: z.array(z.uuid()).max(100).default([]),
  responsible,
  session: z.object({
    starts_at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    ends_at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional(),
  }).strict(),
}).strict().superRefine((value, context) => {
  if (Boolean(value.group_name) === Boolean(value.existing_class_id)) {
    context.addIssue({ code: "custom", path: ["group_name"], message: "Choose an existing group or name one new group." });
  }
  if (!value.participant_names.length && !value.existing_student_ids.length) {
    context.addIssue({ code: "custom", path: ["participant_names"], message: "Add or choose at least one participant." });
  }
  if (value.session.ends_at <= value.session.starts_at) {
    context.addIssue({ code: "custom", path: ["session", "ends_at"], message: "End time must be after start time." });
  }
  const normalized = value.participant_names.map((name) => name.toLocaleLowerCase().replace(/\s+/g, " "));
  if (new Set(normalized).size !== normalized.length) {
    context.addIssue({ code: "custom", path: ["participant_names"], message: "Choose each new participant once." });
  }
});

export const gateProgressiveSetupSchema = z.object({
  gate_name: z.string().trim().min(2).max(160).optional(),
  existing_gate_id: z.uuid().optional(),
  operator: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("current_user"), confirm: z.literal(true) }).strict(),
    z.object({ kind: z.literal("staff"), user_id: z.uuid() }).strict(),
  ]),
}).strict().superRefine((value, context) => {
  if (Boolean(value.gate_name) === Boolean(value.existing_gate_id)) {
    context.addIssue({ code: "custom", path: ["gate_name"], message: "Choose an existing entry point or name one new entry point." });
  }
});

export type AttendanceProgressiveSetup = z.infer<typeof attendanceProgressiveSetupSchema>;
export type GateProgressiveSetup = z.infer<typeof gateProgressiveSetupSchema>;

export function institutionLocalDate(timezone: string, instant = executionNow()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function institutionLocalWeekday(timezone: string, instant = executionNow()): number {
  const label = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(instant);
  return ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(label);
}

export function datePlusDays(date: string, days: number): string {
  const result = new Date(`${date}T12:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}
