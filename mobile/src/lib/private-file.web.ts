import * as DocumentPicker from 'expo-document-picker';
import * as DeviceStorage from './device-storage.web';
import { createBrowserPrivateFiles } from './browser-private-files';
const files = createBrowserPrivateFiles(DeviceStorage);
export async function pickPrivateFile(type: string | string[], maximumBytes = 10 * 1024 * 1024) {
  const result = await DocumentPicker.getDocumentAsync({ multiple: false, type, base64: false });
  if (result.canceled) return null;
  const asset = result.assets[0]!;
  try { if (!asset.file) throw new Error('The browser did not provide the selected file. Choose it again.'); return files.addPicked(asset.file, asset.name, asset.mimeType ?? asset.file.type, maximumBytes); }
  finally { if (asset.uri.startsWith('blob:')) URL.revokeObjectURL(asset.uri); }
}
export const readPrivateFile = files.read;
export const removePrivateFile = files.remove;
export const stagePrivateFile = files.stage;
export const privateFilePreview = files.preview;
/** Camera pixels become an ordinary opaque picked handle; staged bytes use the same encrypted journal owner. */
export const addCapturedPrivateFile = (blob: Blob, name: string, maximumBytes: number) => files.addPicked(blob, name, blob.type, maximumBytes);
