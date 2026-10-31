import { createReadStream } from "node:fs";
import * as files from "node:fs/promises";
import { Readable } from "node:stream";
import { captureSimulationProviderEffect, selectedSimulationResources, simulationLogicalDigest } from "./simulation-resources.js";

function key(path: string): string {
  if (!path || path.includes("\0") || path.length > 4096) throw new Error("Invalid artifact reference.");
  // Absolute Live paths are never retained or accessed by the Simulation port.
  return simulationLogicalDigest(path);
}

export async function mkdir(path: string, options: { recursive?: boolean; mode?: number } = {}) {
  if (selectedSimulationResources()) { key(path); return undefined; }
  return files.mkdir(path, options);
}

export async function writeFile(path: string, data: Buffer | Uint8Array | string, options: { flag?: string; mode?: number } = {}) {
  const selected = selectedSimulationResources();
  if (!selected) return files.writeFile(path, data, options);
  if (options.flag && !["w", "wx"].includes(options.flag)) throw new Error("This artifact write mode has no reviewed Simulation adapter.");
  const content = typeof data === "string" ? Buffer.from(data) : Buffer.from(data);
  await selected.artifacts.write(key(path), content, options.flag === "wx");
  await captureSimulationProviderEffect({ kind: "file_write", provider: "artifact", operation: "write", logicalKey: key(path),
    payload: { size_bytes: content.length, content_hash: simulationLogicalDigest(content), evidence_mode: "simulation" } });
}

export async function rename(from: string, to: string) {
  const selected = selectedSimulationResources();
  if (!selected) return files.rename(from, to);
  return selected.artifacts.rename(key(from), key(to));
}

export async function unlink(path: string) {
  const selected = selectedSimulationResources();
  if (!selected) return files.unlink(path);
  return selected.artifacts.remove(key(path));
}

function placeholderPdf(): Buffer {
  const stream = "BT /F1 18 Tf 48 740 Td (SIMULATION - source document not copied) Tj 0 -30 Td /F1 11 Tf (This is a run-local placeholder, not original or accepted evidence.) Tj ET";
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let document = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(document));
    document += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(document);
  document += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(document);
}

export async function readEnvironmentStoredFile(path: string, contentType: string, originalName: string) {
  const selected = selectedSimulationResources();
  if (!selected) return { stream: createReadStream(path), content_type: contentType, original_name: originalName,
    size_bytes: null, evidence_mode: "live" as const, source_content_omitted: false };
  const content = await selected.artifacts.read(key(path));
  if (content) return { stream: Readable.from([content]), content_type: contentType, original_name: originalName,
    size_bytes: content.length, evidence_mode: "simulation" as const, source_content_omitted: false };
  let placeholder: Buffer;
  let type: string;
  let name: string;
  if (contentType.startsWith("image/")) {
    type = "image/svg+xml";
    name = "simulation-source-placeholder.svg";
    placeholder = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="320" viewBox="0 0 640 320"><rect width="640" height="320" fill="#fff4df"/><text x="320" y="125" text-anchor="middle" font-family="sans-serif" font-size="30" fill="#854300">SIMULATION</text><text x="320" y="175" text-anchor="middle" font-family="sans-serif" font-size="19" fill="#493b2b">Source image was not copied</text><text x="320" y="215" text-anchor="middle" font-family="sans-serif" font-size="15" fill="#493b2b">Placeholder only - not identity or physical evidence</text></svg>');
  } else if (contentType === "application/pdf") {
    type = contentType; name = "simulation-source-placeholder.pdf"; placeholder = placeholderPdf();
  } else {
    type = "text/plain; charset=utf-8"; name = "simulation-source-placeholder.txt";
    placeholder = Buffer.from("SIMULATION\nSource document contents were not copied.\nThis run-local placeholder is not original or accepted evidence.\n");
  }
  return { stream: Readable.from([placeholder]), content_type: type, original_name: name, size_bytes: placeholder.length,
    evidence_mode: "simulation" as const, source_content_omitted: true };
}
