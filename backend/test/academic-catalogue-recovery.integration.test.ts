import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool, types } from 'pg';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/common/request.js';
import type { Database } from '../src/database/types.js';
import type { DatabaseService } from '../src/database/database.service.js';
import { CampusModelCoreService } from '../src/campus-model-core/campus-model-core.service.js';
import { ExecutionDataPlaneScope } from '../src/database/execution-data-plane.js';
import { executionEnvironmentStorage } from '../src/campus-model-core/execution-time.runtime.js';
import { ProgressiveWorkspaceProvisioner } from '../src/institution-onboarding/progressive-workspace.provisioner.js';
import { OperationsService } from '../src/operations/operations.service.js';
import { AcademicCatalogueModelService } from '../src/operations/academic-catalogue-model.service.js';
import * as catalogueModel from '../src/operations/academic-catalogue-model.service.js';
import { createSimulationBranch, SimulationBranchDriver } from '../src/database/simulation-branch.driver.js';
import { SimulationSnapshotStore } from '../src/database/simulation-snapshot-store.js';
import { simulationRequestEnvironment } from '../src/database/simulation-world.service.js';
import { requireIsolatedTestDatabaseUrl } from './test-database.js';

const enabled = process.env.TEST_DATABASE_ISOLATED === 'true';
const url = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : 'postgresql://invalid.invalid/catalogue_unused_test';
const target = process.env.ACADEMIC_CATALOGUE_SIMULATION_TEST_TARGET_URL;
types.setTypeParser(1082, value => value);
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: url, max: 3 }) }) }) as DatabaseService;
afterAll(() => db.destroy());
function services(database: DatabaseService) {
  const core = new CampusModelCoreService(database, new ExecutionDataPlaneScope());
  const model = new AcademicCatalogueModelService(core, core, core, core);
  const operations = new OperationsService(database, {} as never, undefined, undefined, undefined, model);
  return { core, model, operations };
}
async function fixture() {
  const s = services(db), suffix = randomUUID();
  const account = await db.insertInto('users').values({ username: `catalogue-${suffix}`, email: `catalogue-${suffix}@example.test`,
    password_hash: 'isolated-catalogue-fixture-only', first_name: 'Campus', last_name: 'Coordinator', role: 'admin', email_verified_at: new Date() })
    .returning(['id', 'username', 'email', 'first_name', 'last_name', 'role', 'is_active']).executeTakeFirstOrThrow();
  const schoolId = await db.transaction().execute(tx => new ProgressiveWorkspaceProvisioner(s.core).createForAccount(tx, account, 'UTC'));
  const owner: AuthUser = { ...account, active_school_id: schoolId };
  return { ...s, schoolId, owner };
}
const input = (values: Record<string, unknown>) => ({ ...values, command_id: randomUUID(), catalog_id: randomUUID() });
const classValues = { academic_year: '2026-27', grade: 'MTech', section: 'A', board: '', room_number: 'CC2-201' };
async function refused(work: Promise<unknown>) {
  try { await work; throw new Error('Expected exact terminal catalogue refusal'); }
  catch (error) {
    if(!error||typeof(error as {getResponse?:unknown}).getResponse!=='function')throw error;
    const response = (error as { getResponse(): { code: string; fields: { catalogue_refusal: Record<string, unknown> } } }).getResponse();
    expect(response.code, `Expected durable terminal refusal; received ${JSON.stringify(response)}`).toBe('catalogue_command_refused'); return response.fields.catalogue_refusal;
  }
}

describe.skipIf(!enabled)('exact academic catalogue action recovery', () => {
  it('creates and edits each catalogue with exact receipts, concurrent replay and unchanged first acceptance after later edits', async () => {
    const f = await fixture();
    const cases = [
      ['terms', { name: 'Semester I', academic_year: '2026-27', starts_on: '2026-07-01', ends_on: '2026-12-31', attendance_threshold: 80, is_active: true }],
      ['classes', classValues],
      ['subjects', { code: 'CSE501', name: 'Advanced Algorithms', short_name: 'Algorithms', color: '#237A62', icon: 'laptop' }],
    ] as const;
    for (const [kind, values] of cases) {
      const request = input(values), [first, replay] = await Promise.all([
        f.operations.saveCatalog(f.owner, f.schoolId, kind, request), f.operations.saveCatalog(f.owner, f.schoolId, kind, request),
      ]);
      expect(JSON.parse(JSON.stringify(first))).toEqual(JSON.parse(JSON.stringify(replay)));
      expect(first).toMatchObject({ id: request.catalog_id, revision: 1, school_id: f.schoolId });
      const changed = kind === 'classes' ? { ...values, room_number: 'CC2-202' } : { ...values, name: 'Revised academic label' };
      const edit = { ...changed, catalog_id: request.catalog_id, command_id: randomUUID(), expected_revision: 1, confirmed: true, change_reason: '' };
      await expect(f.operations.saveCatalog(f.owner, f.schoolId, kind, edit, request.catalog_id)).resolves.toMatchObject({ id: request.catalog_id, revision: 2 });
      const retained = await f.operations.confirmCatalog(f.owner, f.schoolId, kind, request.catalog_id, request.command_id);
      expect(retained).toMatchObject({ handler: 'academic.catalogue', command_id: request.command_id, state: 'accepted', expected_revision: 0, result: { revision: 1 } });
      expect(JSON.parse(JSON.stringify(await f.operations.saveCatalog(f.owner, f.schoolId, kind, request)))).toEqual(JSON.parse(JSON.stringify(first)));
      await expect(f.operations.saveCatalog(f.owner, f.schoolId, kind, { ...request, ...changed })).rejects.toThrow('different catalogue details');
      await expect(f.operations.confirmCatalog(f.owner, f.schoolId, kind, randomUUID(), request.command_id)).rejects.toThrow();
      expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM school_operations_audit WHERE school_id=${f.schoolId}::uuid AND target_id=${request.catalog_id}::uuid`.execute(db)).rows[0]!.n).toBe(2);
      expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM event_outbox WHERE school_id=${f.schoolId}::uuid AND aggregate_id=${request.catalog_id}::uuid AND event_type='administration.updated'`.execute(db)).rows[0]!.n).toBe(2);
      expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM campus_model_commands WHERE school_id=${f.schoolId}::uuid AND correlation_id=${request.command_id}::uuid AND handler_key='academic.catalogue' AND state='accepted'`.execute(db)).rows[0]!.n).toBe(1);
    }
    await db.updateTable('school_memberships').set({ is_active: false }).where('school_id', '=', f.schoolId).where('user_id', '=', f.owner.id).execute();
    await expect(f.operations.saveCatalog(f.owner, f.schoolId, 'classes', input(classValues))).rejects.toThrow();
  }, 60000);

  it('rolls back a failed native write and refuses stale, changed-source, foreign-campus and revoked-actor confirmations', async () => {
    const f = await fixture(), other = await fixture();
    const first = input(classValues); await f.operations.saveCatalog(f.owner, f.schoolId, 'classes', first);
    const duplicate = input(classValues);
    await expect(f.operations.saveCatalog(f.owner, f.schoolId, 'classes', duplicate)).rejects.toThrow();
    expect(await db.selectFrom('class_sections').select('id').where('id', '=', duplicate.catalog_id).execute()).toEqual([]);
    expect(await db.selectFrom('campus_model_commands').select('state').where('correlation_id', '=', duplicate.command_id).execute()).toEqual([{ state: 'conflicted' }]);
    const edit = { ...classValues, room_number: 'CC2-210', catalog_id: first.catalog_id, command_id: randomUUID(), expected_revision: 1, confirmed: true, change_reason: '' };
    await f.operations.saveCatalog(f.owner, f.schoolId, 'classes', edit, first.catalog_id);
    try { await f.operations.saveCatalog(f.owner, f.schoolId, 'classes', { ...edit, command_id: randomUUID() }, first.catalog_id); throw Error('Expected stale refusal'); }
    catch (e) { expect((e as { getResponse(): unknown }).getResponse()).toMatchObject({ fields: { catalogue_obsolete: { receipt_state: 'absent', expected_revision: 1, current_revision: 2 } } }); }
    await expect(f.operations.confirmCatalog(other.owner, f.schoolId, 'classes', first.catalog_id, first.command_id)).rejects.toThrow();
    await expect(f.operations.confirmCatalog(f.owner, other.schoolId, 'classes', first.catalog_id, first.command_id)).rejects.toThrow();
    await expect(f.operations.confirmCatalog(f.owner, f.schoolId, 'subjects', first.catalog_id, first.command_id)).rejects.toThrow();
    await db.updateTable('users').set({ is_active: false }).where('id', '=', f.owner.id).execute();
    await expect(f.operations.confirmCatalog(f.owner, f.schoolId, 'classes', first.catalog_id, first.command_id)).rejects.toThrow();
    await expect(f.operations.saveCatalog(f.owner, f.schoolId, 'classes', first)).rejects.toThrow();
  }, 60000);

  it('retains exact duplicate refusals across changed source state and only permits a newly reviewed command', async () => {
    const f = await fixture(), first = input(classValues), duplicate = input(classValues);
    await f.operations.saveCatalog(f.owner, f.schoolId, 'classes', first);
    const proof = await refused(f.operations.saveCatalog(f.owner, f.schoolId, 'classes', duplicate));
    expect(proof).toMatchObject({ receipt_state: 'completed', terminal_state: 'conflicted', reason_code: 'academic_catalogue_duplicate',
      school_id: f.schoolId, actor_user_id: f.owner.id, environment_namespace_id: `live:${f.schoolId}`, kind: 'classes',
      source_id: duplicate.catalog_id, command_id: duplicate.command_id, expected_revision: 0,
      reviewed_request: { kind: 'classes', id: duplicate.catalog_id, values: classValues } });
    expect(await db.selectFrom('campus_model_entities').select('lifecycle_state').where('school_id', '=', f.schoolId)
      .where('domain', '=', 'academic_catalogue').where('domain_id', '=', duplicate.catalog_id).execute()).toEqual([{ lifecycle_state: 'planned' }]);
    expect(await db.selectFrom('class_sections').select('id').where('id', '=', duplicate.catalog_id).execute()).toEqual([]);
    expect((await sql`SELECT id FROM school_operations_audit WHERE school_id=${f.schoolId}::uuid AND target_id=${duplicate.catalog_id}::uuid`.execute(db)).rows).toEqual([]);
    expect(await db.selectFrom('event_outbox').select('id').where('aggregate_id', '=', duplicate.catalog_id).execute()).toEqual([]);
    await expect(f.operations.saveCatalog(f.owner, f.schoolId, 'classes', { ...duplicate, room_number: 'Changed retained intent' })).rejects.toThrow('different catalogue details');
    await f.operations.saveCatalog(f.owner, f.schoolId, 'classes', { ...first, command_id: randomUUID(), expected_revision: 1, confirmed: true, change_reason: '', section: 'B' }, first.catalog_id);
    expect(await refused(f.operations.saveCatalog(f.owner, f.schoolId, 'classes', duplicate))).toEqual(proof);
    await f.operations.saveCatalog(f.owner, f.schoolId, 'classes', { ...duplicate, command_id: randomUUID() });
    expect(await refused(f.operations.saveCatalog(f.owner, f.schoolId, 'classes', duplicate))).toEqual(proof);
    expect(await db.selectFrom('campus_model_entities').select('lifecycle_state').where('school_id', '=', f.schoolId)
      .where('domain', '=', 'academic_catalogue').where('domain_id', '=', duplicate.catalog_id).execute()).toEqual([{ lifecycle_state: 'active' }]);
    const commands = await db.selectFrom('campus_model_commands').select(['id', 'state']).where('correlation_id', '=', duplicate.command_id).execute();
    expect(commands).toHaveLength(1); expect(commands[0]!.state).toBe('conflicted');
    expect(await db.selectFrom('campus_model_command_outcomes').select('status').where('command_id', '=', commands[0]!.id).execute()).toEqual([{ status: 'conflicted' }]);
    await db.updateTable('school_memberships').set({ role: 'member' }).where('school_id', '=', f.schoolId).where('user_id', '=', f.owner.id).execute();
    await expect(f.operations.saveCatalog(f.owner, f.schoolId, 'classes', duplicate)).rejects.toThrow();
  }, 60000);

  it('records all three natural-key duplicate refusals, explicit owning rule refusal and rolls back unexpected outcome failure', async () => {
    // A future caller cannot turn an infrastructure status into an owning
    // refusal merely by using the tagged error class.
    for (const status of [500, 503]) expect(catalogueModel.knownCatalogueRefusal(
      new catalogueModel.CatalogueRuleRefusal('Infrastructure failure', status), 'classes')).toBe(false);
    const f = await fixture();
    const cases = [
      ['terms', { name: 'Semester I', academic_year: '2026-27', starts_on: '2026-07-01', ends_on: '2026-12-31', attendance_threshold: 80, is_active: true }],
      ['classes', classValues], ['subjects', { code: 'CS501', name: 'Algorithms', short_name: 'Algo', color: '#237A62', icon: 'laptop' }],
    ] as const;
    for (const [kind, values] of cases) {
      const created = input(values); await f.operations.saveCatalog(f.owner, f.schoolId, kind, created);
      const duplicate = input(values);
      expect(await refused(f.operations.saveCatalog(f.owner, f.schoolId, kind, duplicate))).toMatchObject({ reason_code: 'academic_catalogue_duplicate', terminal_state: 'conflicted' });
      expect(await refused(f.operations.saveCatalog(f.owner, f.schoolId, kind, { ...created, command_id: randomUUID(), expected_revision: 1, confirmed: true, change_reason: '' }, created.catalog_id)))
        .toMatchObject({ reason_code: 'academic_catalogue_rule_refused', terminal_state: 'rejected' });
    }
    const doomed = input(classValues), original = f.core.completeDomainCommand.bind(f.core);
    const failure = vi.spyOn(f.core, 'completeDomainCommand').mockImplementation((tx, value) => {
      if (value.code === 'academic_catalogue_duplicate') throw new Error('Injected refusal outcome failure');
      return original(tx, value);
    });
    try { await expect(f.operations.saveCatalog(f.owner, f.schoolId, 'classes', doomed)).rejects.toThrow('Injected refusal outcome failure'); }
    finally { failure.mockRestore(); }
    expect(await db.selectFrom('campus_model_commands').select('id').where('correlation_id', '=', doomed.command_id).execute()).toEqual([]);
    expect(await db.selectFrom('campus_model_entities').select('id').where('school_id', '=', f.schoolId).where('domain', '=', 'academic_catalogue').where('domain_id', '=', doomed.catalog_id).execute()).toEqual([]);
    expect(await db.selectFrom('class_sections').select('id').where('id', '=', doomed.catalog_id).execute()).toEqual([]);
    const native = input({ ...classValues, section: 'C' });
    const lostOutcome = vi.spyOn(f.core, 'completeDomainCommand').mockImplementation((tx, value) => {
      if (value.code === 'academic_catalogue_saved') throw new Error('Injected accepted outcome failure');
      return original(tx, value);
    });
    try { await expect(f.operations.saveCatalog(f.owner, f.schoolId, 'classes', native)).rejects.toThrow('Injected accepted outcome failure'); }
    finally { lostOutcome.mockRestore(); }
    expect(await db.selectFrom('class_sections').select('id').where('id', '=', native.catalog_id).execute()).toEqual([]);
    expect(await db.selectFrom('event_outbox').select('id').where('aggregate_id', '=', native.catalog_id).execute()).toEqual([]);
    expect((await sql`SELECT id FROM school_operations_audit WHERE school_id=${f.schoolId}::uuid AND target_id=${native.catalog_id}::uuid`.execute(db)).rows).toEqual([]);
    expect(await db.selectFrom('campus_model_commands').select('id').where('correlation_id', '=', native.command_id).execute()).toEqual([]);
    expect(await db.selectFrom('campus_model_entities').select('id').where('school_id', '=', f.schoolId).where('domain', '=', 'academic_catalogue').where('domain_id', '=', native.catalog_id).execute()).toEqual([]);
    expect(await f.operations.saveCatalog(f.owner, f.schoolId, 'classes', native)).toMatchObject({ revision: 1, id: native.catalog_id });
  }, 60000);
});

describe.skipIf(!enabled || !target)('academic catalogue real selected-world recovery', () => {
  it('changes one COW catalogue, preserves actor-qualified receipts and leaves Live and sibling unchanged', async () => {
    const f = await fixture(), original = input(classValues); await f.operations.saveCatalog(f.owner, f.schoolId, 'classes', original);
    const now = new Date().toISOString(), store = new SimulationSnapshotStore(url, requireIsolatedTestDatabaseUrl(target), 2), opened: Kysely<Database>[] = [];
    try {
      const snapshot = await store.capture(f.schoolId, now);
      const open = async () => {
        const run = randomUUID(), scenario = randomUUID(), namespace = `scenario:${scenario}:run:${run}` as const;
        const branch = await createSimulationBranch(store.pool, snapshot, { run_id: run, school_id: f.schoolId, scenario_id: scenario, namespace_id: namespace });
        const driver = new SimulationBranchDriver(store.pool, branch, snapshot), compiler = new PostgresDialect({ pool: store.pool });
        const database = new Kysely<Database>({ dialect: { createDriver: () => driver, createAdapter: () => compiler.createAdapter(), createQueryCompiler: () => compiler.createQueryCompiler(), createIntrospector: c => compiler.createIntrospector(c) } }) as DatabaseService;
        opened.push(database);
        const environment = simulationRequestEnvironment({ institution_id: f.schoolId, scenario_id: scenario, run_id: run, virtual_now: now, source_snapshot_ref: `sha256:${snapshot.content_hash}`, manifest_ref: 'catalogue-recovery-test', checked_at: now });
        return { ...services(database), database, namespace, run: <T>(work: () => Promise<T>) => executionEnvironmentStorage.run(environment, work) };
      };
      const world = await open(), sibling = await open(), duplicate = input(classValues), change = { ...classValues, room_number: 'CC2-230', catalog_id: original.catalog_id, command_id: randomUUID(), expected_revision: 1, confirmed: true, change_reason: '' };
      await world.run(async () => {
        // Refuse the first catalogue write in this branch. Its failed INSERT
        // may also undo first materialization within the native savepoint.
        const proof = await refused(world.operations.saveCatalog(f.owner, f.schoolId, 'classes', duplicate));
        expect(proof).toMatchObject({ environment_namespace_id: world.namespace, terminal_state: 'conflicted' });
        expect(await world.database.selectFrom('class_sections').select('id').where('id', '=', duplicate.catalog_id).execute()).toEqual([]);
        expect(await world.database.selectFrom('campus_model_entities').select('lifecycle_state').where('school_id', '=', f.schoolId)
          .where('domain', '=', 'academic_catalogue').where('domain_id', '=', duplicate.catalog_id).execute()).toEqual([{ lifecycle_state: 'planned' }]);
        const first = await world.operations.saveCatalog(f.owner, f.schoolId, 'classes', change, original.catalog_id);
        expect(first).toMatchObject({ revision: 2, room_number: 'CC2-230' });
        expect(await world.operations.saveCatalog(f.owner, f.schoolId, 'classes', change, original.catalog_id)).toMatchObject({ revision: 2, room_number: 'CC2-230' });
        expect(await world.operations.confirmCatalog(f.owner, f.schoolId, 'classes', original.catalog_id, change.command_id)).toMatchObject({ state: 'accepted', result: { revision: 2 } });
        expect(await world.database.selectFrom('campus_model_commands').select(['state', 'environment_namespace_id']).where('correlation_id', '=', change.command_id).execute()).toEqual([{ state: 'accepted', environment_namespace_id: world.namespace }]);
        await world.operations.saveCatalog(f.owner, f.schoolId, 'classes', { ...change, command_id: randomUUID(), expected_revision: 2, section: 'C' }, original.catalog_id);
        expect(await refused(world.operations.saveCatalog(f.owner, f.schoolId, 'classes', duplicate))).toEqual(proof);
        expect(await world.database.selectFrom('class_sections').select('id').where('id', '=', duplicate.catalog_id).execute()).toEqual([]);
        expect(await world.database.selectFrom('campus_model_commands').select(['state', 'environment_namespace_id']).where('correlation_id', '=', duplicate.command_id).execute()).toEqual([{ state: 'conflicted', environment_namespace_id: world.namespace }]);
      });
      const unchanged = async (database: DatabaseService) => {
        expect(await database.selectFrom('class_sections').select(['revision', 'room_number']).where('id', '=', original.catalog_id).execute()).toEqual([{ revision: 1, room_number: classValues.room_number }]);
        expect(await database.selectFrom('campus_model_commands').select('id').where('correlation_id', '=', change.command_id).execute()).toEqual([]);
        expect(await database.selectFrom('campus_model_commands').select('id').where('correlation_id', '=', duplicate.command_id).execute()).toEqual([]);
        expect(await database.selectFrom('class_sections').select('id').where('id', '=', duplicate.catalog_id).execute()).toEqual([]);
        expect(await database.selectFrom('campus_model_entities').select('id').where('school_id', '=', f.schoolId).where('domain', '=', 'academic_catalogue').where('domain_id', '=', duplicate.catalog_id).execute()).toEqual([]);
      };
      await unchanged(db); await sibling.run(() => unchanged(sibling.database));
      await sibling.run(() => expect(sibling.operations.confirmCatalog(f.owner, f.schoolId, 'classes', original.catalog_id, change.command_id)).rejects.toThrow());
    } finally { await Promise.all(opened.map(database => database.destroy())); await store.pool.end(); }
  }, 120000);
});
