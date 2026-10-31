import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiConnectionError, ApiError, createCampusApiClient, type CampusResponse } from '../src/lib/api-client';
import { createBrowserSessionController } from '../src/auth/web-session-controller';
import { browserAuthMutation } from '../src/auth/web-auth-mutation';
import { browserCsrfToken, confirmedBrowserEnvironment, isBrowserSessionSignal, verifiedBrowserProfile, type BrowserProfileWire, type BrowserSessionWire } from '../src/auth/web-session-policy';
import type { SessionState } from '../src/auth/session-types';

const user = { id: 'actor-1', username: 'member', email: 'member@example.test', first_name: 'Member', last_name: '', display_name: 'Member', active_school_id: 'school-1' };
const live = { mode: 'live', institution_id: 'school-1', namespace_id: 'live:school-1' };
const simulation = { mode: 'simulation', institution_id: 'school-1', namespace_id: 'scenario:s:run:r', run_id: 'r', virtual_clock: { now: '2026-10-29T08:00:00Z', time_zone: 'Asia/Kolkata' } };
const session = (environment: unknown = live): BrowserSessionWire => ({ authenticated: true, user, execution_environment: environment });
const profile = (environment: unknown = live): BrowserProfileWire => ({ user, memberships: [{ id: 'membership-1', school_id: 'school-1', school_name: 'Campus', role: 'member' }], execution_environment: environment });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function fixture(handle?: (path: string, init: RequestInit) => Promise<CampusResponse>) {
  const calls: Array<{ path: string; init: RequestInit }> = [], states: SessionState[] = [];
  let loggedOut = false, announcements = 0, clears = 0, environment: unknown = live;
  const api = createCampusApiClient({ origin: 'https://campus.example', cookieSession: { readCsrfToken: () => 'signed-cookie.proof' }, fetcher: (url, init) => {
    const path = new URL(url).pathname; calls.push({ path, init });
    if (handle) return handle(path, init);
    if (path === '/api/v1/auth/session/') return Promise.resolve(json(session(environment)));
    if (path === '/api/v1/auth/me/') return Promise.resolve(json(profile(environment)));
    if (path === '/api/v1/auth/logout/') return Promise.resolve(new Response(null, { status: 204 }));
    return Promise.resolve(json(path.endsWith('/login/') || path.endsWith('/register/') ? { user } : { ok: true }));
  } });
  const controller = createBrowserSessionController({ api, onState: state => states.push(state), clearQueries: () => { clears++; }, isExplicitlyLoggedOut: () => loggedOut, markExplicitlyLoggedOut: value => { loggedOut = value; }, announceChange: () => { announcements++; } });
  api.setApiCallbacks(controller.expire, () => { void controller.refresh(); });
  return { api, controller, calls, states, latest: () => states.at(-1)!, isLoggedOut: () => loggedOut, setLoggedOut: (value: boolean) => { loggedOut = value; }, setEnvironment: (value: unknown) => { environment = value; }, announcements: () => announcements, clears: () => clears };
}

test('CSRF copies the decoded complete signed cookie and refuses ambiguous or malformed cookies', () => {
  assert.equal(browserCsrfToken('theme=dark; csrftoken=secret.signed%2Bproof; other=value'), 'secret.signed+proof');
  for (const value of ['', 'csrftoken=', 'csrftoken=one; csrftoken=two', 'csrftoken=%', 'csrftoken=bad%0Aheader']) assert.equal(browserCsrfToken(value), null);
});
test('browser profile requires the exact actor, campus and server world in both reads', () => {
  assert.equal(verifiedBrowserProfile(session(), profile()).user?.id, user.id);
  assert.throws(() => verifiedBrowserProfile(session(), { ...profile(), user: { ...user, id: 'another-actor' } }), /account context/);
  assert.throws(() => verifiedBrowserProfile(session(), profile(), 'another-actor'), /account context/);
  assert.throws(() => verifiedBrowserProfile(session(), profile(simulation)), /environment changed/);
  assert.throws(() => verifiedBrowserProfile(session(), { ...profile(), user: { ...user, active_school_id: 'school-2' } }), /environment changed/);
  assert.throws(() => verifiedBrowserProfile(session({ ...live, institution_id: 'school-2' }), profile({ ...live, institution_id: 'school-2' })), /active campus/);
});
test('missing and malformed Simulation descriptors never fall back to Live', () => {
  for (const value of [undefined, {}, { mode: 'other' }, { ...simulation, virtual_clock: undefined }, { ...simulation, virtual_clock: { now: 'invalid', time_zone: 'Asia/Kolkata' } }, { ...simulation, virtual_clock: { now: '2026-10-29T08:00:00Z', time_zone: 'Invalid/TimeZone' } }]) assert.throws(() => confirmedBrowserEnvironment(value));
  const unavailable = { ...simulation, unavailable: true, unavailable_reason: 'runtime_unavailable', virtual_clock: undefined };
  const verified = verifiedBrowserProfile(session(unavailable), profile(unavailable));
  assert.equal(verified.status, 'authenticated'); assert.equal(verified.environment.mode, 'simulation'); assert.equal(verified.environment.unavailable, true); assert.equal(verified.environment.virtual_clock, undefined);
});
test('peer signals carry no trusted session and malformed signals are ignored', () => {
  assert.equal(isBrowserSessionSignal({ version: 1, kind: 'session-environment-changed', senderId: 'peer', nonce: 'unique' }), true);
  for (const value of [null, [], {}, { version: 1, kind: 'session-environment-changed', senderId: 'peer' }, { version: 2, kind: 'session-environment-changed', senderId: 'peer', nonce: 'x' }]) assert.equal(isBrowserSessionSignal(value), false);
});
test('bootstrap confirms cookie actor and world before permitting a domain read', async () => {
  const f = fixture();
  await assert.rejects(f.api.apiFetch('/api/v1/workspace'), /Confirm the active campus/);
  await f.controller.refresh();
  assert.equal(f.latest().status, 'authenticated'); assert.equal(f.latest().environment.namespace_id, 'live:school-1');
  await f.api.apiFetch('/api/v1/workspace');
  assert.deepEqual(f.calls.map(call => call.path), ['/api/v1/auth/session/', '/api/v1/auth/me/', '/api/v1/workspace']);
  assert.equal(new Headers(f.calls.at(-1)!.init.headers).get('X-ThatCampus-Execution-Environment'), 'live:school-1');
  assert.ok(f.calls.every(call => new Headers(call.init.headers).get('Authorization') === null && call.init.credentials === 'same-origin'));
});
test('cookie login uses current account endpoints and verifies the cookie rather than trusting the login body', async () => {
  const f = fixture(); assert.equal(await f.controller.login(' member@example.test ', 'password'), null);
  assert.deepEqual(f.calls.map(call => call.path), ['/api/v1/auth/csrf/', '/api/v1/auth/login/', '/api/v1/auth/session/', '/api/v1/auth/me/']);
  assert.deepEqual(JSON.parse(f.calls[1]!.init.body as string), { identifier: user.email, password: 'password' });
  assert.equal(f.latest().status, 'authenticated'); assert.equal(f.announcements(), 1);
});
test('an MFA challenge does not unblock data or read a profile', async () => {
  const f = fixture(path => Promise.resolve(json(path === '/api/v1/auth/login/' ? { mfa_required: true, challenge_token: 'challenge' } : {})));
  assert.equal(await f.controller.login('member', 'password'), 'challenge');
  assert.equal(f.latest().status, 'anonymous'); assert.deepEqual(f.calls.map(call => call.path), ['/api/v1/auth/csrf/', '/api/v1/auth/login/']);
  assert.ok(f.states.every(state => state.status === 'anonymous'), 'The login form must stay mounted while its challenge is returned.');
  await assert.rejects(f.api.apiFetch('/api/v1/workspace'), /Confirm the active campus/);
});

test('Google sign-in uses the current CSRF/cookie owner and confirms the same account before continuing',async () => {
  const f = fixture(path => Promise.resolve(json(path === '/api/v1/auth/google/' ? { user } : path === '/api/v1/auth/session/' ? session() : path === '/api/v1/auth/me/' ? profile() : {})));
  assert.equal(await f.controller.googleLogin('exact.google.proof'),null);
  assert.deepEqual(f.calls.map(row => row.path),['/api/v1/auth/csrf/','/api/v1/auth/google/','/api/v1/auth/session/','/api/v1/auth/me/']);
  assert.deepEqual(JSON.parse(f.calls[1]!.init.body as string),{ credential: 'exact.google.proof' });
  assert.equal(new Headers(f.calls[1]!.init.headers).get('Authorization'),null); assert.equal(f.latest().user?.id,user.id); assert.equal(f.latest().environment.mode,'live');
});
test('Google MFA remains a challenge and uses the existing MFA owner without granting an early session',async () => {
  const f = fixture(path => Promise.resolve(json(path === '/api/v1/auth/google/' ? { mfa_required: true,challenge_token: 'google-challenge' } : {})));
  assert.equal(await f.controller.googleLogin('exact.google.proof'),'google-challenge'); assert.equal(f.latest().status,'anonymous'); assert.equal(f.calls.length,2);
  await assert.rejects(f.api.apiFetch('/api/v1/workspace'),/Confirm the active campus/);
});
test('a departed Google form cannot POST its credential after CSRF preparation',async () => {
  const waiting = deferred<CampusResponse>(),started = deferred<void>(); let focused = true;
  const f = fixture(path => { if (path === '/api/v1/auth/csrf/') { started.resolve(); return waiting.promise; } return Promise.resolve(json({ user })); });
  const pending = f.controller.googleLogin('exact.google.proof',{ returnHref: '/login?next=%2Fjoin',assertCurrent() { if (!focused) throw new Error('form changed'); } });
  const rejected = assert.rejects(pending,/form changed/); await started.promise; focused = false; waiting.resolve(json({})); await rejected;
  assert.deepEqual(f.calls.map(row => row.path),['/api/v1/auth/csrf/']); assert.equal(f.latest().status,'anonymous');
});
test('late Google credential response after logout cannot install or override the next account',async () => {
  const waiting=deferred<CampusResponse>(),started=deferred<void>();
  const f=fixture(path => { if (path==='/api/v1/auth/google/') { started.resolve(); return waiting.promise; } if (path==='/api/v1/auth/logout/') return Promise.resolve(new Response(null,{ status:204 })); return Promise.resolve(json(path==='/api/v1/auth/session/'?session():path==='/api/v1/auth/me/'?profile():path==='/api/v1/auth/login/'?{ user }:{})); });
  const first=f.controller.googleLogin('old.google.proof'),rejected=assert.rejects(first,/context changed/);await started.promise;
  const out=f.controller.logout(),next=f.controller.login('next','password');waiting.resolve(json({ user:{...user,id:'old-google-actor'} }));await rejected;await out;await next;
  assert.equal(f.latest().user?.id,user.id);assert.deepEqual(f.calls.filter(row=>row.init.method==='POST').map(row=>row.path),['/api/v1/auth/google/','/api/v1/auth/logout/','/api/v1/auth/login/']);
});
test('malformed Google proof and an existing authenticated account never start another Google sign-in',async () => {
  const f=fixture();assert.throws(()=>f.controller.googleLogin('bad proof'),/valid sign-in proof/);assert.equal(f.calls.length,0);
  await f.controller.refresh();const before=f.calls.length;await assert.rejects(f.controller.googleLogin('exact.google.proof'),/Sign out/);assert.equal(f.calls.length,before);
});
test('same-identity foreground verification retains query data and screen identity until confirmed', async () => {
  const f = fixture(); await f.controller.refresh(); const before = f.clears();
  f.controller.suspend(); assert.equal(f.latest().status, 'loading'); assert.equal(f.latest().user?.id, user.id); assert.equal(f.clears(), before);
  await assert.rejects(f.api.apiFetch('/api/v1/workspace'), /Confirm the active campus/);
  await f.controller.refresh(); assert.equal(f.latest().status, 'authenticated'); assert.equal(f.clears(), before);
  f.setEnvironment(simulation); await f.controller.refresh(); assert.ok(f.clears() > before); assert.equal(f.latest().environment.mode, 'simulation');
});
test('MFA completion and registration confirm ordinary cookie sessions without native token fields', async () => {
  const mfa = fixture(); await mfa.controller.completeMfa('exact-challenge', 'exact-code');
  assert.equal(mfa.latest().status, 'authenticated');
  assert.deepEqual(JSON.parse(mfa.calls[1]!.init.body as string), { challenge_token: 'exact-challenge', code: 'exact-code' });
  assert.equal(mfa.calls[1]!.path, '/api/v1/auth/mfa/login/');
  const registration = fixture(); await registration.controller.register(' member@example.test ', 'password');
  assert.equal(registration.calls[1]!.path, '/api/v1/auth/register/');
  assert.deepEqual(JSON.parse(registration.calls[1]!.init.body as string), { email: user.email, password: 'password' });
  assert.equal(registration.latest().status, 'authenticated');
});
test('a successful login body cannot install a different cookie account', async () => {
  const f = fixture(path => Promise.resolve(json(path === '/api/v1/auth/session/' ? { ...session(), user: { ...user, id: 'foreign-actor' } } : path === '/api/v1/auth/me/' ? { ...profile(), user: { ...user, id: 'foreign-actor' } } : { user })));
  await assert.rejects(f.controller.login('member', 'password'), /account context/);
  assert.equal(f.latest().status, 'anonymous'); await assert.rejects(f.api.apiFetch('/api/v1/workspace'), /Confirm the active campus/);
});
test('explicit logout prevents accidental restoration of a still-active remote cookie', async () => {
  const f = fixture(); f.setLoggedOut(true); await f.controller.refresh();
  assert.equal(f.latest().status, 'anonymous'); assert.equal(f.calls.length, 0);
  await assert.rejects(f.api.apiFetch('/api/v1/workspace'), /Confirm the active campus/);
  await f.controller.login('member', 'password'); assert.equal(f.isLoggedOut(), false); assert.equal(f.latest().status, 'authenticated');
});
test('logout lets an old cookie-setting response settle and revokes it before a later sign-in', async () => {
  const late = deferred<CampusResponse>(), started = deferred<void>(); let loginCalls = 0;
  const f = fixture((path) => {
    if (path === '/api/v1/auth/login/' && loginCalls++ === 0) { started.resolve(); return late.promise; }
    if (path === '/api/v1/auth/session/') return Promise.resolve(json(session()));
    if (path === '/api/v1/auth/me/') return Promise.resolve(json(profile()));
    if (path === '/api/v1/auth/logout/') return Promise.resolve(new Response(null, { status: 204 }));
    return Promise.resolve(json(path === '/api/v1/auth/login/' ? { user } : {}));
  });
  const login = f.controller.login('old', 'password'), rejected = assert.rejects(login, /context changed/); await started.promise;
  const logout = f.controller.logout();
  const current = f.controller.login('new', 'password');
  assert.equal(f.calls.find(call => call.path === '/api/v1/auth/login/')?.init.signal?.aborted, false);
  late.resolve(json({ user })); await rejected; await logout; await current;
  const mutations = f.calls.filter(call => call.init.method === 'POST').map(call => call.path);
  assert.deepEqual(mutations, ['/api/v1/auth/login/', '/api/v1/auth/logout/', '/api/v1/auth/login/']);
  assert.equal(f.latest().status, 'authenticated'); assert.equal(f.isLoggedOut(), false);
});
test('uncertain remote logout keeps local sign-out and blocks all domain traffic', async () => {
  const f = fixture(path => path === '/api/v1/auth/logout/' ? Promise.reject(new TypeError('offline')) : Promise.resolve(json({})));
  await f.controller.logout(); assert.equal(f.isLoggedOut(), true); assert.equal(f.latest().status, 'anonymous'); assert.match(f.latest().error!, /Remote sign-out could not be confirmed/);
  await f.controller.refresh(); assert.equal(f.calls.length, 1); assert.match(f.latest().error!, /Remote sign-out could not be confirmed/); await assert.rejects(f.api.apiFetch('/api/v1/workspace'), /Confirm the active campus/);
});
test('unavailable Simulation remains selected and blocked while account recovery still works', async () => {
  const f = fixture(); f.setEnvironment({ ...simulation, unavailable: true, unavailable_reason: 'runtime_unavailable', virtual_clock: undefined }); await f.controller.refresh();
  assert.equal(f.latest().environment.mode, 'simulation'); assert.equal(f.latest().environment.unavailable, true);
  await assert.rejects(f.api.apiFetch('/api/v1/workspace'), /Confirm the active campus/); await f.api.apiFetch('/api/v1/auth/execution-environment/');
});
test('failed environment selection re-reads the actual selected server world before resuming', async () => {
  let selected: unknown = live;
  const f = fixture(path => {
    if (path === '/api/v1/auth/execution-environment/') { selected = simulation; return Promise.reject(new TypeError('response lost')); }
    if (path === '/api/v1/auth/session/') return Promise.resolve(json(session(selected)));
    if (path === '/api/v1/auth/me/') return Promise.resolve(json(profile(selected)));
    return Promise.resolve(json({}));
  });
  await f.controller.refresh(); await assert.rejects(f.controller.selectEnvironment({ mode: 'simulation', run_id: 'r' }), cause => {
    assert.ok(cause instanceof ApiConnectionError); assert.equal(cause.status, undefined);
    assert.match(cause.message, /An action may have completed; refresh before repeating it/);
    assert.doesNotMatch(cause.message, /response lost/); return true;
  });
  assert.equal(f.latest().environment.namespace_id, simulation.namespace_id); assert.equal(f.latest().status, 'authenticated');
  assert.equal(f.calls.filter(call => call.path === '/api/v1/auth/execution-environment/' && call.init.method === 'POST').length, 1);
  const selection = f.calls.findIndex(call => call.path === '/api/v1/auth/execution-environment/');
  assert.deepEqual(f.calls.slice(selection + 1).map(call => call.path), ['/api/v1/auth/session/', '/api/v1/auth/me/']);
  await f.api.apiFetch('/api/v1/workspace'); assert.equal(new Headers(f.calls.at(-1)!.init.headers).get('X-ThatCampus-Execution-Environment'), simulation.namespace_id);
});
test('a selection cannot resolve for a different actor or run, or when confirmation fails', async () => {
  for (const change of ['actor', 'run', 'profile-error'] as const) {
    let changed = false;
    const f = fixture(path => {
      if (path === '/api/v1/auth/execution-environment/') { changed = true; return Promise.resolve(json({ execution_environment: simulation })); }
      const environment = changed ? { ...simulation, run_id: change === 'run' ? 'foreign-run' : 'r' } : live;
      const actor = changed && change === 'actor' ? { ...user, id: 'foreign-actor' } : user;
      if (path === '/api/v1/auth/session/') return Promise.resolve(json({ ...session(environment), user: actor }));
      if (path === '/api/v1/auth/me/') return Promise.resolve(changed && change === 'profile-error' ? json({ detail: 'Profile unavailable' }, 503) : json({ ...profile(environment), user: actor }));
      return Promise.resolve(json({}));
    });
    await f.controller.refresh(); await assert.rejects(f.controller.selectEnvironment({ mode: 'simulation', run_id: 'r' }));
    assert.equal(f.latest().status, 'error'); assert.equal(f.latest().user?.id, user.id);
    await assert.rejects(f.api.apiFetch('/api/v1/workspace'), /Confirm the active campus/);
  }
});
test('a superseded selection rejects before its caller can navigate', async () => {
  const late = deferred<CampusResponse>(), started = deferred<void>();
  const f = fixture(path => {
    if (path === '/api/v1/auth/execution-environment/') { started.resolve(); return late.promise; }
    return Promise.resolve(json(path === '/api/v1/auth/session/' ? session() : path === '/api/v1/auth/me/' ? profile() : {}));
  });
  await f.controller.refresh();
  const selection = f.controller.selectEnvironment({ mode: 'simulation', run_id: 'r' }), rejected = assert.rejects(selection, /context changed/); await started.promise;
  const refresh = f.controller.refresh(); late.resolve(json({ execution_environment: simulation })); await rejected; await refresh;
  assert.equal(f.latest().status, 'authenticated'); assert.equal(f.latest().environment.mode, 'live');
});
test('profile failure keeps campus data blocked without substituting an anonymous Live view', async () => {
  const f = fixture(path => Promise.resolve(path === '/api/v1/auth/session/' ? json(session(simulation)) : json({ detail: 'Profile unavailable' }, 503)));
  await f.controller.refresh(); assert.equal(f.latest().status, 'error'); assert.match(f.latest().error!, /Profile unavailable/);
  await assert.rejects(f.api.apiFetch('/api/v1/workspace'), /Confirm the active campus/);
});
test('late bootstrap cannot install or expire a newer authenticated cookie session', async () => {
  const late = deferred<CampusResponse>(), started = deferred<void>(); let reads = 0;
  const f = fixture(path => {
    if (path === '/api/v1/auth/session/' && reads++ === 0) { started.resolve(); return late.promise; }
    return Promise.resolve(json(path === '/api/v1/auth/session/' ? session() : path === '/api/v1/auth/me/' ? profile() : { user }));
  });
  const old = f.controller.refresh(); await started.promise; const login = f.controller.login('member', 'password');
  late.resolve(json({ detail: 'Old session expired' }, 401)); await old; await login;
  assert.equal(f.latest().status, 'authenticated'); assert.equal(f.latest().user?.id, user.id);
});
test('account mutation retries a definite CSRF refusal once, but never a lost or domain response', async () => {
  const calls: string[] = []; let attempts = 0;
  const api = { async apiFetch<T>(path: string): Promise<T> { calls.push(path); if (path.endsWith('/login/') && attempts++ === 0) throw new ApiError('CSRF verification failed', 403); return {} as T; } };
  await browserAuthMutation(api, '/api/v1/auth/login/', { identifier: 'member', password: 'password' });
  assert.deepEqual(calls, ['/api/v1/auth/csrf/', '/api/v1/auth/login/', '/api/v1/auth/csrf/', '/api/v1/auth/login/']);
  for (const failure of [new TypeError('response lost'), new ApiError('Forbidden', 403), new ApiError('Conflict', 409)]) {
    let writes = 0; const failing = { async apiFetch<T>(path: string): Promise<T> { if (!path.endsWith('/csrf/')) { writes++; throw failure; } return {} as T; } };
    await assert.rejects(browserAuthMutation(failing, '/api/v1/auth/login/', {})); assert.equal(writes, 1);
  }
});
test('account payload is captured before CSRF awaits and unrelated domain/native paths never dispatch', async () => {
  const ready = deferred<unknown>(), started = deferred<void>(), writes: string[] = [], body = { identifier: 'original', password: 'original-password' };
  const api = { async apiFetch<T>(path: string, init?: RequestInit): Promise<T> { if (path.endsWith('/csrf/')) { started.resolve(); return ready.promise as Promise<T>; } writes.push(init?.body as string); return {} as T; } };
  const request = browserAuthMutation(api, '/api/v1/auth/login/', body); await started.promise;
  body.identifier = 'changed'; body.password = 'changed'; ready.resolve({}); await request;
  assert.deepEqual(writes.map(value => JSON.parse(value)), [{ identifier: 'original', password: 'original-password' }]);
  for (const path of ['/api/v1/activities/registers', '/api/v1/auth/native/login/', '/api/v1/auth/login/?next=other']) await assert.rejects(browserAuthMutation(api, path, {}), /unavailable in the browser/);
  assert.equal(writes.length, 1);
});


test('same-account refresh removes old protected query data when membership access is revoked', async () => {
  let allowed = true;
  const f = fixture(path => {
    if (path === '/api/v1/auth/session/') return Promise.resolve(json(session()));
    const current = profile(); current.memberships[0]!.permissions = allowed ? ['private.read'] : [];
    return Promise.resolve(json(current));
  });
  await f.controller.refresh(); const before = f.clears();
  allowed = false; await f.controller.refresh();
  assert.equal(f.latest().status, 'authenticated');
  assert.equal(f.clears(), before + 1);
  assert.deepEqual(f.latest().memberships[0]!.permissions, []);
});
