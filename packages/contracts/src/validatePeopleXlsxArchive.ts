import { Unzip, UnzipInflate } from "fflate";

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_EXPANDED_BYTES = 8 * 1024 * 1024;
const MAX_ENTRIES = 256;
const invalid = () => new Error("This is not a supported Excel workbook. Save it as .xlsx or CSV and try again.");

/** Check both declared and actually inflated sizes before the workbook parser runs.
 * Small input chunks bound each inflater allocation. Only XML accepted by the
 * workbook reader is retained for coordinate preflight, under the same 8 MiB cap.
 * This is an import resource guard, not a general antivirus or Office validator.
 */
export function validatePeopleXlsxArchive(buffer: ArrayBuffer): ReadonlyMap<string, Uint8Array> {
  if (buffer.byteLength > MAX_FILE_BYTES) throw new Error("Choose a file smaller than 1 MB.");
  if (buffer.byteLength < 22) throw invalid();
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (view.getUint32(offset, true) === 0x06054b50 && offset + 22 + view.getUint16(offset + 20, true) === bytes.length) {
      end = offset; break;
    }
  }
  if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) throw invalid();
  const count = view.getUint16(end + 10, true);
  const directorySize = view.getUint32(end + 12, true);
  const directoryStart = view.getUint32(end + 16, true);
  if (!count || count > MAX_ENTRIES || view.getUint16(end + 8, true) !== count
    || directoryStart === 0xffffffff || directorySize === 0xffffffff || directoryStart + directorySize !== end) throw invalid();
  const expected = new Map<string, number>();
  let cursor = directoryStart;
  let declaredTotal = 0;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50) throw invalid();
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const compressed = view.getUint32(cursor + 20, true);
    const expanded = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const next = cursor + 46 + nameLength + view.getUint16(cursor + 30, true) + view.getUint16(cursor + 32, true);
    const local = view.getUint32(cursor + 42, true);
    if (flags & 1 || ![0, 8].includes(method) || compressed === 0xffffffff || expanded === 0xffffffff
      || view.getUint16(cursor + 34, true) || next > end || local + 30 > directoryStart
      || view.getUint32(local, true) !== 0x04034b50) throw invalid();
    const name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    if (!name || expected.has(name) || /(?:^|\/)vbaProject(?:Signature)?\.bin$/i.test(name)) throw invalid();
    expected.set(name, expanded);
    declaredTotal += expanded;
    if (declaredTotal > MAX_EXPANDED_BYTES) throw new Error("This workbook is too large to read safely. Copy the names into a smaller sheet or paste a list.");
    cursor = next;
  }
  if (cursor !== end || !expected.has("[Content_Types].xml")) throw invalid();

  let actualTotal = 0;
  let failure: Error | undefined;
  const opened = new Set<string>();
  const completed = new Set<string>();
  const xmlParts = new Map<string, Uint8Array>();
  const unzip = new Unzip(file => {
    if (!expected.has(file.name) || opened.has(file.name)) { failure = invalid(); file.terminate(); return; }
    opened.add(file.name);
    let fileBytes = 0;
    const keepXml = file.name.endsWith(".xml") || file.name.endsWith(".xml.rels");
    let chunks: Uint8Array[] = [];
    file.ondata = (error, data, final) => {
      if (error) failure = invalid();
      if (failure) { file.terminate(); return; }
      actualTotal += data.length;
      fileBytes += data.length;
      if (actualTotal > MAX_EXPANDED_BYTES || fileBytes > expected.get(file.name)!) {
        failure = new Error("This workbook expands beyond its safe size limit. Save a smaller .xlsx or CSV file.");
        file.terminate(); return;
      }
      if (keepXml && data.length) chunks.push(data.slice());
      if (final) {
        if (fileBytes !== expected.get(file.name)) failure = invalid();
        if (keepXml && !failure) {
          const content = new Uint8Array(fileBytes);
          let offset = 0;
          for (const chunk of chunks) { content.set(chunk, offset); offset += chunk.length; }
          xmlParts.set(file.name, content);
        }
        chunks = [];
        completed.add(file.name);
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  try {
    for (let offset = 0; offset < bytes.length; offset += 256) {
      unzip.push(bytes.subarray(offset, Math.min(offset + 256, bytes.length)), offset + 256 >= bytes.length);
      if (failure) throw failure;
    }
  } catch (error) {
    throw failure ?? (error instanceof Error && error.message.includes("size limit") ? error : invalid());
  }
  if (completed.size !== expected.size) throw invalid();
  return xmlParts;
}
