export const PEOPLE_IMPORT_LIMITS = { bytes: 1024 * 1024, people: 100, columns: 20, sheets: 10 } as const;
export type PeopleImportSheet = { name: string; rows: unknown[][] };
export type PeopleImportConnection = "learner" | "worker" | "contractor" | "visitor" | "other";
export type PeopleImportRow = { row: number; name: string; affiliation?: PeopleImportConnection; contact_email?: string; contact_phone?: string; errors: string[]; repeated: boolean };
export type PeopleImportMapping = { nameColumn: number; connectionColumn: number | null; emailColumn?: number | null; phoneColumn?: number | null; hasHeader: boolean };

export function parsePeopleDelimited(text: string, delimiter: "," | "\t"): unknown[][] {
  if (new TextEncoder().encode(text).byteLength > PEOPLE_IMPORT_LIMITS.bytes) throw new Error("Use 1 MiB or less of text.");
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false, closed = false;
  const finishCell = () => { row.push(cell); cell = ""; closed = false; if (row.length > PEOPLE_IMPORT_LIMITS.columns) throw new Error("Use a file with 20 columns or fewer."); };
  const finishRow = () => { finishCell(); rows.push(row); row = []; if (rows.length > 1000) throw new Error("Use 1,000 source rows or fewer, including blank rows."); };
  const input = text.replace(/^\uFEFF/, "");
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!;
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') { quoted = false; closed = true; }
      else cell += char;
    } else if (char === delimiter) finishCell();
    else if (char === "\n" || char === "\r") { if (char === "\r" && input[index + 1] === "\n") index += 1; finishRow(); }
    else if (char === '"') { if (cell || closed) throw new Error("Check the file's quotation marks, then try again."); quoted = true; }
    else if (closed && char.trim()) throw new Error("Check the file's quotation marks, then try again.");
    else if (!closed) cell += char;
  }
  if (quoted) throw new Error("A quoted cell was not closed. Check the file and try again.");
  if (cell || row.length || closed) finishRow();
  if (rows.filter((cells) => cells.some((value) => value.trim())).length > PEOPLE_IMPORT_LIMITS.people + 1) throw new Error("Import up to 100 people at a time.");
  return rows;
}

export function parsePeoplePaste(text: string): unknown[][] {
  if (new TextEncoder().encode(text).byteLength > PEOPLE_IMPORT_LIMITS.bytes) throw new Error("Paste 1 MiB or less of text.");
  if (text.includes("\t")) return parsePeopleDelimited(text, "\t");
  const rows = text.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/).map((line) => [line]);
  if (rows.length > 1000) throw new Error("Use 1,000 source rows or fewer, including blank rows.");
  if (rows.filter((cells) => cells.some((value) => value.trim())).length > PEOPLE_IMPORT_LIMITS.people + 1) throw new Error("Add up to 100 people at a time.");
  return rows;
}

export function validatePeopleImportSheets(sheets: PeopleImportSheet[]): PeopleImportSheet[] {
  if (!sheets.length) throw new Error("This file has no readable sheets.");
  if (sheets.length > PEOPLE_IMPORT_LIMITS.sheets) throw new Error("Use a workbook with 10 sheets or fewer.");
  return sheets.map((sheet) => {
    const rows = sheet.rows;
    if (rows.length > 1000) throw new Error("Use 1,000 source rows or fewer, including blank rows.");
    if (rows.filter(hasPeopleImportValues).length > PEOPLE_IMPORT_LIMITS.people + 1) throw new Error("Use a sheet with up to 100 people, plus an optional header.");
    if (rows.some((row) => row.length > PEOPLE_IMPORT_LIMITS.columns)) throw new Error("Use a sheet with 20 columns or fewer.");
    return { ...sheet, rows };
  });
}

export function guessPeopleImportMapping(sheet: PeopleImportSheet): PeopleImportMapping {
  const header = sheet.rows.find(hasPeopleImportValues)?.map((value) => typeof value === "string" ? value.trim().replace(/\s*\((?:required|optional)\)\s*$/i, "").trim().replace(/\s+/g, " ").toLowerCase() : "") ?? [];
  const nameColumn = header.findIndex((value) => ["name", "full name", "person name"].includes(value));
  const connectionColumn = header.findIndex((value) => ["connection", "connection to campus", "affiliation"].includes(value));
  const emailColumn = header.findIndex((value) => ["email", "contact email", "contactemail", "contact_email"].includes(value));
  const phoneColumn = header.findIndex((value) => ["phone", "contact phone", "contactphone", "contact_phone"].includes(value));
  return { nameColumn: Math.max(0, nameColumn), connectionColumn: connectionColumn >= 0 ? connectionColumn : null, emailColumn: emailColumn >= 0 ? emailColumn : null, phoneColumn: phoneColumn >= 0 ? phoneColumn : null, hasHeader: nameColumn >= 0 };
}

export function hasPeopleImportValues(cells: unknown[]) { return cells.some((cell) => cell !== null && cell !== undefined && (typeof cell !== "string" || Boolean(cell.trim()))); }
export function peopleImportCellText(value: unknown): string { if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value); if (value instanceof Date) return Number.isNaN(value.getTime()) ? "Invalid date" : value.toISOString(); return ""; }
export function normalizePeopleImportName(name: string) { return name.trim().replace(/\s+/g, " ").toLowerCase(); }

export function mapPeopleImportRows(sheet: PeopleImportSheet, mapping: PeopleImportMapping): PeopleImportRow[] {
  const mappedColumns = [mapping.nameColumn, mapping.connectionColumn, mapping.emailColumn, mapping.phoneColumn].filter((column): column is number => column !== null && column !== undefined);
  if (new Set(mappedColumns).size !== mappedColumns.length) throw new Error("Choose different columns for each mapped field.");
  const source = sheet.rows.map((cells, index) => ({ cells, index })).filter(({ cells }) => hasPeopleImportValues(cells));
  if (mapping.hasHeader) source.shift();
  if (source.length > PEOPLE_IMPORT_LIMITS.people) throw new Error("Add up to 100 people at a time.");
  const connections: Record<string, PeopleImportConnection> = { learner: "learner", employee: "worker", worker: "worker", contractor: "contractor", visitor: "visitor", other: "other" };
  const rows = source.map(({ cells, index }) => {
    const errors: string[] = [];
    const raw = cells[mapping.nameColumn];
    const name = typeof raw === "string" ? raw.trim() : peopleImportCellText(raw);
    if (typeof raw !== "string" || !name) errors.push("Choose a text name for this row.");
    else if (name.length > 150) errors.push("Use a name of 150 characters or fewer.");
    else if ([...name].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) errors.push("Use one name per row, without control characters.");
    else if (name.startsWith("=")) errors.push("Use a saved text name, not a formula expression.");
    const connection = mapping.connectionColumn === null ? null : cells[mapping.connectionColumn];
    let affiliation: PeopleImportConnection | undefined;
    if (connection !== null && connection !== undefined && (typeof connection !== "string" || Boolean(connection.trim()))) {
      affiliation = typeof connection === "string" ? connections[connection.trim().toLowerCase()] : undefined;
      if (!affiliation) errors.push("Connection must be Learner, Employee, Contractor, Visitor or Other; or leave it blank.");
    }
    const contact: { contact_email?: string; contact_phone?: string } = {};
    const email = mapping.emailColumn === null || mapping.emailColumn === undefined ? null : cells[mapping.emailColumn];
    const phone = mapping.phoneColumn === null || mapping.phoneColumn === undefined ? null : cells[mapping.phoneColumn];
    if (email !== null && email !== undefined && email !== "") {
      if (typeof email !== "string") errors.push("Use a saved text email address, or leave it blank.");
      else if (email.trim()) {
        const value = email.trim();
        // Matches the owning create/profile endpoint's current z.email() validation.
        const emailPattern = /^(?:[A-Za-z0-9_'+-]+\.)*[A-Za-z0-9_'+-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/;
        if (value.length > 254 || !emailPattern.test(value)) errors.push("Use a valid email address of 254 characters or fewer, or leave it blank.");
        else contact.contact_email = value;
      }
    }
    if (phone !== null && phone !== undefined && phone !== "") {
      if (typeof phone !== "string") errors.push("Save phone numbers as text to preserve + signs and leading zeroes, or leave them blank.");
      else if (phone.trim()) {
        const value = phone.trim();
        if (value.length > 32) errors.push("Use a phone number of 32 characters or fewer.");
        else if (value.startsWith("=")) errors.push("Use a saved text phone number, not a formula expression.");
        else contact.contact_phone = value;
      }
    }
    return { row: index + 1, name, ...(affiliation ? { affiliation } : {}), ...contact, errors, repeated: false };
  });
  const counts = new Map<string, number>();
  for (const row of rows) if (row.name) counts.set(normalizePeopleImportName(row.name), (counts.get(normalizePeopleImportName(row.name)) ?? 0) + 1);
  return rows.map((row) => ({ ...row, repeated: Boolean(row.name && (counts.get(normalizePeopleImportName(row.name)) ?? 0) > 1) }));
}
