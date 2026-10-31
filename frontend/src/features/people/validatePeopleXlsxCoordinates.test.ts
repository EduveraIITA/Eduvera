import { describe, expect, it } from "vitest";
import { validatePeopleXlsxCoordinates } from "./validatePeopleXlsxCoordinates";

const parts = (body: string, path = "xl/worksheets/sheet1.xml") => new Map([[path, new TextEncoder().encode(body)]]);
const sheet = (body: string) => `<worksheet><sheetData>${body}</sheetData></worksheet>`;

describe("Excel coordinates before dense parsing", () => {
  it("bounds workbook sheet declarations before the reader parses every sheet", () => {
    const metadata = (count: number) => `<workbook xmlns:x="urn:sheet"><sheets>${Array.from({ length: count }, (_, index) => `<x:sheet name="People ${index + 1}"/>`).join("")}</sheets></workbook>`;
    expect(() => validatePeopleXlsxCoordinates(parts(metadata(10), "xl/workbook.xml"))).not.toThrow();
    expect(() => validatePeopleXlsxCoordinates(parts(metadata(11), "xl/workbook.xml"))).toThrow(/10 sheets/);
  });

  it("accepts bounded sparse, implicit and entity-encoded coordinates without inspecting text as XML", () => {
    expect(() => validatePeopleXlsxCoordinates(parts(sheet('<row r="1"><c r="A&#49;"/></row><row r="1000"><c r="T1000"/></row>')))).not.toThrow();
    expect(() => validatePeopleXlsxCoordinates(parts(sheet('<row><c r="A1"/></row><row/><row><c r="B3"/></row>')))).not.toThrow();
    expect(() => validatePeopleXlsxCoordinates(parts(sheet('<!-- <row r="999999999"/> --><row r="1"><c r="A1"><is><t><![CDATA[<row r="999999999"/>]]></t></is></c></row>')))).not.toThrow();
  });

  it.each([
    '<row r="2001"><c r="A1"/></row>',
    '<row r="1"><c r="A2001"/></row>',
    '<row r="1"><c r="U1"/></row>',
    '<row r="1"><c r="XFD1"/></row>',
    '<row r="&#49;000001"><c r="A1"/></row>',
    '<row r="1"><c r="A&#49;000001"/></row>',
    '<row r="1e9"/>', '<row r="Infinity"/>', '<row r="0"/>', '<row r="-1"/>',
    '<row r="1.5"/>', '<row r="1"><c r="a1"/></row>',
    '<row r="1000"/><row/>',
  ])("rejects sparse or malformed addresses before the reader can fill arrays: %s", body => {
    expect(() => validatePeopleXlsxCoordinates(parts(sheet(body)))).toThrow(/1,000 source rows/);
  });

  it("decodes prefixed attributes and validates every XML path that the reader could use", () => {
    const xml = '<x:worksheet xmlns:x="urn:test"><x:sheetData><x:row x:r="1001"><x:c x:r="A1"/></x:row></x:sheetData></x:worksheet>';
    expect(() => validatePeopleXlsxCoordinates(parts(xml, "xl/unusual-linked-sheet.xml"))).toThrow(/1,000 source rows/);
    expect(() => validatePeopleXlsxCoordinates(parts(xml, "custom.xml.rels"))).toThrow(/1,000 source rows/);
  });

  it.each([
    '<row r="1"><c x:r="A999999999" r="A1"/></row>',
    '<row r="1"><c r="A1" x:r="A999999999"/></row>',
    '<row x:r="999999999" r="1"><c r="A1"/></row>',
    '<row r="1" x:r="999999999"><c r="A1"/></row>',
  ])("rejects attribute aliases independent of the reader's mutable enumeration order: %s", body => {
    expect(() => validatePeopleXlsxCoordinates(parts(`<worksheet xmlns:x="urn:alias"><sheetData>${body}</sheetData></worksheet>`))).toThrow(/unsupported XML/);
  });

  it("bounds implicit row/cell counts, checks row/cell agreement and rejects malformed structure", () => {
    expect(() => validatePeopleXlsxCoordinates(parts(sheet("<row/>".repeat(1001))))).toThrow(/1,000 source rows/);
    expect(() => validatePeopleXlsxCoordinates(parts(sheet(`<row>${'<c r="A1"/>'.repeat(21)}</row>`)))).toThrow(/20 columns/);
    expect(() => validatePeopleXlsxCoordinates(parts(sheet('<row r="1"><c r="A2"/></row>')))).toThrow(/unsupported XML/);
    expect(() => validatePeopleXlsxCoordinates(parts(sheet('<row><row/></row>')))).toThrow(/unsupported XML/);
    expect(() => validatePeopleXlsxCoordinates(parts('<worksheet><sheetData/><row r="1"/></worksheet>'))).toThrow(/unsupported XML/);
    expect(() => validatePeopleXlsxCoordinates(parts('<worksheet><sheetData/><sheetData/></worksheet>'))).toThrow(/unsupported XML/);
    expect(() => validatePeopleXlsxCoordinates(parts('<worksheet><sheetData><row></sheetData></worksheet>'))).toThrow(/unsupported XML/);
  });

  it("rejects DTDs, malformed attributes, invalid encoding and excessive nesting", () => {
    expect(() => validatePeopleXlsxCoordinates(parts('<!DOCTYPE worksheet [<!ENTITY x "1">]><worksheet/>'))).toThrow(/unsupported XML/);
    expect(() => validatePeopleXlsxCoordinates(parts(sheet('<row r=1/>')))).toThrow(/unsupported XML/);
    expect(() => validatePeopleXlsxCoordinates(new Map([["sheet.xml", new Uint8Array([0xff])]]))).toThrow(/unsupported XML/);
    expect(() => validatePeopleXlsxCoordinates(parts("<x>".repeat(129) + "</x>".repeat(129)))).toThrow(/unsupported XML/);
  });
});
