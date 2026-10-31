import readWorkbook from "read-excel-file/universal";
import { zipSync } from "fflate";
import { validatePeopleXlsxArchive } from "./validatePeopleXlsxArchive";
import { validatePeopleXlsxCoordinates } from "./validatePeopleXlsxCoordinates";
import { validatePeopleImportSheets } from "./peopleBulkImport";

/** Bounded shared parser. Browser callers keep this inside their same-origin worker. */
export async function parsePeopleXlsxWorkbook(buffer: ArrayBuffer, reader: typeof readWorkbook = readWorkbook) {
  const xmlParts = validatePeopleXlsxArchive(buffer);
  validatePeopleXlsxCoordinates(xmlParts);
  // The public universal reader uses fflate's async unzip path, which can spawn
  // a blob worker for large DEFLATE entries. Repack only verified XML as STORED
  // entries so that path stays synchronous inside our existing same-origin
  // worker; do not weaken CSP or import private reader internals.
  const stored = zipSync(Object.fromEntries(xmlParts), { level: 0 });
  const storedBuffer = stored.buffer.slice(stored.byteOffset, stored.byteOffset + stored.byteLength);
  const workbook = await reader(storedBuffer);
  return validatePeopleImportSheets(workbook.map(sheet => ({ name: sheet.sheet, rows: sheet.data })));
}
