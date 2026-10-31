import assert from 'node:assert/strict';
import test from 'node:test';
import type { FacilitiesSettings, RepairDetail } from '../../packages/contracts/src/wire/features/facilities/facilitiesApi';
import { createInitialRepairPhotoAttempt, facilitiesAcceptedReadPath, facilitiesActionObsolete, facilitiesCanAddPhoto, facilitiesConfirmationPath, facilitiesCurrentReadMatches, facilitiesPhotoFingerprint, facilitiesPhotoMetadata, facilitiesPhotoPath, facilitiesReceiptMatches, facilitiesSettingsBody, facilitiesSettingsFingerprint, FACILITIES_PHOTO_MAX_BYTES } from '../src/lib/facilities-native';
import { NativePendingActionJournal, type NativePendingAction, type NativePendingScope } from '../src/lib/native-pending-action';

const school = '10000000-0000-4000-8000-000000000001', repairId = '20000000-0000-4000-8000-000000000001', key = '30000000-0000-4000-8000-000000000001', person = '40000000-0000-4000-8000-000000000001';
const root = `/api/v1/schools/${school}/facilities`, path = `${root}/repairs/${repairId}`;
const scope: NativePendingScope = { actorId: 'account', schoolId: school, mode: 'simulation', namespaceId: 'world-one', origin: 'https://campus.example' };
const file = { uri: 'file:///private/app/photo.png', name: 'photo.png', type: 'image/png', size: 8, hash: 'a'.repeat(64) };
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const settings: FacilitiesSettings = { revision: 0, handler_person_id: null, verifier_mode: 'reporter', verifier_person_id: null, emergency_contact: '', can_manage: true, configured: false };
const photo = { id: key, file_name: file.name, content_type: file.type, size: file.size, created_at: '2026-10-27T12:00:00Z', href: `${path}/photos/${key}` };
const detail = { id: repairId, revision: 4, state: 'reported', allowed_actions: { add_photo: true }, photos: [] } as unknown as RepairDetail;
const action: NativePendingAction = { version: 1, domain: 'facilities', scope, clientId: key, ownerHref: `/areas/facilities?repair_id=${repairId}`, endpoint: path + '/photos', refreshPath: path, method: 'POST', payload: { kind: 'multipart', fields: { command_id: key, expected_revision: '4' }, file }, source: { kind: 'facilities_photo', sourceId: repairId, revision: 4 }, phase: 'unknown', replayPolicy: 'same_request', createdAt: '2026-10-27T12:00:00Z' };
const receipt = { state: 'accepted', result: { id: repairId, revision: 5, action: 'photo_added' } };
const savedDetail = { ...detail, revision: 5, photos: [photo] };
const settingsAction: NativePendingAction = { ...action, ownerHref: '/areas/facilities?action=settings', endpoint: root + '/settings', refreshPath: root + '/settings', source: { kind: 'facilities_settings', sourceId: school, revision: 0 }, payload: { kind: 'json', body: JSON.stringify({ command_id: key, expected_revision: 0, handler_person_id: person, verifier_mode: 'reporter', verifier_person_id: null, emergency_contact: '' }) } };

test('repair photo validation matches owner MIME/signature, size and filename normalization', () => {
  assert.deepEqual(facilitiesPhotoMetadata('../private\\photo\n.png', 'IMAGE/PNG; charset=binary', 8, png), { name: 'photo_.png', type: 'image/png', size: 8 });
  assert.equal(facilitiesPhotoMetadata('camera.jpg', 'image/jpeg', 4, new Uint8Array([255, 216, 255, 0])).type, 'image/jpeg');
  assert.throws(() => facilitiesPhotoMetadata('spoof.jpg', 'image/jpeg', 8, png));
  assert.throws(() => facilitiesPhotoMetadata('empty.png', 'image/png', 0, new Uint8Array()));
  assert.throws(() => facilitiesPhotoMetadata('changed.png', 'image/png', 9, png));
  assert.throws(() => facilitiesPhotoMetadata('large.png', 'image/png', FACILITIES_PHOTO_MAX_BYTES + 1, png));
  assert.throws(() => facilitiesPhotoMetadata('other.webp', 'image/webp', 8, png));
});
test('private photo path requires current server-visible exact campus, repair, photo and metadata', () => {
  assert.equal(facilitiesPhotoPath(school, savedDetail, photo), photo.href);
  for (const changed of [{ ...photo, href: 'https://elsewhere.example/private.jpg' }, { ...photo, href: photo.href + '?token=secret' }, { ...photo, href: photo.href.replace(repairId, person) }, { ...photo, id: person }, { ...photo, size: 9 }, { ...photo, content_type: 'text/html' }]) assert.throws(() => facilitiesPhotoPath(school, savedDetail, changed));
  assert.throws(() => facilitiesPhotoPath(person, savedDetail, photo));
  assert.throws(() => facilitiesPhotoPath(school, { ...savedDetail, recovery_only: true }, photo));
  assert.throws(() => facilitiesPhotoPath(school, { ...savedDetail, access_transferred: true }, photo));
  assert.throws(() => facilitiesPhotoPath(school, { ...savedDetail, photos: [] }, photo));
});
test('photo authority and reviewed source change for closed, revoked, transferred and progressed repairs', () => {
  assert.equal(facilitiesCanAddPhoto(detail), true);
  for (const changed of [{ ...detail, state: 'closed' as const }, { ...detail, allowed_actions: { ...detail.allowed_actions, add_photo: false } }, { ...detail, recovery_only: true }, { ...detail, access_transferred: true }, { ...detail, photos: Array(20).fill(photo) }]) assert.equal(facilitiesCanAddPhoto(changed), false);
  assert.notEqual(facilitiesPhotoFingerprint(detail), facilitiesPhotoFingerprint({ ...detail, revision: 5 }));
  assert.notEqual(facilitiesPhotoFingerprint(detail), facilitiesPhotoFingerprint({ ...detail, external_view: true }));
  assert.notEqual(facilitiesPhotoFingerprint(detail), facilitiesPhotoFingerprint(savedDetail));
});
test('an optional report photo gets one initial attempt, never repeats on recovery/rerender and never silently advances its source', () => {
  const initial = createInitialRepairPhotoAttempt();
  initial.queue(repairId, repairId);
  assert.equal(initial.claim({ ...detail, id: person, revision: 1 }), null);
  assert.equal(initial.claim({ ...detail, revision: 1 }), 'upload');
  assert.equal(initial.claim({ ...detail, revision: 1 }), null);
  initial.queue(repairId, repairId); assert.equal(initial.claim({ ...detail, revision: 2 }), null);
  const changed = createInitialRepairPhotoAttempt(); changed.queue(repairId, repairId);
  assert.equal(changed.claim({ ...detail, revision: 2 }), 'review'); assert.equal(changed.claim({ ...detail, revision: 2 }), null);
  const closed = createInitialRepairPhotoAttempt(); closed.queue(repairId, repairId); assert.equal(closed.claim({ ...detail, revision: 1, state: 'closed' }), 'blocked');
  assert.throws(() => initial.queue(person, repairId));
});
test('first setup uses real revision zero and requires exact configured policy choices and management authority', () => {
  const values = { handler_person_id: person, verifier_mode: 'handler' as const, verifier_person_id: person, emergency_contact: '  Security 100  ' };
  assert.deepEqual(facilitiesSettingsBody(settings, values), { expected_revision: 0, handler_person_id: person, verifier_mode: 'handler', verifier_person_id: null, emergency_contact: 'Security 100' });
  assert.throws(() => facilitiesSettingsBody({ ...settings, can_manage: false }, values));
  assert.throws(() => facilitiesSettingsBody(settings, { ...values, handler_person_id: 'unverified' }));
  assert.throws(() => facilitiesSettingsBody(settings, { ...values, verifier_mode: 'named', verifier_person_id: null }));
  assert.throws(() => facilitiesSettingsBody(settings, { ...values, emergency_contact: 'x'.repeat(301) }));
  assert.notEqual(facilitiesSettingsFingerprint(settings), facilitiesSettingsFingerprint({ ...settings, revision: 1 }));
  assert.notEqual(facilitiesSettingsFingerprint(settings), facilitiesSettingsFingerprint({ ...settings, can_manage: false }));
});
test('photo 2xx validates exact immutable upload and current detail, then exact receipt validates original revision', () => {
  assert.equal(facilitiesAcceptedReadPath({ ...savedDetail, revision: 8 }, action), path);
  for (const value of [{ ...savedDetail, id: person }, { ...savedDetail, revision: 4 }, { ...savedDetail, photos: [] }, { ...savedDetail, photos: [{ ...photo, size: 9 }] }, { ...savedDetail, photos: [{ ...photo, file_name: 'different.png' }] }]) assert.throws(() => facilitiesAcceptedReadPath(value, action));
  assert.equal(facilitiesCurrentReadMatches(savedDetail, action), true);
  assert.equal(facilitiesCurrentReadMatches({ ...savedDetail, id: person }, action), false);
  assert.equal(facilitiesCurrentReadMatches({ ...savedDetail, revision: 4 }, action), false);
  assert.equal(facilitiesConfirmationPath(action), path + '/confirmation?command_id=' + key);
  assert.equal(facilitiesReceiptMatches(receipt, action), true);
  for (const changed of [{ state: 'pending', result: receipt.result }, { ...receipt, result: { ...receipt.result, id: person } }, { ...receipt, result: { ...receipt.result, revision: 8 } }, { ...receipt, result: { ...receipt.result, action: 'updated' } }]) assert.equal(facilitiesReceiptMatches(changed, action), false);
});
test('settings replay may return newer setup but only exact settings receipt confirms the retained command', () => {
  const latest = { ...settings, configured: true, revision: 3, handler_person_id: person, verifier_mode: 'handler' };
  assert.equal(facilitiesAcceptedReadPath(latest, settingsAction), root + '/settings');
  assert.equal(facilitiesCurrentReadMatches(latest, settingsAction), true);
  assert.equal(facilitiesConfirmationPath(settingsAction), root + '/settings/confirmation?command_id=' + key);
  assert.equal(facilitiesReceiptMatches({ state: 'accepted', result: { id: school, revision: 1 } }, settingsAction), true);
  assert.equal(facilitiesReceiptMatches({ state: 'accepted', result: { id: school, revision: 3 } }, settingsAction), false);
  assert.equal(facilitiesReceiptMatches({ state: 'accepted', result: { id: repairId, revision: 1 } }, settingsAction), false);
});
test('only exact owner obsolete proof retires an unaccepted original repair command', () => {
  const proof = { confirmation: 'permanently_inapplicable', receipt_state: 'absent', command_id: key, repair_id: repairId, expected_revision: 4, current_revision: 5, reason: 'stream_advanced' };
  const error = { status: 409, details: { error: { code: 'facilities_obsolete', fields: { facilities_obsolete: proof } } } };
  assert.equal(facilitiesActionObsolete(error, action), true);
  for (const change of [{ repair_id: person }, { command_id: person }, { expected_revision: 3 }, { current_revision: 4 }, { receipt_state: 'accepted' }, { reason: 'unknown' }]) assert.equal(facilitiesActionObsolete({ ...error, details: { error: { ...error.details.error, fields: { facilities_obsolete: { ...proof, ...change } } } } }, action), false);
  assert.equal(facilitiesActionObsolete({ ...error, status: 500 }, action), false);
});
test('lost photo reply retains identical bytes/key/revision after relaunch; accepted receipt recovery never sends again', async () => {
  let raw: string | null = null, reads = 0;
  const storage = { read: async () => raw, write: async (value: string) => { raw = value; }, clear: async () => { raw = null; } }, sent: NativePendingAction[] = [];
  const context = { ownerHref: action.ownerHref, refreshPath: path, assertActive() {}, resolveRefreshPath: facilitiesAcceptedReadPath, accepted(value: unknown, _assertActive: () => void, pending: NativePendingAction) { assert.equal(facilitiesCurrentReadMatches(value, pending), true); if (reads === 1) throw new Error('Receipt unavailable'); assert.equal(facilitiesReceiptMatches(receipt, pending), true); } };
  const create = (lost: boolean) => new NativePendingActionJournal({ scope, domain: 'facilities', storage, randomId: () => key, send: async pending => { sent.push(pending); if (lost) throw new Error('Lost response'); return savedDetail; }, read: async () => { reads++; return savedDetail; } });
  const first = create(true); await first.hydrate(); assert.equal(await first.run({ endpoint: path + '/photos', multipart: { fields: { expected_revision: 4 }, file }, source: action.source }, context), false);
  assert.equal(JSON.parse(raw!).phase, 'unknown'); assert.deepEqual(JSON.parse(raw!).payload.file, file);
  const next = create(false); await next.hydrate(); assert.equal(await next.recover(context), false); assert.deepEqual(sent[1], sent[0]); assert.equal(JSON.parse(raw!).phase, 'accepted');
  const last = create(false); await last.hydrate(); assert.equal(await last.recover(context), true); assert.equal(sent.length, 2); assert.equal(raw, null);
});
test('settings save persists exact keyed JSON before send and resumes the original reviewed choices', async () => {
  let raw: string | null = null;
  const storage = { read: async () => raw, write: async (value: string) => { raw = value; }, clear: async () => { raw = null; } }, sent: NativePendingAction[] = [];
  const latest = { ...settings, configured: true, revision: 2, handler_person_id: person }, exactReceipt = { state: 'accepted', result: { id: school, revision: 1 } };
  const create = (lost: boolean) => new NativePendingActionJournal({ scope, domain: 'facilities', storage, randomId: () => key, send: async pending => { assert.ok(raw); assert.equal(JSON.parse(raw!).phase, 'unknown'); sent.push(pending); if (lost) throw new Error('Lost response'); return latest; }, read: async () => latest });
  const context = { ownerHref: settingsAction.ownerHref, refreshPath: root + '/settings', assertActive() {}, resolveRefreshPath: facilitiesAcceptedReadPath, accepted(value: unknown, _assertActive: () => void, pending: NativePendingAction) { assert.equal(facilitiesCurrentReadMatches(value, pending), true); assert.equal(facilitiesReceiptMatches(exactReceipt, pending), true); } };
  const body = facilitiesSettingsBody(settings, { handler_person_id: person, verifier_mode: 'reporter', verifier_person_id: null, emergency_contact: 'Security' });
  const first = create(true); await first.hydrate(); assert.equal(await first.run({ endpoint: root + '/settings', body, serverKey: 'command_id', source: settingsAction.source }, context), false);
  const record = JSON.parse(raw!) as NativePendingAction; assert.equal(record.replayPolicy, 'same_request'); assert.deepEqual(record.payload, { kind: 'json', body: JSON.stringify({ ...body, command_id: key }) });
  const next = create(false); await next.hydrate(); assert.equal(await next.recover(context), true); assert.deepEqual(sent[1], sent[0]); assert.equal(raw, null);
});
test('secure storage failure or a changed source prevents a new photo send', async () => {
  let sends = 0;
  const failed = new NativePendingActionJournal({ scope, domain: 'facilities', storage: { read: async () => null, write: async () => { throw new Error('Keychain locked'); }, clear: async () => {} }, randomId: () => key, send: async () => { sends++; }, read: async () => savedDetail });
  await failed.hydrate(); assert.equal(await failed.run({ endpoint: path + '/photos', multipart: { fields: { expected_revision: 4 }, file }, source: action.source }, { ownerHref: action.ownerHref, refreshPath: path, assertActive() {} }), false); assert.equal(sends, 0);
  const changed = new NativePendingActionJournal({ scope, domain: 'facilities', storage: { read: async () => null, write: async () => {}, clear: async () => {} }, randomId: () => key, send: async () => { sends++; }, read: async () => savedDetail });
  await changed.hydrate(); assert.equal(await changed.run({ endpoint: path + '/photos', multipart: { fields: { expected_revision: 4 }, file }, source: { ...action.source!, revision: 5 } }, { ownerHref: action.ownerHref, refreshPath: path, assertActive() {} }), false); assert.equal(sends, 0);
});
