import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import type { PrivateFileMetadata } from './browser-private-files';
export async function pickPrivateFile(type: string | string[], _maximumBytes = 10 * 1024 * 1024) {
  const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false, type });
  if (result.canceled) return null;
  const asset = result.assets[0]!; return { uri: asset.uri, name: asset.name, type: asset.mimeType ?? '', size: asset.size };
}
export async function readPrivateFile(uri: string, maximumBytes = 10 * 1024 * 1024) {
  const file = new File(uri);
  if (!uri.startsWith('file://') || !file.exists || !file.size || file.size > maximumBytes) throw new Error('The private file is unavailable or exceeds the current size limit.');
  const size = file.size, bytes = new Uint8Array(await file.bytes()); if (bytes.byteLength !== size) throw new Error('The selected file changed while it was being read. Choose it again.');
  return { uri, size, bytes };
}
export async function removePrivateFile(uri: string) { const file = new File(uri); if (file.exists) file.delete(); }
export async function stagePrivateFile<T extends PrivateFileMetadata>(file: T, _scopeKey: string, kind: 'pending' | 'leave'): Promise<T> {
  const directory = new Directory(Paths.document, kind === 'leave' ? 'thatcampus-leave-pending' : 'thatcampus-pending-uploads'); directory.create({ intermediates: true, idempotent: true });
  const destination = new File(directory, Crypto.randomUUID());
  try { new File(file.uri).copy(destination); } catch (cause) { if (destination.exists) destination.delete(); throw cause; }
  return { ...file, uri: destination.uri };
}
export async function privateFilePreview(uri: string) { return { uri, release() {} }; }
