import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool, types } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/auth/password.js';
import { CampusModelCoreService } from '../src/campus-model-core/campus-model-core.service.js';
import { ExecutionDataPlaneScope } from '../src/database/execution-data-plane.js';
import type { Database } from '../src/database/types.js';
import type { DatabaseService } from '../src/database/database.service.js';
import { ProgressiveWorkspaceProvisioner } from '../src/institution-onboarding/progressive-workspace.provisioner.js';
import { IsolatedAppHttp } from './isolated-app-http.test-support.js';
import { requireIsolatedTestDatabaseUrl } from './test-database.js';

const enabled = process.env.TEST_DATABASE_ISOLATED === 'true';
// No default dist fallback. IsolatedAppHttp also validates the explicit current
// temporary build's path before it imports AppModule or starts its loopback API.
const compiledRoot = process.env.ACADEMIC_CATALOGUE_HTTP_COMPILED_ROOT
  ?? process.env.VISIT_ONBOARDING_HTTP_COMPILED_ROOT;
const source = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL)
  : 'postgresql://invalid.invalid/catalogue_http_unused_test';
types.setTypeParser(1082, value => value);
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: source, max: 2 }) }) }) as DatabaseService;
const app = new IsolatedAppHttp();
afterAll(async () => { await app.stop(); await db.destroy(); }, 10_000);

type ClassRow = { id: string; school_id: string; revision: number; academic_year: string; grade: string; section: string; board: string; room_number: string };
type Confirmation = { handler: string; school_id: string; kind: string; source_id: string; command_id: string; state: string; expected_revision: number; result: ClassRow };

describe.skipIf(!enabled)('academic catalogue recovery through the current compiled ordinary HTTP application', () => {
  beforeAll(async () => {
    try {
      if (!compiledRoot) throw new Error('An explicit ACADEMIC_CATALOGUE_HTTP_COMPILED_ROOT or VISIT_ONBOARDING_HTTP_COMPILED_ROOT is required; normal dist startup is forbidden.');
      await app.start(source, { compiledRoot, publicUrl: 'https://catalogue-http.example.test' });
    } catch (cause) {
      // Vitest's JSON reporter can omit suite-hook errors. Retain the failing
      // startup phase in the runner log as well, without any connection URL.
      const failure = `${cause instanceof Error ? cause.stack ?? cause.message : String(cause)}\n${app.failureDiagnostics()}`
        .replaceAll(source, '<owned isolated database URL>')
        .replace(/postgres(?:ql)?:\/\/[^\s"'<>)]*/gu, '<redacted PostgreSQL URL>').slice(-12_000);
      const message = `Academic catalogue compiled HTTP startup failed:\n${failure}`;
      process.stderr.write(`${message}\n`);
      throw new Error(message);
    }
  }, 30_000);

  it('preserves exact accepted receipts across later edits, proves stale refusal and rechecks permissions and session revocation', async () => {
    const suffix = randomUUID(), password = `Private-${randomUUID()}!`;
    // Fixture identity/provisional campus authority uses the real onboarding
    // owner. Every catalogue change/receipt below goes through the HTTP app.
    const account = await db.insertInto('users').values({
      username: `catalogue-http-${suffix}`, email: `catalogue-http-${suffix}@example.test`,
      password_hash: await hashPassword(password), first_name: 'Campus', last_name: 'Coordinator',
      role: 'admin', email_verified_at: new Date(),
    }).returning(['id', 'email', 'first_name', 'last_name']).executeTakeFirstOrThrow();
    const core = new CampusModelCoreService(db, new ExecutionDataPlaneScope());
    const school = await db.transaction().execute(tx => new ProgressiveWorkspaceProvisioner(core).createForAccount(tx, account, 'UTC'));
    const actor = app.session(); await actor.login(account.email, password, school);
    const root = `/api/v1/schools/${school}/catalog/classes`, id = randomUUID();
    const original = { academic_year: '2026-27', grade: 'MTech', section: 'A', board: '', room_number: 'CC2-201',
      catalog_id: id, command_id: randomUUID() };
    const confirmation = (command: string) => `${root}/${id}/commands/${command}/`;
    expect((await app.session().request(confirmation(original.command_id))).status).toBe(401);
    expect((await actor.request(`${root}/`, 'POST', original, false)).status).toBe(403);
    expect(await db.selectFrom('class_sections').select('id').where('id', '=', id).execute()).toEqual([]);
    expect(await db.selectFrom('campus_model_commands').select('id').where('correlation_id', '=', original.command_id).execute()).toEqual([]);

    const createdResponse = await actor.request(`${root}/`, 'POST', original);
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as ClassRow;
    expect(created).toMatchObject({ id, school_id: school, revision: 1, room_number: 'CC2-201' });
    const firstEdit = { ...original, command_id: randomUUID(), expected_revision: 1,
      confirmed: true, change_reason: '', room_number: 'CC2-202' };
    const edited = await actor.json<ClassRow>(`${root}/${id}/`, 'PATCH', firstEdit);
    expect(edited).toMatchObject({ id, revision: 2, room_number: 'CC2-202' });
    const secondEdit = { ...firstEdit, command_id: randomUUID(), expected_revision: 2, room_number: 'CC2-203' };
    expect(await actor.json<ClassRow>(`${root}/${id}/`, 'PATCH', secondEdit)).toMatchObject({ id, revision: 3, room_number: 'CC2-203' });

    // Simulate a response lost after acceptance by submitting the retained exact
    // command again only after a later revision exists. No latest-row matching.
    expect(await actor.json<ClassRow>(`${root}/`, 'POST', original)).toEqual(created);
    expect(await actor.json<ClassRow>(`${root}/${id}/`, 'PATCH', firstEdit)).toEqual(edited);
    expect(await actor.json<Confirmation>(confirmation(original.command_id))).toMatchObject({
      handler: 'academic.catalogue', school_id: school, kind: 'classes', source_id: id,
      command_id: original.command_id, state: 'accepted', expected_revision: 0, result: created,
    });
    expect(await actor.json<Confirmation>(confirmation(firstEdit.command_id))).toMatchObject({
      command_id: firstEdit.command_id, state: 'accepted', expected_revision: 1, result: edited,
    });
    const changed = await actor.request(`${root}/${id}/`, 'PATCH', { ...firstEdit, room_number: 'Different payload' });
    expect(changed.status).toBe(409);
    expect(await changed.json()).toMatchObject({ error: { status: 409, detail: 'This command was already used with different catalogue details.' } });

    const stale = { ...firstEdit, command_id: randomUUID(), room_number: 'Stale unaccepted choice' };
    const refused = await actor.request(`${root}/${id}/`, 'PATCH', stale);
    expect(refused.status).toBe(409); expect(refused.headers.get('content-type')).toContain('application/json');
    const envelope = await refused.json() as { error: { request_id: string; fields: { catalogue_obsolete: unknown } } };
    expect(envelope).toMatchObject({ error: { status: 409, code: 'catalogue_revision_obsolete', fields: { catalogue_obsolete: {
      confirmation: 'permanently_inapplicable', receipt_state: 'absent', handler: 'academic.catalogue',
      source_id: id, command_id: stale.command_id, expected_revision: 1, current_revision: 3,
    } } } });
    expect(envelope.error.request_id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(await db.selectFrom('campus_model_commands').select('id').where('correlation_id', '=', stale.command_id).execute()).toEqual([]);
    expect(await db.selectFrom('class_sections').select(['revision', 'room_number']).where('id', '=', id).execute()).toEqual([{ revision: 3, room_number: 'CC2-203' }]);
    for (const query of [
      sql<{ count: number }>`SELECT count(*)::int AS count FROM school_operations_audit WHERE school_id=${school}::uuid AND target_id=${id}::uuid`,
      sql<{ count: number }>`SELECT count(*)::int AS count FROM event_outbox WHERE school_id=${school}::uuid AND aggregate_id=${id}::uuid AND event_type='administration.updated'`,
      sql<{ count: number }>`SELECT count(*)::int AS count FROM campus_model_events WHERE school_id=${school}::uuid AND source_domain='academic_catalogue' AND source_record_id=${id}`,
    ]) expect((await query.execute(db)).rows).toEqual([{ count: 3 }]);

    // Fixture authority revocation, not a shadow catalogue writer. The existing
    // cookie remains authenticated but may neither reveal nor replay a receipt.
    await db.updateTable('school_memberships').set({ role: 'member' }).where('school_id', '=', school).where('user_id', '=', account.id).execute();
    expect((await actor.request(confirmation(original.command_id))).status).toBe(403);
    expect((await actor.request(`${root}/`, 'POST', original)).status).toBe(403);
    expect((await actor.request('/api/v1/auth/logout/', 'POST', {})).status).toBe(204);
    expect((await actor.request(confirmation(original.command_id))).status).toBe(401);
    expect(await db.selectFrom('class_sections').select(['revision', 'room_number']).where('id', '=', id).execute()).toEqual([{ revision: 3, room_number: 'CC2-203' }]);
  }, 120_000);
});
