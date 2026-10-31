/** Native attendance drafts are observations, never accepted attendance.
 * SQLCipher is mandatory: no plaintext fallback and no background replay. */
export { attendanceDraftKey, validateAttendanceDraft, parseStoredAttendanceDraft } from './attendance-draft-policy';
export type { AttendanceStatus, AttendanceMark, AttendanceDraftScope, AttendanceCommand, AttendanceDraft } from './attendance-draft-policy';
import { attendanceDraftKey, validateAttendanceDraft, parseStoredAttendanceDraft, type AttendanceDraft, type AttendanceDraftScope, type AttendanceCommand, type AttendanceMark } from './attendance-draft-policy';

type DraftDatabase = {
  runAsync(sql: string, ...params: (string | number | null)[]): Promise<unknown>;
  getFirstAsync<T>(sql: string, ...params: (string | number | null)[]): Promise<T | null>;
};
let databasePromise: Promise<DraftDatabase> | undefined;
let mutationQueue: Promise<unknown> = Promise.resolve();
function serializeMutation(operation: () => Promise<unknown>) {
  const pending = mutationQueue.then(operation, operation);
  mutationQueue = pending.catch(() => {});
  return pending;
}
async function database(): Promise<DraftDatabase> {
  if (!databasePromise) databasePromise = (async () => {
    const [SQLite, SecureStore, Crypto] = await Promise.all([import('expo-sqlite'), import('./device-storage'), import('expo-crypto')]);
    const db = await SQLite.openDatabaseAsync('thatcampus-attendance-v1.db');
    try {
      const cipher = await db.getFirstAsync<Record<string, unknown>>('PRAGMA cipher_version');
      if (!cipher || !Object.values(cipher).some(value => typeof value === 'string' && value.length > 0)) throw new Error('Encrypted local attendance storage is unavailable in this build. Keep this register open until your changes are confirmed.');
      let key = await SecureStore.getItemAsync('thatcampus.attendance.database-key');
      if (!key) {
        key = Array.from(await Crypto.getRandomBytesAsync(32), byte => byte.toString(16).padStart(2, '0')).join('');
        await SecureStore.setItemAsync('thatcampus.attendance.database-key', key, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
      }
      if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('The encrypted draft key is unavailable.');
      await db.execAsync(`PRAGMA key = "x'${key}'"; PRAGMA cipher_memory_security = ON;`);
      await db.execAsync('CREATE TABLE IF NOT EXISTS attendance_drafts (scope_key TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL)');
      return db;
    } catch (error) { await db.closeAsync(); throw error; }
  })().catch(error => { databasePromise = undefined; throw error; });
  return databasePromise;
}
export async function readAttendanceDraft(scope: AttendanceDraftScope, registerId: string) {
  const row = await (await database()).getFirstAsync<{ payload: string }>('SELECT payload FROM attendance_drafts WHERE scope_key = ?', attendanceDraftKey(scope, registerId));
  return parseStoredAttendanceDraft(row?.payload ?? null, scope, registerId);
}
export async function writeAttendanceDraft(draft: AttendanceDraft) {
  if (!validateAttendanceDraft(draft, draft.scope, draft.registerId)) throw new Error('This attendance draft could not be safely retained.');
  await serializeMutation(async () => (await database()).runAsync('INSERT INTO attendance_drafts (scope_key, payload) VALUES (?, ?) ON CONFLICT(scope_key) DO UPDATE SET payload = excluded.payload', attendanceDraftKey(draft.scope, draft.registerId), JSON.stringify(draft)));
}
export async function removeAttendanceDraft(scope: AttendanceDraftScope, registerId: string) {
  await serializeMutation(async () => (await database()).runAsync('DELETE FROM attendance_drafts WHERE scope_key = ?', attendanceDraftKey(scope, registerId)));
}
export async function newAttendanceCommand(action: AttendanceCommand['action'], revision: number, records: AttendanceMark[], reason: string): Promise<AttendanceCommand> {
  const Crypto = await import('expo-crypto');
  return { key: Crypto.randomUUID(), action, expectedRevision: revision, body: JSON.stringify({ expected_revision: revision, ...((action === 'save' || action === 'submit') && records.length ? { records } : {}), ...(reason.trim() ? { reason: reason.trim() } : {}) }) };
}
