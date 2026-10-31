import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Run with the bundled Node executable. The first argument is a temporary
// workspace whose node_modules symlink points at load_workspace_dependencies.
// This generator never loads the app's spreadsheet libraries.
const workspace = process.argv[2];
if (!workspace || !path.isAbsolute(workspace)) throw new Error("Pass the absolute bundled-dependency workspace path.");
const require = createRequire(path.join(workspace, "package.json"));
const { SpreadsheetFile, Workbook } = await import(require.resolve("@oai/artifact-tool"));
const repo = fileURLToPath(new URL("../", import.meta.url));
const outputDir = path.join(repo, "outputs/01a15018-0971-7ba1-a7b6-273477532500");
const evidenceDir = path.join(repo, "artifacts/app-theme-20261020");
const publicDir = path.join(repo, "frontend/public/templates");
await Promise.all([outputDir, evidenceDir, publicDir].map(directory => fs.mkdir(directory, { recursive: true })));

const workbook = Workbook.create();
const sheet = workbook.worksheets.add("People");
sheet.getRange("A1:D11").values = [
  ["Name (required)", "Connection (optional)", "Email (optional)", "Phone (optional)"],
  ["Aarav Sharma", "Learner", "aarav.sharma@example.com", "+1 202-555-0101"],
  ["Meera Kapoor", "Employee", "meera.kapoor@example.com", "+1 202-555-0102"],
  ["Riya Patel", "Visitor", "riya.patel@example.com", "+1 202-555-0103"],
  ["Jo O’Connor", "Contractor", "jo.oconnor@example.com", "+1 202-555-0104"],
  ["李 明", "Learner", "li.ming@example.com", "+1 202-555-0105"],
  ["Amina Yusuf", "Employee", "amina.yusuf@example.com", null],
  ["Noor", null, null, null],
  ["Sofia García", "Visitor", "sofia.garcia@example.com", "+1 202-555-0108"],
  ["Arun Das", "Other", null, "+1 202-555-0109"],
  ["Sage", null, null, null],
];
sheet.showGridLines = false;
sheet.freezePanes.freezeRows(1);
sheet.getRange("A1:D11").format = {
  font: { name: "Arial", size: 11, color: "#172B24" },
  horizontalAlignment: "left",
  verticalAlignment: "center",
  wrapText: false,
  rowHeight: 28,
};
sheet.getRange("A1:D1").format = {
  fill: "#245E49",
  font: { name: "Arial", size: 11, color: "#FFFFFF", bold: true },
  horizontalAlignment: "center",
  verticalAlignment: "center",
  rowHeight: 30,
};
for (const row of [3, 5, 7, 9, 11]) sheet.getRange(`A${row}:D${row}`).format.fill = "#F0F6F2";
sheet.getRange("A1:A11").format.columnWidth = 28;
sheet.getRange("B1:B11").format.columnWidth = 26;
sheet.getRange("C1:C11").format.columnWidth = 38;
sheet.getRange("D1:D11").format.columnWidth = 24;
sheet.getRange("D2:D11").setNumberFormat("@");
workbook.recalculate();

const values = await workbook.inspect({ kind: "table", range: "People!A1:D11", include: "values,formulas", tableMaxRows: 11, tableMaxCols: 4, maxChars: 5000 });
const errors = await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!", options: { useRegex: true, maxResults: 20 }, summary: "final formula error scan", maxChars: 2000 });
const preview = await workbook.render({ sheetName: "People", range: "A1:D11", scale: 2, format: "png" });
await fs.writeFile(path.join(evidenceDir, "people-import-template-preview.png"), new Uint8Array(await preview.arrayBuffer()));
await fs.writeFile(path.join(evidenceDir, "people-import-template-inspection.json"), JSON.stringify({ values: values.ndjson, errors: errors.ndjson }, null, 2));
const output = await SpreadsheetFile.exportXlsx(workbook);
const outputPath = path.join(outputDir, "people-import-template.xlsx");
await output.save(outputPath);
await fs.copyFile(outputPath, path.join(publicDir, "people-import-template.xlsx"));
console.log(JSON.stringify({ outputPath, publicPath: path.join(publicDir, "people-import-template.xlsx"), values: values.ndjson, errors: errors.ndjson }));
