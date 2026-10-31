import { z } from "zod";
const text = (max: number) => z.string().trim().max(max).refine(value => !value.includes("\0"), "Unsupported character.");
const day = z.iso.date().refine(value => value >= "1900-01-01" && value <= "2200-12-31", "Choose a date between 1900 and 2200.");
const provenance = z.object({ fixture_key: text(120).min(1).optional(), source_note: text(1000).min(1).optional() }).strict().nullable();
const fields = { title: text(160).min(2), description: text(4000).default(""), starts_on: day, ends_on: day,
  category_label: text(80).min(2).default("Campus date"), academic_term_id: z.uuid().nullable().default(null),
  provenance: provenance.default(null) };
const validWindow = (value: { starts_on: string; ends_on: string }) => value.ends_on >= value.starts_on && Date.parse(value.ends_on) - Date.parse(value.starts_on) <= 366 * 86_400_000;
export const publishCampusDateInput = z.object({ ...fields, idempotency_key: z.uuid() }).strict().refine(validWindow, "Choose an inclusive date range of up to 367 days.");
export const correctCampusDateInput = z.object({ ...fields, academic_term_id: z.uuid().nullable().optional(), provenance: provenance.optional(), idempotency_key: z.uuid(), expected_revision: z.number().int().positive(), reason: text(1000).min(3) }).strict().refine(validWindow, "Choose an inclusive date range of up to 367 days.");
export const cancelCampusDateInput = z.object({ idempotency_key: z.uuid(), expected_revision: z.number().int().positive(), reason: text(1000).min(3) }).strict();
export const campusDateRangeInput = z.object({ from: day, until: day, page: z.coerce.number().int().min(1).max(100000).default(1) }).strict()
  .refine(value => value.until >= value.from && Date.parse(value.until) - Date.parse(value.from) <= 30 * 86_400_000, "Choose a date range of up to 31 days.");
export type CampusDateFields = z.infer<typeof publishCampusDateInput>;
export interface CampusDateDto { id: string; school_id: string; title: string; description: string; starts_on: string; ends_on: string;
  category_label: string; academic_term_id: string | null; provenance: CampusDateFields["provenance"];
  state: "published" | "cancelled"; revision: number; cancellation_reason: string | null; updated_at: string; }
