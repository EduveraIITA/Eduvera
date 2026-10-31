import { parsePeopleXlsxWorkbook } from "./parsePeopleXlsxWorkbook";

// A bundled same-origin worker preserves the existing strict production CSP.
// Validated XML is repacked as STORED entries to avoid nested blob workers;
// external links are not fetched.
self.onmessage = (event: MessageEvent<ArrayBuffer>) => {
  void (async () => {
    try {
      const sheets = await parsePeopleXlsxWorkbook(event.data);
      self.postMessage({ sheets });
    } catch (error) {
      self.postMessage({ error: error instanceof Error ? error.message : "This workbook could not be read. Save it as .xlsx or CSV and try again." });
    }
  })();
};
