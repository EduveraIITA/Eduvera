import { beforeEach, describe, expect, it, vi } from "vitest";
import { readPeopleImportFile } from "./peopleBulkFile";
import { readPeopleXlsx } from "./readPeopleXlsx";
vi.mock("./readPeopleXlsx", () => ({ readPeopleXlsx: vi.fn() }));
beforeEach(() => vi.resetAllMocks());
function file(name: string, bytes: Uint8Array) { return { name, size: bytes.byteLength, arrayBuffer: () => Promise.resolve(bytes.buffer as ArrayBuffer) } as File; }
describe("neutral people file entry", () => {
  it("reads UTF-8 CSV and TSV actual bytes using the same bounded mapping matrix", async () => {
    const csv = await readPeopleImportFile(file("people.csv", new TextEncoder().encode('Name,Connection\r\n"O’Connor, Jo",Visitor')));
    expect(csv).toEqual([{ name: "people.csv", rows: [["Name", "Connection"], ["O’Connor, Jo", "Visitor"]] }]);
    const tsv = await readPeopleImportFile(file("people.tsv", new TextEncoder().encode("Name\tConnection\n李 明\tLearner")));
    expect(tsv[0]?.rows[1]).toEqual(["李 明", "Learner"]);
    expect(readPeopleXlsx).not.toHaveBeenCalled();
  });
  it("delegates Excel only to the guarded same-origin worker loader", async () => {
    vi.mocked(readPeopleXlsx).mockResolvedValue([{ name: "Sheet", rows: [["Name"], ["Full Person Name"]] }]);
    const input = file("people.xlsx", new Uint8Array([1, 2, 3]));
    expect(await readPeopleImportFile(input)).toEqual([{ name: "Sheet", rows: [["Name"], ["Full Person Name"]] }]);
    expect(readPeopleXlsx).toHaveBeenCalledWith(await input.arrayBuffer());
  });
  it("rejects unsupported and oversized files before parsing and reports invalid UTF-8", async () => {
    await expect(readPeopleImportFile(file("people.xlsm", new Uint8Array()))).rejects.toThrow(/not supported/);
    await expect(readPeopleImportFile(file("people.xls", new Uint8Array()))).rejects.toThrow(/not supported/);
    await expect(readPeopleImportFile(file("people.csv", new Uint8Array(1024 * 1024 + 1)))).rejects.toThrow(/1 MiB/);
    await expect(readPeopleImportFile(file("people.csv", new Uint8Array([255])))).rejects.toThrow(/UTF-8/);
    expect(readPeopleXlsx).not.toHaveBeenCalled();
  });
});
