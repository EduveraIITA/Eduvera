import type { FacilitiesSettings, RepairDetail, RepairPhoto } from '../../../packages/contracts/src/wire/features/facilities/facilitiesApi';
import type { NativePendingAction } from './native-pending-action';

export const FACILITIES_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const FACILITIES_PHOTO_MAX_COUNT = 20;
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const revision = (value: unknown, minimum = 0): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
export function facilitiesRoot(schoolId: string) {
  if (!uuid(schoolId)) throw new Error('Choose a verified campus before opening repair evidence.');
  return `/api/v1/schools/${schoolId}/facilities`;
}
export function facilitiesRepairPath(schoolId: string, repairId: string) {
  if (!uuid(repairId)) throw new Error('This repair identifier could not be verified.');
  return `${facilitiesRoot(schoolId)}/repairs/${repairId}`;
}
/** Match the owner's filename normalization before persisting upload metadata. */
export function facilitiesPhotoName(name: string) { return name.split(/[\\/]/u).pop()?.replace(/\p{Cc}/gu, '_').slice(0, 180) || 'repair-photo'; }
export function facilitiesPhotoMetadata(name: string, declaredType: string, size: number, bytes: Uint8Array) {
  const type = declaredType.split(';', 1)[0]!.trim().toLowerCase();
  if (!Number.isSafeInteger(size) || size <= 0 || size > FACILITIES_PHOTO_MAX_BYTES || bytes.byteLength !== size) throw new Error('Choose a non-empty JPEG or PNG up to 5 MiB.');
  const png = bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  const jpeg = bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!(type === 'image/png' && png || type === 'image/jpeg' && jpeg)) throw new Error('Use a JPEG or PNG with matching photo contents.');
  return { name: facilitiesPhotoName(name), type, size };
}
export function facilitiesPhotoPath(schoolId: string, repair: Pick<RepairDetail, 'id' | 'photos' | 'recovery_only' | 'access_transferred'>, photo: RepairPhoto) {
  const path = `${facilitiesRepairPath(schoolId, repair.id)}/photos/${photo.id}`;
  if (repair.recovery_only || repair.access_transferred || !uuid(photo.id) || !repair.photos.some(item => item.id === photo.id && item.href === photo.href && item.size === photo.size && item.content_type === photo.content_type)
    || photo.href !== path || !['image/jpeg', 'image/png'].includes(photo.content_type) || !revision(photo.size, 1) || photo.size > FACILITIES_PHOTO_MAX_BYTES) throw new Error('This private photo does not belong to the current repair view. Refresh the repair.');
  return path;
}
export function facilitiesSettingsFingerprint(settings: FacilitiesSettings) {
  return JSON.stringify([settings.revision, settings.can_manage, settings.configured, settings.handler_person_id, settings.verifier_mode, settings.verifier_person_id, settings.emergency_contact]);
}
export function facilitiesPhotoFingerprint(repair: RepairDetail) {
  return JSON.stringify([repair.id, repair.revision, repair.state, repair.allowed_actions.add_photo === true, repair.recovery_only === true, repair.access_transferred === true, repair.external_view === true,
    repair.external_access?.id ?? null, repair.external_access?.state ?? null, repair.photos.map(photo => [photo.id, photo.content_type, photo.size]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))]);
}
export function facilitiesCanAddPhoto(repair: RepairDetail) {
  return uuid(repair.id) && revision(repair.revision, 1) && !repair.recovery_only && !repair.access_transferred && repair.state !== 'closed' && repair.allowed_actions.add_photo === true && repair.photos.length < FACILITIES_PHOTO_MAX_COUNT;
}
/** A report starts at revision one. Later changes require an explicit review. */
export function createInitialRepairPhotoAttempt() {
  let pending: { commandId: string; repairId: string; attempted: boolean } | null = null;
  return {
    queue(commandId: string, repairId: string) {
      if (!uuid(commandId) || !uuid(repairId) || commandId !== repairId) throw new Error('The saved report identity could not be verified.');
      if (pending?.commandId !== commandId) pending = { commandId, repairId, attempted: false };
    },
    claim(repair: RepairDetail): 'upload' | 'review' | 'blocked' | null {
      if (!pending || pending.attempted || pending.repairId !== repair.id) return null;
      pending.attempted = true;
      return !facilitiesCanAddPhoto(repair) ? 'blocked' : repair.revision === 1 ? 'upload' : 'review';
    },
    clear() { pending = null; },
  };
}
export function facilitiesSettingsBody(settings: FacilitiesSettings, values: Pick<FacilitiesSettings, 'handler_person_id' | 'verifier_mode' | 'verifier_person_id' | 'emergency_contact'>) {
  if (!settings.can_manage || !revision(settings.revision) || !uuid(values.handler_person_id) || !['reporter', 'handler', 'named'].includes(values.verifier_mode) || values.verifier_mode === 'named' && !uuid(values.verifier_person_id)) throw new Error('Choose a current handler and the person who checks completed repairs.');
  const emergency_contact = values.emergency_contact.trim();
  if (emergency_contact.length > 300) throw new Error('Keep the emergency contact within 300 characters.');
  return { expected_revision: settings.revision, handler_person_id: values.handler_person_id, verifier_mode: values.verifier_mode, verifier_person_id: values.verifier_mode === 'named' ? values.verifier_person_id : null, emergency_contact };
}
/** A replay returns current state. The separate receipt proves the exact accepted revision. */
export function facilitiesAcceptedReadPath(value: unknown, action: NativePendingAction) {
  const result = object(value), source = action.source, root = facilitiesRoot(action.scope.schoolId);
  if (!source || !result || !revision(result.revision, source.revision + 1)) throw new Error('The server did not confirm this exact repair action. Its request was kept.');
  if (source.kind === 'facilities_settings' && source.sourceId === action.scope.schoolId && action.endpoint === `${root}/settings` && action.payload.kind === 'json') {
    if (!['reporter', 'handler', 'named'].includes(String(result.verifier_mode)) || typeof result.can_manage !== 'boolean' || !uuid(result.handler_person_id)) throw new Error('The saved repair setup could not be verified.');
    return `${root}/settings`;
  }
  if (source.kind === 'facilities_photo' && action.payload.kind === 'multipart' && result.id === source.sourceId && action.endpoint === `${facilitiesRepairPath(action.scope.schoolId, source.sourceId)}/photos`) {
    const photo = Array.isArray(result.photos) ? result.photos.map(object).find(item => item?.id === action.clientId) : null;
    if (!photo || photo.file_name !== action.payload.file.name || photo.content_type !== action.payload.file.type || photo.size !== action.payload.file.size) throw new Error('The server did not confirm the exact uploaded photo. Its request was kept.');
    return facilitiesRepairPath(action.scope.schoolId, source.sourceId);
  }
  throw new Error('This confirmation belongs to different repair work.');
}
export function facilitiesConfirmationPath(action: NativePendingAction) {
  const source = action.source;
  if (!uuid(action.clientId) || !source) throw new Error('The retained repair command is incomplete.');
  const base = source.kind === 'facilities_settings' && source.sourceId === action.scope.schoolId ? `${facilitiesRoot(action.scope.schoolId)}/settings`
    : source.kind === 'facilities_photo' ? facilitiesRepairPath(action.scope.schoolId, source.sourceId) : '';
  if (!base) throw new Error('The retained repair source could not be verified.');
  return `${base}/confirmation?command_id=${action.clientId}`;
}
export function facilitiesCurrentReadMatches(value: unknown, action: NativePendingAction) {
  const result = object(value), source = action.source;
  if (!result || !source || !revision(result.revision, source.revision + 1)) return false;
  return source.kind === 'facilities_photo' ? result.id === source.sourceId && Array.isArray(result.photos) && !!object(result.allowed_actions)
    : source.kind === 'facilities_settings' && source.sourceId === action.scope.schoolId && typeof result.can_manage === 'boolean' && ['reporter', 'handler', 'named'].includes(String(result.verifier_mode)) && uuid(result.handler_person_id);
}
export function facilitiesReceiptMatches(value: unknown, action: NativePendingAction) {
  const receipt = object(value), result = object(receipt?.result), source = action.source;
  return !!source && receipt?.state === 'accepted' && result?.id === source.sourceId && result?.revision === source.revision + 1
    && (source.kind === 'facilities_settings' || source.kind === 'facilities_photo' && result.action === 'photo_added');
}
export function facilitiesActionObsolete(error: unknown, action: NativePendingAction) {
  const envelope = object(object(object(error)?.details)?.error), proof = object(object(envelope?.fields)?.facilities_obsolete), source = action.source;
  return object(error)?.status === 409 && !!source && envelope?.code === 'facilities_obsolete' && proof?.confirmation === 'permanently_inapplicable' && proof.receipt_state === 'absent'
    && proof.repair_id === source.sourceId && proof.command_id === action.clientId && proof.expected_revision === source.revision && revision(proof.current_revision, source.revision + 1) && proof.reason === 'stream_advanced';
}
