import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, webcrypto } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { ApiError } from '../src/lib/api-client';
import { assertGatePassSource, GatePassIssueJournal, gateManagementFilter, gateManagementPage, gatePassEndpoint, gatePassQr, gatePassStorageKey, readGateIssuedPass, readGatePassIntent, type GatePassIntent } from '../src/lib/gate-management';
import { createGatePassTemporaryFile, shareGatePassQr } from '../src/lib/gate-pass-share-core';
import { createBrowserDeviceStorage } from '../src/lib/device-storage-browser';

const school = '1167fda8-1428-45ec-86c2-7baf0bfdb024', person = '7098597b-84b0-4665-a91e-17375936fe68', other = '300739ff-2580-4d91-b69e-31b25e4883d3';
const scope = 'origin:local|actor:director|campus:one|simulation:isolated-world';
// Generated test data, never a development or Live bearer credential.
const token = `eduera-gate:${'a'.repeat(43)}`, now = '2026-10-29T12:00:00.000Z';
const response = { qr: token, kind: 'pickup', name: 'Synthetic learner', expires_at: '2026-10-29T12:15:00.000Z' };
const intent: GatePassIntent = { version: 1, scope, schoolId: school, subjectId: person, kind: 'pickup', phase: 'unknown' };
function store(initial: string | null = null) { let raw = initial; const writes: string[] = []; return { read: async () => raw, write: async (value: string) => { raw = value; writes.push(value); }, clear: async () => { raw = null; }, get raw() { return raw; }, writes }; }
const input = () => ({ kind: 'pickup' as const, subjectId: person, name: response.name, now, assertCurrent() {}, send: async () => response, accepted() {} });

test('Gate management filters/pages and pass routes remain bounded to exact owner endpoints', () => {
  assert.equal(gateManagementFilter('inside'), 'inside'); assert.equal(gateManagementFilter('unknown'), 'all');
  for (const value of [null, '0', '-1', '1.2', '01', '9999999999', '1x']) assert.equal(gateManagementPage(value), 1);
  assert.equal(gateManagementPage('12'), 12);
  assert.equal(gatePassEndpoint(school, person, 'pickup'), `/api/v1/gate/schools/${school}/passes/`);
  assert.equal(gatePassEndpoint(school, person, 'visitor'), `/api/v1/gate/schools/${school}/visitors/${person}/pass/`);
  assert.throws(() => gatePassEndpoint('../other', person, 'student'));
  assert.throws(() => gatePassEndpoint(school, 'https://outside.invalid', 'visitor'));
});
test('a pass response proves kind, recipient, opaque token and future expiry without retaining extra fields', () => {
  assert.deepEqual(readGateIssuedPass({ ...response, private_extra: 'omit' }, 'pickup', response.name, now), response);
  for (const change of [{ kind: 'student' }, { name: 'Other learner' }, { qr: 'free text' }, { expires_at: now }, { expires_at: 'invalid' }]) assert.throws(() => readGateIssuedPass({ ...response, ...change }, 'pickup', response.name, now));
  assert.throws(() => readGateIssuedPass(response, 'pickup', response.name, 'invalid clock'));
});
test('restored issuance metadata binds exact account/origin/campus/world and rejects private data', () => {
  assert.deepEqual(readGatePassIntent(intent, scope, school), intent);
  for (const change of [{ scope: scope.replace('simulation:isolated-world', 'live') }, { schoolId: other }, { subjectId: 'invalid' }, { phase: 'retry' }, { qr: token }, { name: response.name }, { response }]) assert.throws(() => readGatePassIntent({ ...intent, ...change }, scope, school));
});
test('the exact pass journal key round-trips through the real bounded encrypted browser adapter', async () => {
  const indexedDB = new IDBFactory(), crypto = webcrypto as unknown as Crypto, digest = async (value: string) => createHash('sha256').update(value).digest('hex');
  const key = await gatePassStorageKey(scope, school, digest), otherKey = await gatePassStorageKey(`${scope}:other-run`, school, digest);
  assert.match(key, /^thatcampus\.pending\.v1\.gate\.[a-f0-9]{64}$/); assert.notEqual(key, otherKey);
  const adapter = () => createBrowserDeviceStorage({ indexedDB: () => indexedDB, crypto: () => crypto });
  const journal = new GatePassIssueJournal(scope, school, { read: () => adapter().getItemAsync(key), write: value => adapter().setItemAsync(key, value, { keychainAccessible: 6 }), clear: () => adapter().deleteItemAsync(key) });
  await journal.hydrate(); assert.equal(journal.ready, true); assert.equal(journal.blocked, false);
  await assert.rejects(journal.issue({ ...input(), send: async () => { throw new Error('Unknown after dispatch'); } }));
  assert.deepEqual(readGatePassIntent(JSON.parse((await adapter().getItemAsync(key))!), scope, school), intent);
  assert.equal(await adapter().getItemAsync(otherKey), null);
  await assert.rejects(adapter().setItemAsync(`thatcampus.gate-pass.v1.${'a'.repeat(64)}`, 'unregistered'), /only scope-bound/);
  await assert.rejects(gatePassStorageKey(scope, school, async () => 'unbounded'), /journal key/);
});
test('current recipient/approval and dated pickup source must still match', () => {
  const visitor = { id: person, name: 'Synthetic visitor', revision: 2, school_id: school, state: 'approved' };
  assert.doesNotThrow(() => assertGatePassSource(visitor, visitor, 'visitor', school));
  for (const change of [{ id: other }, { name: 'Changed' }, { school_id: other }, { revision: 3 }, { state: 'denied' }]) assert.throws(() => assertGatePassSource(visitor, { ...visitor, ...change }, 'visitor', school));
  const pickup = { id: person, name: response.name, plan_state: 'ready', plan_id: other, plan_revision: 4, mode: 'guardian_pickup', authority_id: other };
  assert.doesNotThrow(() => assertGatePassSource(pickup, pickup, 'pickup', school));
  for (const change of [{ plan_state: 'pending' }, { plan_id: person }, { plan_id: null }, { plan_revision: 5 }, { plan_revision: null }, { mode: 'bus' }, { mode: 'independent_departure' }, { authority_id: person }, { authority_id: null }]) assert.throws(() => assertGatePassSource(pickup, { ...pickup, ...change }, 'pickup', school));
});
test('private QR is a bounded pure vector with quiet margin, without token or recipient in SVG text', () => {
  const qr = gatePassQr(token);
  assert.ok(qr.size > 20 && qr.size < 185); assert.match(qr.path, /^M\d+,\d+h1v1h-1z/);
  assert.match(qr.svg, /fill="#fff"/); assert.ok(!qr.svg.includes(token)); assert.ok(!qr.svg.includes(response.name));
  for (const match of qr.path.matchAll(/M(\d+),(\d+)/g)) { assert.ok(Number(match[1]) >= 4 && Number(match[1]) < qr.size - 4); assert.ok(Number(match[2]) >= 4 && Number(match[2]) < qr.size - 4); }
  assert.throws(() => gatePassQr('not-a-pass'));
});
test('issuance persists only nonsecret intent before the one POST and clears only after accepted owner result', async () => {
  const storage = store(), journal = new GatePassIssueJournal(scope, school, storage); await journal.hydrate();
  let sends = 0, accepted = 0;
  const result = await journal.issue({ ...input(), async send() { sends++; assert.equal(JSON.parse(storage.raw!).phase, 'unknown'); return response; }, accepted(pass) { accepted++; assert.equal(pass.qr, token); assert.equal(JSON.parse(storage.raw!).phase, 'accepted'); } });
  assert.equal(result.qr, token); assert.equal(sends, 1); assert.equal(accepted, 1); assert.equal(storage.raw, null); assert.equal(journal.pending, null);
  assert.equal(storage.writes.length, 2); assert.ok(storage.writes.every(value => !value.includes(token) && !value.includes(response.name) && !value.includes('expires_at')));
});
test('storage refusal or context loss before dispatch prevents POST', async () => {
  let sends = 0;
  const storage = store(), journal = new GatePassIssueJournal(scope, school, { ...storage, write: async () => { throw new Error('Storage refused'); } }); await journal.hydrate();
  await assert.rejects(journal.issue({ ...input(), async send() { sends++; return response; } }), /Storage refused/); assert.equal(sends, 0);
  let active = true; const second = store(), changed = new GatePassIssueJournal(scope, school, { ...second, write: async value => { await second.write(value); active = false; } }); await changed.hydrate();
  await assert.rejects(changed.issue({ ...input(), assertCurrent() { if (!active) throw new Error('Source changed'); }, async send() { sends++; return response; } }), /Source changed/);
  assert.equal(sends, 0); assert.equal(second.raw, null);
});
test('unknown dispatch locks new issuance across remount and exposes no replay method', async () => {
  const storage = store(), journal = new GatePassIssueJournal(scope, school, storage); await journal.hydrate(); let sends = 0;
  await assert.rejects(journal.issue({ ...input(), async send() { sends++; throw new Error('Disconnected after dispatch'); } }), /Disconnected/);
  assert.equal(journal.pending?.phase, 'unknown'); assert.equal(sends, 1);
  const restored = new GatePassIssueJournal(scope, school, storage); await restored.hydrate();
  await assert.rejects(restored.issue({ ...input(), async send() { sends++; return response; } }), /retained pass request/);
  await restored.finishAccepted(() => {}); assert.equal(restored.pending?.phase, 'unknown'); assert.equal(sends, 1);
  assert.equal('retry' in restored, false);
});
test('malformed/foreign response retains unknown result; only definite first refusal releases it', async () => {
  for (const result of [{ ...response, kind: 'student' }, { ...response, name: 'Foreign' }, { ...response, qr: 'bad' }]) {
    const storage = store(), journal = new GatePassIssueJournal(scope, school, storage); await journal.hydrate();
    await assert.rejects(journal.issue({ ...input(), send: async () => result })); assert.equal(journal.pending?.phase, 'unknown');
  }
  for (const status of [400, 401, 403, 404, 422, 408, 409, 429, 500]) {
    const storage = store(), journal = new GatePassIssueJournal(scope, school, storage); await journal.hydrate();
    await assert.rejects(journal.issue({ ...input(), send: async () => { throw new ApiError('Owner refusal', status); } }));
    assert.equal(journal.pending?.phase ?? null, [400, 401, 403, 404, 422].includes(status) ? null : 'unknown');
  }
});
test('accepted cleanup failure retains accepted metadata, and recovery only clears without another POST', async () => {
  let refuse = true, sends = 0; const storage = store(), journal = new GatePassIssueJournal(scope, school, { ...storage, clear: async () => { if (refuse) throw new Error('Cleanup failed'); await storage.clear(); } }); await journal.hydrate();
  await assert.rejects(journal.issue({ ...input(), async send() { sends++; return response; } }), /Cleanup failed/);
  assert.equal(journal.pending?.phase, 'accepted'); assert.ok(!storage.raw?.includes(token));
  refuse = false; await journal.finishAccepted(() => {}); assert.equal(sends, 1); assert.equal(journal.pending, null); assert.equal(storage.raw, null);
});
test('late context loss after accepted response keeps accepted metadata and never delivers a private QR', async () => {
  let active = true, delivered = false; const storage = store(), journal = new GatePassIssueJournal(scope, school, storage); await journal.hydrate();
  await assert.rejects(journal.issue({ ...input(), assertCurrent() { if (!active) throw new Error('Wrong world'); }, async send() { active = false; return response; }, accepted() { delivered = true; } }), /Wrong world/);
  assert.equal(journal.pending?.phase, 'accepted'); assert.equal(delivered, false);
});
test('corrupt/foreign retained issuance blocks new dispatch rather than silently dropping it', async () => {
  for (const raw of ['not-json', JSON.stringify({ ...intent, scope: 'other-world' }), JSON.stringify({ ...intent, qr: token })]) {
    const journal = new GatePassIssueJournal(scope, school, store(raw)); await assert.rejects(journal.hydrate());
    assert.equal(journal.ready, true); assert.equal(journal.blocked, true); await assert.rejects(journal.issue(input()), /retained pass request/);
  }
});
test('storage availability recovery re-reads the retained exact intent without clearing or sending it', async () => {
  let denied = true, writes = 0, clears = 0;
  const journal = new GatePassIssueJournal(scope, school, { async read() { if (denied) throw new Error('Storage unavailable'); return JSON.stringify(intent); }, async write() { writes++; }, async clear() { clears++; } });
  await assert.rejects(journal.hydrate()); assert.equal(journal.blocked, true);
  denied = false; await journal.hydrate(); assert.equal(journal.blocked, false); assert.deepEqual(journal.pending, intent); assert.equal(writes, 0); assert.equal(clears, 0);
});
test('a concurrent issuance or accepted cleanup cannot send a second POST', async () => {
  const storage = store(), journal = new GatePassIssueJournal(scope, school, storage); await journal.hydrate();
  let finish!: (value: unknown) => void, sends = 0;
  const pending = journal.issue({ ...input(), async send() { sends++; return new Promise(resolve => { finish = resolve; }); } });
  await Promise.resolve(); await assert.rejects(journal.issue(input())); await journal.finishAccepted(() => {});
  finish(response); await pending; assert.equal(sends, 1);
});
test('sharing uses a credential-free filename and private temporary SVG, then always removes it', async () => {
  for (const refusal of [false, true]) {
    const events: string[] = []; let bytes: Uint8Array = new Uint8Array();
    const adapter = { isAvailable: async () => true, async createTemporaryFile(name: string) { events.push(name); return { uri: 'private:temporary', async write(value: Uint8Array) { bytes = value; events.push('write'); }, async delete() { events.push('delete'); } }; }, async share(uri: string, options: { mimeType: string; dialogTitle: string }) { assert.equal(uri, 'private:temporary'); assert.equal(options.mimeType, 'image/svg+xml'); events.push('share'); if (refusal) throw new Error('Share refused'); } };
    const operation = shareGatePassQr(token, 'pickup', adapter, () => {}); if (refusal) await assert.rejects(operation, /Share refused/); else await operation;
    assert.deepEqual(events, ['thatcampus-pickup-qr.svg', 'write', 'share', 'delete']); assert.match(new TextDecoder().decode(bytes), /^<svg /); assert.ok(!new TextDecoder().decode(bytes).includes(token));
  }
});
test('context loss during temporary write cleans up without presenting the share surface', async () => {
  let active = true, shares = 0, deleted = 0;
  await assert.rejects(shareGatePassQr(token, 'student', { isAvailable: async () => true, async createTemporaryFile() { return { uri: 'private:temporary', async write() { active = false; }, async delete() { deleted++; } }; }, async share() { shares++; } }, () => { if (!active) throw new Error('Source lost'); }), /Source lost/);
  assert.equal(shares, 0); assert.equal(deleted, 1);
});
test('temporary native file creation refusal cannot delete an existing file', async () => {
  let deletes = 0, writes = 0;
  const file = { uri: 'private:owned-test', exists: true, create(options: { overwrite: boolean }) { assert.equal(options.overwrite, false); throw new Error('Existing file'); }, write() { writes++; }, delete() { deletes++; } };
  assert.throws(() => createGatePassTemporaryFile(file), /Existing file/); assert.equal(deletes, 0); assert.equal(writes, 0);
  const owned = createGatePassTemporaryFile({ ...file, create() {} }); await owned.write(new Uint8Array([1])); owned.delete();
  assert.equal(writes, 1); assert.equal(deletes, 1);
});
