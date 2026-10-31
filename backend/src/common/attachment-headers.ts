/** Authorized file previews use revocable local object URLs, never blob scripts. */
export const PRIVATE_IMAGE_SOURCES = ["'self'", "data:", "blob:"] as const;

/** RFC 6266/5987 private attachment names; never emit raw header controls. */
export function attachmentContentDisposition(filename: string) {
  const name = filename.replace(/[\r\n\0]/gu, "_") || "attachment";
  const fallback = name.replace(/[^\x20-\x7e]|["\\]/gu, "_");
  const encoded = encodeURIComponent(name).replace(/[!'()*]/gu, value => `%${value.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
