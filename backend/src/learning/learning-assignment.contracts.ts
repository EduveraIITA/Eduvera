import { z } from "zod";
import { offeringAcademicInput } from "./learning-offering-academic.js";

export const assignmentId = z.string().uuid();
const text = (max: number) => z.string().trim().max(max).refine(value => !value.includes("\0"));
export const assignmentCommand = z.object({ command_id: assignmentId, expected_revision: z.number().int().min(0) }).strict();
export const assignmentPublication = assignmentCommand.extend({ audience_hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const assignmentDraft = assignmentCommand.extend({
  assignment_id: assignmentId, class_section_id: assignmentId, term_id: assignmentId,
  subject_id: assignmentId.nullable().default(null), reviewer_id: assignmentId,
  title: text(180).min(1), instructions: text(8000).min(1),
  due_at: z.iso.datetime({ offset: true }).nullable().default(null),
  cutoff_at: z.iso.datetime({ offset: true }).nullable().default(null),
  submission_mode: z.enum(["text", "files", "either"]).default("either"),
  max_attempts: z.number().int().min(1).max(100).nullable().default(null),
  policy_version: z.literal(1).default(1),
  resubmission_mode: z.literal("on_request").default("on_request"),
}).strict();
// Legacy class requests intentionally gain no default fields: accepted payload commitments remain byte-compatible.
export const offeringAssignmentDraft = assignmentDraft.omit({ class_section_id: true, term_id: true, subject_id: true }).extend({
  context_kind: z.literal("learning_offering"), offering_id: assignmentId,
}).strict();
export const learningAssignmentDraft = z.union([assignmentDraft, offeringAssignmentDraft]);
export const learningPersonReference = z.object({ id: assignmentId, expected_revision: z.number().int().positive() }).strict();
export const learningOfferingCreate = z.object({ command_id: assignmentId, offering_id: assignmentId, name: text(150).min(1),
  participants: z.array(learningPersonReference).min(1).max(100), instructor: learningPersonReference, starts_on: z.iso.date(),
  academic_context: offeringAcademicInput.optional(),
}).strict().refine(value => new Set(value.participants.map(item => item.id)).size === value.participants.length, "Choose each participant once.");
export const learningOfferingEnroll = assignmentCommand.extend({ participants: z.array(learningPersonReference).min(1).max(100), starts_on: z.iso.date() }).strict()
  .refine(value => new Set(value.participants.map(item => item.id)).size === value.participants.length, "Choose each participant once.");
export const learningOfferingEnd = assignmentCommand.extend({ reason: text(500).min(3) }).strict();
export const learningOfferingInstructor = assignmentCommand.extend({ instructor: learningPersonReference, starts_on: z.iso.date() }).strict();
export const learningOfferingAcademicCommand = assignmentCommand.extend({ academic_context: offeringAcademicInput }).strict();
const offeringEnrollmentReceipt = z.object({ id: assignmentId, person_id: assignmentId, revision: z.number().int().positive() }).strict();
const offeringAcademicReceiptContext = offeringAcademicInput.extend({ term_name: z.string(), academic_year: z.string(), starts_on: z.iso.date(), ends_on: z.iso.date(),
  subject_name: z.string(), color: z.string(), icon: z.string() }).strict();
export const learningOfferingReceipts = {
  create: z.object({ id: assignmentId, revision: z.number().int().positive(), teaching_assignment_id: assignmentId, enrollments: z.array(offeringEnrollmentReceipt), academic_context: offeringAcademicReceiptContext.optional() }).strict(),
  academic: z.object({ id: assignmentId, revision: z.number().int().positive(), action: z.literal("academic.configure"), academic_context: offeringAcademicReceiptContext }).strict(),
  enroll: z.object({ id: assignmentId, revision: z.number().int().positive(), enrollments: z.array(offeringEnrollmentReceipt) }).strict(),
  instructor: z.object({ id: assignmentId, revision: z.number().int().positive(), teaching_assignment_id: assignmentId }).strict(),
  end: z.object({ id: assignmentId, revision: z.number().int().positive(), record_id: assignmentId, record_revision: z.number().int().positive(), ends_on: z.iso.date() }).strict(),
};
export const learnerDraft = assignmentCommand.extend({ body: z.string().max(12000).refine(value => !value.includes("\0")) }).strict();
export const assignmentUpload = assignmentCommand.extend({ file_id: assignmentId }).strict();
export const assignmentSubmit = assignmentCommand.extend({ attempt_id: assignmentId }).strict();
export const assignmentReview = assignmentCommand.extend({ review_id: assignmentId, attempt_id: assignmentId,
  decision: z.enum(["reviewed", "request_changes"]), feedback: text(4000).min(1) }).strict();
export const assignmentReviewerHandover = assignmentCommand.extend({ reviewer_id: assignmentId, preview_hash: z.string().regex(/^[a-f0-9]{64}$/), reason: text(500).min(3) }).strict();
export const assignmentHandoverReceipt = z.object({ id: assignmentId, handover_id: assignmentId, revision: z.number().int().positive(), reviewer_id: assignmentId, reviews_reissued: z.number().int().nonnegative() }).strict();
export interface AssignmentUpload { filename: string; mimetype: string; data: Buffer }
export const assignmentLimits = { file_bytes: 5 * 1024 * 1024, files: 3, page_size: 10 } as const;
export type AssignmentCommand = z.infer<typeof assignmentCommand>;
const savedReceipt = z.object({ id: assignmentId, revision: z.number().int().positive() }).strict();
const workReceipt = savedReceipt.extend({ student_id: assignmentId }).strict();
const personWorkReceipt = savedReceipt.extend({ person_id: assignmentId }).strict();
export const assignmentReceipts = {
  saved: savedReceipt,
  published: savedReceipt.extend({ audience_count: z.number().int().positive() }).strict(),
  work: workReceipt,
  upload: workReceipt.extend({ file_id: assignmentId }).strict(),
  submitted: workReceipt.extend({ attempt_id: assignmentId, attempt_number: z.number().int().positive(), submitted_at: z.iso.datetime({ offset: true }), manifest_hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  reviewed: z.object({ id: assignmentId, student_id: assignmentId, attempt_id: assignmentId, decision: z.enum(["reviewed", "request_changes"]) }).strict(),
};
export const offeringAssignmentReceipts = {
  work: personWorkReceipt,
  upload: personWorkReceipt.extend({ file_id: assignmentId }).strict(),
  submitted: personWorkReceipt.extend({ attempt_id: assignmentId, attempt_number: z.number().int().positive(), submitted_at: z.iso.datetime({ offset: true }), manifest_hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  reviewed: z.object({ id: assignmentId, person_id: assignmentId, attempt_id: assignmentId, decision: z.enum(["reviewed", "request_changes"]) }).strict(),
};
