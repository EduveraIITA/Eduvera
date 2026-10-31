import * as Crypto from 'expo-crypto';
import { attendancePhotoFileMetadata, ATTENDANCE_PHOTO_MAX_BYTES } from './attendance-photo';
import { addCapturedPrivateFile, readPrivateFile, removePrivateFile } from './private-file.web';
export async function prepareAttendancePhotoFile(uri: string, name: string, type: string) {
  const saved = await readPrivateFile(uri,ATTENDANCE_PHOTO_MAX_BYTES), metadata = attendancePhotoFileMetadata(name,type,saved.bytes);
  const hash = Array.from(new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256,new Uint8Array(saved.bytes))),v => v.toString(16).padStart(2,'0')).join('');
  return {uri,...metadata,hash};
}
export async function prepareCapturedAttendancePhoto(uri: string) {
  const match = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(uri);
  if(!match || match[2]!.length > Math.ceil(ATTENDANCE_PHOTO_MAX_BYTES/3)*4) throw new Error('The captured photo is unavailable or exceeds 24 MiB.');
  const bytes = Uint8Array.from(atob(match[2]!),v => v.charCodeAt(0)), type = `image/${match[1]}`;
  const metadata = attendancePhotoFileMetadata(`attendance-photo.${match[1]==='jpeg'?'jpg':'png'}`,type,bytes);
  const file = await addCapturedPrivateFile(new Blob([bytes],{type}),metadata.name,ATTENDANCE_PHOTO_MAX_BYTES);
  try{return await prepareAttendancePhotoFile(file.uri,metadata.name,type);}catch(cause){await removePrivateFile(file.uri).catch(()=>{});throw cause;}
}
