import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { createBrowserDeviceStorage } from '../src/lib/device-storage-browser';
import { createBrowserPrivateFiles } from '../src/lib/browser-private-files';
import { pendingFileUriAllowed, leaveFileUriAllowed } from '../src/lib/private-file-policy.web';
import { privateUploadForm } from '../src/lib/upload-form.web';
import { facilitiesPhotoMetadata } from '../src/lib/facilities-native';
import { leaveFileType } from '../src/lib/attendance-leave-policy';

const crypto = webcrypto as unknown as Crypto, scope = JSON.stringify(['actor', 'campus', 'simulation', 'run-a', 'https://campus.example']);
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const bytes = new TextEncoder().encode('%PDF-1.7\nexact original document');
function fixture() { const indexedDB = new IDBFactory(), storage = createBrowserDeviceStorage({ indexedDB: () => indexedDB, crypto: () => crypto }); return { storage, files: createBrowserPrivateFiles(storage, () => crypto) }; }

test('real browser File/Blob bytes stage under an exact scoped durable handle and survive reload', async () => {
  const { storage, files } = fixture(), selected = files.addPicked(new File([bytes], 'evidence.pdf', { type: 'application/pdf' }), 'evidence.pdf', 'application/pdf');
  assert.ok(pendingFileUriAllowed(selected.uri, scope, true)); assert.equal(pendingFileUriAllowed(selected.uri, scope), false);
  const staged = await files.stage({ ...selected, hash: hash(bytes) }, scope, 'pending');
  assert.match(staged.uri, /^thatcampus-file:\/\/pending\//); assert.ok(!staged.uri.startsWith('file://'));
  assert.ok(pendingFileUriAllowed(staged.uri, scope)); assert.equal(pendingFileUriAllowed(staged.uri, scope + '-foreign'), false);
  const reloaded = createBrowserPrivateFiles(storage, () => crypto);
  assert.deepEqual((await reloaded.read(staged.uri)).bytes, bytes); await assert.rejects(reloaded.read(selected.uri), /unavailable or changed/);
  await files.remove(selected.uri); assert.deepEqual((await reloaded.read(staged.uri)).bytes, bytes);
  await reloaded.remove(staged.uri); await assert.rejects(reloaded.read(staged.uri), /unavailable or changed/);
});

test('durable uploads reject a foreign scope, different kind, altered hash, lost bytes and corrupt metadata', async () => {
  const { storage, files } = fixture(), selected = files.addPicked(new Blob([bytes]), 'evidence.pdf', 'application/pdf'), original = { ...selected, hash: hash(bytes) };
  await assert.rejects(files.stage({ ...original, hash: 'f'.repeat(64) }, scope, 'pending'), /unavailable or changed/);
  const saved = await files.stage(original, scope, 'pending');
  await assert.rejects(files.stage(saved, scope + 'foreign', 'pending'), /unavailable or changed/); await assert.rejects(files.stage(saved, scope, 'leave'), /unavailable or changed/);
  const key = `thatcampus.pending-file.${hash(new TextEncoder().encode(saved.uri))}`, raw = JSON.parse((await storage.getItemAsync(key))!);
  await storage.setItemAsync(key, JSON.stringify({ ...raw, bytes: btoa('different bytes') }));
  await assert.rejects(files.read(saved.uri), /unavailable or changed/); assert.equal(JSON.parse((await storage.getItemAsync(key))!).bytes, btoa('different bytes'));
  await storage.setItemAsync(key, JSON.stringify({ ...raw, scopeKey: 'foreign' })); await assert.rejects(files.read(saved.uri), /unavailable or changed/);
});

test('a denied staged write sends no replacement and preserves the selected original for review', async () => {
  const { storage } = fixture(), files = createBrowserPrivateFiles({ ...storage, setItemAsync: async () => { throw new Error('quota denied'); } }, () => crypto);
  const selected = files.addPicked(new Blob([bytes]), 'evidence.pdf', 'application/pdf');
  await assert.rejects(files.stage({ ...selected, hash: hash(bytes) }, scope, 'pending'), /quota denied/);
  assert.deepEqual((await files.read(selected.uri)).bytes, bytes);
});

test('browser leave handles stay separate and existing byte-signature/media policies still apply', async () => {
  const { files } = fixture(), selected = files.addPicked(new Blob([bytes]), 'evidence.pdf', 'application/pdf'), saved = await files.stage({ ...selected, hash: hash(bytes) }, scope, 'leave');
  assert.ok(leaveFileUriAllowed(saved.uri, scope)); assert.equal(leaveFileUriAllowed(saved.uri, scope + 'foreign'), false); assert.equal(pendingFileUriAllowed(saved.uri, scope), false);
  assert.equal(leaveFileType('evidence.pdf', (await files.read(saved.uri)).bytes), 'application/pdf');
  assert.throws(() => files.addPicked(new Blob([]), 'empty.pdf', 'application/pdf'), /nonempty/);
  assert.throws(() => files.addPicked(new Blob([new Uint8Array(11)]), 'too-big.pdf', 'application/pdf', 10), /size limit/);
  assert.throws(() => files.addPicked(new Blob([bytes]), '../unsafe.pdf', 'application/pdf'), /safe filename/);
  assert.throws(() => facilitiesPhotoMetadata('photo.png', 'image/png', bytes.length, bytes), /JPEG|PNG|match|supported/);
  assert.equal(leaveFileUriAllowed('file:///private/thatcampus-leave-pending/source', scope), false);
});

test('captured web data-URI photos become real selected handles with bounded original bytes', async () => {
  const { files } = fixture(), jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const read = await files.read(`data:image/jpeg;base64,${Buffer.from(jpeg).toString('base64')}`, 1024);
  assert.match(read.uri, /^thatcampus-picked:/); assert.deepEqual(read.bytes, jpeg);
  assert.equal(facilitiesPhotoMetadata('repair-photo.jpg', 'image/jpeg', jpeg.length, read.bytes).type, 'image/jpeg');
  await assert.rejects(files.read('https://foreign.example/photo.jpg'), /unavailable or changed/);
  await assert.rejects(files.read('data:image/svg+xml;base64,PHN2Zz4='), /captured photo/);
});

test('browser multipart uses a real named Blob, retains exact fields and snapshots bytes', async () => {
  const input = new Uint8Array(bytes), fields = { body: 'Exact note', client_id: 'original-command', expected_revision: '7' };
  const form = privateUploadForm({ fields, file: { name: 'evidence.pdf', type: 'application/pdf', size: input.length } }, input);
  input.fill(0); const file = form.get('file'); assert.ok(file instanceof Blob); assert.equal((file as File).name, 'evidence.pdf'); assert.equal(file.type, 'application/pdf'); assert.deepEqual(new Uint8Array(await file.arrayBuffer()), bytes);
  for (const [key, value] of Object.entries(fields)) assert.equal(form.get(key), value);
  assert.equal(form.get('command_id'), null); assert.equal([...form.keys()].length, 4);
  assert.throws(() => privateUploadForm({ fields, file: { name: 'evidence.pdf', type: 'application/pdf', size: bytes.length + 1 } }, bytes), /size changed/);
});

test('private previews preserve MIME type and exact bytes, then revoke their local Blob URL', async () => {
  const { files } = fixture(), selected = files.addPicked(new Blob([bytes]), 'evidence.pdf', 'application/pdf'), staged = await files.stage({ ...selected, hash: hash(bytes) }, scope, 'pending');
  const preview = await files.preview(staged.uri);
  try {
    assert.match(preview.uri, /^blob:/);
    const response = await fetch(preview.uri);
    assert.equal(response.headers.get('content-type'), 'application/pdf');
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  } finally { preview.release(); }
  await assert.rejects(fetch(preview.uri));
  assert.deepEqual((await files.read(staged.uri)).bytes, bytes);
});
