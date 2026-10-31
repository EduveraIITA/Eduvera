import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool, types } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/auth/password.js';
import type { DatabaseService } from '../src/database/database.service.js';
import type { Database } from '../src/database/types.js';
import { createExternalRepairFixture, externalCommand } from './facilities-external-work.test-support.js';
import { acceptWithRecipientProof } from './invitation-recipient-proof.test-support.js';
import { IsolatedAppHttp } from './isolated-app-http.test-support.js';
import { requireIsolatedTestDatabaseUrl } from './test-database.js';

const enabled = process.env.TEST_DATABASE_ISOLATED === 'true';
const source = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : 'postgresql://invalid.invalid/external_repair_http_unused_test';
types.setTypeParser(1082, value => value);
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: source, max: 3 }) }) }) as DatabaseService;
const app = new IsolatedAppHttp();
interface Repair { id: string; revision: number; state: string; handler: { id: string }; external_view: boolean;
  external_access: { id: string; can_activate: boolean } | null; allowed_actions: { accept: boolean; verify: boolean } }
interface Manifest { context: { access_scope: string }; areas: Array<{ key: string }>;
  more: { groups: Array<{ key: string }> }; work: { items: Array<{ href: string }> } }

describe.runIf(enabled)('External technician through the compiled ordinary AppModule', () => {
  beforeAll(() => app.start(source), 30_000);
  afterAll(async () => { await app.stop(); await db.destroy(); }, 10_000);
  it('uses real login and scoped DI boundary for exact job acceptance, reported completion and campus verification', async () => {
    process.env.INVITATION_EMAIL_ENABLED = 'false';
    const f = await createExternalRepairFixture(db, { pending: true });
    const grant = await f.run(async () => f.facilities.grantExternal(f.user, f.schoolId, f.repair.id, await f.grantInput(f.repair.revision)));
    const invitation = await f.operations.invite(f.user, f.schoolId, { role: 'member', person_id: f.person.id,
      email: f.email, idempotency_key: randomUUID(), work_context: { kind: 'facility_repair', source_id: f.repair.id, access_id: grant.external_access!.id } });
    await acceptWithRecipientProof(f.operations, { email: f.email, token: invitation.token, password: f.password,
      first_name: 'Fictional HTTP Technician', last_name: '' });
    // Set only the normally provisioned campus actors' test credentials. Their
    // existing person endpoints and authority are not fabricated or replaced.
    await db.updateTable('users').set({ password_hash: await hashPassword(f.password) }).where('id', 'in', [f.user.id, f.borrower.id]).execute();
    const technician = app.session(), owner = app.session(), verifier = app.session();
    await technician.login(f.email, f.password, f.schoolId);
    await owner.login(f.user.email, f.password, f.schoolId);
    await verifier.login(f.borrower.email, f.password, f.schoolId);
    const base = `/api/v1/schools/${f.schoolId}/facilities`, path = `${base}/repairs/${f.repair.id}`;
    expect((await app.session().request(path)).status).toBe(401);
    const manifest = await technician.json<Manifest>('/api/v1/workspace/');
    expect(manifest.context.access_scope).toBe('assigned_work');
    expect(manifest.areas.map(area => area.key)).toEqual(['facilities']);
    expect(manifest.more.groups.map(group => group.key)).toEqual(['account']);
    expect(manifest.work.items.map(item => item.href)).toContain(`/areas/facilities?repair_id=${f.repair.id}`);
    let repair = await technician.json<Repair>(path);
    expect(repair.external_view).toBe(true); expect(JSON.stringify(repair)).not.toContain('PRIVATE');
    for (const route of [`${base}/options`, `${base}/settings`, `/api/v1/schools/${f.schoolId}/people/participants`,
      `/api/v1/schools/${f.schoolId}/institution-setup/`])
      expect((await technician.request(route)).status).toBe(403);
    expect((await technician.request(`${path}/external-access/${grant.external_access!.id}/activate`, 'POST', externalCommand(repair.revision), false)).status).toBe(403);
    repair = await technician.json<Repair>(`${path}/external-access/${grant.external_access!.id}/activate`, 'POST', externalCommand(repair.revision));
    expect(repair.state).toBe('reported'); expect(repair.handler.id).toBe(f.person.id);
    repair = await technician.json<Repair>(`${path}/actions`, 'POST', { ...externalCommand(repair.revision), action: 'accept' });
    repair = await technician.json<Repair>(`${path}/actions`, 'POST', { ...externalCommand(repair.revision), action: 'complete', note: 'Connector repaired; ready for the campus to check.' });
    expect(repair.state).toBe('awaiting_verification'); expect(repair.allowed_actions.verify).toBe(false);
    expect((await technician.request(`${path}/actions`, 'POST', { ...externalCommand(repair.revision), action: 'verify' })).status).toBe(403);
    repair = await verifier.json<Repair>(`${path}/actions`, 'POST', { ...externalCommand(repair.revision), action: 'verify', note: 'Campus has checked the connector.' });
    expect(repair.state).toBe('closed');
    expect((await technician.json<Manifest>('/api/v1/workspace/')).work.items.some(item => item.href.includes(f.repair.id))).toBe(false);
    expect((await owner.json<Repair>(path)).state).toBe('closed');
  }, 120_000);
});
