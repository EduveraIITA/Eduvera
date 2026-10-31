import { readFile } from 'node:fs/promises';

/** Fixed light-surface artwork shared by HTML email and printable receipts. */
export const thatCampusWordmark = {
  filename: 'thatcampus-wordmark-light-v3.png',
  emailPath: '/email-assets/thatcampus-wordmark-light-v3.png',
  contentType: 'image/png',
} as const;

export function readThatCampusWordmark(): Promise<Buffer> {
  // Both src/common and dist/common resolve to the packaged backend assets.
  // Email artwork must not depend on a separately built SPA being present.
  return readFile(new URL(`../../assets/receipt/${thatCampusWordmark.filename}`, import.meta.url));
}
