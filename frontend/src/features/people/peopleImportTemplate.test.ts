import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePeopleXlsxWorkbook } from "./parsePeopleXlsxWorkbook";
import { guessPeopleImportMapping, mapPeopleImportRows } from "./peopleBulkImport";

describe("bundled people import template", () => {
  it("imports exactly ten synthetic examples with required/optional headers and preserved text contacts", async () => {
    const bytes = readFileSync(join(process.cwd(), "public/templates/people-import-template.xlsx"));
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const sheets = await parsePeopleXlsxWorkbook(buffer);
    expect(sheets).toHaveLength(1);
    const sheet = sheets[0]!;
    expect(sheet.name).toBe("People");
    expect(sheet.rows).toEqual([
      ["Name (required)", "Connection (optional)", "Email (optional)", "Phone (optional)"],
      ["Aarav Sharma", "Learner", "aarav.sharma@example.com", "+1 202-555-0101"],
      ["Meera Kapoor", "Employee", "meera.kapoor@example.com", "+1 202-555-0102"],
      ["Riya Patel", "Visitor", "riya.patel@example.com", "+1 202-555-0103"],
      ["Jo O’Connor", "Contractor", "jo.oconnor@example.com", "+1 202-555-0104"],
      ["李 明", "Learner", "li.ming@example.com", "+1 202-555-0105"],
      ["Amina Yusuf", "Employee", "amina.yusuf@example.com", null],
      ["Noor", null, null, null],
      ["Sofia García", "Visitor", "sofia.garcia@example.com", "+1 202-555-0108"],
      ["Arun Das", "Other", null, "+1 202-555-0109"],
      ["Sage", null, null, null],
    ]);
    const mapping = guessPeopleImportMapping(sheet);
    expect(mapping).toEqual({ nameColumn: 0, connectionColumn: 1, emailColumn: 2, phoneColumn: 3, hasHeader: true });
    expect(mapPeopleImportRows(sheet, mapping)).toEqual([
      { row: 2, name: "Aarav Sharma", affiliation: "learner", contact_email: "aarav.sharma@example.com", contact_phone: "+1 202-555-0101", errors: [], repeated: false },
      { row: 3, name: "Meera Kapoor", affiliation: "worker", contact_email: "meera.kapoor@example.com", contact_phone: "+1 202-555-0102", errors: [], repeated: false },
      { row: 4, name: "Riya Patel", affiliation: "visitor", contact_email: "riya.patel@example.com", contact_phone: "+1 202-555-0103", errors: [], repeated: false },
      { row: 5, name: "Jo O’Connor", affiliation: "contractor", contact_email: "jo.oconnor@example.com", contact_phone: "+1 202-555-0104", errors: [], repeated: false },
      { row: 6, name: "李 明", affiliation: "learner", contact_email: "li.ming@example.com", contact_phone: "+1 202-555-0105", errors: [], repeated: false },
      { row: 7, name: "Amina Yusuf", affiliation: "worker", contact_email: "amina.yusuf@example.com", errors: [], repeated: false },
      { row: 8, name: "Noor", errors: [], repeated: false },
      { row: 9, name: "Sofia García", affiliation: "visitor", contact_email: "sofia.garcia@example.com", contact_phone: "+1 202-555-0108", errors: [], repeated: false },
      { row: 10, name: "Arun Das", affiliation: "other", contact_phone: "+1 202-555-0109", errors: [], repeated: false },
      { row: 11, name: "Sage", errors: [], repeated: false },
    ]);
  });
});
