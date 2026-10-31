import { validateHeaderValue } from "node:http";
import { describe, expect, it } from "vitest";
import { attachmentContentDisposition } from "../src/common/attachment-headers.js";

describe("assignment download disposition", () => {
  it("provides a safe ASCII fallback and RFC5987 Unicode filename", () => {
    const header = attachmentContentDisposition('Sana’s प्रोग्राम 🚀.txt');
    expect(() => validateHeaderValue("Content-Disposition", header)).not.toThrow();
    expect(header).toContain("filename*=UTF-8''Sana%E2%80%99s%20");
    expect(header).toContain("%F0%9F%9A%80.txt");
    expect(header).not.toContain("प्रोग्राम");
  });
  it("strips header injection and escapes quotes, backslashes and RFC5987 punctuation", () => {
    const header = attachmentContentDisposition('"program\\(1)\r\nX-Evil: yes.txt');
    expect(() => validateHeaderValue("Content-Disposition", header)).not.toThrow();
    expect(header).not.toMatch(/[\r\n]/u); expect(header).toContain("%22program%5C%281%29__X-Evil%3A%20yes.txt");
    expect(header).toContain('filename="_program_(1)__X-Evil: yes.txt"');
  });
});
