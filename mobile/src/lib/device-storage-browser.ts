import type { SecureStoreOptions } from 'expo-secure-store';

const databaseName = 'thatcampus-device-journals-v1';
const entriesStore = 'journal_entries', keysStore = 'encryption_keys', encryptionKeyName = 'journal-aes-gcm-v1';
const unavailable = 'Private browser storage is unavailable. New actions are blocked until storage is available.';
const unreadable = 'The retained browser record could not be verified. Its bytes were kept; new actions are blocked.';
const hash = '[a-f0-9]{64}', uuid = '[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}';
const namespace = '(?:pending\\.v1\\.(?:departure|events|learning|assessments|people|messages|simulation|resources|facilities|calendar|schedule|attendance|gate|campus)|pending\\.(?:resources|facilities|dining|accommodation)|people-review|leave-intent|academic-session|attendance-evidence|fee-action|staff-command|institution-commands|notice-response|notice-manage|gate-action|assistant-command|attendance-draft|attendance-offline|pending-file|more-action|academic-reports|care-receipts|simulation-baseline|simulation-removal)';
const journalKey = new RegExp(`^thatcampus\\.${namespace}\\.${hash}(?:\\.manifest|\\.${uuid}\\.(?:0|[1-9][0-9]{0,3}))?$`);
type EncryptedRecord = { version: 1; iv: Uint8Array; ciphertext: ArrayBuffer };

function validateKey(key: string, options: SecureStoreOptions = {}) {
  if (typeof key !== 'string' || !journalKey.test(key)) throw new Error('Browser device storage accepts only scope-bound campus journals. Account credentials are not stored here.');
  if (options.requireAuthentication || options.keychainService || options.accessGroup || options.keychainAccessible !== undefined && options.keychainAccessible !== 6) throw new Error('This native secure-storage option is unavailable in a browser. Nothing was stored.');
}
function validEncryptionKey(value: unknown): value is CryptoKey {
  if (!value || typeof value !== 'object') return false;
  const key = value as CryptoKey;
  return key.type === 'secret' && key.extractable === false && key.algorithm?.name === 'AES-GCM' && (key.algorithm as AesKeyAlgorithm).length === 256 && Array.isArray(key.usages) && key.usages.length === 2 && key.usages.includes('encrypt') && key.usages.includes('decrypt');
}
function validRecord(value: unknown): value is EncryptedRecord {
  const row = value as EncryptedRecord;
  return !!row && row.version === 1 && row.iv instanceof Uint8Array && row.iv.byteLength === 12 && row.ciphertext instanceof ArrayBuffer && row.ciphertext.byteLength >= 16;
}

/** Origin-isolated, encrypted journals. No auth tokens, localStorage or memory fallback.
 * AES keys are nonextractable CryptoKeys stored by structured clone in IndexedDB.
 * This does not provide hardware-backed Keychain protection or protect against XSS.
 */
export function createBrowserDeviceStorage(dependencies: { indexedDB?: () => IDBFactory | undefined; crypto?: () => Crypto | undefined } = {}) {
  let connection: Promise<IDBDatabase> | undefined;
  const browserCrypto = () => {
    let value: Crypto | undefined;
    try { value = dependencies.crypto ? dependencies.crypto() : globalThis.crypto; } catch { /* Denied browser APIs fail closed below. */ }
    if (!value?.subtle || !value.getRandomValues) throw new Error(unavailable);
    return value;
  };
  function database() {
    if (!connection) connection = new Promise<IDBDatabase>((resolve, reject) => {
      let factory: IDBFactory | undefined;
      try { factory = dependencies.indexedDB ? dependencies.indexedDB() : globalThis.indexedDB; } catch { reject(new Error(unavailable)); return; }
      if (!factory) { reject(new Error(unavailable)); return; }
      let request: IDBOpenDBRequest, settled = false;
      try { request = factory.open(databaseName, 1); } catch { reject(new Error(unavailable)); return; }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(entriesStore)) db.createObjectStore(entriesStore);
        if (!db.objectStoreNames.contains(keysStore)) db.createObjectStore(keysStore);
      };
      request.onerror = request.onblocked = () => { settled = true; reject(new Error(unavailable)); };
      request.onsuccess = () => {
        const db = request.result;
        if (settled) { db.close(); return; }
        db.onversionchange = () => { db.close(); connection = undefined; };
        db.onclose = () => { connection = undefined; };
        resolve(db);
      };
    }).catch(cause => { connection = undefined; throw cause; });
    return connection;
  }
  async function operation<T>(store: string, mode: IDBTransactionMode, request: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await database();
    return new Promise<T>((resolve, reject) => {
      try {
        const transaction = db.transaction(store, mode), result = request(transaction.objectStore(store));
        let value: T;
        result.onsuccess = () => { value = result.result; };
        transaction.oncomplete = () => resolve(value!);
        transaction.onabort = transaction.onerror = () => reject(new Error(unavailable));
      } catch { reject(new Error(unavailable)); }
    });
  }
  async function encryptionKey(create: boolean) {
    const existing: unknown = await operation(keysStore, 'readonly', store => store.get(encryptionKeyName));
    if (existing !== undefined) { if (!validEncryptionKey(existing)) throw new Error(unreadable); return existing; }
    if (!create) throw new Error(unreadable);
    const candidate = await browserCrypto().subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const db = await database();
    // Concurrent tabs serialize this transaction; only one generated key wins.
    return new Promise<CryptoKey>((resolve, reject) => {
      let failure = unavailable;
      try {
        const transaction = db.transaction([keysStore, entriesStore], 'readwrite'), keys = transaction.objectStore(keysStore), request = keys.get(encryptionKeyName);
        let chosen: CryptoKey;
        request.onsuccess = () => {
          if (request.result !== undefined) {
            if (!validEncryptionKey(request.result)) { failure = unreadable; transaction.abort(); return; }
            chosen = request.result; return;
          }
          const count = transaction.objectStore(entriesStore).count();
          count.onsuccess = () => {
            // Never replace a missing key while retained ciphertext exists.
            if (count.result) { failure = unreadable; transaction.abort(); return; }
            chosen = candidate; keys.put(candidate, encryptionKeyName);
          };
        };
        transaction.oncomplete = () => resolve(chosen!);
        transaction.onabort = transaction.onerror = () => reject(new Error(failure));
      } catch { reject(new Error(unavailable)); }
    });
  }
  return {
    async getItemAsync(key: string, options: SecureStoreOptions = {}): Promise<string | null> {
      validateKey(key, options);
      const row: unknown = await operation(entriesStore, 'readonly', store => store.get(key));
      if (row === undefined) return null;
      if (!validRecord(row)) throw new Error(unreadable);
      try {
        const plaintext = await browserCrypto().subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(row.iv), additionalData: new TextEncoder().encode(key) }, await encryptionKey(false), row.ciphertext);
        return new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
      } catch { throw new Error(unreadable); }
    },
    async setItemAsync(key: string, value: string, options: SecureStoreOptions = {}): Promise<void> {
      validateKey(key, options);
      if (typeof value !== 'string') throw new Error('Device journal values must be strings. Nothing was stored.');
      const crypto = browserCrypto(), secret = await encryptionKey(true), iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(key) }, secret, new TextEncoder().encode(value));
      await operation(entriesStore, 'readwrite', store => store.put({ version: 1, iv, ciphertext } satisfies EncryptedRecord, key));
    },
    async deleteItemAsync(key: string, options: SecureStoreOptions = {}): Promise<void> {
      validateKey(key, options);
      await operation(entriesStore, 'readwrite', store => store.delete(key));
    },
  };
}
