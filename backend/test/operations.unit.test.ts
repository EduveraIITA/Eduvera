import { describe, expect, it } from "vitest";
import { date, invoiceSchema, parseStudentCsv, paymentSchema, rolloverSchema, studentSchema, termSchema } from "../src/operations/schemas.js";

const classId = "75bd2dce-2416-459a-a57b-413bb56835a6";
const termId = "75bd2dce-2416-459a-a57b-413bb56835a7";
const studentId = "75bd2dce-2416-459a-a57b-413bb56835a8";
const header = "email,first_name,last_name,admission_number,class_section_id,term_id,roll_number,date_of_birth";
describe("school operations validation", () => {
  it("parses quoted CSV, escaped quotes, BOM, and CRLF", () => {
    const rows = parseStudentCsv(`\uFEFF${header}\r\nx@example.test,"A, B","C""D",A1,${classId},${termId},1,2010-02-28\r\n`);
    expect(rows).toHaveLength(1);
    expect(studentSchema.parse(rows[0])).toMatchObject({ first_name: "A, B", last_name: 'C"D', roll_number: 1 });
  });
  it("rejects malformed quotes, missing columns, uneven rows and empty imports", () => {
    expect(() => parseStudentCsv(`${header}\nx,"oops`)).toThrow();
    expect(() => parseStudentCsv("email,name\nx,y")).toThrow();
    expect(() => parseStudentCsv(`${header}\nx,y`)).toThrow();
    expect(() => parseStudentCsv(header)).toThrow();
  });
  it("validates real calendar dates and term ordering", () => {
    expect(date.safeParse("2026-02-30").success).toBe(false);
    expect(date.safeParse("2024-02-29").success).toBe(true);
    expect(termSchema.safeParse({ academic_year: "2026-27", name: "Term 1", starts_on: "2026-04-01", ends_on: "2026-03-01" }).success).toBe(false);
  });
  it("rejects fractional, negative and excessive monetary values", () => {
    const invoice = { student_id: studentId, reference: "F1", description: "Tuition", due_on: "2026-10-01" };
    for (const amount_paise of [0, -1, 1.1, 100_000_001]) expect(invoiceSchema.safeParse({ ...invoice, amount_paise }).success).toBe(false);
    expect(invoiceSchema.parse({ ...invoice, amount_paise: 100 }).amount_paise).toBe(100);
    expect(paymentSchema.safeParse({ amount_paise: 100, method: "online", reference: "R1", idempotency_key: studentId }).success).toBe(false);
  });
  it("rejects same-term and duplicate-source promotions", () => {
    expect(rolloverSchema.safeParse({ source_term_id: termId, target_term_id: termId, mappings: [{ from_class_id: classId, to_class_id: studentId }] }).success).toBe(false);
    expect(rolloverSchema.safeParse({ source_term_id: termId, target_term_id: studentId, mappings: [{ from_class_id: classId, to_class_id: studentId }, { from_class_id: classId, to_class_id: termId }] }).success).toBe(false);
  });
});
