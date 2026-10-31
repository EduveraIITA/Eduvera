import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import * as appConfig from '../src/config.js';
import * as emailTransport from '../src/common/email-transport.js';
import { hashPassword } from '../src/auth/password.js';
import { CampusModelCoreService } from '../src/campus-model-core/campus-model-core.service.js';
import { ExecutionDataPlaneScope } from '../src/database/execution-data-plane.js';
import type { DatabaseService } from '../src/database/database.service.js';
import type { Database } from '../src/database/types.js';
import { VisitOnboardingIdentity } from '../src/gate/visit-onboarding-identity.js';
import { VisitOnboardingModel } from '../src/gate/visit-onboarding.model.js';
import { VisitOnboardingService } from '../src/gate/visit-onboarding.service.js';
import { IsolatedAppHttp } from './isolated-app-http.test-support.js';
import { requireIsolatedTestDatabaseUrl } from './test-database.js';
import { createVisitGuestFixture, visitGuestLater } from './visit-guest-view.test-support.js';
const enabled = process.env.TEST_DATABASE_ISOLATED === 'true' && Boolean(process.env.VISIT_ONBOARDING_HTTP_COMPILED_ROOT);
const source = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : 'postgresql://invalid.invalid/visit_registration_http_unused_test';
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: source, max: 3 }) }) }) as DatabaseService;
const app = new IsolatedAppHttp(); afterAll(async () => { await app.stop(); await db.destroy(); }); afterEach(() => vi.restoreAllMocks());
describe.runIf(enabled)('Current compiled visitor registration through ordinary application guards', () => {
  it('authenticates a new neutral visitor, admits only exact registered views and denies management/private organiser access', async () => {
    const password = 'Synthetic-Registration-Owner-2026!', f = await createVisitGuestFixture(db, { passwordHash: await hashPassword(password) });
    await app.start(source, { compiledRoot: process.env.VISIT_ONBOARDING_HTTP_COMPILED_ROOT!, publicUrl: 'https://visit-onboarding.example.test' });
    const manager = app.session(); await manager.login(f.user.email, password, f.schoolId);
    const root = `/api/v1/gate/schools/${f.schoolId}/visit-arrangements`, command = { command_id: randomUUID(), expected_revision: 0, expected_visit_revision: 1, action: 'issue', ends_at: visitGuestLater(f.now, 300) };
    const issued = await manager.json<{ join_url: string; current: { id: string } }>(`${root}/${f.visit.id}/onboarding-link/`, 'POST', command);
    const token = new URLSearchParams(new URL(issued.join_url).hash.slice(1)).get('token')!;
    const revealed = await manager.request(`${root}/${f.visit.id}/onboarding-link/reveal/`, 'POST', { expected_revision: 1, expected_visit_revision: 1 });
    expect(revealed.headers.get('cache-control')).toContain('no-store'); expect((await revealed.json() as { join_url: string }).join_url).toBe(issued.join_url);
    const anonymous = app.session();
    expect((await anonymous.request('/api/v1/auth/visit-onboarding/preview/', 'POST', { token }, false)).status).toBe(403);
    const preview = await anonymous.request('/api/v1/auth/native/visit-onboarding/preview/', 'POST', { token }, false); expect(preview.status).toBe(200);
    expect(preview.headers.get('cache-control')).toContain('no-store'); expect(await preview.json()).not.toHaveProperty('question');

    // A synthetic independent mailbox exercises the owning proof/account service;
    // it is not seeded into a challenge or returned by a public endpoint.
    const address = `registration-http-${randomUUID()}@example.test`, visitorPassword = 'Synthetic-Registration-Visitor-2026!', core = new CampusModelCoreService(db, new ExecutionDataPlaneScope()),
      onboarding = new VisitOnboardingService(db, core, new VisitOnboardingIdentity(core), new VisitOnboardingModel(core, core, core));
    let code = ''; const settings = appConfig.config(); vi.spyOn(appConfig, 'config').mockReturnValue({ ...settings, INVITATION_EMAIL_ENABLED: true });
    vi.spyOn(emailTransport, 'sendTransactionalEmail').mockImplementation(async message => { if (message.to !== address) throw new Error('Unexpected synthetic mailbox.'); code = /confirmation code is:\s*(\d{6})/.exec(message.text)?.[1] ?? ''; });
    const proof = await onboarding.proof({ token, email: address }, `isolated-http:${randomUUID()}`);
    expect(await onboarding.account({ token, email: address, challenge_id: proof.challenge_id, code, first_name: 'Fictional HTTP Visitor', last_name: '', password: visitorPassword })).toEqual({ status: 'created' });
    vi.restoreAllMocks();
    const visitor = app.session(); await visitor.json('/api/v1/auth/csrf/'); await visitor.json('/api/v1/auth/login/', 'POST', { identifier: address, password: visitorPassword });
    const join = { token, command_id: randomUUID() };
    expect((await visitor.request('/api/v1/auth/visit-onboarding/join/', 'POST', join, false)).status).toBe(403);
    const accepted = await visitor.json<{ school_id: string; visit_id: string; registration_id: string }>('/api/v1/auth/visit-onboarding/join/', 'POST', join);
    expect(accepted).toMatchObject({ school_id: f.schoolId, visit_id: f.visit.id });
    expect(await visitor.json('/api/v1/auth/visit-onboarding/join/', 'POST', join)).toMatchObject({ registration_id: accepted.registration_id, replayed: true });
    await visitor.json('/api/v1/auth/active-school/', 'POST', { school_id: f.schoolId });
    const list = await visitor.json<{ visits: Array<{ id: string }> }>(`${root}/registered/`); expect(list.visits.map(item => item.id)).toEqual([f.visit.id]);
    const own = await visitor.json(`${root}/${f.visit.id}/participant/`); expect(own).toMatchObject({ entry_permission: false, presence_confirmed: false }); expect(own).not.toHaveProperty('question');
    const workspace = await visitor.json<{ areas: Array<{ capabilities: string[]; surfaces: Array<{ href: string }> }> }>('/api/v1/workspace/');
    expect(workspace.areas.flatMap(area => area.capabilities)).toContain('gate.visits.registered');
    expect(workspace.areas.flatMap(area => area.capabilities)).not.toContain('gate.manage');
    for (const path of [`${root}/options/`, `${root}/${f.visit.id}/`, `${root}/${f.visit.id}/sharing/`, `${root}/${f.visit.id}/onboarding-link/`,
      `/api/v1/schools/${f.schoolId}/people/participants/`, `/api/v1/schools/${f.schoolId}/campus-scenes/`]) expect((await visitor.request(path)).status).toBe(403);
    expect([403, 404]).toContain((await visitor.request(`${root}/${f.visit.id}/shared/`)).status);
    expect([403, 404]).toContain((await visitor.request(`${root}/${f.visit.id}/shared/questions/`, 'POST', { command_id: randomUUID(), expected_revision: 0, share_id: issued.current.id, note: 'Not an organiser.' })).status);
    await manager.json(`${root}/${f.visit.id}/onboarding-link/`, 'POST', { command_id: randomUUID(), expected_revision: 1, expected_visit_revision: 1, action: 'revoke' });
    expect((await visitor.json<{ visits: unknown[] }>(`${root}/registered/`)).visits).toEqual([]);
    expect((await visitor.request(`${root}/${f.visit.id}/participant/`)).status).toBe(404);
  }, 120_000);
});
