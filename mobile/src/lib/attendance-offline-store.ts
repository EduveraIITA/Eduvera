import type { TeacherAttendanceResponse, TeacherAttendanceSaveInput } from '../../../packages/contracts/src/wire/features/operations/api';
import { nativePendingScopeKey, type NativePendingScope } from './native-pending-action';
import { attendanceOfflineBody, attendanceOfflineConfirmedRead, attendanceOfflineHashInput, attendanceOfflineOverlay, attendanceOfflineReceipt, attendanceOfflineScreenMatches, type AttendanceOfflineCapture, type AttendanceOfflineScreen } from './attendance-offline-policy';

type Storage = { read(): Promise<string | null>; write(value: string): Promise<void> };
type ChunkAdapter = { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void>; remove(key: string): Promise<void>; randomId(): string; digest(value: string): Promise<string> };
type Snapshot = { classId: string; date: string; cachedAt: string; screen: TeacherAttendanceResponse };
type Capture = AttendanceOfflineCapture & { paused?: boolean; error?: string };
type Document = { version: 1; scope: NativePendingScope; deviceId: string; snapshots: Snapshot[]; captures: Capture[]; denied: string[] };
export type AttendanceOfflineState = { ready: boolean; blocked: boolean; busy: boolean; error: string; pending: Capture[] };
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const entryKey = (classId: string, date: string) => `${classId}:${date}`;
const message = (cause: unknown) => cause instanceof Error ? cause.message : 'The retained offline attendance could not be confirmed.';
const detached = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const maxCharacters = 2_097_152;

/** A new namespace; this adapter never reads or changes ordinary attendance drafts. */
export function createAttendanceOfflineChunkStore(adapter: ChunkAdapter, prefix: string): Storage {
  const slot = prefix + '.manifest';
  const manifest = (raw: string) => { const value = JSON.parse(raw) as { version: number; commit: string; parts: number; hash: string }; if (value.version !== 1 || !uuid(value.commit) || !Number.isSafeInteger(value.parts) || value.parts < 1 || value.parts > 8192 || !/^[a-f0-9]{64}$/.test(value.hash)) throw new Error('The offline attendance manifest is unreadable. Its bytes were kept.'); return value; };
  return {
    async read() { const raw = await adapter.get(slot); if (!raw) return null; const saved = manifest(raw), parts: string[] = []; for (let index = 0; index < saved.parts; index++) { const part = await adapter.get(`${prefix}.${saved.commit}.${index}`); if (part === null) throw new Error('An encrypted offline attendance chunk is missing. Its original data was kept.'); parts.push(part); } const value = parts.join(''); if (await adapter.digest(value) !== saved.hash) throw new Error('Offline attendance failed its integrity check. Its original data was kept.'); return value; },
    async write(value) {
      const characters = Array.from(value); if (characters.length > maxCharacters) throw new Error('Secure offline attendance storage is full. Sync retained captures before downloading more rosters.');
      const parts: string[] = []; for (let index = 0; index < characters.length; index += 256) parts.push(characters.slice(index, index + 256).join('')); if (!parts.length) parts.push('');
      const commit = adapter.randomId(), oldRaw = await adapter.get(slot), next = { version: 1, commit, parts: parts.length, hash: await adapter.digest(value) }; let written = 0, attemptedManifest = false;
      try { for (; written < parts.length; written++) await adapter.set(`${prefix}.${commit}.${written}`, parts[written]); attemptedManifest = true; await adapter.set(slot, JSON.stringify(next)); } catch (cause) { if (!attemptedManifest) for (let index = 0; index < written; index++) await adapter.remove(`${prefix}.${commit}.${index}`).catch(() => {}); throw cause; }
      if (oldRaw) { try { const old = manifest(oldRaw); for (let index = 0; index < old.parts; index++) await adapter.remove(`${prefix}.${old.commit}.${index}`).catch(() => {}); } catch { /* New committed data remains authoritative. */ } }
    },
  };
}

export class AttendanceOfflineQueue {
  private data: Document | null = null;
  private state: AttendanceOfflineState = { ready: false, blocked: false, busy: false, error: '', pending: [] };
  private subscribers = new Set<(state: AttendanceOfflineState) => void>();
  private operations: Promise<unknown> = Promise.resolve();
  private hydration?: Promise<void>;
  constructor(private options: { scope: NativePendingScope; storage: Storage; randomId(): string; digest(value: string): Promise<string> }) {}
  snapshot() { return this.state; }
  subscribe(callback: (state: AttendanceOfflineState) => void) { this.subscribers.add(callback); callback(this.state); return () => { this.subscribers.delete(callback); }; }
  private publish(changes: Partial<AttendanceOfflineState>) { this.state = { ...this.state, ...changes }; for (const subscriber of this.subscribers) subscriber(this.state); }
  private serialize<T>(operation: () => Promise<T>): Promise<T> { const result = this.operations.then(operation, operation); this.operations = result.catch(() => {}); return result; }
  private async commit(data: Document) { const serialized = JSON.stringify(data); if (Array.from(serialized).length > maxCharacters) { const error = new Error('Secure offline attendance storage is full. Sync retained captures before downloading more rosters.'); this.publish({ error: error.message }); throw error; } try { await this.options.storage.write(serialized); this.data = data; this.publish({ pending: detached(data.captures), error: '' }); } catch (cause) { this.publish({ blocked: true, error: message(cause) }); throw cause; } }
  private requireData() { if (!this.state.ready || this.state.blocked || !this.data) throw new Error(this.state.error || 'Secure offline attendance is not ready. Nothing was sent.'); return detached(this.data); }
  hydrate() { if (!this.hydration) this.hydration = this.serialize(async () => { try {
    const raw = await this.options.storage.read();
    if (!raw) { await this.commit({ version: 1, scope: this.options.scope, deviceId: `native-${this.options.randomId()}`, snapshots: [], captures: [], denied: [] }); }
    else {
      const value = JSON.parse(raw) as Document;
      if (value.version !== 1 || nativePendingScopeKey(value.scope) !== nativePendingScopeKey(this.options.scope) || !/^native-[0-9a-f-]{36}$/i.test(value.deviceId) || !Array.isArray(value.snapshots) || value.snapshots.length > 8 || !Array.isArray(value.captures) || value.captures.length > 16 || !Array.isArray(value.denied) || value.denied.some(key => typeof key !== 'string')) throw new Error('Offline attendance does not match this exact account, campus, world and server. Its data was kept.');
      for (const snapshot of value.snapshots) if (!attendanceOfflineScreenMatches(snapshot.screen, value.scope, snapshot.classId, snapshot.date)) throw new Error('A retained roster is invalid. Its data was kept.');
      const keys = new Set<string>();
      for (const capture of value.captures) {
        const body = JSON.parse(capture.body), key = entryKey(capture.classSectionId, capture.date);
        if (capture.version !== 1 || !uuid(capture.id) || nativePendingScopeKey(capture.scope) !== nativePendingScopeKey(value.scope) || !['queued', 'received'].includes(capture.phase) || !attendanceOfflineScreenMatches(capture.screen, value.scope, capture.classSectionId, capture.date) || body.class_section_id !== capture.classSectionId || body.date !== capture.date || body.expected_revision !== capture.screen.register.revision || capture.requestHash !== await this.options.digest(attendanceOfflineHashInput(body)) || keys.has(key)) throw new Error('A retained offline capture is invalid. Its original data was kept.');
        const normalized = attendanceOfflineBody(value.scope, capture.screen, { ...body, idempotency_key: capture.id }, value.deviceId, capture.createdAt);
        if (JSON.stringify(normalized) !== capture.body) throw new Error('A retained offline capture changed after preparation. Its data was kept.');
        if (capture.phase === 'received') { if (!capture.receipt || !['accepted', 'quarantined', 'rejected'].includes(attendanceOfflineReceipt(capture.receipt, capture).status)) throw new Error('The retained offline receipt is incomplete.'); }
        keys.add(key);
      }
      this.data = value; this.publish({ pending: detached(value.captures) });
    }
    this.publish({ ready: true });
  } catch (cause) { this.publish({ ready: true, blocked: true, error: message(cause) }); } }); return this.hydration; }
  async cacheSnapshot(screen: TeacherAttendanceResponse, now: string) { return this.serialize(async () => { const data = this.requireData(), local = screen as AttendanceOfflineScreen; if (local.local_capture || local.offline_snapshot || !attendanceOfflineScreenMatches(screen, data.scope)) throw new Error('Only an authoritative server roster can be downloaded.'); const key = entryKey(screen.class.id, screen.date); data.snapshots = data.snapshots.filter(item => entryKey(item.classId, item.date) !== key); data.snapshots.push({ classId: screen.class.id, date: screen.date, cachedAt: now, screen: detached(screen) }); while (data.snapshots.length > 8) data.snapshots.shift(); data.denied = data.denied.filter(item => item !== key); await this.commit(data); }); }
  async deny(classId: string, date: string) { return this.serialize(async () => { const data = this.requireData(), key = entryKey(classId, date); if (!data.denied.includes(key)) data.denied.push(key); data.snapshots = data.snapshots.filter(item => entryKey(item.classId, item.date) !== key); await this.commit(data); }); }
  view(classId: string, date: string, fresh: TeacherAttendanceResponse): AttendanceOfflineScreen { const capture = this.data?.captures.find(item => item.classSectionId === classId && item.date === date); return capture ? attendanceOfflineOverlay(capture) : fresh; }
  fallback(classId: string, date: string, now: string): AttendanceOfflineScreen | null { const data = this.requireData(), key = entryKey(classId, date); if (data.denied.includes(key)) return null; const snapshot = data.snapshots.find(item => entryKey(item.classId, item.date) === key); if (!snapshot || Date.parse(snapshot.screen.continuity_snapshot.expires_at) < Date.parse(now)) return null; const capture = data.captures.find(item => item.classSectionId === classId && item.date === date); return capture ? attendanceOfflineOverlay(capture, true) : { ...detached(snapshot.screen), offline_snapshot: true }; }
  async prepare(screen: TeacherAttendanceResponse, input: TeacherAttendanceSaveInput, now: string): Promise<AttendanceOfflineScreen> { return this.serialize(async () => {
    const data = this.requireData(), key = entryKey(screen.class.id, screen.date);
    if (data.denied.includes(key)) throw new Error('Current access refused this class. Reconnect and refresh before recording new observations.');
    const body = JSON.stringify(attendanceOfflineBody(data.scope, screen, input, data.deviceId, now)), existing = data.captures.find(item => item.classSectionId === screen.class.id && item.date === screen.date);
    if (existing) { if (existing.id === input.idempotency_key && existing.body === body) return attendanceOfflineOverlay(existing); throw new Error('This class and date already have retained observations. Sync the original capture before recording another.'); }
    if (data.captures.length >= 16) throw new Error('Sync the retained captures before saving another roster on this device.');
    const { offline_snapshot: _cached, local_capture: _local, ...original } = screen as AttendanceOfflineScreen;
    const capture: Capture = { version: 1, scope: data.scope, id: input.idempotency_key, classSectionId: screen.class.id, date: screen.date, createdAt: now, body, requestHash: await this.options.digest(attendanceOfflineHashInput(JSON.parse(body))), screen: detached(original), phase: 'queued' };
    data.snapshots = data.snapshots.filter(item => entryKey(item.classId, item.date) !== key); data.snapshots.push({ classId: screen.class.id, date: screen.date, cachedAt: now, screen: detached(original) }); while (data.snapshots.length > 8) data.snapshots.shift();
    data.captures.push(capture); await this.commit(data); return attendanceOfflineOverlay(capture);
  }); }
  async flush(context: { automatic?: boolean; assertCurrent(): void; send(capture: AttendanceOfflineCapture): Promise<unknown>; read(capture: AttendanceOfflineCapture): Promise<TeacherAttendanceResponse>; onConfirmed?(screen: TeacherAttendanceResponse, capture: AttendanceOfflineCapture): Promise<void> | void; now(): string }) { return this.serialize(async () => {
    const data = this.requireData(); if (context.automatic && data.scope.mode !== 'live') return; this.publish({ busy: true, error: '' });
    try {
      for (const source of [...data.captures]) {
        if (context.automatic && source.paused) continue;
        context.assertCurrent(); let current = source;
        try {
          if (current.phase === 'queued') {
            const receipt = attendanceOfflineReceipt(await context.send(detached(current)), current); context.assertCurrent();
            if (receipt.status === 'pending') { current = { ...current, error: 'The school retained these observations and is still processing them.' }; }
            else current = { ...current, phase: 'received', receipt, paused: false, error: undefined };
            data.captures = data.captures.map(item => item.id === current.id ? current : item); await this.commit(data); context.assertCurrent();
            if (current.phase !== 'received') continue;
          }
          const screen = await context.read(detached(current)); context.assertCurrent();
          if (!attendanceOfflineConfirmedRead(screen, current)) throw new Error('The refreshed school register did not prove this exact capture batch and its applied observations or recorded review status.');
          await context.onConfirmed?.(screen, current); context.assertCurrent();
          const key = entryKey(current.classSectionId, current.date); data.snapshots = data.snapshots.filter(item => entryKey(item.classId, item.date) !== key); data.snapshots.push({ classId: current.classSectionId, date: current.date, cachedAt: context.now(), screen: detached(screen) }); while (data.snapshots.length > 8) data.snapshots.shift(); data.denied = data.denied.filter(item => item !== key); data.captures = data.captures.filter(item => item.id !== current.id); await this.commit(data);
        } catch (cause) {
          // A stored terminal receipt is never resent, even if its read or UI refresh fails.
          const status = (cause as { status?: number } | null)?.status;
          if (typeof status === 'number' && status >= 400 && status < 500) { const key = entryKey(current.classSectionId, current.date); if (!data.denied.includes(key)) data.denied.push(key); data.snapshots = data.snapshots.filter(item => entryKey(item.classId, item.date) !== key); }
          data.captures = data.captures.map(item => item.id === current.id ? { ...current, paused: typeof status === 'number' && status >= 400 && status < 500, error: message(cause) } : item);
          await this.commit(data); this.publish({ error: message(cause) });
          try { context.assertCurrent(); } catch { break; }
          if (this.state.blocked) break;
        }
      }
    } finally { this.publish({ busy: false }); }
  }); }
}

const queues = new Map<string, Promise<AttendanceOfflineQueue>>();
export function attendanceOfflineQueue(scope: NativePendingScope) {
  const key = nativePendingScopeKey(scope); let promise = queues.get(key);
  if (!promise) {
    promise = Promise.all([import('./device-storage'), import('expo-crypto')]).then(async ([storage, crypto]) => {
      const digest = (value: string) => crypto.digestStringAsync(crypto.CryptoDigestAlgorithm.SHA256, value), prefix = `thatcampus.attendance-offline.${await digest(key)}`;
      const store = createAttendanceOfflineChunkStore({ get: storage.getItemAsync, set: (name, value) => storage.setItemAsync(name, value, { keychainAccessible: storage.WHEN_UNLOCKED_THIS_DEVICE_ONLY }), remove: storage.deleteItemAsync, randomId: crypto.randomUUID, digest }, prefix), queue = new AttendanceOfflineQueue({ scope, storage: store, randomId: crypto.randomUUID, digest });
      await queue.hydrate(); return queue;
    }); queues.set(key, promise);
  }
  return promise;
}
