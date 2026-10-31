import type { CampusDownloadAdapter } from './api-client';

type BrowserDownloadEnvironment = {
  document(): Pick<Document, 'createElement' | 'body'> | undefined;
  createObjectURL(blob: Blob): string;
  revokeObjectURL(uri: string): void;
  schedule(work: () => void, milliseconds: number): unknown;
};

/** Transport already checks scope, size, auth and omitted Simulation originals.
 * This adapter only presents bounded verified bytes and releases its Blob URL.
 */
export function createBrowserDownloadAdapter(environment: BrowserDownloadEnvironment = {
  document: () => typeof document === 'undefined' ? undefined : document,
  createObjectURL: blob => URL.createObjectURL(blob), revokeObjectURL: uri => URL.revokeObjectURL(uri), schedule: (work, milliseconds) => setTimeout(work, milliseconds),
}): CampusDownloadAdapter {
  const files = new Map<string, { name: string; presented: boolean }>();
  return {
    isAvailable: async () => !!environment.document() && typeof URL.createObjectURL === 'function',
    createTemporaryFile(name) {
      let uri = '';
      return { get uri() { return uri; }, async write(bytes) {
        if (uri) throw new Error('The private temporary download already contains its original bytes.');
        uri = environment.createObjectURL(new Blob([new Uint8Array(bytes).buffer], { type: 'application/octet-stream' })); files.set(uri, { name, presented: false });
      }, delete() {
        if (!uri) return;
        const current = uri, presented = files.get(current)?.presented; files.delete(current); uri = '';
        if (presented) environment.schedule(() => environment.revokeObjectURL(current), 1000); else environment.revokeObjectURL(current);
      } };
    },
    async share(uri) {
      const file = files.get(uri), document = environment.document(); if (!file || !document) throw new Error('The temporary campus file is unavailable.');
      const link = document.createElement('a'); link.href = uri; link.download = file.name; link.rel = 'noopener'; document.body.appendChild(link);
      try { link.click(); file.presented = true; } finally { link.remove(); }
    },
  };
}
