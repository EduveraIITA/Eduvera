import { describe, expect, it } from "vitest";
import { guessPeopleImportMapping, mapPeopleImportRows, parsePeopleDelimited, parsePeoplePaste, validatePeopleImportSheets } from "./peopleBulkImport";
describe("bounded neutral people import parsing", () => {
  it("reads quoted CSV, escaped quotes, BOM and CRLF without splitting a full name", () => {
    const rows = parsePeopleDelimited('\uFEFFName,Connection\r\n"Smith, Jo",Employee\r\n"A ""Quoted"" Name",Learner\r\n', ",");
    const sheet = { name: "People", rows };
    expect(mapPeopleImportRows(sheet, guessPeopleImportMapping(sheet))).toEqual([
      { row: 2, name: "Smith, Jo", affiliation: "worker", errors: [], repeated: false },
      { row: 3, name: 'A "Quoted" Name', affiliation: "learner", errors: [], repeated: false },
    ]);
  });
  it("treats pasted comma names as names and spreadsheet tabs as columns", () => {
    expect(parsePeoplePaste("Smith, Jo\nAarav Sharma")).toEqual([["Smith, Jo"], ["Aarav Sharma"]]);
    expect(parsePeoplePaste("Name\tConnection\nAarav\tLearner")).toEqual([["Name", "Connection"], ["Aarav", "Learner"]]);
  });
  it("rejects broken quotations and finite column/row/sheet limits before writes", () => {
    expect(() => parsePeopleDelimited('Name\n"Unclosed', ",")).toThrow(/not closed/);
    expect(() => parsePeopleDelimited('Name\nBad"quote', ",")).toThrow(/quotation/);
    expect(() => parsePeopleDelimited(Array(21).fill("value").join(","), ",")).toThrow(/20 columns/);
    expect(() => parsePeoplePaste(Array(102).fill("A person").join("\n"))).toThrow(/100 people/);
    expect(() => validatePeopleImportSheets(Array.from({ length: 11 }, (_, i) => ({ name: String(i), rows: [["Name"]] })))).toThrow(/10 sheets/);
  });
  it("requires text names, leaves unknown connections invalid and never invents identity components", () => {
    const rows = mapPeopleImportRows({ name: "Sheet", rows: [[42], ["", "Visitor"], ["=CONCAT(A1,B1)"], ["Aarav Sharma", "Student"], ["Nguyễn Thị Minh", "Visitor"]] }, { nameColumn: 0, connectionColumn: 1, hasHeader: false });
    expect(rows[0]?.errors).toEqual(["Choose a text name for this row."]);
    expect(rows[1]?.errors.length).toBe(1);
    expect(rows[2]?.errors[0]).toMatch(/formula expression/);
    expect(rows[3]?.errors[0]).toMatch(/Connection must/);
    expect(rows[4]).toMatchObject({ name: "Nguyễn Thị Minh", affiliation: "visitor", errors: [] });
  });
  it("marks repeated names for explicit decisions without collapsing rows or choosing existing people", () => {
    const rows = mapPeopleImportRows({ name: "Sheet", rows: [["  Aarav  Sharma "], ["aarav sharma"], ["Different Person"]] }, { nameColumn: 0, connectionColumn: null, hasHeader: false });
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.repeated)).toEqual([true, true, false]);
    expect(rows[0]?.name).toBe("Aarav  Sharma");
    expect(rows.every((row) => !Object.hasOwn(row, "person_id"))).toBe(true);
  });
  it("supports an explicit no-header mapping and rejects 101 actual people", () => {
    const sheet = { name: "Sheet", rows: [["Visitor", "Ravi Kumar"]] };
    expect(mapPeopleImportRows(sheet, { nameColumn: 1, connectionColumn: 0, hasHeader: false })[0]).toMatchObject({ row: 1, name: "Ravi Kumar", affiliation: "visitor" });
    expect(() => mapPeopleImportRows({ name: "Sheet", rows: Array.from({ length: 101 }, () => ["Person"]) }, { nameColumn: 0, connectionColumn: null, hasHeader: false })).toThrow(/100 people/);
  });
  it("retains original source row numbers through blank lines and Windows/old-Mac line endings", () => {
    const sheet = { name: "Paste", rows: parsePeoplePaste("\r\nName\r\n\r\nO'Connor, Jo\r\n\r\n李 明\rLast Person") };
    expect(mapPeopleImportRows(sheet, guessPeopleImportMapping(sheet)).map(({ row, name }) => ({ row, name }))).toEqual([{ row: 4, name: "O'Connor, Jo" }, { row: 6, name: "李 明" }, { row: 7, name: "Last Person" }]);
    expect(() => mapPeopleImportRows(sheet, { nameColumn: 0, connectionColumn: 0, hasHeader: true })).toThrow(/different columns/);
  });
  it("recognizes required/optional template headers and retains optional saved text contacts", () => {
    const sheet = { name: "People", rows: [["Name (required)", "Connection (optional)", "Email (optional)", "Phone (optional)"], ["Amina Yusuf", "Employee", " Amina.Yusuf@example.com ", " +1 202-555-0101 "], ["Name only", "  ", null, "  "]] };
    const mapping = guessPeopleImportMapping(sheet);
    expect(mapping).toEqual({ nameColumn: 0, connectionColumn: 1, emailColumn: 2, phoneColumn: 3, hasHeader: true });
    expect(mapPeopleImportRows(sheet, mapping)).toEqual([
      { row: 2, name: "Amina Yusuf", affiliation: "worker", contact_email: "Amina.Yusuf@example.com", contact_phone: "+1 202-555-0101", errors: [], repeated: false },
      { row: 3, name: "Name only", errors: [], repeated: false },
    ]);
    expect(guessPeopleImportMapping({ name: "Aliases", rows: [[" Full Name (REQUIRED) ", "Contact Email (optional)", "Contact Phone (optional)"]] })).toEqual({ nameColumn: 0, connectionColumn: null, emailColumn: 1, phoneColumn: 2, hasHeader: true });
  });
  it("rejects numeric phones, malformed/oversized emails and literal phone formulas without converting values", () => {
    const sheet = { name: "Contacts", rows: [["Numeric phone", "valid@example.com", 123456], ["Bad email", "not-an-email", "+00012"], ["Long email", `${"a".repeat(243)}@example.com`, ""], ["Formula phone", "", "=A1"], ["Numeric email", 42, null], ["Long phone", "", "1".repeat(33)]] };
    const rows = mapPeopleImportRows(sheet, { nameColumn: 0, connectionColumn: null, emailColumn: 1, phoneColumn: 2, hasHeader: false });
    expect(rows[0]).toMatchObject({ contact_email: "valid@example.com", errors: [expect.stringMatching(/Save phone numbers as text/)] });
    expect(rows[0]).not.toHaveProperty("contact_phone");
    expect(rows[1]).toMatchObject({ contact_phone: "+00012", errors: [expect.stringMatching(/valid email/)] });
    expect(rows[2]?.errors).toEqual([expect.stringMatching(/254 characters/)]);
    expect(rows[3]?.errors).toEqual([expect.stringMatching(/not a formula expression/)]);
    expect(rows[4]?.errors).toEqual([expect.stringMatching(/saved text email/)]);
    expect(rows[5]?.errors).toEqual([expect.stringMatching(/32 characters/)]);
  });
  it("never maps one source column into two person fields and keeps old name-only mappings valid", () => {
    const sheet = { name: "Old", rows: [["Name only", "person@example.com"]] };
    expect(() => mapPeopleImportRows(sheet, { nameColumn: 0, connectionColumn: null, emailColumn: 1, phoneColumn: 1, hasHeader: false })).toThrow(/different columns/);
    expect(mapPeopleImportRows(sheet, { nameColumn: 0, connectionColumn: null, hasHeader: false })).toEqual([{ row: 1, name: "Name only", errors: [], repeated: false }]);
  });
});
