import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { validatePeopleXlsxArchive } from "./validatePeopleXlsxArchive";

function archive(extra: Record<string, Uint8Array> = {}) {
  const bytes = zipSync({ "[Content_Types].xml": strToU8("<Types/>"), "xl/workbook.xml": strToU8("<workbook/>"), ...extra });
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

describe("bounded Excel container validation", () => {
  it("accepts a small deflated workbook container without retaining extracted content", () => {
    expect(() => validatePeopleXlsxArchive(archive())).not.toThrow();
  });
  it("rejects oversized, truncated, non-ZIP and renamed macro files", () => {
    expect(() => validatePeopleXlsxArchive(new ArrayBuffer(1024 * 1024 + 1))).toThrow(/1 MB/);
    expect(() => validatePeopleXlsxArchive(archive().slice(0, 30))).toThrow(/supported Excel/);
    expect(() => validatePeopleXlsxArchive(new ArrayBuffer(100))).toThrow(/supported Excel/);
    expect(() => validatePeopleXlsxArchive(archive({ "xl/vbaProject.bin": new Uint8Array(10) }))).toThrow(/supported Excel/);
  });
  it("rejects excessive declared expansion before reading XML", () => {
    const source = archive({ "xl/worksheets/sheet1.xml": new Uint8Array(8 * 1024 * 1024 + 1) });
    expect(source.byteLength).toBeLessThan(1024 * 1024);
    expect(() => validatePeopleXlsxArchive(source)).toThrow(/too large/);
  });
  it("rejects forged directory sizes using actual streamed expansion", () => {
    const source = archive({ "xl/worksheets/sheet1.xml": new Uint8Array(256 * 1024) });
    const view = new DataView(source);
    for (let offset = 0; offset + 46 < source.byteLength; offset++) {
      if (view.getUint32(offset, true) === 0x02014b50 && view.getUint32(offset + 24, true) > 1000) {
        view.setUint32(offset + 24, 1, true); break;
      }
    }
    expect(() => validatePeopleXlsxArchive(source)).toThrow(/safe size limit/);
  });
  it("rejects encrypted and unsupported compression declarations", () => {
    for (const [field, value] of [[8, 1], [10, 14]]) {
      const source = archive(); const view = new DataView(source);
      for (let offset = 0; offset + 46 < source.byteLength; offset++) {
        if (view.getUint32(offset, true) === 0x02014b50) { view.setUint16(offset + field, value, true); break; }
      }
      expect(() => validatePeopleXlsxArchive(source)).toThrow(/supported Excel/);
    }
  });
});
