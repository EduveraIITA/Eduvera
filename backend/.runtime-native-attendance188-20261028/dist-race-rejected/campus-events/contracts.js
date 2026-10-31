import { z } from "zod";
export const uuid = z.string().uuid();
const text = (max) => z.string().trim().max(max).refine((value) => !value.includes("\0"), "Unsupported character.");
const requiredText = (max) => text(max).min(1);
const instant = z.iso.datetime({ offset: true });
export const eventType = z.enum([
    "annual_function", "excursion", "sports", "workshop", "competition",
    "assembly", "ptm", "club", "class_test", "other",
]);
export const eventStatus = z.enum(["draft", "published", "cancelled", "completed"]);
export const audienceMode = z.enum(["school", "class_sections", "students"]);
export const participationRequirement = z.enum(["optional", "mandatory"]);
export const sessionType = z.enum(["general", "rehearsal", "departure", "activity", "return"]);
export const attendanceMode = z.enum(["none", "check_in", "check_in_out"]);
export const attendanceStatus = z.enum(["not_recorded", "present", "late", "excused", "no_show", "checked_out"]);
export const audienceSchema = z.object({
    mode: audienceMode,
    class_section_ids: z.array(uuid).max(100).default([]),
    student_ids: z.array(uuid).max(500).default([]),
}).strict().superRefine((value, context) => {
    if (new Set(value.class_section_ids).size !== value.class_section_ids.length) {
        context.addIssue({ code: "custom", message: "Class selections must be unique.", path: ["class_section_ids"] });
    }
    if (new Set(value.student_ids).size !== value.student_ids.length) {
        context.addIssue({ code: "custom", message: "Student selections must be unique.", path: ["student_ids"] });
    }
    if (value.mode === "school" && (value.class_section_ids.length || value.student_ids.length)) {
        context.addIssue({ code: "custom", message: "A school-wide audience must not include narrower selections." });
    }
    if (value.mode === "class_sections" && (!value.class_section_ids.length || value.student_ids.length)) {
        context.addIssue({ code: "custom", message: "Choose at least one class and no individual students." });
    }
    if (value.mode === "students" && (!value.student_ids.length || value.class_section_ids.length)) {
        context.addIssue({ code: "custom", message: "Choose at least one student and no class sections." });
    }
});
export const eventSessionSchema = z.object({
    id: uuid.optional(),
    title: requiredText(160),
    session_type: sessionType,
    venue: text(240).default(""),
    space_id: uuid.nullable().optional(),
    use_event_space: z.boolean().optional(),
    starts_at: instant,
    ends_at: instant,
    attendance_mode: attendanceMode,
    participant_student_ids: z.array(uuid).max(500).default([]),
}).strict().refine(value => !value.use_event_space || !value.space_id, {
    message: "Use either the event location or one session location.", path: ["space_id"],
}).refine((value) => Date.parse(value.ends_at) > Date.parse(value.starts_at), {
    message: "Session end time must follow its start time.", path: ["ends_at"],
});
export const checklistItemSchema = z.object({
    id: uuid.optional(),
    label: requiredText(180),
    required: z.boolean().default(false),
}).strict();
export const eventStaffSchema = z.object({
    user_id: uuid,
    role: z.enum(["organizer", "duty_staff", "attendance_taker"]),
}).strict();
const eventFields = z.object({
    school_id: uuid,
    idempotency_key: uuid,
    event_type: eventType,
    subject_id: uuid.nullable().default(null),
    title: requiredText(160),
    description: text(4000).default(""),
    venue: text(240).default(""),
    space_id: uuid.nullable().optional(),
    starts_at: instant,
    ends_at: instant,
    audience: audienceSchema,
    participation_requirement: participationRequirement,
    requires_rsvp: z.boolean(),
    requires_guardian_consent: z.boolean(),
    payment_required: z.boolean(),
    payment_amount_paise: z.number().int().min(1).max(100_000_000).nullable().default(null),
    payment_due_on: z.iso.date().nullable().default(null),
    payment_currency: z.literal("INR").default("INR"),
    sessions: z.array(eventSessionSchema).max(32),
    checklist: z.array(checklistItemSchema).max(40).default([]),
    staff: z.array(eventStaffSchema).max(100).default([]),
});
function validateEventWindow(value, context) {
    const start = Date.parse(value.starts_at);
    const end = Date.parse(value.ends_at);
    if (end <= start)
        context.addIssue({ code: "custom", message: "Event end time must follow its start time.", path: ["ends_at"] });
    value.sessions.forEach((session, index) => {
        if (Date.parse(session.starts_at) < start || Date.parse(session.ends_at) > end) {
            context.addIssue({ code: "custom", message: "Every session must fall within the event time window.", path: ["sessions", index] });
        }
        if (new Set(session.participant_student_ids).size !== session.participant_student_ids.length) {
            context.addIssue({ code: "custom", message: "Session participant selections must be unique.", path: ["sessions", index, "participant_student_ids"] });
        }
    });
    const sessionIds = value.sessions.flatMap((session) => session.id ? [session.id] : []);
    if (new Set(sessionIds).size !== sessionIds.length)
        context.addIssue({ code: "custom", message: "Session IDs must be unique.", path: ["sessions"] });
    const checklistIds = value.checklist.flatMap((item) => item.id ? [item.id] : []);
    if (new Set(checklistIds).size !== checklistIds.length)
        context.addIssue({ code: "custom", message: "Checklist IDs must be unique.", path: ["checklist"] });
    const staffUsers = value.staff.map((member) => member.user_id);
    if (new Set(staffUsers).size !== staffUsers.length)
        context.addIssue({ code: "custom", message: "Choose one explicit event duty per staff member.", path: ["staff"] });
    const hasPaymentAmount = value.payment_amount_paise !== null;
    const hasPaymentDueDate = value.payment_due_on !== null;
    if ((value.payment_required && (!hasPaymentAmount || !hasPaymentDueDate))
        || (!value.payment_required && (hasPaymentAmount || hasPaymentDueDate))) {
        context.addIssue({ code: "custom", message: "Paid events need an amount and due date; free events must omit both.", path: ["payment_required"] });
    }
    if (value.participation_requirement === "optional" && !value.requires_rsvp) {
        context.addIssue({ code: "custom", message: "An optional event requires RSVP so session rosters contain only accepted participants.", path: ["requires_rsvp"] });
    }
}
export const createEventSchema = eventFields.strict().superRefine(validateEventWindow);
export const saveEventSchema = eventFields.extend({ expected_revision: z.number().int().positive() }).strict().superRefine(validateEventWindow);
export const eventActionSchema = z.object({ school_id: uuid, expected_revision: z.number().int().positive(), idempotency_key: uuid }).strict();
export const cancelEventSchema = eventActionSchema.extend({
    internal_reason: requiredText(500).min(3),
    audience_notice: requiredText(500).min(3),
}).strict();
export const rsvpSchema = z.object({
    school_id: uuid, student_id: uuid,
    status: z.enum(["accepted", "declined"]),
    expected_revision: z.number().int().nonnegative(),
    idempotency_key: uuid,
}).strict();
export const consentSchema = z.object({
    school_id: uuid, student_id: uuid,
    status: z.enum(["granted", "denied", "withdrawn"]),
    note: text(500).default(""), expected_revision: z.number().int().nonnegative(), idempotency_key: uuid,
}).strict();
export const checklistCompletionSchema = z.object({
    school_id: uuid, student_id: uuid, completed: z.boolean(), idempotency_key: uuid,
}).strict();
export const attendanceCommandSchema = z.object({
    school_id: uuid, expected_revision: z.number().int().positive(), idempotency_key: uuid,
    reason: text(500).optional(),
    records: z.array(z.object({
        student_id: uuid,
        status: attendanceStatus,
        note: text(500).default(""),
        observed_at: instant.nullable(),
        readiness_contradiction_note: requiredText(500).min(3).nullable().default(null),
    }).strict().superRefine((record, context) => {
        const physical = record.status === "present" || record.status === "late" || record.status === "checked_out";
        if (physical && !record.observed_at) {
            context.addIssue({ code: "custom", message: "Present, late and checked-out decisions require an observation time.", path: ["observed_at"] });
        }
        if (!physical && record.observed_at !== null) {
            context.addIssue({ code: "custom", message: "Only a physical check-in or check-out may include an observation time.", path: ["observed_at"] });
        }
        if (!physical && record.readiness_contradiction_note !== null) {
            context.addIssue({ code: "custom", message: "Only a physically observed participant may include readiness contradiction evidence.", path: ["readiness_contradiction_note"] });
        }
    })).min(1).max(500),
}).strict().superRefine((value, context) => {
    if (new Set(value.records.map((record) => record.student_id)).size !== value.records.length) {
        context.addIssue({ code: "custom", message: "Each student may appear only once.", path: ["records"] });
    }
});
export const lockSessionSchema = eventActionSchema.extend({ reason: requiredText(500).min(3) }).strict();
export const reopenSessionSchema = eventActionSchema.extend({ reason: requiredText(500).min(3) }).strict();
export const grantConsentAuthoritySchema = z.object({
    school_id: uuid, expected_revision: z.number().int().nonnegative(), idempotency_key: uuid,
    valid_from: z.iso.date(), valid_until: z.iso.date().nullable(),
    provenance: requiredText(500).min(3), verified: z.literal(true),
}).strict().refine((value) => !value.valid_until || value.valid_until >= value.valid_from, {
    message: "Authority end date must not precede its start date.", path: ["valid_until"],
});
export const revokeConsentAuthoritySchema = z.object({
    school_id: uuid, expected_revision: z.number().int().positive(), idempotency_key: uuid,
    reason: requiredText(500).min(3),
}).strict();
//# sourceMappingURL=contracts.js.map