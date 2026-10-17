function asciiPdfText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "-")
    .replace(/([\\()])/g, "\\$1");
}

function byteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

/**
 * Creates a compact, standards-compliant PDF without adding a large client
 * dependency. It is intentionally text-only so timetable exports remain fast,
 * searchable, and printable on low-bandwidth school devices.
 */
export function downloadTextPdf(filename: string, title: string, sourceLines: string[]) {
  const linesPerPage = 48;
  const pages = Array.from(
    { length: Math.max(1, Math.ceil(sourceLines.length / linesPerPage)) },
    (_, index) => sourceLines.slice(index * linesPerPage, (index + 1) * linesPerPage),
  );
  const fontObject = 3 + pages.length * 2;
  const pageObjects = pages.map((_, index) => 3 + index * 2);
  const objects = new Map<number, string>();

  objects.set(1, "<< /Type /Catalog /Pages 2 0 R >>");
  objects.set(
    2,
    `<< /Type /Pages /Kids [${pageObjects.map((number) => `${number} 0 R`).join(" ")}] /Count ${pages.length} >>`,
  );

  pages.forEach((pageLines, index) => {
    const pageObject = 3 + index * 2;
    const contentObject = pageObject + 1;
    const header = index === 0 ? title : `${title} - continued`;
    const textCommands = [header, "", ...pageLines]
      .map((line, lineIndex) =>
        lineIndex === 0
          ? `(${asciiPdfText(line)}) Tj`
          : `0 -15 Td (${asciiPdfText(line)}) Tj`,
      )
      .join("\n");
    const stream = `BT\n/F1 11 Tf\n48 792 Td\n${textCommands}\nET`;
    objects.set(
      pageObject,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontObject} 0 R >> >> /Contents ${contentObject} 0 R >>`,
    );
    objects.set(contentObject, `<< /Length ${byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  });
  objects.set(fontObject, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  let document = "%PDF-1.4\n%ThatCampusOS\n";
  const offsets = [0];
  for (let number = 1; number <= fontObject; number += 1) {
    offsets[number] = byteLength(document);
    document += `${number} 0 obj\n${objects.get(number)}\nendobj\n`;
  }
  const xrefOffset = byteLength(document);
  document += `xref\n0 ${fontObject + 1}\n0000000000 65535 f \n`;
  for (let number = 1; number <= fontObject; number += 1) {
    document += `${String(offsets[number]).padStart(10, "0")} 00000 n \n`;
  }
  document += `trailer\n<< /Size ${fontObject + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  const url = URL.createObjectURL(new Blob([document], { type: "application/pdf" }));
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = filename.endsWith(".pdf") ? filename : `${filename}.pdf`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
