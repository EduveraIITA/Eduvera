import * as Crypto from 'expo-crypto';
import { attendancePhotoFileMetadata, ATTENDANCE_PHOTO_MAX_BYTES } from './attendance-photo';
import { readPrivateFile } from './private-file';
export async function prepareAttendancePhotoFile(uri: string, name: string, type: string) {
  const saved = await readPrivateFile(uri,ATTENDANCE_PHOTO_MAX_BYTES), metadata = attendancePhotoFileMetadata(name,type,saved.bytes);
  const hash = Array.from(new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256,saved.bytes)),v => v.toString(16).padStart(2,'0')).join('');
  return {uri,...metadata,hash};
}
export const prepareCapturedAttendancePhoto = (uri: string) => prepareAttendancePhotoFile(uri,'attendance-photo.jpg','image/jpeg');
