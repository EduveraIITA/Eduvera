import { createHash } from "node:crypto";
import { z } from "zod";

export const sessionUuid = z.string().uuid();
export const sessionDate = z.iso.date();
export const sessionPage = z.coerce.number().int().min(1).max(10000).default(1);
const text = (max: number) => z.string().trim().max(max).refine(value => !value.includes("\0"));
export const sessionCommand = z.object({ command_id: sessionUuid, expected_revision: z.number().int().nonnegative(),
  source_fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const lessonSave = sessionCommand.extend({ preparation: text(8000).default(""), topic: text(180).default(""),
  learner_notes: text(8000).default(""), state: z.enum(["prepared", "reported"]), reason: text(500).default("") }).strict()
  .refine(value => value.state !== "reported" || value.topic.length > 0, "Add the topic actually covered.");
export const sessionMaterial = sessionCommand.extend({ material_id: sessionUuid, title: text(180).min(1),
  kind: z.enum(["link", "text"]), url: text(1000).default(""), body: text(20000).default(""), shared: z.boolean(),
  replaces_material_id: sessionUuid.nullable().default(null) }).strict().superRefine((value, ctx) => {
    if (value.kind === "link") {
      try { const url = new URL(value.url); if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error(); }
      catch { ctx.addIssue({ code: "custom", path: ["url"], message: "Use an HTTP or HTTPS link without embedded credentials." }); }
      if (value.body) ctx.addIssue({ code: "custom", path: ["body"], message: "A link has no text attachment." });
    } else if (!value.body || value.url) ctx.addIssue({ code: "custom", path: ["body"], message: "Enter the reading or code text." });
  });
export const sessionFile = sessionCommand.extend({ material_id: sessionUuid, title: text(180).min(1), shared: z.boolean(),
  replaces_material_id: sessionUuid.nullable().default(null) }).strict();
export type SessionCommand = z.infer<typeof sessionCommand>;
export interface SessionUpload { filename: string; mimetype: string; data: Buffer }
export const sessionHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function teachingSessionId(school: string, kind: string, key: string, date: string) {
  const bytes = createHash("sha256").update(JSON.stringify(["teaching-session-v1", school, kind, key, date])).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 15) | 80; bytes[8] = (bytes[8]! & 63) | 128;
  const hex = bytes.toString("hex"); return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export const teachingSessionHref = (id: string, date: string) => `/areas/timetable/session?${new URLSearchParams({ session_id: id, date }).toString()}`;
