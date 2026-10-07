import { z } from "zod";

export const uuid = z.string().uuid();
export const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Use a valid calendar date.");
const text = (max: number) => z.string().trim().min(1).max(max);
export const personSchema = z.object({
  email: z.email().trim().toLowerCase().max(254), first_name: text(150), last_name: text(150),
});
export const studentSchema = personSchema.extend({
  admission_number: text(64), date_of_birth: date.nullable().default(null),
  class_section_id: uuid, term_id: uuid, roll_number: z.number().int().min(1).max(32767),
});
export const studentUpdateSchema = personSchema.pick({ first_name: true, last_name: true }).extend({
  admission_number: text(64), date_of_birth: date.nullable(),
});
export const guardianSchema = personSchema.extend({
  student_id: uuid, phone: text(32), relationship: z.enum(["mother", "father", "guardian"]),
  is_primary: z.boolean().default(false), can_authorize_leave: z.boolean().default(true),
});
export const termSchema = z.object({
  academic_year: z.string().regex(/^\d{4}-\d{2}(?:\d{2})?$/), name: text(100), starts_on: date, ends_on: date,
  attendance_threshold: z.number().min(0).max(100).default(85), is_active: z.boolean().default(true),
}).refine((data) => data.ends_on >= data.starts_on, { message: "Term end must follow its start.", path: ["ends_on"] });
export const classSchema = z.object({
  academic_year: z.string().regex(/^\d{4}-\d{2}(?:\d{2})?$/), grade: text(16), section: text(16),
  board: z.string().trim().max(100).default(""), room_number: z.string().trim().max(32).default(""),
});
export const subjectSchema = z.object({
  code: text(16).transform((value) => value.toUpperCase()),
  name: text(100),
  short_name: text(40),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Choose a valid six-digit subject color.").transform((value) => value.toUpperCase()).default("#1D4ED8"),
  icon: z.enum(["book-open", "calculator", "flask-conical", "languages", "palette", "dumbbell", "laptop", "globe-2"]).default("book-open"),
});
export const catalogMutationSchema = z.object({
  expected_revision: z.number().int().positive().optional(),
  confirmed: z.boolean().default(false),
  change_reason: z.string().trim().max(240).default(""),
});
export const enrollmentSchema = z.object({ student_id: uuid, class_section_id: uuid, term_id: uuid, roll_number: z.number().int().min(1).max(32767) });
export const rolloverSchema = z.object({
  source_term_id: uuid, target_term_id: uuid,
  mappings: z.array(z.object({ from_class_id: uuid, to_class_id: uuid })).min(1).max(200),
  confirm: z.boolean().default(false),
}).refine((data) => data.source_term_id !== data.target_term_id, "Select different source and target terms.")
  .refine((data) => new Set(data.mappings.map((m) => m.from_class_id)).size === data.mappings.length, "Duplicate source class.");
export const invoiceSchema = z.object({
  student_id: uuid, reference: text(80), description: text(200),
  amount_paise: z.number().int().min(1).max(100_000_000), due_on: date,
});
export const paymentSchema = z.object({
  amount_paise: z.number().int().min(1).max(100_000_000), method: z.enum(["cash", "bank_transfer", "cheque"]),
  reference: text(120), idempotency_key: uuid,
});

// RFC 4180-style CSV, including quoted commas, escaped quotes and CRLF.
export function parseStudentCsv(input: string): Record<string, unknown>[] {
  const rows: string[][] = []; let row: string[] = []; let field = ""; let quoted = false; let closed = false;
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') { field += '"'; index++; }
      else if (char === '"') { quoted = false; closed = true; }
      else field += char;
    } else if (char === '"' && !field && !closed) quoted = true;
    else if (char === ',' || char === '\n' || char === '\r') {
      row.push(field); field = ""; closed = false;
      if (char !== ',') {
        if (char === '\r' && input[index + 1] === '\n') index++;
        if (row.some((cell) => cell.trim())) rows.push(row);
        row = [];
      }
    } else {
      if (closed || char === '"') throw new Error("Malformed CSV quoting.");
      field += char;
    }
  }
  if (quoted) throw new Error("Unclosed CSV quote.");
  row.push(field); if (row.some((cell) => cell.trim())) rows.push(row);
  const headers = rows.shift()?.map((h) => h.replace(/^\uFEFF/, "").trim()) ?? [];
  const required = ["email", "first_name", "last_name", "admission_number", "class_section_id", "term_id", "roll_number"];
  if (required.some((key) => !headers.includes(key)) || new Set(headers).size !== headers.length) throw new Error(`Required columns: ${required.join(", ")}`);
  if (!rows.length || rows.length > 200) throw new Error("Import between 1 and 200 students at a time.");
  return rows.map((cells, index) => {
    if (cells.length !== headers.length) throw new Error(`Row ${index + 2} has the wrong number of columns.`);
    const record: Record<string, unknown> = Object.fromEntries(headers.map((key, i) => [key, cells[i]!.trim()]));
    record.roll_number = Number(record.roll_number);
    record.date_of_birth = record.date_of_birth || null;
    return record;
  });
}
