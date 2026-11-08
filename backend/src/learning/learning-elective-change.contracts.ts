import { z } from "zod";
import { ConflictException } from "@nestjs/common";

/** Only explicitly identified owning review rules may close an unaccepted intent. */
export class ElectiveRuleRefusal extends ConflictException {}

const id = z.uuid(), revision = z.number().int().nonnegative(), hash = z.string().regex(/^[a-f0-9]{64}$/);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value);
const reference = z.object({ id, expected_revision: revision }).strict();
export const electiveSelection = z.object({ person: reference, source_offering: reference, source_enrollment: reference, destination_offering: reference, effective_on: day }).strict()
  .refine(value => value.source_offering.id !== value.destination_offering.id, "Choose a different destination elective.");
export const electiveCatchUp = z.discriminatedUnion("kind", [z.object({ kind: z.literal("not_needed"), reason: z.string().trim().min(3).max(500) }).strict(),
  z.object({ kind: z.literal("plan"), summary: z.string().trim().min(5).max(1000), due_on: day.nullable() }).strict()]);
export const electiveCommand = z.object({ command_id: id, expected_revision: revision }).strict();
const reviewer = z.object({ user_id: id, eligibility_hash: hash }).strict();
export const electiveRequest = electiveCommand.extend({ expected_revision: z.literal(0), change_id: id, selection: electiveSelection, preview_fingerprint: hash,
  reason: z.string().trim().min(3).max(500), catch_up: electiveCatchUp, finance_reviewer: reviewer.nullable(), confirm_delivery: z.boolean() }).strict()
  .refine(value => Boolean(value.finance_reviewer) === value.confirm_delivery, "Explicitly confirm delivery to the selected Finance reviewer, or leave the handoff unassigned.");
export const electiveAssignment = electiveCommand.extend({ reviewer, confirm_delivery: z.literal(true) }).strict();
export const electiveDecision = electiveCommand.extend({ expected_ledger_basis_hash: hash, outcome: z.enum(["no_financial_change", "requires_financial_review"]), reason: z.string().trim().min(5).max(1000) }).strict();
export const electiveWithdrawal = electiveCommand.extend({ reason: z.string().trim().min(3).max(500) }).strict();
export const electiveReceipt = z.object({ id, command_id: id, revision: z.number().int().positive(), action: z.enum(["request", "finance.assign", "finance.classify", "apply", "withdraw"]),
  state: z.enum(["unassigned", "waiting_for_finance", "no_financial_change", "requires_financial_review", "applied", "withdrawn"]), source_enrollment_id: id.optional(), destination_enrollment_id: id.optional(),
  effective_on: day.optional(), schedule_revisions: z.array(z.object({ previous_plan_id: id, plan_id: id, revision: z.number().int().positive(), command_id: id }).strict()).max(100).optional() }).strict();
export type ElectiveSelection = z.infer<typeof electiveSelection>;
export type ElectiveCommand = z.infer<typeof electiveCommand>;
export type ElectiveReceipt = z.infer<typeof electiveReceipt>;
export interface ElectiveFinanceReviewer { user_id: string; person_id: string; label: string; eligibility_hash: string }
export interface ElectiveChangeRow {
  id: string; school_id: string; person_id: string; source_offering_id: string; destination_offering_id: string; source_enrollment_id: string;
  selection: ElectiveSelection; preview: Record<string, unknown>; preview_fingerprint: string; reason: string;
  catch_up: z.infer<typeof electiveCatchUp>; created_by: string; command_id: string; created_at: Date;
}
export interface ElectiveActionRow {
  id: string; school_id: string; change_id: string; revision: number; kind: ElectiveReceipt['action']; actor_id: string; command_id: string;
  data: Record<string, unknown>; created_at: Date;
}
