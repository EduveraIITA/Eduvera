/// <reference path="./saxen.d.ts" />
import { Parser } from "saxen";

const MAX_SOURCE_ROWS = 1000;
const MAX_COLUMNS = 20;
const MAX_SHEETS = 10;
const invalidXml = () => new Error("This workbook has unsupported XML. Save it as .xlsx or CSV and try again.");
const outsideBounds = () => new Error("Use a workbook with 1,000 source rows and 20 columns or fewer, including blank or formatted cells.");
const localName = (name: string) => name.slice(name.indexOf(":") + 1);

function rowNumber(value: string) {
  if (!/^\d{1,10}$/.test(value)) throw outsideBounds();
  const row = Number(value);
  if (!Number.isSafeInteger(row) || row < 1 || row > MAX_SOURCE_ROWS) throw outsideBounds();
  return row;
}

function cellAddress(value: string) {
  // Match actual XLSX cell references, rather than coercing signs, exponents,
  // lowercase column names or unbounded letter sequences as the reader might.
  const parts = /^([A-Z]{1,3})(\d{1,10})$/.exec(value);
  if (!parts) throw outsideBounds();
  let column = 0;
  for (const letter of parts[1]!) column = column * 26 + letter.charCodeAt(0) - 64;
  if (column < 1 || column > MAX_COLUMNS) throw outsideBounds();
  return rowNumber(parts[2]!);
}

/** Run before readWorkbook, which fills sparse cell/row gaps into dense arrays.
 * Check every parser-readable XML part, not only a conventional worksheet path:
 * relationships may point a worksheet to any XML filename. Entity decoding and
 * prefix removal deliberately match the installed reader's SAX wrapper.
 */
export function validatePeopleXlsxCoordinates(parts: ReadonlyMap<string, Uint8Array>): void {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (const [path, bytes] of parts) {
    let xml: string;
    try { xml = decoder.decode(bytes); } catch { throw invalidXml(); }
    if (!xml.trim()) throw invalidXml();
    const parser = new Parser();
    let depth = 0, sheetDataSeen = false, dataOpen = false, sourceRows = 0;
    let inRow = false, activeRow: number | undefined, lastRow = 0, cellsInRow = 0;
    let sheets = 0;
    let failure: Error | undefined;
    const fail = (error: Error) => { failure = error; throw error; };
    parser.on("error", () => fail(failure ?? invalidXml()));
    parser.on("warn", () => fail(invalidXml()));
    parser.on("attention", () => fail(invalidXml()));
    parser.on("openTag", (rawName, getAttributes, decodeEntities) => {
      if (++depth > 128) fail(invalidXml());
      const name = localName(rawName);
      // The reader discovers every named sheet in this fixed metadata part and
      // parses all of them before its result reaches our post-parse limits.
      // Count every declaration conservatively, including malformed unnamed
      // ones, so no metadata alias can defer this resource bound until later.
      if (path === "xl/workbook.xml" && name === "sheet" && ++sheets > MAX_SHEETS) {
        fail(new Error("Use a workbook with 10 sheets or fewer."));
      }
      if (name === "sheetData") {
        if (sheetDataSeen) fail(invalidXml());
        sheetDataSeen = true; dataOpen = true;
      }
      if (!sheetDataSeen || name !== "row" && name !== "c") return;
      if (!dataOpen) fail(invalidXml());
      let reference: string | undefined;
      for (const [key, value] of Object.entries(getAttributes())) {
        if (localName(key) === "r" && !key.startsWith("xmlns:")) {
          // The reader strips prefixes by mutating the attributes object while
          // enumerating it. Reject aliases instead of depending on a different
          // snapshot/overwrite order for r and prefix:r.
          if (reference !== undefined) fail(invalidXml());
          reference = decodeEntities(value);
        }
      }
      try {
        if (name === "row") {
          if (inRow) throw invalidXml();
          if (++sourceRows > MAX_SOURCE_ROWS) throw outsideBounds();
          activeRow = reference === undefined ? undefined : rowNumber(reference);
          cellsInRow = 0; inRow = true;
        } else {
          if (!inRow) throw invalidXml();
          if (++cellsInRow > MAX_COLUMNS || reference === undefined) throw outsideBounds();
          const cellRow = cellAddress(reference);
          if (activeRow !== undefined && activeRow !== cellRow) throw invalidXml();
          activeRow = cellRow;
        }
      } catch (error) { fail(error instanceof Error ? error : invalidXml()); }
    });
    parser.on("closeTag", rawName => {
      const name = localName(rawName);
      if (name === "row" && sheetDataSeen) {
        if (!inRow) fail(invalidXml());
        const completedRow = activeRow ?? lastRow + 1;
        if (completedRow > MAX_SOURCE_ROWS) fail(outsideBounds());
        if (completedRow <= lastRow) fail(invalidXml());
        lastRow = completedRow; inRow = false;
      }
      if (name === "sheetData") dataOpen = false;
      if (--depth < 0) fail(invalidXml());
    });
    try {
      const result = parser.parse(xml);
      if (failure || result instanceof Error || depth !== 0) throw failure ?? invalidXml();
    } catch (error) { throw failure ?? (error instanceof Error ? error : invalidXml()); }
  }
}
