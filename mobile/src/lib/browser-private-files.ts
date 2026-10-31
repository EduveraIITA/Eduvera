import { browserPickedFileUri, browserPrivateFileUri, parseBrowserPrivateFileUri } from './browser-private-file-policy';

export interface PrivateFileMetadata { uri: string; name: string; type: string; size: number; hash: string }
type Storage = Pick<typeof import('./device-storage'), 'getItemAsync' | 'setItemAsync' | 'deleteItemAsync'>;
const defaultMaximumBytes = 10 * 1024 * 1024;
const maximumBytes = 24 * 1024 * 1024;
const message = 'The retained upload bytes are unavailable or changed. A different file was not substituted.';
const nameIsSafe = (name: string) => !!name && name.length <= 255 && !/[\r\n\0/\\]/.test(name);
function base64(bytes: Uint8Array) { let value = ''; for (let offset = 0; offset < bytes.length; offset += 0x8000) value += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)); return btoa(value); }
function decode(value: string) { const binary = atob(value), bytes = new Uint8Array(binary.length); for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index); return bytes; }

/** Picked File objects stay ephemeral; staged immutable bytes are encrypted in IDB. */
export function createBrowserPrivateFiles(storage: Storage, cryptoSource: () => Crypto | undefined = () => globalThis.crypto) {
  const picked = new Map<string, { blob: Blob; name: string; type: string }>();
  const crypto = () => { const value = cryptoSource(); if (!value?.subtle || !value.randomUUID) throw new Error('Private browser file storage is unavailable. Nothing was sent.'); return value; };
  const digest = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto().subtle.digest('SHA-256', new Uint8Array(bytes).buffer)), byte => byte.toString(16).padStart(2, '0')).join('');
  const slot = async (uri: string) => `thatcampus.pending-file.${await digest(new TextEncoder().encode(uri))}`;
  async function read(uri: string, maximum = defaultMaximumBytes): Promise<{ uri: string; size: number; bytes: Uint8Array; type: string }> {
    if (uri.startsWith('data:')) {
      const match = /^data:(image\/(?:jpeg|png));base64,([a-zA-Z0-9+/]*={0,2})$/.exec(uri);
      if (!match || match[2]!.length > Math.ceil(Math.min(maximum, maximumBytes) / 3) * 4) throw new Error('The captured photo is unavailable or exceeds the current size limit.');
      const bytes = decode(match[2]!), blob = new Blob([new Uint8Array(bytes).buffer], { type: match[1] });
      return read(addPicked(blob, 'camera-photo.' + (match[1] === 'image/png' ? 'png' : 'jpg'), match[1]!, maximum).uri, maximum);
    }
    const local = picked.get(uri);
    if (local) {
      if (!Number.isSafeInteger(local.blob.size) || local.blob.size < 1 || local.blob.size > maximum || local.blob.size > maximumBytes) throw new Error('Choose a nonempty file within the current size limit.');
      const bytes = new Uint8Array(await local.blob.arrayBuffer()); if (bytes.length !== local.blob.size) throw new Error(message);
      return { uri, size: bytes.length, bytes, type: local.type };
    }
    const identity = parseBrowserPrivateFileUri(uri); if (!identity) throw new Error(message);
    const raw = await storage.getItemAsync(await slot(uri)); if (raw === null) throw new Error(message);
    try {
      const row = JSON.parse(raw) as { version: number; uri: string; scopeKey: string; name: string; type: string; size: number; hash: string; bytes: string };
      if (row.version !== 1 || row.uri !== uri || row.scopeKey !== identity.scopeKey || !nameIsSafe(row.name) || typeof row.type !== 'string' || !row.type || !Number.isSafeInteger(row.size) || row.size < 1 || row.size > maximum || row.size > maximumBytes || !/^[a-f0-9]{64}$/.test(row.hash) || typeof row.bytes !== 'string' || row.bytes.length > Math.ceil(row.size / 3) * 4) throw new Error(message);
      const bytes = decode(row.bytes); if (bytes.length !== row.size || await digest(bytes) !== row.hash) throw new Error(message);
      return { uri, size: bytes.length, bytes, type: row.type };
    } catch { throw new Error(message); }
  }
  function addPicked(blob: Blob, name: string, type: string, maximum = defaultMaximumBytes) {
    if (!nameIsSafe(name) || !Number.isSafeInteger(blob.size) || blob.size < 1 || blob.size > maximum || blob.size > maximumBytes) throw new Error('Choose a nonempty file with a safe filename within the current size limit.');
    const uri = `thatcampus-picked://${crypto().randomUUID()}`; picked.set(uri, { blob, name, type }); return { uri, name, type, size: blob.size };
  }
  return {
    addPicked,
    read,
    async stage<T extends PrivateFileMetadata>(file: T, scopeKey: string, kind: 'pending' | 'leave'): Promise<T> {
      const identity = parseBrowserPrivateFileUri(file.uri);
      if (!browserPickedFileUri(file.uri) && (!identity || identity.scopeKey !== scopeKey || identity.kind !== kind)) throw new Error(message);
      const original = await read(file.uri, file.size), hash = await digest(original.bytes);
      if (!nameIsSafe(file.name) || !file.type || file.size !== original.size || file.hash !== hash) throw new Error(message);
      const uri = browserPrivateFileUri(kind, crypto().randomUUID(), scopeKey);
      await storage.setItemAsync(await slot(uri), JSON.stringify({ version: 1, uri, scopeKey, name: file.name, type: file.type, size: original.size, hash, bytes: base64(original.bytes) }), { keychainAccessible: 6 });
      return { ...file, uri };
    },
    async remove(uri: string) {
      if (browserPickedFileUri(uri)) { picked.delete(uri); return; }
      if (!parseBrowserPrivateFileUri(uri)) throw new Error(message);
      await storage.deleteItemAsync(await slot(uri));
    },
    async preview(uri: string) {
      const value = await read(uri, maximumBytes), url = URL.createObjectURL(new Blob([new Uint8Array(value.bytes).buffer], { type: value.type }));
      return { uri: url, release: () => URL.revokeObjectURL(url) };
    },
  };
}
