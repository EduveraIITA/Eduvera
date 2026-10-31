import * as DeviceStorage from './device-storage.web';
import { createBrowserAttendanceDraftStorage } from './attendance-draft-browser';
import type { AttendanceCommand, AttendanceMark } from './attendance-draft-policy';
export { attendanceDraftKey, validateAttendanceDraft, parseStoredAttendanceDraft } from './attendance-draft-policy';
export type { AttendanceStatus, AttendanceMark, AttendanceDraftScope, AttendanceCommand, AttendanceDraft } from './attendance-draft-policy';

const drafts = createBrowserAttendanceDraftStorage(DeviceStorage);
export const readAttendanceDraft = drafts.readAttendanceDraft;
export const writeAttendanceDraft = drafts.writeAttendanceDraft;
export const removeAttendanceDraft = drafts.removeAttendanceDraft;
export async function newAttendanceCommand(action: AttendanceCommand['action'], revision: number, records: AttendanceMark[], reason: string): Promise<AttendanceCommand> {
  if (!globalThis.crypto?.randomUUID) throw new Error('A private browser command identifier is unavailable. Nothing was sent.');
  return { key: globalThis.crypto.randomUUID(), action, expectedRevision: revision, body: JSON.stringify({ expected_revision: revision, ...((action === 'save' || action === 'submit') && records.length ? { records } : {}), ...(reason.trim() ? { reason: reason.trim() } : {}) }) };
}
