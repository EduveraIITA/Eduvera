import { z } from "zod";
import type { ParticipationFinalization } from "./participation-finalization.js";

export const participationStatusSchema = z.enum(["present", "absent", "late", "excused", "half_day", "no_show", "checked_out", "left_early"]);
export type ParticipationStatus = z.infer<typeof participationStatusSchema>;
export type ParticipationRegisterState = "draft" | "submitted" | "locked";

/** Server-only proof supplied by a reviewed domain source adapter, never HTTP input. */
export interface ParticipationCaptureSource {
  capture_channel: "human_roll_call" | "offline_paper" | "camera_assisted";
  observed_at: Date;
  evidence_refs: string[];
}
export type ParticipationCaptureSources = Readonly<Record<string, ParticipationCaptureSource>>;

export const attendancePageSchema = z.object({
  date: z.iso.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(50).default(20),
}).strict();
export const attendanceQueueSchema = attendancePageSchema.extend({
  search: z.string().trim().max(120).default(""),
  view: z.enum(["all", "needs_recording", "awaiting_review", "automatic_pending", "upcoming", "completed", "cancelled"]).default("all"),
  kind: z.string().trim().max(60).optional(),
});
export const attendanceHistorySchema = attendancePageSchema.omit({ date: true }).extend({
  view: z.literal("activities").optional(),
  batch: z.string().min(1).max(2048).optional(),
}).refine(input => !(input.view && input.batch), "Choose activity summaries or one activity's evidence.");
export const participationMarksSchema = z.object({
  expected_revision: z.number().int().min(0),
  reason: z.string().trim().min(3).max(500).optional(),
  records: z.array(z.object({
    person_id: z.string().uuid(),
    status: participationStatusSchema.nullable(),
    remarks: z.string().trim().max(500).default(""),
  }).strict()).min(1).max(2000),
}).strict().superRefine((input, context) => {
  if (new Set(input.records.map((record) => record.person_id)).size !== input.records.length) {
    context.addIssue({ code: "custom", path: ["records"], message: "Record each participant only once." });
  }
});
export const participationTransitionSchema = z.object({
  expected_revision: z.number().int().min(0),
  reason: z.string().trim().min(3).max(500).optional(),
}).strict();

// Device and camera reports must enter through their registered source adapters.
// This authenticated human endpoint never accepts a claimed device identity.
export const participationEvidenceSchema = z.object({
  expected_revision: z.number().int().min(0),
  person_id: z.string().uuid(),
  claimed_status: participationStatusSchema,
  capture_channel: z.enum(["offline_paper", "self_check_in"]),
  observed_at: z.iso.datetime({ offset: true }),
  source_reference: z.string().trim().max(160).default(""),
  note: z.string().trim().min(3).max(500),
}).strict();
export const participationEvidenceDecisionSchema = z.object({
  expected_revision: z.number().int().min(0),
  decision: z.enum(["accepted", "rejected"]),
  reason: z.string().trim().min(3).max(500),
}).strict();

export interface ParticipationRosterRow {
  person_id: string;
  name: string;
  roles: string[];
  requirement: "required" | "optional";
  status: ParticipationStatus | null;
  remarks: string;
  observed_at: string | null;
  revision: number;
}

export interface ActivityAttendanceSummary {
  id: string;
  occurrence_id: string;
  title: string;
  kind: string;
  starts_at: string;
  ends_at: string;
  time_zone: string;
  place_label: string;
  state: ParticipationRegisterState;
  revision: number;
  participant_count: number;
  recorded_count: number;
  can_record: boolean;
  can_review: boolean;
  availability_reason: string | null;
  source_kind: "activity" | "daily_class" | "scheduled_session" | "event" | "examination";
  occurrence_state?: string;
  queue_category?: "needs_recording" | "awaiting_review" | "automatic_pending" | "upcoming" | "completed" | "cancelled";
  entry_mode?: "participation" | "owning_domain" | "legacy";
  source?: { domain: string; href: string; label: string };
  finalization?: ParticipationFinalization;
}

export function participationCounts(roster: readonly Pick<ParticipationRosterRow, "status">[]) {
  const count = (status: ParticipationStatus) => roster.filter((row) => row.status === status).length;
  const recorded = roster.filter((row) => row.status !== null).length;
  return {
    participants: roster.length,
    recorded,
    unrecorded: roster.length - recorded,
    present: count("present"),
    absent: count("absent"),
    late: count("late"),
    excused: count("excused"),
    half_day: count("half_day"),
  };
}

export function participationRosterFingerprint(rows: readonly {
  person_id: string; source_kind: string; source_ref: string; source_revision: number; participation_role: string; requirement: string;
}[]): string {
  // The caller hashes this canonical representation so source/membership changes
  // cannot silently replace the roster a recorder reviewed.
  return JSON.stringify([...rows].map((row) => ({
    person_id: row.person_id,
    source_kind: row.source_kind,
    source_ref: row.source_ref,
    source_revision: row.source_revision,
    participation_role: row.participation_role,
    requirement: row.requirement,
  })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))));
}
