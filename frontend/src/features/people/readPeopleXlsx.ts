import type { PeopleImportSheet } from "./peopleBulkImport";

/** Parsing is isolated from UI responsiveness and never changes the site's CSP. */
export function readPeopleXlsx(buffer: ArrayBuffer): Promise<PeopleImportSheet[]> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try { worker = new Worker(new URL("./peopleXlsx.worker.ts", import.meta.url), { type: "module" }); }
    catch { reject(new Error("Excel reading is not available in this browser. Use CSV or paste the names instead.")); return; }
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error("This workbook took too long to read. Use a smaller sheet, CSV or paste the names."));
    }, 15_000);
    const stop = () => { clearTimeout(timer); worker.terminate(); };
    worker.onmessage = (event: MessageEvent<{ sheets?: PeopleImportSheet[]; error?: string }>) => {
      stop();
      if (event.data.error) reject(new Error(event.data.error));
      else if (Array.isArray(event.data.sheets)) resolve(event.data.sheets);
      else reject(new Error("This workbook could not be read. Try CSV or paste the names instead."));
    };
    worker.onerror = () => { stop(); reject(new Error("This workbook could not be read. Try CSV or paste the names instead.")); };
    worker.onmessageerror = () => { stop(); reject(new Error("This workbook could not be read. Try CSV or paste the names instead.")); };
    try { worker.postMessage(buffer, [buffer]); }
    catch { stop(); reject(new Error("This workbook could not be opened. Choose it again or try CSV.")); }
  });
}
