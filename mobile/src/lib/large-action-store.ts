import type { NativePendingStorage } from './native-pending-action';
const name = 'thatcampus-action-journals-v1.db';
const secretKey = 'thatcampus.journals.database-key';
const validKey = (key: string) => /^thatcampus\.pending\.v1\.campus\.[a-f0-9]{64}$/.test(key);
const maximumBytes = 12 * 1024 * 1024;
type Database = Pick<import('expo-sqlite').SQLiteDatabase, 'getFirstAsync' | 'runAsync'>;
let opening: Promise<Database> | undefined;
async function database(): Promise<Database> {
  if (!opening) opening = (async () => {
    const [SQLite, SecureStore, Crypto, Files] = await Promise.all([import('expo-sqlite'), import('./device-storage'), import('expo-crypto'), import('expo-file-system')]);
    const existing = new Files.File(SQLite.defaultDatabaseDirectory!, name);
    const hadData = existing.exists && existing.size > 0;
    let key = await SecureStore.getItemAsync(secretKey);
    // A missing device key never replaces a database containing retained work.
    if (!key && hadData) throw new Error('The retained action encryption key is unavailable. Its database was preserved.');
    if (!key) { key = Array.from(await Crypto.getRandomBytesAsync(32), byte => byte.toString(16).padStart(2,'0')).join(''); await SecureStore.setItemAsync(secretKey,key,{keychainAccessible:SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY}); }
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('The retained action encryption key could not be verified.');
    const db = await SQLite.openDatabaseAsync(name);
    try {
      const cipher = await db.getFirstAsync<Record<string, unknown>>('PRAGMA cipher_version');
      if (!cipher || !Object.values(cipher).some(value => typeof value === 'string' && value.length > 0)) throw new Error('Encrypted action storage is unavailable in this build. Nothing was sent.');
      await db.execAsync(`PRAGMA key = "x'${key}'"; PRAGMA cipher_memory_security = ON; PRAGMA synchronous = FULL;`);
      await db.execAsync('CREATE TABLE IF NOT EXISTS action_journals (scope_key TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL)');
      return db;
    } catch (cause) { await db.closeAsync(); throw cause; }
  })().catch(cause => { opening = undefined; throw cause; });
  return opening;
}
/** Large scene documents use the already configured SQLCipher runtime. This is
 * separate from Attendance drafts; no prior attendance database is opened. */
export function createLargeActionStorage(key: string): NativePendingStorage {
  if (!validKey(key)) throw new Error('Large action storage requires an exact scoped campus journal.');
  return {
    async read() { const row = await (await database()).getFirstAsync<{payload:string}>('SELECT payload FROM action_journals WHERE scope_key = ?',key); return row?.payload ?? null; },
    async write(value) { if (typeof value !== 'string' || new TextEncoder().encode(value).byteLength > maximumBytes) throw new Error('This layout exceeds the encrypted action limit. Nothing was sent.'); await (await database()).runAsync('INSERT INTO action_journals(scope_key,payload) VALUES (?,?) ON CONFLICT(scope_key) DO UPDATE SET payload=excluded.payload',key,value); },
    async clear() { await (await database()).runAsync('DELETE FROM action_journals WHERE scope_key = ?',key); },
  };
}
