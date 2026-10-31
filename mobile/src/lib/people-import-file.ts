import { parsePeopleDelimited, validatePeopleImportSheets } from '../../../packages/contracts/src/peopleBulkImport';
import { parsePeopleXlsxWorkbook } from '../../../packages/contracts/src/parsePeopleXlsxWorkbook';
import { pickPrivateFile, readPrivateFile, removePrivateFile } from './private-file';
export async function pickPeopleImport() {
  const file = await pickPrivateFile(['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv', 'text/tab-separated-values'], 1024 * 1024);
  if (!file) return null;
  try {
    if (!/\.(xlsx|csv|tsv)$/i.test(file.name)) throw new Error('Choose .xlsx, .csv or .tsv. Legacy .xls and macro-enabled files are not supported.');
    const {bytes} = await readPrivateFile(file.uri, 1024 * 1024);
    const sheets = /\.xlsx$/i.test(file.name) ? await parsePeopleXlsxWorkbook(bytes.slice().buffer) : validatePeopleImportSheets([{name:file.name,rows:parsePeopleDelimited(new TextDecoder('utf-8',{fatal:true}).decode(bytes),/\.tsv$/i.test(file.name) ? '\t' : ',')}]);
    return { name:file.name, sheets };
  } finally { await removePrivateFile(file.uri).catch(()=>{}); }
}
