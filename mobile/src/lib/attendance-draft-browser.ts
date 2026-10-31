import { attendanceDraftKey, parseStoredAttendanceDraft, validateAttendanceDraft, type AttendanceDraft, type AttendanceDraftScope } from './attendance-draft-policy';

type DeviceStorage = Pick<typeof import('./device-storage'), 'getItemAsync' | 'setItemAsync' | 'deleteItemAsync'>;

/** Browser drafts use the same exact actor/campus/world/server/register identity.
 * The device-storage adapter encrypts these records in origin-isolated IndexedDB.
 * There is no plaintext fallback, automatic submission or background replay.
 */
export function createBrowserAttendanceDraftStorage(storage: DeviceStorage, cryptoSource: () => Crypto | undefined = () => globalThis.crypto) {
  let mutationQueue: Promise<unknown> = Promise.resolve();
  async function key(scope: AttendanceDraftScope, registerId: string) {
    const identity = attendanceDraftKey(scope, registerId), crypto = cryptoSource();
    if (!crypto?.subtle) throw new Error('Encrypted browser attendance storage is unavailable. New actions are blocked.');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
    return `thatcampus.attendance-draft.${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
  }
  function serialize(operation: () => Promise<void>) {
    const pending = mutationQueue.then(operation, operation); mutationQueue = pending.catch(() => {}); return pending;
  }
  return {
    async readAttendanceDraft(scope: AttendanceDraftScope, registerId: string) {
      return parseStoredAttendanceDraft(await storage.getItemAsync(await key(scope, registerId)), scope, registerId);
    },
    async writeAttendanceDraft(draft: AttendanceDraft) {
      if (!validateAttendanceDraft(draft, draft.scope, draft.registerId)) throw new Error('This attendance draft could not be safely retained.');
      const serialized = JSON.stringify(draft), scope = { ...draft.scope }, registerId = draft.registerId;
      await serialize(async () => storage.setItemAsync(await key(scope, registerId), serialized, { keychainAccessible: 6 }));
    },
    async removeAttendanceDraft(scope: AttendanceDraftScope, registerId: string) {
      const originalScope = { ...scope };
      await serialize(async () => storage.deleteItemAsync(await key(originalScope, registerId)));
    },
  };
}
