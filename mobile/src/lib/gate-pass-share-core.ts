import type { CampusDownloadAdapter } from './api-client';
import { gatePassQr } from './gate-management';
export function createGatePassTemporaryFile(file: { readonly uri: string; readonly exists: boolean; create(options: { overwrite: boolean }): void; write(bytes: Uint8Array): void | Promise<void>; delete(): void }) {
  // Creation must succeed before we own cleanup. A UUID collision or refusal
  // cannot authorize deleting a pre-existing private file.
  file.create({ overwrite: false });
  return { uri: file.uri, write: async (bytes: Uint8Array) => file.write(bytes), delete: () => { if (file.exists) file.delete(); } };
}
export async function shareGatePassQr(token: string, kind: string, adapter: CampusDownloadAdapter, assertCurrent: () => void) {
  assertCurrent(); const bytes = new TextEncoder().encode(gatePassQr(token).svg);
  if (!['student', 'pickup', 'visitor'].includes(kind)) throw new Error('The pass kind changed.');
  if (!await adapter.isAvailable()) throw new Error('File sharing is unavailable.');
  assertCurrent(); let file: Awaited<ReturnType<CampusDownloadAdapter['createTemporaryFile']>> | undefined;
  try {
    file = await adapter.createTemporaryFile(`thatcampus-${kind}-qr.svg`); assertCurrent();
    await file.write(bytes); assertCurrent();
    await adapter.share(file.uri, { mimeType: 'image/svg+xml', dialogTitle: 'Share private gate pass' });
  } finally { await file?.delete(); }
}
