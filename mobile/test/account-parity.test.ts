import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { safeAccountReturnTarget, accountReturnTitle } from '../src/auth/account-return';
import { nativeAuthDestination } from '../src/auth/auth-entry';
import { authenticatorQr } from '../src/auth/authenticator-qr';
import { confirmedDemoSwitch, confirmedNativeDemoSwitch, type DemoSwitchWire } from '../src/auth/demo-profile-policy';
import { createBrowserSessionController } from '../src/auth/web-session-controller';
import { ApiConnectionError, createCampusApiClient } from '../src/lib/api-client';
import type { SessionState } from '../src/auth/session-types';

const current = { id: 'actor-1', username: 'kavita.staff', email: 'fixture@example.test', first_name: 'Kavita', last_name: 'Mehta', display_name: 'Kavita Mehta', active_school_id: 'campus' };
const target = { ...current, id: 'actor-2', username: 'meera.principal' };
const selected = { role: 'admin' as const, username: target.username };
const live = { mode: 'live' as const, institution_id: 'campus', namespace_id: 'live:campus' };
const expiry = '2099-01-01T00:00:00.000Z';
const response: DemoSwitchWire = { user: target, public_demo: true, redirect_to: '/today', execution_environment: live, token_type: 'Bearer', access_token: `tc_native_${'a'.repeat(43)}`, expires_at: expiry };
const session: SessionState = { status: 'authenticated', user: { ...current, email_verified: true }, memberships: [{ id: 'member', school_id: 'campus', school_name: 'Campus', role: 'staff' }], environment: live, setupRequired: false, error: null };

test('account returns preserve exact known in-app query context and reject unsafe destinations', () => {
  assert.equal(safeAccountReturnTarget('/areas/fees?student_id=fixture&section=receipts'), '/areas/fees?student_id=fixture&section=receipts');
  assert.equal(safeAccountReturnTarget('/more/account?from=%2Ftoday'), '/more/account?from=%2Ftoday');
  assert.equal(safeAccountReturnTarget('/account/profile?from=%2Fareas%2Ffees'), '/more/account?from=%2Fareas%2Ffees');
  assert.equal(safeAccountReturnTarget('/account/security?from=%2Faccount%2Fprofile'), '/more/account/security?from=%2Faccount%2Fprofile');
  for (const path of ['https://evil.test', '//evil.test/more', '/\\evil.test', '/more/%2fprivate', '/more/%2e%2e/login', '/login', '/signup', '/arbitrary', '/areas/fees\n']) assert.equal(safeAccountReturnTarget(path), null, path);
  assert.equal(accountReturnTitle('/areas/fees?student_id=fixture'), 'Fees');
  assert.equal(accountReturnTitle('/more/account?from=/today'), 'Profile');
  assert.equal(nativeAuthDestination(session, '/today?section=attention'), '/today?section=attention');
  assert.equal(nativeAuthDestination(session, '/workspace'), '/workspace');
  assert.equal(nativeAuthDestination({ ...session, user: { ...session.user!, email_verified: false } }, '/more/account?from=%2Fareas%2Ffees'), '/more/account/security?from=%2Fmore%2Faccount%3Ffrom%3D%252Fareas%252Ffees');
});

test('native demo switch validates selected identity, Live, expiry and unchanged read-only restriction', () => {
  assert.equal(confirmedNativeDemoSwitch(response, selected, current, true, expiry).id, target.id);
  for (const patch of [{ public_demo: false }, { redirect_to: '//evil.test' }, { execution_environment: { mode: 'simulation' as const } }, { user: { ...target, username: 'another.person' } }, { user: { ...target, id: current.id } }, { token_type: 'Cookie' }, { expires_at: 'invalid' }, { expires_at: '2000-01-01' }, { access_token: undefined }]) assert.throws(() => confirmedNativeDemoSwitch({ ...response, ...patch }, selected, current, true, expiry));
  const retained = { ...response, user: current, access_token: undefined, session_retained: true };
  assert.equal(confirmedNativeDemoSwitch(retained, { role: 'staff', username: current.username }, current, true, expiry).id, current.id);
  assert.throws(() => confirmedNativeDemoSwitch({ ...retained, access_token: response.access_token }, { role: 'staff', username: current.username }, current, true, expiry));
  assert.throws(() => confirmedNativeDemoSwitch(retained, { role: 'staff', username: current.username }, current, true, '2098-01-01T00:00:00.000Z'));
  assert.throws(() => confirmedDemoSwitch({ ...response, user: { ...target, id: current.id } }, selected, current, true));
});

test('authenticator QR SVG geometry round-trips through an independent scanner with a quiet border', () => {
  // Reuse the owning web test dependency only in this Node test. The native
  // runtime imports neither the frontend package nor the scanner.
  const jsQR = createRequire(import.meta.url)('jsqr');
  const uri = 'otpauth://totp/ThatCampus%3Afixture%40example.test?secret=JBSWY3DPEHPK3PXP&issuer=ThatCampus';
  const qr = authenticatorQr(uri), scale = 6, size = qr.size * scale;
  const pixels = new Uint8ClampedArray(size * size * 4).fill(255);
  const squares = [...qr.path.matchAll(/M(\d+),(\d+)h1v1h-1z/g)];
  assert.ok(squares.length > 100);
  for (const square of squares) {
    const x = Number(square[1]), y = Number(square[2]);
    assert.ok(x >= 4 && y >= 4 && x < qr.size - 4 && y < qr.size - 4);
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) { const offset = ((y * scale + dy) * size + x * scale + dx) * 4; pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 0; }
  }
  assert.equal(jsQR(pixels, size, size)?.data, uri);
  for (const invalid of ['https://evil.test/?secret=JBSWY3DPEHPK3PXP', 'otpauth://hotp/fixture?secret=JBSWY3DPEHPK3PXP', 'otpauth://totp/fixture', 'otpauth://totp/fixture?secret=not-a-key']) assert.throws(() => authenticatorQr(invalid));
});

test('browser profile switching uses owning cookie ceremony and verifies the selected actor without native credentials', async () => {
  const calls: Array<{ path: string; init: RequestInit }> = [], states: SessionState[] = [];
  let actor = current;
  const api = createCampusApiClient({ origin: 'https://campus.example', cookieSession: { readCsrfToken: () => 'signed.proof' }, fetcher: async (url, init) => {
    const path = new URL(url).pathname; calls.push({ path, init });
    const value = path === '/api/v1/auth/session/' ? { authenticated: true, user: actor, public_demo: true, execution_environment: live }
      : path === '/api/v1/auth/me/' ? { user: actor, memberships: session.memberships, execution_environment: live }
      : path === '/api/v1/auth/demo-profile-switch/' ? (actor = target, { ...response, access_token: undefined, token_type: undefined }) : {};
    return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
  } });
  const controller = createBrowserSessionController({ api, onState: state => states.push(state), clearQueries() {}, isExplicitlyLoggedOut: () => false, markExplicitlyLoggedOut() {}, announceChange() {} });
  await controller.refresh(); await controller.switchDemoProfile(selected);
  assert.equal(states.at(-1)?.user?.id, target.id); assert.equal(states.at(-1)?.publicDemo, true);
  assert.deepEqual(calls.map(call => call.path), ['/api/v1/auth/session/', '/api/v1/auth/me/', '/api/v1/auth/csrf/', '/api/v1/auth/demo-profile-switch/', '/api/v1/auth/session/', '/api/v1/auth/me/']);
  assert.deepEqual(JSON.parse(calls[3]!.init.body as string), { role: 'admin' });
  assert.ok(calls.every(call => call.init.credentials === 'same-origin' && !new Headers(call.init.headers).has('Authorization')));
  await assert.rejects(api.apiFetch('/api/v1/auth/native/session/'), /unavailable in the browser/);
});

test('a lost browser switch response stays unconfirmed and is never automatically repeated', async () => {
  let switches = 0; const states: SessionState[] = [];
  const api = createCampusApiClient({ origin: 'https://campus.example', cookieSession: { readCsrfToken: () => 'signed.proof' }, fetcher: async (url) => {
    const path = new URL(url).pathname;
    if (path === '/api/v1/auth/demo-profile-switch/') { switches++; throw new Error('Response lost after rotation'); }
    return new Response(JSON.stringify(path.endsWith('/session/') ? { authenticated: true, user: current, public_demo: true, execution_environment: live } : path.endsWith('/me/') ? { user: current, memberships: session.memberships, execution_environment: live } : {}), { headers: { 'Content-Type': 'application/json' } });
  } });
  const controller = createBrowserSessionController({ api, onState: state => states.push(state), clearQueries() {}, isExplicitlyLoggedOut: () => false, markExplicitlyLoggedOut() {}, announceChange() {} });
  await controller.refresh(); await assert.rejects(controller.switchDemoProfile(selected), cause => {
    assert.ok(cause instanceof ApiConnectionError); assert.equal(cause.status, undefined);
    assert.match(cause.message, /An action may have completed; refresh before repeating it/);
    assert.doesNotMatch(cause.message, /Response lost after rotation/); return true;
  });
  assert.equal(switches, 1); assert.equal(states.at(-1)?.status, 'error');
  await assert.rejects(api.apiFetch('/api/v1/workspace'), /Confirm the active campus/);
  await assert.rejects(controller.switchDemoProfile(selected), /Confirm your current account/); assert.equal(switches, 1);
});
