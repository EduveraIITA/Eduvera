import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool, types } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Database } from '../src/database/types.js';
import type { DatabaseService } from '../src/database/database.service.js';
import { SimulationSnapshotStore } from '../src/database/simulation-snapshot-store.js';
import { createSimulationBranch, SimulationBranchDriver } from '../src/database/simulation-branch.driver.js';
import { simulationRequestEnvironment } from '../src/database/simulation-world.service.js';
import { executionEnvironmentStorage } from '../src/campus-model-core/execution-time.runtime.js';
import { initializeSimulationResources, SimulationResourceStore } from '../src/database/simulation-resources.store.js';
import { ExecutionEffectRouter } from '../src/campus-model-core/execution-effects.runtime.js';
import { EXECUTION_EFFECT_KINDS } from '../src/campus-model-core/execution-effects.contracts.js';
import { bindSimulationResources, unbindSimulationResources } from '../src/common/simulation-resources.js';
import { requireIsolatedTestDatabaseUrl } from './test-database.js';
import { campusOperationsServices, createCampusOperationsFixture } from './campus-operations.test-support.js';
import { resourceLoanRequest } from './resource-loans.test-support.js';
import type { CampusEventDto } from '../src/campus-events/contracts.js';

const enabled = process.env.TEST_DATABASE_ISOLATED === 'true';
const source = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : 'postgresql://invalid.invalid/map_world_unused_test';
const target = process.env.CAMPUS_OPERATIONS_SIMULATION_TEST_TARGET_URL;
types.setTypeParser(1082, value => value);
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: source, max: 4 }) }) }) as DatabaseService;
beforeAll(() => { process.env.INVITATION_EMAIL_ENABLED = 'false'; });
afterAll(() => db.destroy());
const command = (revision: number) => ({ command_id: randomUUID(), expected_revision: revision });

describe.skipIf(!enabled || !target)('Published asset operations in actual isolated COW worlds', () => {
  it('verifies and reopens a fault, publishes and cancels an exact located event only in one branch, while Live and a sibling remain unchanged', async () => {
    const f = await createCampusOperationsFixture(db), store = new SimulationSnapshotStore(source, requireIsolatedTestDatabaseUrl(target), 3);
    const opened: DatabaseService[] = [], namespaces: string[] = [];
    let repairId = '', eventId = '';const otherRepairIds:string[]=[];
    try {
      await f.run(async () => {
        const remoteCampus=await f.topology.createCampus(f.user,f.schoolId,{name:'Remote field campus',code:'FIELD',campus_type:'branch'},resourceLoanRequest(f.user));
        const remotePlace=await f.topology.createSpace(f.user,f.schoolId,{campus_id:remoteCampus.id,name:'Field workshop',code:'FIELD-W',kind:'workshop'},resourceLoanRequest(f.user));
        for(let index=0;index<21;index++)otherRepairIds.push((await f.facilities.report(f.user,f.schoolId,{...command(0),space_id:remotePlace.id,problem:`Field workshop repair ${index+1}`})).id);
        const repair = await f.facilities.report(f.user, f.schoolId, { ...command(0), holding_id: f.holdingId,
          problem: 'Private reported lamp fault', asset_impact: 'not_working' });
        repairId = repair.id;
        eventId = (await f.events.create(resourceLoanRequest(f.user), f.eventInput())).id;
      });
      const snapshot = await store.capture(f.schoolId, f.now); await initializeSimulationResources(store.pool);
      expect(snapshot.counts.facilities_repairs).toBe(22);
      const open = async () => {
        const runId = randomUUID(), scenarioId = randomUUID(), namespace = `scenario:${scenarioId}:run:${runId}` as const;
        const branch = await createSimulationBranch(store.pool, snapshot, { run_id: runId, school_id: f.schoolId, scenario_id: scenarioId, namespace_id: namespace });
        const driver = new SimulationBranchDriver(store.pool, branch, snapshot), compiler = new PostgresDialect({ pool: store.pool });
        const database = new Kysely<Database>({ dialect: { createDriver: () => driver, createAdapter: () => compiler.createAdapter(),
          createQueryCompiler: () => compiler.createQueryCompiler(), createIntrospector: connection => compiler.createIntrospector(connection) } }) as DatabaseService;
        opened.push(database); namespaces.push(namespace);
        const environment = simulationRequestEnvironment({ institution_id: f.schoolId, scenario_id: scenarioId, run_id: runId,
          virtual_now: f.now, source_snapshot_ref: `sha256:${snapshot.content_hash}`, manifest_ref: 'campus-operations-actual-cow', checked_at: f.now });
        const resources = new SimulationResourceStore(store.pool, environment), effects = new ExecutionEffectRouter();
        effects.bindSimulationSinks({ environment, sinks: EXECUTION_EFFECT_KINDS.map(kind => resources.sink(kind)) });
        bindSimulationResources({ environment, artifacts: resources, effects, effectReplay: resources });
        return { ...campusOperationsServices(database), database, namespace,
          run: <T>(operation: () => Promise<T>) => executionEnvironmentStorage.run(environment, operation) };
      };
      const world = await open(), sibling = await open();
      await world.run(async () => {
        let map = await world.operations.view(f.borrower, f.schoolId, { campus_id: f.campusId });
        expect(map.environment).toEqual({ kind: 'simulation', namespace_id: world.namespace });
        expect(map.assets[0]).toMatchObject({ signal: { state: 'reported_fault', impact: 'not_working' }, repairs: [] });
        expect((await world.facilities.work(f.user,f.schoolId,{campus_id:f.campusId})).needs_me.map(item=>item.repair_id)).toEqual([repairId]);
        const ownMap=await world.operations.view(f.user,f.schoolId,{campus_id:f.campusId});
        expect(ownMap.activities.filter(item=>item.layer==='maintenance')).toEqual([expect.objectContaining({state:'reported',source:expect.objectContaining({record_id:repairId})})]);
        expect(ownMap.activities.some(item=>otherRepairIds.includes(item.source.record_id))).toBe(false);
        let repair = await world.facilities.act(f.user, f.schoolId, repairId, { ...command(1), action: 'accept' });
        const complete = { ...command(repair.revision), action: 'complete', note: 'Branch technician reports replacing the driver.' };
        repair = await world.facilities.act(f.user, f.schoolId, repairId, complete);
        expect(await world.facilities.act(f.user, f.schoolId, repairId, complete)).toMatchObject({ state: 'awaiting_verification', revision: 3 });
        expect((await world.operations.view(f.borrower, f.schoolId, { campus_id: f.campusId })).assets[0]?.signal.state).toBe('awaiting_verification');
        expect((await world.operations.view(f.user,f.schoolId,{campus_id:f.campusId})).activities.filter(item=>item.source.record_id===repairId))
          .toEqual([expect.objectContaining({state:'awaiting_verification',action_label:'Check repair'})]);
        const verify = { ...command(repair.revision), action: 'verify', note: 'Branch inspector checked this repaired lamp.' };
        repair = await world.facilities.act(f.user, f.schoolId, repairId, verify);
        expect(await world.facilities.act(f.user, f.schoolId, repairId, verify)).toMatchObject({ state: 'closed', revision: 4 });
        map = await world.operations.view(f.borrower, f.schoolId, { campus_id: f.campusId });
        expect(map.assets[0]).toMatchObject({ native_state: 'available', signal: { state: 'verified_resolution', open_reports: 0 }, repairs: [] });
        let event = await world.events.detail(f.user, eventId, f.schoolId);
        event = await world.events.save(resourceLoanRequest(f.user), eventId, f.eventDefinition(event, { space_id: f.otherPlaceId }));
        const publish = { school_id: f.schoolId, expected_revision: event.revision, idempotency_key: randomUUID() };
        event = await world.events.publish(resourceLoanRequest(f.user), eventId, publish) as CampusEventDto;
        expect(await world.events.publish(resourceLoanRequest(f.user), eventId, publish)).toMatchObject({ status: 'published' });
        const defaultMap = await world.operations.view(f.user, f.schoolId, { campus_id: f.campusId });
        expect(defaultMap.activities).toContainEqual(
          expect.objectContaining({ layer: 'events', space_id: f.otherPlaceId, dimension: 'expected' }));
        expect(defaultMap.personal_activities).toBeUndefined();
        const projectPersonal = vi.spyOn(world.personal, 'mine').mockRejectedValue(new Error('personal schedule read unavailable'));
        try {
          const lean = await world.operations.view(f.user, f.schoolId, { campus_id: f.campusId, activity_scope: 'campus_only' });
          expect(projectPersonal).not.toHaveBeenCalled();
          expect(lean).toMatchObject({ personal_activities: 'separate', environment: defaultMap.environment,
            publication: defaultMap.publication, assets: defaultMap.assets, activities: defaultMap.activities });
          await expect(world.operations.view(f.user, f.schoolId, { campus_id: f.campusId })).rejects.toThrow('personal schedule read unavailable');
        } finally {
          projectPersonal.mockRestore();
        }
        const footprint = (await sql<{space_id:string|null}>`SELECT space_id FROM schedule_activity_occurrences WHERE school_id=${f.schoolId}::uuid AND source='event'`.execute(world.database)).rows;
        expect(footprint).toEqual([{ space_id: f.otherPlaceId }]);
        const accepted = await world.database.selectFrom('campus_model_commands').select(['state', 'environment_namespace_id'])
          .where('school_id', '=', f.schoolId).where('command_type', '=', 'events.event.publish').execute();
        expect(accepted).toHaveLength(1);expect(accepted[0]?.state).toBe('accepted');expect(accepted[0]?.environment_namespace_id).toBe(world.namespace);
        await world.events.cancel(resourceLoanRequest(f.user), eventId, { school_id: f.schoolId, expected_revision: event.revision,
          idempotency_key: randomUUID(), internal_reason: 'Private branch-only cancellation reason', audience_notice: 'Workshop postponed in this rehearsal.' });
        expect((await world.operations.view(f.user, f.schoolId, { campus_id: f.campusId })).activities.filter(item => item.layer === 'events')).toEqual([]);
        repair = await world.facilities.act(f.user, f.schoolId, repairId, { ...command(repair.revision), action: 'reopen', reopen_kind:'further_work', note: 'Branch recurrence still needs further work.' });
        expect(repair).toMatchObject({ state: 'reported', revision: 5 });
        expect((await world.operations.view(f.borrower, f.schoolId, { campus_id: f.campusId })).assets[0]?.signal.state).toBe('reported_fault');
        const refresh = await world.database.selectFrom('event_outbox').select('payload').where('school_id', '=', f.schoolId).where('event_type', '=', 'campus_assets.updated').execute();
        expect(JSON.stringify(refresh)).not.toMatch(/Private|repair_id|person_id|technician|inspector|photo/);
        await expect(world.operations.view(f.borrower, f.schoolId, { campus_id: f.campusId, namespace_id: sibling.namespace })).rejects.toThrow('do not accept');
        await world.database.updateTable('school_memberships').set({ is_active: false }).where('school_id', '=', f.schoolId).where('user_id', '=', f.borrower.id).execute();
        await expect(world.operations.view(f.borrower, f.schoolId, { campus_id: f.campusId })).rejects.toThrow();
        await expect(world.operations.view(f.borrower, f.schoolId, { campus_id: f.campusId, activity_scope: 'campus_only' })).rejects.toThrow();
      });
      const unchanged = async (services: ReturnType<typeof campusOperationsServices>, database: DatabaseService) => {
        expect(await services.facilities.detail(f.user, f.schoolId, repairId)).toMatchObject({ state: 'reported', revision: 1, asset_impact: 'not_working' });
        expect(await services.events.detail(f.user, eventId, f.schoolId)).toMatchObject({ status: 'draft', revision: 1, space_id: f.placeId });
        const map = await services.operations.view(f.borrower, f.schoolId, { campus_id: f.campusId, activity_scope: 'campus_only' });
        expect(map.personal_activities).toBe('separate');
        expect(map.assets[0]?.signal).toMatchObject({ state: 'reported_fault', open_reports: 1 });
        expect((await services.facilities.work(f.user,f.schoolId,{campus_id:f.campusId})).needs_me.map(item=>item.repair_id)).toEqual([repairId]);
        expect((await sql`SELECT id FROM schedule_activity_occurrences WHERE school_id=${f.schoolId}::uuid AND source='event'`.execute(database)).rows).toEqual([]);
      };
      await f.run(() => unchanged(f, db));
      await sibling.run(() => unchanged(sibling, sibling.database));
      expect((await sql<{ count: number }>`SELECT count(*)::int AS count FROM campus_model_commands WHERE school_id=${f.schoolId}::uuid AND command_type='events.event.publish'`.execute(db)).rows[0]?.count).toBe(0);
    } finally {
      for (const namespace of namespaces) unbindSimulationResources(namespace);
      for (const database of opened) await database.destroy();
      await store.pool.end();
    }
  }, 180_000);
});
