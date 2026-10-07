import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { csvRows } from "../src/institutions/import-directory.js";
import { createSchema, likeLiteral, searchSchema } from "../src/institutions/schemas.js";

async function parse(chunks: string[]) { const rows = []; for await (const row of csvRows(Readable.from(chunks))) rows.push(row); return rows; }
describe("normalized directory CSV and input validation", () => {
  it("reads BOM, quoted commas, multiline fields, escaped quotes and split chunks", async () => {
    expect(await parse(['\uFEFFname,address\r\n"Public, School","Line 1\nLine ', '2 ""Road"', '""\r\n'])).toEqual([["name", "address"], ["Public, School", 'Line 1\nLine 2 "Road"']]);
  });
  it("rejects invalid and truncated quotes", async () => {
    await expect(parse(['"unclosed'])).rejects.toThrow();
    await expect(parse(['"value"trailing'])).rejects.toThrow();
  });
  it("preserves official leading zeros", async () => { expect(await parse(["code\n00123456789\n"])).toEqual([["code"], ["00123456789"]]); });
  it("escapes wildcard characters as literal search text", () => { expect(likeLiteral("A%_\\")).toBe("a\\%\\_\\\\"); });
  it("requires one creation mode and bounded queries", () => {
    expect(createSchema.safeParse({}).success).toBe(false);
    expect(searchSchema.safeParse({ q: " x " }).success).toBe(false);
    expect(searchSchema.parse({ q: " School " })).toMatchObject({ q: "School", limit: 15 });
  });
});
