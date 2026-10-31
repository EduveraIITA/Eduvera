import assert from 'node:assert/strict';
import test from 'node:test';
import { createGateLanguagePreferences, gateIdentityImageDataUri, gateIdentityImagePath, gateLanguagePreferenceKey, gateOfficePhoneHref, gateOperatorSection, gateOperatorSectionHref, GATE_IDENTITY_IMAGE_MAX_BYTES, loadGateIdentityImage } from '../src/lib/gate-operator-policy';
import { createCampusApiClient, type CampusFetch } from '../src/lib/api-client';
import { gateOperatorCopy, gateVisitorStatus } from '../src/features/gate/operator-copy';
import { gateVisitorEntryCopy } from '../src/features/gate/visitor-entry-copy';

const origin = 'https://campus.example', photoPath = '/api/v1/gate/schools/campus-a/visitors/person-a/photo/';
const png = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]);
const scope = { origin, actorId: 'actor-a', schoolId: 'campus-a' };
function deferred<T>() { let resolve!: (value: T) => void, reject!: (cause: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

test('Gate language is a collision-free actor/campus/server preference, independent of domain/world data', async () => {
  const values = new Map<string, string>(), prefs = createGateLanguagePreferences({ get: async key => values.get(key) ?? null, set: async (key, value) => { values.set(key, value); } });
  assert.equal(await prefs.read(scope), 'en'); await prefs.save(scope, 'hi'); assert.equal(await prefs.read(scope), 'hi');
  for (const foreign of [{ ...scope, actorId: 'actor-b' }, { ...scope, schoolId: 'campus-b' }, { ...scope, origin: 'https://another.example' }]) assert.equal(await prefs.read(foreign), 'en');
  assert.match(gateLanguagePreferenceKey(scope), /^[a-zA-Z0-9._-]+$/);
  assert.notEqual(gateLanguagePreferenceKey({ ...scope, actorId: 'a:b' }), gateLanguagePreferenceKey({ ...scope, actorId: 'a_b' }));
  assert.notEqual(gateLanguagePreferenceKey({ ...scope, actorId: '😀' }), gateLanguagePreferenceKey({ ...scope, actorId: '😁' }));
  values.set(gateLanguagePreferenceKey(scope), 'unrecognized'); assert.equal(await prefs.read(scope), 'en');
  assert.throws(() => gateLanguagePreferenceKey({ ...scope, actorId: '' }));
});

test('rapid language choices serialize per exact preference; a failed save does not poison the next choice', async () => {
  const first = deferred<void>(), started: string[] = [], saved: string[] = [];
  const prefs = createGateLanguagePreferences({ get: async () => saved.at(-1) ?? null, set: async (_key, value) => { started.push(value); if (started.length === 1) await first.promise; saved.push(value); } });
  const a = prefs.save(scope, 'hi'), b = prefs.save(scope, 'en'); await Promise.resolve(); await Promise.resolve(); assert.deepEqual(started, ['hi']);
  first.resolve(); await Promise.all([a,b]); assert.deepEqual(saved, ['hi','en']); assert.equal(await prefs.read(scope), 'en');
  let fail = true; const recover = createGateLanguagePreferences({ get: async () => null, set: async () => { if (fail) throw new Error('Storage unavailable'); } });
  await assert.rejects(recover.save(scope, 'hi')); fail = false; await recover.save(scope, 'en');
});

test('operator sections restore exact canonical query intent and preserve unrelated context during view changes', () => {
  const base = '/areas/in-out/operate';
  assert.equal(gateOperatorSection(base), 'operate');
  for (const section of ['operate','approvals','records','visitors'] as const) assert.equal(gateOperatorSection(`${base}?section=${section}`), section);
  for (const query of ['section=', 'section=unknown', 'section=approvals&section=records', 'section=records&section=records']) assert.equal(gateOperatorSection(`${base}?${query}`), null);
  const link = `${base}?section=records&visitor=old&visitor_page=3&visitor_filter=pending&attention_notification_id=exact&other=retained`;
  const destination = new URL(gateOperatorSectionHref(link, 'visitors'), origin);
  assert.equal(destination.pathname, base); assert.equal(destination.searchParams.get('section'), 'visitors'); assert.equal(destination.searchParams.get('visitor_filter'), 'pending');
  assert.equal(destination.searchParams.has('visitor'), false); assert.equal(destination.searchParams.has('visitor_page'), false); assert.equal(destination.searchParams.get('attention_notification_id'), 'exact'); assert.equal(destination.searchParams.get('other'), 'retained');
  assert.equal(new URL(gateOperatorSectionHref(link, 'operate'), origin).searchParams.has('section'), false);
  assert.equal(new URL(gateOperatorSectionHref(base, 'visitors'), origin).searchParams.get('visitor_filter'), 'active');
});

test('office phone handoff accepts an ordinary phone number without URL/dial-command injection', () => {
  assert.equal(gateOfficePhoneHref('+91 (532) 292-2000'), 'tel:+915322922000');
  for (const value of [null, '', '123', 'tel:+1234567', 'https://example.invalid', '123456?call=true', '*12345#', '+12;3456', '12345\n67890', '1'.repeat(21)]) assert.equal(gateOfficePhoneHref(value), null);
});

test('identity references reject foreign, credentialed, transformed and non-API URLs before any I/O', async () => {
  assert.equal(gateIdentityImagePath(photoPath, origin), photoPath); assert.equal(gateIdentityImagePath(origin + photoPath, origin), photoPath);
  const invalid = [undefined, '', ' ' + photoPath, '//evil.example' + photoPath, 'https://evil.example' + photoPath, 'https://campus.example.evil.test' + photoPath, 'https://user@campus.example' + photoPath, 'data:image/png;base64,secret', 'file:///private/photo.png', 'javascript:alert(1)', '/api/v1/auth/session/', photoPath + '?token=private', photoPath + '#fragment', '/api/v1/gate/../auth/photo/', '/api/v1/gate/%2e%2e/photo/', '/api/v1/gate/%252e%252e/photo/', '/api/v1/gate//photo/', '/api/v1/gate\\photo/', '/uploads/avatar.png'];
  let reads = 0;
  for (const reference of invalid) {
    assert.equal(gateIdentityImagePath(reference, origin), null, String(reference));
    await assert.rejects(loadGateIdentityImage({ reference, origin, signal: new AbortController().signal, assertCurrent() {}, read: async () => { reads++; throw new Error('Must not read'); } }));
  }
  assert.equal(reads, 0);
});

test('photo bytes remain image-only and bounded; source loss/cancellation after read cannot reveal a data URI', async () => {
  assert.match(gateIdentityImageDataUri(png, 'image/png'), /^data:image\/png;base64,/);
  for (const [bytes, mime] of [[png,'image/jpeg'], [png,'image/svg+xml'], [new Uint8Array(),'image/png'], [new Uint8Array(GATE_IDENTITY_IMAGE_MAX_BYTES+1),'image/png'], [new TextEncoder().encode('<svg onload="run()"/>'),'image/png']] as const) assert.throws(() => gateIdentityImageDataUri(bytes,mime));
  for (const change of ['person','scope','blur','background','cancel']) {
    const result = deferred<{ bytes: Uint8Array; mimeType: string; assertCurrent(): void }>(), controller = new AbortController(); let current = true;
    const read = loadGateIdentityImage({ reference: photoPath, origin, signal: controller.signal, assertCurrent() { if (!current) throw new Error('Original selected person lost its lease'); }, read: () => result.promise });
    if (change === 'cancel') controller.abort(); else current = false;
    result.resolve({ bytes: png, mimeType: 'image/png', assertCurrent() {} }); await assert.rejects(read);
  }
});

test('Gate image transport uses ordinary native auth/selected-world headers and no-store with no file/cache adapter', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const client = createCampusApiClient({ origin, fetcher: async (url, init) => { calls.push({url,init}); return new Response(png, { headers: { 'Content-Type': 'image/png' } }); } });
  client.bindApiSession('private-test-token', 'selected-isolated-world'); const image = await client.readGateIdentityImage(photoPath); assert.deepEqual(image.bytes,png);
  const call = calls[0]!, headers = new Headers(call.init.headers); assert.equal(headers.get('Authorization'),'Bearer private-test-token'); assert.equal(headers.get('X-ThatCampus-Execution-Environment'),'selected-isolated-world'); assert.equal(call.init.cache,'no-store'); assert.equal(call.init.credentials,'omit'); assert.equal(call.init.redirect,'error'); assert.equal(call.init.method,'GET'); assert.equal(call.url,origin+photoPath);
  for (const path of ['https://evil.example/photo/', '/api/v1/auth/session/', photoPath+'?token=x']) await assert.rejects(client.readGateIdentityImage(path));
  assert.equal(calls.length,1);
});

test('cookie image transport stays same-origin and stale Simulation/scope responses fail closed without Live fallback', async () => {
  let calls = 0; const pending = deferred<Response>();
  const client = createCampusApiClient({ origin, cookieSession: { readCsrfToken: () => 'csrf' }, fetcher: async (_url, init) => { calls++; const headers = new Headers(init.headers); assert.equal(init.credentials,'same-origin'); assert.equal(headers.get('Authorization'),null); assert.equal(headers.get('X-ThatCampus-Execution-Environment'),'world-a'); return pending.promise; } });
  client.bindCookieSession('world-a'); const image = client.readGateIdentityImage(photoPath); client.bindCookieSession('world-b'); pending.resolve(new Response(png,{headers:{'Content-Type':'image/png'}})); await assert.rejects(image,/context changed/); assert.equal(calls,1);
  client.bindCookieSession('world-a',true); await assert.rejects(client.readGateIdentityImage(photoPath),/Confirm the active campus/); assert.equal(calls,1);
  const omitted = createCampusApiClient({ origin, fetcher: async () => new Response(png,{headers:{'Content-Type':'image/png','X-ThatCampus-Source-Content-Omitted':'true'}}) }); omitted.bindApiSession('test','world-a'); await assert.rejects(omitted.readGateIdentityImage(photoPath),/metadata only/);
});

test('image stream and declared size are limited before a private 4MiB+ response can be retained', async () => {
  let cancelled = false;
  const fetcher: CampusFetch = async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(GATE_IDENTITY_IMAGE_MAX_BYTES+1)); }, cancel() { cancelled = true; } }),{headers:{'Content-Type':'image/png'}});
  const client = createCampusApiClient({origin,fetcher}); client.bindApiSession('test','world-a'); await assert.rejects(client.readGateIdentityImage(photoPath),/too large/); assert.equal(cancelled,true);
  const declared = createCampusApiClient({origin,fetcher:async()=>new Response(png,{headers:{'Content-Type':'image/png','Content-Length':String(GATE_IDENTITY_IMAGE_MAX_BYTES+1)}})}); declared.bindApiSession('test','world-a'); await assert.rejects(declared.readGateIdentityImage(photoPath),/too large/);
});

test('Hindi changes operating vocabulary and preserves unknown/user content instead of translating people or inventing state', () => {
  const en=gateOperatorCopy('en'),hi=gateOperatorCopy('hi'); assert.deepEqual(Object.keys(hi),Object.keys(en));
  for(const key of Object.keys(en) as Array<keyof typeof en>) assert.ok(hi[key].trim());
  assert.equal(hi.recordEntry,'प्रवेश दर्ज करें'); assert.equal(gateVisitorStatus('hi','unexpected-source-state'),'unexpected-source-state');
  const form=gateVisitorEntryCopy('hi'); assert.equal(form.parent,'अभिभावक'); assert.equal(form.name,'आगंतुक का नाम');
});
