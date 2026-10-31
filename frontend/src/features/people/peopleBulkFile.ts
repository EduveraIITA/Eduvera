import { PEOPLE_IMPORT_LIMITS, parsePeopleDelimited, validatePeopleImportSheets, type PeopleImportSheet } from "./peopleBulkImport";
import { readPeopleXlsx } from "./readPeopleXlsx";

export async function readPeopleImportFile(file: File): Promise<PeopleImportSheet[]> {
  if (file.size > PEOPLE_IMPORT_LIMITS.bytes) throw new Error("Choose a file of 1 MiB or smaller.");
  if (!/\.(xlsx|csv|tsv)$/i.test(file.name)) throw new Error("Choose .xlsx, .csv or .tsv. Legacy .xls and macro-enabled files are not supported.");
  const buffer = await file.arrayBuffer();
  if (/\.xlsx$/i.test(file.name)) {
    return readPeopleXlsx(buffer);
  }
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(buffer); }
  catch { throw new Error("Save this text file as UTF-8 CSV or TSV, then try again."); }
  return validatePeopleImportSheets([{ name: file.name, rows: parsePeopleDelimited(text, /\.tsv$/i.test(file.name) ? "\t" : ",") }]);
}
