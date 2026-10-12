import { z } from "zod";

export const noticePortalSchema = z.enum(["parent", "teacher", "principal"]);
export const noticeResponseModeSchema = z.enum(["information", "acknowledgement", "choice"]);
export const noticePrioritySchema = z.enum(["urgent", "high", "normal"]);
export const noticeChannelSchema = z.enum(["app", "sms", "paper", "phone", "in_person"]);

const audienceSchema = z.object({
  kind: z.enum(["school_staff", "school_guardians", "class_guardians"]),
  class_section_id: z.string().uuid().nullable().optional(),
}).strict().superRefine((audience, context) => {
  const hasClass = Boolean(audience.class_section_id);
  if ((audience.kind === "class_guardians") !== hasClass) {
    context.addIssue({ code: "custom", message: "A class is required only for a class guardian audience." });
  }
});

const noticeContentShape = {
  title: z.string().trim().min(3).max(180),
  body: z.string().trim().min(3).max(4000),
  response_mode: noticeResponseModeSchema,
  response_options: z.array(z.string().trim().min(1).max(120)).max(6).default([]),
  priority: noticePrioritySchema.default("normal"),
  due_at: z.iso.datetime({ offset: true }).nullable().optional(),
  audiences: z.array(audienceSchema).min(1).max(10),
};

function validateContent(
  input: {
    response_mode: z.infer<typeof noticeResponseModeSchema>;
    response_options: string[];
    due_at?: string | null | undefined;
    audiences: Array<z.infer<typeof audienceSchema>>;
  },
  context: z.RefinementCtx,
) {
  const normalizedOptions = input.response_options.map((option) => option.toLocaleLowerCase());
  if (new Set(normalizedOptions).size !== normalizedOptions.length) {
    context.addIssue({ code: "custom", path: ["response_options"], message: "Choice labels must be unique." });
  }
  if (input.response_mode === "information") {
    if (input.response_options.length || input.due_at) {
      context.addIssue({ code: "custom", message: "Information notices do not collect a response or use a deadline." });
    }
  } else {
    if (!input.due_at) context.addIssue({ code: "custom", path: ["due_at"], message: "Choose a response deadline." });
    if (input.response_mode === "acknowledgement" && input.response_options.length) {
      context.addIssue({ code: "custom", path: ["response_options"], message: "Acknowledgements do not use choices." });
    }
    if (input.response_mode === "choice" && input.response_options.length < 2) {
      context.addIssue({ code: "custom", path: ["response_options"], message: "Provide at least two choices." });
    }
  }
  const identities = input.audiences.map((audience) => `${audience.kind}:${audience.class_section_id ?? "school"}`);
  if (new Set(identities).size !== identities.length) {
    context.addIssue({ code: "custom", path: ["audiences"], message: "Each audience can be selected once." });
  }
}

export const createNoticeSchema = z.object({
  school_id: z.string().uuid(),
  ...noticeContentShape,
  idempotency_key: z.string().uuid(),
}).strict().superRefine(validateContent);

export const updateNoticeSchema = z.object({
  ...noticeContentShape,
  expected_revision: z.number().int().positive(),
  idempotency_key: z.string().uuid(),
}).strict().superRefine(validateContent);

export const publishNoticeSchema = z.object({
  expected_revision: z.number().int().positive(),
  idempotency_key: z.string().uuid(),
}).strict();

export const cancelNoticeSchema = z.object({
  expected_revision: z.number().int().positive(),
  reason: z.string().trim().min(3).max(500),
  idempotency_key: z.string().uuid(),
}).strict();

export const respondNoticeSchema = z.object({
  expected_revision: z.number().int().positive(),
  response_value: z.string().trim().min(1).max(120).optional(),
  response_note: z.string().trim().max(1000).default(""),
  idempotency_key: z.string().uuid(),
  student_id: z.string().uuid().optional(),
}).strict();

export const assistedResponseSchema = z.object({
  recipient_id: z.string().uuid(),
  expected_revision: z.number().int().positive(),
  response_value: z.string().trim().min(1).max(120).optional(),
  response_note: z.string().trim().max(1000).default(""),
  channel: z.enum(["sms", "paper", "phone", "in_person"]),
  observed_at: z.iso.datetime({ offset: true }),
  idempotency_key: z.string().uuid(),
}).strict();

export const deliveryAttemptSchema = z.object({
  recipient_id: z.string().uuid(),
  channel: z.enum(["sms", "paper", "phone", "in_person"]),
  status: z.enum(["queued", "attempted", "delivered", "failed", "cancelled"]),
  note: z.string().trim().max(500).default(""),
  provider_reference: z.string().trim().max(180).default(""),
  attempted_at: z.iso.datetime({ offset: true }),
  idempotency_key: z.string().uuid(),
}).strict();

export type NoticePortal = z.infer<typeof noticePortalSchema>;
export type NoticeAudienceInput = z.infer<typeof audienceSchema>;
export type NoticeContentInput = Pick<z.infer<typeof createNoticeSchema>,
  "title" | "body" | "response_mode" | "response_options" | "priority" | "due_at" | "audiences">;
