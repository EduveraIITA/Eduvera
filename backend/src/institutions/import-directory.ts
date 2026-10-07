import { createReadStream } from "node:fs";
import { pathToFileURL } from "node:url";
import { Pool, type PoolClient } from "pg";
import { z } from "zod";
import { institutionType } from "./schemas.js";

// Streaming RFC-4180 CSV (quoted commas, escaped quotes, multiline fields and UTF-8 BOM).
export async function* csvRows(stream: AsyncIterable<string | Buffer>): AsyncGenerator<string[]> {
  let row: string[] = [], field = "", quoted = false, afterQuote = false, first = true;
  for await (const chunk of stream) {
    for (const char of chunk.toString()) {
      if (first) { first = false; if (char === "\uFEFF") continue; }
      if (quoted) {
        if (char === '"') { quoted = false; afterQuote = true; } else field += char;
      } else if (afterQuote && char === '"') {
        field += '"'; quoted = true; afterQuote = false;
      } else if (char === "," || char === "\n") {
        row.push(field.replace(/\r$/, "")); field = ""; afterQuote = false;
        if (char === "\n") { yield row; row = []; }
      } else if (char === '"' && field === "" && !afterQuote) {
        quoted = true;
      } else if (char === "\r") {
        // Record CRLF outside a quoted field.
      } else {
        if (afterQuote || char === '"') throw new Error("Invalid CSV quoting");
        field += char;
      }
      if (field.length > 1_000_000 || row.length > 100) throw new Error("CSV record is too large");
    }
  }
  if (quoted) throw new Error("Unterminated quoted CSV field");
  if (field || row.length || afterQuote) yield [...row, field];
}

const importSchema = z.object({
  name: z.string().trim().min(2).max(180), institution_type: institutionType,
  source: z.enum(["UDISE", "AISHE"]), source_code: z.string().trim().toUpperCase().min(1).max(64),
  state: z.string().trim().max(120), district: z.string().trim().max(120), city: z.string().trim().max(120), address: z.string().trim().max(1000),
  is_verified: z.enum(["true", "false"]).default("false"), metadata: z.string().default("{}"),
  existing_school_id: z.union([z.uuid(), z.literal("")]).default(""),
}).superRefine((row, context) => {
  if (row.source === "UDISE" && (row.institution_type !== "school" || !/^\d{11}$/.test(row.source_code))) context.addIssue({ code: "custom", message: "UDISE requires school and an 11-digit code (keep leading zeroes)." });
  const prefix = { college: "C", university: "U", standalone: "S", school: "", other: "" }[row.institution_type];
  if (row.source === "AISHE" && (!prefix || !new RegExp(`^${prefix}-\\d+$`).test(row.source_code))) context.addIssue({ code: "custom", message: "AISHE code prefix must match college C-, university U-, or standalone S-." });
});

export async function importDirectory(client: PoolClient, stream: AsyncIterable<string | Buffer>) {
  let headers: string[] | undefined, count = 0;
  await client.query("BEGIN");
  try {
    for await (const cells of csvRows(stream)) {
      if (cells.every((cell) => !cell.trim())) continue;
      if (!headers) {
        headers = cells.map((cell) => cell.trim());
        if (new Set(headers).size !== headers.length) throw new Error("Duplicate CSV headers");
        for (const required of ["name", "institution_type", "source", "source_code", "state", "district", "city", "address"]) {
          if (!headers.includes(required)) throw new Error(`Missing CSV header: ${required}`);
        }
        continue;
      }
      if (cells.length !== headers.length) throw new Error(`Record ${count + 1}: wrong number of columns`);
      const row = importSchema.parse(Object.fromEntries(headers.map((key, index) => [key, cells[index]])));
      const metadata: unknown = JSON.parse(row.metadata || "{}");
      if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new Error("metadata must be a JSON object");
      const result = await client.query<{ id: string }>(`INSERT INTO institution_directory
        (name,institution_type,source,source_code,state,district,city,address,is_verified,metadata)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (source,source_code) DO UPDATE SET
        name=excluded.name,institution_type=excluded.institution_type,state=excluded.state,district=excluded.district,
        city=excluded.city,address=excluded.address,is_verified=excluded.is_verified,
        metadata=institution_directory.metadata || excluded.metadata,updated_at=now() RETURNING id`,
      [row.name,row.institution_type,row.source,row.source_code,row.state,row.district,row.city,row.address,row.is_verified === "true",metadata]);
      if (row.existing_school_id) {
        // An explicit operator-reviewed mapping; never infer identity from institution names.
        const existing = await client.query<{ source: string; directory_id: string }>(`SELECT d.source,o.directory_id FROM institution_onboarding o
          JOIN institution_directory d ON d.id=o.directory_id WHERE o.school_id=$1 FOR UPDATE OF o`, [row.existing_school_id]);
        if (existing.rows[0]?.source && existing.rows[0].source !== "MANUAL") {
          const same = await client.query("SELECT 1 FROM institution_onboarding WHERE school_id=$1 AND directory_id=$2", [row.existing_school_id,result.rows[0]!.id]);
          if (!same.rows.length) throw new Error("Refusing to replace an existing official identity");
        }
        await client.query(`INSERT INTO institution_onboarding(school_id,directory_id,status) VALUES ($1,$2,'active')
          ON CONFLICT(school_id) DO UPDATE SET directory_id=excluded.directory_id,updated_at=now()`, [row.existing_school_id,result.rows[0]!.id]);
        if (existing.rows[0]?.source === "MANUAL") {
          await client.query("DELETE FROM institution_directory WHERE id=$1 AND source='MANUAL' AND NOT EXISTS (SELECT 1 FROM institution_onboarding WHERE directory_id=$1)", [existing.rows[0].directory_id]);
        }
      }
      count++;
    }
    if (!headers) throw new Error("CSV is empty");
    await client.query("COMMIT");
    return count;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.DATABASE_URL || !process.argv[2]) throw new Error("Usage: DATABASE_URL=... npm run directory:import -- normalized.csv");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  try { console.log(`Imported ${await importDirectory(client, createReadStream(process.argv[2], { encoding: "utf8" }))} institution records.`); }
  finally { client.release(); await pool.end(); }
}
