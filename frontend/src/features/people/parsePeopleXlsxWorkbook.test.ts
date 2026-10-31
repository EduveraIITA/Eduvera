import { afterEach, describe, expect, it, vi } from "vitest";
import { strToU8, zipSync } from "fflate";
import readWorkbook from "read-excel-file/universal";
import { parsePeopleXlsxWorkbook } from "./parsePeopleXlsxWorkbook";
import { validatePeopleXlsxArchive } from "./validatePeopleXlsxArchive";

vi.mock("read-excel-file/universal", async original => ({ default: vi.fn((await original<typeof import("read-excel-file/universal")>()).default) }));
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

function workbook(rows: string, worksheetPath = "worksheets/sheet1.xml", comment = "", sheetCount = 1) {
  const sheetParts = Array.from({ length: sheetCount }, (_, index) => ({
    id: index + 1,
    path: index === 0 ? worksheetPath : `worksheets/sheet${index + 1}.xml`,
  }));
  const files = {
    "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
    "_rels/.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    "xl/workbook.xml": `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetParts.map(({ id }) => `<sheet name="${id === 1 ? "People" : `People ${id}`}" sheetId="${id}" r:id="rId${id}"/>`).join("")}</sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetParts.map(({ id, path }) => `<Relationship Id="rId${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${path}"/>`).join("")}</Relationships>`,
    ...Object.fromEntries(sheetParts.map(({ path }) => [`xl/${path}`, `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${comment}<sheetData>${rows}</sheetData></worksheet>`])),
  };
  const bytes = zipSync(Object.fromEntries(Object.entries(files).map(([path, xml]) => [path, strToU8(xml)])));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

describe("real bounded workbook worker pipeline", () => {
  it("reads a genuine small zipped workbook while retaining full names and source row positions", async () => {
    const buffer = workbook('<row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>María  del Pilar 李</t></is></c></row>');
    expect(buffer.byteLength).toBeLessThan(2000);
    expect(validatePeopleXlsxArchive(buffer).has("xl/worksheets/sheet1.xml")).toBe(true);
    await expect(parsePeopleXlsxWorkbook(buffer, readWorkbook)).resolves.toEqual([{ name: "People", rows: [["Name"], [null], ["María  del Pilar 李"]] }]);
    expect(readWorkbook).toHaveBeenCalledOnce();
  });

  it("rejects an eleven-sheet workbook before calling the dense reader", async () => {
    const buffer = workbook('<row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c></row>', undefined, "", 11);
    expect(buffer.byteLength).toBeLessThan(10_000);
    expect(() => validatePeopleXlsxArchive(buffer)).not.toThrow();
    await expect(parsePeopleXlsxWorkbook(buffer, readWorkbook)).rejects.toThrow(/10 sheets/);
    expect(readWorkbook).not.toHaveBeenCalled();
  });

  it.each([
    ['<row r="2001"><c r="A2001" t="inlineStr"><is><t>Far row</t></is></c></row>', "worksheets/sheet1.xml"],
    ['<row r="1"><c r="U1" t="inlineStr"><is><t>Far column</t></is></c></row>', "unusual-linked-sheet.xml"],
    ['<row r="1"><c r="A&#50;001" t="inlineStr"><is><t>Encoded row</t></is></c></row>', "worksheets/sheet1.xml"],
  ])("rejects a tiny sparse workbook before calling the dense reader", async (rows, path) => {
    const buffer = workbook(rows, path);
    expect(buffer.byteLength).toBeLessThan(2000);
    expect(() => validatePeopleXlsxArchive(buffer)).not.toThrow();
    await expect(parsePeopleXlsxWorkbook(buffer, readWorkbook)).rejects.toThrow(/1,000 source rows/);
    expect(readWorkbook).not.toHaveBeenCalled();
  });

  it("reads a large compressed XML entry using only internal STORED entries and no nested Worker", async () => {
    const nestedWorker = vi.fn(() => { throw new Error("A nested blob worker is forbidden."); });
    vi.stubGlobal("Worker", nestedWorker);
    const buffer = workbook('<row r="1"><c r="A1" t="inlineStr"><is><t>Full Name</t></is></c></row>', undefined, `<!--${"expanded comment ".repeat(40_000)}-->`);
    expect(buffer.byteLength).toBeLessThan(10_000);
    await expect(parsePeopleXlsxWorkbook(buffer, readWorkbook)).resolves.toEqual([{ name: "People", rows: [["Full Name"]] }]);
    const input = vi.mocked(readWorkbook).mock.calls[0]![0];
    expect(input).toBeInstanceOf(ArrayBuffer);
    const stored = input as ArrayBuffer;
    expect(stored.byteLength).toBeGreaterThan(524_288);
    const view = new DataView(stored);
    let offset = 0, entries = 0;
    while (offset + 30 < stored.byteLength && view.getUint32(offset, true) === 0x04034b50) {
      expect(view.getUint16(offset + 8, true)).toBe(0);
      offset += 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true) + view.getUint32(offset + 18, true);
      entries++;
    }
    expect(entries).toBe(4); // The reader ignores _rels/.rels, unlike workbook.xml.rels.
    expect(nestedWorker).not.toHaveBeenCalled();
  });
});
