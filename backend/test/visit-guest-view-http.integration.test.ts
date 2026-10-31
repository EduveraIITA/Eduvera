import { Kysely, PostgresDialect } from 'kysely';
import { Pool, types } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/auth/password.js';
import type { DatabaseService } from '../src/database/database.service.js';
import type { Database } from '../src/database/types.js';
import { IsolatedAppHttp } from './isolated-app-http.test-support.js';
import { requireIsolatedTestDatabaseUrl } from './test-database.js';
import { createVisitGuestFixture, visitGuestCommand } from './visit-guest-view.test-support.js';

const enabled = process.env.TEST_DATABASE_ISOLATED === 'true';
const source = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : 'postgresql://invalid.invalid/visit_guest_http_unused_test';
types.setTypeParser(1082, value => value);
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: source, max: 3 }) }) }) as DatabaseService;
const app = new IsolatedAppHttp();
interface Detail { visit: { id: string; revision: number; state: string }; share: { id: string; ends_at: string; directions: string };
  question: { id: string; revision: number; state: string; entries: Array<{ note: string }> } | null }
interface Sharing { share_revision: number; current: { id: string } | null }
interface Manifest { context: { access_scope: string }; areas: Array<{ key: string }>;
  more: { groups: Array<{ key: string }> }; work: { items: Array<{ href: string }> } }

describe.runIf(enabled)('Visitor self-service through the compiled ordinary AppModule', () => {
  beforeAll(() => app.start(source), 30_000);
  afterAll(async () => { await app.stop(); await db.destroy(); }, 10_000);
  it('uses normal login and exact-source DI guards for details, private questions and cancellation without gate privileges', async () => {
    process.env.INVITATION_EMAIL_ENABLED = 'false';
    const f = await createVisitGuestFixture(db, { pending: true });
    const sharing = await f.run(async () => f.sharing.share(f.user, f.schoolId, f.visit.id, await f.shareInput(0)));
    await f.join({ kind: 'visit_arrangement', source_id: f.visit.id, access_id: sharing.current!.id });
    // Credentials only for the normally provisioned test founder. No account,
    // person linkage, source acceptance or operational permission is seeded.
    await db.updateTable('users').set({ password_hash: await hashPassword(f.password) }).where('id', '=', f.user.id).execute();
    const guest = app.session(), owner = app.session();
    await guest.login(f.email, f.password, f.schoolId);
    await owner.login(f.user.email, f.password, f.schoolId);
    const base = `/api/v1/gate/schools/${f.schoolId}/visit-arrangements`, path = `${base}/${f.visit.id}`;
    expect((await app.session().request(`${path}/shared`)).status).toBe(401);
    const manifest = await guest.json<Manifest>('/api/v1/workspace/');
    expect(manifest.context.access_scope).toBe('assigned_work');
    expect(manifest.areas.map(area => area.key)).toEqual(['in-out']);
    expect(manifest.more.groups.map(group => group.key)).toEqual(['account']);
    expect(manifest.work.items).toEqual([]);
    let detail = await guest.json<Detail>(`${path}/shared`);
    expect(detail.visit).toMatchObject({ id: f.visit.id, state: 'confirmed' });
    expect(detail.question).toBeNull();
    expect(JSON.stringify(detail)).not.toMatch(/last_movement|observed_count|actor_user_id|avatar_url|account_user_id/u);
    for (const denied of [base, `${base}/options`, `${path}/sharing`, path,
      `/api/v1/schools/${f.schoolId}/people/participants`, `/api/v1/schools/${f.schoolId}/institution-setup/`])
      expect((await guest.request(denied)).status).toBe(403);
    const ask = { ...visitGuestCommand(0), share_id: detail.share.id, note: 'PRIVATE guest asks where the group should meet.' };
    expect((await guest.request(`${path}/shared/questions`, 'POST', ask, false)).status).toBe(403);
    detail = await guest.json<Detail>(`${path}/shared/questions`, 'POST', ask);
    expect(detail.question).toMatchObject({ revision: 1, state: 'waiting_for_review' });
    const question = detail.question!;
    expect((await owner.json<Manifest>('/api/v1/workspace/')).work.items.some(item => item.href.includes(f.visit.id))).toBe(true);
    detail = await owner.json<Detail>(`${path}/shared/questions/${question.id}/replies`, 'POST',
      { ...visitGuestCommand(question.revision), note: 'Meet at reception beside the accessible entrance.' });
    expect(detail.question).toMatchObject({ state: 'answered', revision: 2 });
    expect((await guest.json<Detail>(`${path}/shared`)).question!.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ note: 'Meet at reception beside the accessible entrance.' }),
    ]));
    expect((await owner.json<Manifest>('/api/v1/workspace/')).work.items.some(item => item.href.includes(f.visit.id))).toBe(false);
    await owner.json(`${path}/cancel`, 'POST', visitGuestCommand(f.visit.revision));
    expect((await guest.json<Detail>(`${path}/shared`)).visit.state).toBe('cancelled');
    const managed = await owner.json<Sharing>(`${path}/sharing`);
    await owner.json(`${path}/shares/${managed.current!.id}/revoke`, 'POST', visitGuestCommand(managed.share_revision));
    expect((await guest.request(`${path}/shared`)).status).toBe(404);
    expect((await guest.json<Manifest>('/api/v1/workspace/')).context.access_scope).toBe('assigned_work');
  }, 120_000);
});
