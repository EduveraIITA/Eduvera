import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool, types } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXECUTION_EFFECT_KINDS } from '../src/campus-model-core/execution-effects.contracts.js';
import { ExecutionEffectRouter } from '../src/campus-model-core/execution-effects.runtime.js';
import { executionEnvironmentStorage } from '../src/campus-model-core/execution-time.runtime.js';
import { bindSimulationResources, unbindSimulationResources } from '../src/common/simulation-resources.js';
import type { DatabaseService } from '../src/database/database.service.js';
import type { Database } from '../src/database/types.js';
import { createSimulationBranch, SimulationBranchDriver } from '../src/database/simulation-branch.driver.js';
import { initializeSimulationResources, SimulationResourceStore } from '../src/database/simulation-resources.store.js';
import { SimulationSnapshotStore } from '../src/database/simulation-snapshot-store.js';
import { simulationRequestEnvironment } from '../src/database/simulation-world.service.js';
import { createExternalRepairFixture, externalCommand, externalPhoto, readExternalBytes } from './facilities-external-work.test-support.js';
import { facilitiesServices } from './facilities.test-support.js';
import { requireIsolatedTestDatabaseUrl } from './test-database.js';

const enabled = process.env.TEST_DATABASE_ISOLATED === 'true';
const source = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : 'postgresql://invalid.invalid/external_repair_worlds_unused_test';
const target = process.env.EXTERNAL_WORK_SIMULATION_TEST_TARGET_URL;
types.setTypeParser(1082, value => value);
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: source, max: 3 }) }) }) as DatabaseService;
let directory: string | undefined;
beforeAll(async () => { if (!enabled || !target) return; process.env.INVITATION_EMAIL_ENABLED = 'false';
  directory = await mkdtemp(join(tmpdir(), 'thatcampus-external-repair-cow-')); process.env.UPLOAD_DIR = directory; });
afterAll(async () => { await db.destroy(); if (directory) await rm(directory, { recursive: true, force: true }); });

describe.skipIf(!enabled || !target)('External repair authority in actual COW worlds', () => {
  it('isolates shared evidence, exact handoff, progress, expiry and another independent assignment', async () => {
    const f = await createExternalRepairFixture(db), technician = f.joined!.user;
    const sharedPhoto = externalCommand(f.repair.revision), bytes = externalPhoto('LIVE-shared-source-photo');
    let repair = await f.run(() => f.facilities.addPhoto(f.borrower, f.schoolId, f.repair.id, sharedPhoto, bytes));
    const deadline = new Date(Date.parse(f.now) + 86_400_000).toISOString();
    repair = await f.run(async () => f.facilities.grantExternal(f.user, f.schoolId, repair.id,
      await f.grantInput(repair.revision, { ends_at: deadline, shared_photo_ids: [sharedPhoto.command_id] })));
    const sourceRevision = repair.revision, assignmentId = repair.external_access!.id;
    let second = await f.run(() => f.facilities.report(f.borrower, f.schoolId,
      { ...externalCommand(0), problem: 'PRIVATE independent repair source', location_note: 'Independent fictional room' }));
    second = await f.run(async () => f.facilities.grantExternal(f.user, f.schoolId, second.id, await f.grantInput(second.revision)));
    const store = new SimulationSnapshotStore(source, requireIsolatedTestDatabaseUrl(target), 3);
    const opened: DatabaseService[] = [], namespaces: string[] = [];
    try {
      const snapshot = await store.capture(f.schoolId, f.now);
      expect(snapshot.counts.facilities_external_assignments).toBe(2);
      await initializeSimulationResources(store.pool);
      const open = async () => {
        const runId = randomUUID(), scenarioId = randomUUID(), namespace = `scenario:${scenarioId}:run:${runId}` as const;
        const branch = await createSimulationBranch(store.pool, snapshot, { run_id: runId, school_id: f.schoolId,
          scenario_id: scenarioId, namespace_id: namespace });
        const driver = new SimulationBranchDriver(store.pool, branch, snapshot), compiler = new PostgresDialect({ pool: store.pool });
        const database = new Kysely<Database>({ dialect: { createDriver: () => driver, createAdapter: () => compiler.createAdapter(),
          createQueryCompiler: () => compiler.createQueryCompiler(), createIntrospector: connection => compiler.createIntrospector(connection) } }) as DatabaseService;
        opened.push(database);
        const environment = (at: string) => simulationRequestEnvironment({ institution_id: f.schoolId, scenario_id: scenarioId, run_id: runId,
          virtual_now: at, source_snapshot_ref: `sha256:${snapshot.content_hash}`, manifest_ref: 'external-repair-real-cow', checked_at: f.now });
        const resources = new SimulationResourceStore(store.pool, environment(f.now)), effects = new ExecutionEffectRouter();
        effects.bindSimulationSinks({ environment: environment(f.now), sinks: EXECUTION_EFFECT_KINDS.map(kind => resources.sink(kind)) });
        const bind = () => bindSimulationResources({ environment: environment(f.now), artifacts: resources, effects, effectReplay: resources });
        bind(); namespaces.push(namespace);
        return { ...facilitiesServices(database), database, namespace, resources, bind,
          run: <T>(operation: () => Promise<T>) => executionEnvironmentStorage.run(environment(f.now), operation),
          runAt: <T>(at: string, operation: () => Promise<T>) => executionEnvironmentStorage.run(environment(at), operation) };
      };
      const world = await open(), sibling = await open();
      let branchRevision = sourceRevision;
      let branchAssignmentId = assignmentId;
      const addedPhoto = randomUUID(), branchBytes = externalPhoto('branch-technician-evidence');
      await world.run(async () => {
        const initial = await world.facilities.detail(technician, f.schoolId, repair.id);
        expect(initial.external_view).toBe(true); expect(JSON.stringify(initial)).not.toContain('PRIVATE');
        const omitted = await world.facilities.photo(technician, f.schoolId, repair.id, sharedPhoto.command_id);
        expect(omitted).toMatchObject({ evidence_mode: 'simulation', source_content_omitted: true });
        expect((await readExternalBytes(omitted.stream)).includes(bytes.data)).toBe(false);
        const person = await world.database.selectFrom('school_people').select('revision').where('school_id', '=', f.schoolId).where('id', '=', f.person.id).executeTakeFirstOrThrow();
        const changed = await world.facilities.grantExternal(f.user, f.schoolId, repair.id, { ...externalCommand(sourceRevision),
          person_id: f.person.id, expected_person_revision: person.revision, starts_at: f.now, ends_at: deadline,
          instructions: 'Branch-only instruction: inspect the reviewed connector and report the result.', shared_photo_ids: [sharedPhoto.command_id] });
        branchAssignmentId = changed.external_access!.id;
        expect(branchAssignmentId).not.toBe(assignmentId);
        await expect(world.facilities.activateExternal(technician, f.schoolId, repair.id, assignmentId, externalCommand(changed.revision))).rejects.toThrow();
        const activated = await world.facilities.activateExternal(technician, f.schoolId, repair.id, branchAssignmentId, externalCommand(changed.revision));
        const accepted = await world.facilities.act(technician, f.schoolId, repair.id, { ...externalCommand(activated.revision), action: 'accept' });
        const progress = await world.facilities.act(technician, f.schoolId, repair.id, { ...externalCommand(accepted.revision), action: 'update',
          status: 'waiting', wait_reason: 'parts', note: 'Branch-only connector ordered; campus source stays unchanged.' });
        const photo = await world.facilities.addPhoto(technician, f.schoolId, repair.id,
          { command_id: addedPhoto, expected_revision: progress.revision }, branchBytes);
        branchRevision = photo.revision;
        expect(await readExternalBytes((await world.facilities.photo(technician, f.schoolId, repair.id, addedPhoto)).stream)).toEqual(branchBytes.data);
        expect((await world.resources.list(1, 20)).counts.artifacts).toBe(1);
        await expect(f.invitations.create(technician, f.schoolId,
          { role: 'member', person_id: f.person.id, email: f.email, idempotency_key: randomUUID() })).rejects.toThrow('managed in Live');
        expect((await world.resources.list(1, 20)).counts.effects).toMatchObject({ external_notification: 0, connector_call: 0 });
      });
      await world.runAt(new Date(Date.parse(deadline) - 1).toISOString(), async () => {
        expect((await world.facilities.detail(technician, f.schoolId, repair.id)).revision).toBe(branchRevision);
      });
      await world.runAt(deadline, async () => {
        await expect(world.facilities.detail(technician, f.schoolId, repair.id)).rejects.toThrow();
        await expect(world.facilities.photo(technician, f.schoolId, repair.id, addedPhoto)).rejects.toThrow();
        await expect(world.facilities.act(technician, f.schoolId, repair.id, { ...externalCommand(branchRevision), action: 'complete',
          note: 'An expired source must not permit this completion.' })).rejects.toThrow();
        expect((await world.facilities.detail(technician, f.schoolId, second.id)).external_view).toBe(true);
        const endpoint = await world.database.transaction().execute(tx => world.core.resolveAccountEndpoint(tx,
          { school_id: f.schoolId, user_id: technician.id, at: deadline }));
        expect(endpoint.acting).toBe(true);
        expect((await world.facilities.work(technician, f.schoolId)).needs_me.some(row => row.repair_id === repair.id)).toBe(false);
        expect((await sql<{ valid: boolean }>`SELECT facilities_event_recipient_valid(${f.schoolId}::uuid,${JSON.stringify({ repair_id: repair.id })}::jsonb,${technician.id}::uuid) AS valid`
          .execute(world.database)).rows[0]!.valid).toBe(false);
        expect((await world.facilities.work(f.user, f.schoolId)).needs_me).toEqual(expect.arrayContaining([
          expect.objectContaining({ repair_id: repair.id, action: 'recover' }),
        ]));
        await world.facilities.endExternal(f.user, f.schoolId, repair.id, branchAssignmentId,
          { ...externalCommand(branchRevision), note: 'The branch campus ends this expired supplier assignment.' });
      });
      const unchanged = async (service: ReturnType<typeof facilitiesServices>['facilities']) => {
        expect(await service.detail(f.user, f.schoolId, repair.id)).toMatchObject({ revision: sourceRevision, state: 'reported', handler: { id: f.custodianPersonId } });
        expect((await service.detail(technician, f.schoolId, repair.id)).external_view).toBe(true);
        await expect(service.photo(technician, f.schoolId, repair.id, addedPhoto)).rejects.toThrow();
      };
      await f.run(() => unchanged(f.facilities)); await sibling.run(() => unchanged(sibling.facilities));
      expect(await readExternalBytes((await f.run(() => f.facilities.photo(technician, f.schoolId, repair.id, sharedPhoto.command_id))).stream)).toEqual(bytes.data);
      expect((await sibling.resources.list(1, 20)).counts.artifacts).toBe(0);
      const events = await world.run(() => world.database.selectFrom('event_outbox').select('payload').where('school_id', '=', f.schoolId)
        .where('event_type', '=', 'facilities.updated').execute());
      expect(JSON.stringify(events)).not.toMatch(/PRIVATE|Branch-only|instructions|file_name/u);
    } finally {
      for (const namespace of namespaces) unbindSimulationResources(namespace);
      await Promise.all(opened.map(database => database.destroy())); await store.pool.end();
    }
  }, 150_000);
});
