import { z } from "zod";
import type { Kysely, Transaction } from "kysely";
import type { Database } from "../database/types.js";
export type PlanDb = Kysely<Database> | Transaction<Database>;
export const uuid = z.string().uuid();
export const date = z.iso.date();
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((v) => !v.includes("\0"), "Unsupported character.");
const time = z
  .string()
  .regex(
    /^([01]\d|2[0-3]):[0-5]\d(?::00)?$/,
    "Use a valid time in hours and minutes.",
  )
  .transform((v) => `${v.slice(0, 5)}:00`);
export const periodSchema = z
  .object({
    subject_id: uuid.nullable().default(null),
    period_number: z.number().int().min(1).max(24),
    starts_at: time,
    ends_at: time,
    title: text(120).refine((v) => !!v, "Enter a period name."),
    slot_type: z.enum(["class", "break", "activity"]),
    room: text(80),
    teacher_user_id: uuid.nullable(),
    cancelled: z.boolean(),
    materials: z
      .array(text(120).refine((v) => !!v, "Enter a material name."))
      .max(12),
  })
  .strict()
  .refine((p) => p.ends_at > p.starts_at, "End time must follow start time.");
export type PlanPeriod = z.infer<typeof periodSchema>;
export interface StoredPeriod extends PlanPeriod {
  id: string;
  teacher_name: string | null;
  teacher_membership_id: string | null;
  coverage_status:
    "not_required" | "unassigned" | "pending" | "accepted" | "declined";
  response_note: string;
  response_source: string | null;
  responded_by: string | null;
  responded_at: Date | null;
  received_at: Date | null;
  response_revision: number;
}
export interface Plan {
  id: string;
  school_id: string;
  class_section_id: string;
  term_id: string;
  date: string;
  revision: number;
  draft_version: number | null;
  published_version: number | null;
  owner_id: string;
  updated_at: Date;
}
export const commandSchema = z.object({
  school_id: uuid,
  idempotency_key: uuid,
});
export const startSchema = commandSchema.extend({
  class_section_id: uuid,
  date,
});
export const saveSchema = commandSchema
  .extend({
    expected_revision: z.number().int().positive(),
    notice: text(1200),
    reason: text(500),
    periods: z.array(periodSchema).max(24),
  })
  .strict()
  .refine(
    (v) =>
      new Set(v.periods.map((p) => p.period_number)).size === v.periods.length,
    "Period numbers must be unique.",
  );
export const actionSchema = commandSchema
  .extend({ expected_revision: z.number().int().positive() })
  .strict();
export const responseSchema = commandSchema
  .extend({
    expected_revision: z.number().int().nonnegative(),
    status: z.enum(["accepted", "declined"]),
    note: text(500),
    source: z.enum(["app", "phone", "paper", "in_person"]),
    received_at: z.iso.datetime({ offset: true }).optional(),
  })
  .strict()
  .refine(
    (v) => v.status !== "declined" || v.note.length > 0,
    "Explain why coverage is unavailable.",
  )
  .refine(
    (v) => v.source === "app" || (!!v.received_at && v.note.length > 0),
    "Assisted responses need the received time and a note.",
  );
export function comparable(p: PlanPeriod) {
  return {
    subject_id: p.subject_id ?? null,
    period_number: p.period_number,
    starts_at: p.starts_at.slice(0, 5),
    ends_at: p.ends_at.slice(0, 5),
    title: p.title,
    slot_type: p.slot_type,
    room: p.room,
    teacher_user_id: p.teacher_user_id,
    cancelled: p.cancelled,
    materials: p.materials,
  };
}
export function samePeriod(a: PlanPeriod, b: PlanPeriod) {
  return JSON.stringify(comparable(a)) === JSON.stringify(comparable(b));
}
