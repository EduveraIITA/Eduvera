import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXECUTION_EFFECT_KINDS } from '../src/campus-model-core/execution-effects.contracts.js';
import { ExecutionEffectRouter } from '../src/campus-model-core/execution-effects.runtime.js';
import { executionEnvironmentStorage } from '../src/campus-model-core/execution-time.runtime.js';
import { bindSimulationResources, unbindSimulationResources } from '../src/common/simulation-resources.js';
import type { DatabaseService } from '../src/database/database.service.js';
import { createSimulationBranch, SimulationBranchDriver } from '../src/database/simulation-branch.driver.js';
import { initializeSimulationResources, SimulationResourceStore } from '../src/database/simulation-resources.store.js';
import { SimulationSnapshotStore, type StoredSimulationSnapshot } from '../src/database/simulation-snapshot-store.js';
import { simulationRequestEnvironment } from '../src/database/simulation-world.service.js';
import type { Database } from '../src/database/types.js';
import { requireIsolatedTestDatabaseUrl } from './test-database.js';
import { createVisitGuestFixture, visitGuestCommand, visitGuestLater, visitGuestServices } from './visit-guest-view.test-support.js';

const enabled = process.env.TEST_DATABASE_ISOLATED === 'true';
const source = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : 'postgresql://invalid.invalid/visit_guest_cow_unused_test';
const target = process.env.VISIT_GUEST_SIMULATION_TEST_TARGET_URL;
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: source, max: 3 }) }) }) as DatabaseService;
beforeAll(() => { process.env.INVITATION_EMAIL_ENABLED = 'false'; });
afterAll(() => db.destroy());

async function openWorld(store: SimulationSnapshotStore, snapshot: StoredSimulationSnapshot, school: string) {
  const scenario = randomUUID(), run = randomUUID(), namespace = `scenario:${scenario}:run:${run}` as const;
  const branch = await createSimulationBranch(store.pool, snapshot, { run_id: run, school_id: school, scenario_id: scenario, namespace_id: namespace });
  const driver = new SimulationBranchDriver(store.pool, branch, snapshot), compiler = new PostgresDialect({ pool: store.pool });
  const database = new Kysely<Database>({ dialect: { createDriver: () => driver, createAdapter: () => compiler.createAdapter(),
    createQueryCompiler: () => compiler.createQueryCompiler(), createIntrospector: connection => compiler.createIntrospector(connection) } }) as DatabaseService;
  const at = (time: string) => simulationRequestEnvironment({ institution_id: school, scenario_id: scenario, run_id: run,
    virtual_now: time, source_snapshot_ref: `sha256:${snapshot.content_hash}`, manifest_ref: 'visit-guest-actual-cow', checked_at: snapshot.captured_at });
  const resources = new SimulationResourceStore(store.pool, at(snapshot.captured_at)), effects = new ExecutionEffectRouter();
  effects.bindSimulationSinks({ environment: at(snapshot.captured_at), sinks: EXECUTION_EFFECT_KINDS.map(kind => resources.sink(kind)) });
  bindSimulationResources({ environment: at(snapshot.captured_at), artifacts: resources, effects, effectReplay: resources });
  return { database, namespace, resources, ...visitGuestServices(database),
    runAt: <T>(time: string, operation: () => Promise<T>) => executionEnvironmentStorage.run(at(time), operation) };
}

describe.runIf(enabled && Boolean(target))('Private visitor self-service in actual selected COW worlds', () => {
  it('changes the same visit and private thread in one branch while keeping Live, a sibling and real identity effects unchanged', async () => {
    const f = await createVisitGuestFixture(db, { pending: true });
    const input = await f.shareInput(0), sharing = await f.run(() => f.sharing.share(f.user, f.schoolId, f.visit.id, input));
    const guest = (await f.join({ kind: 'visit_arrangement', source_id: f.visit.id, access_id: sharing.current!.id })).user;
    const original = await f.run(() => f.sharing.sharedDetail(guest, f.schoolId, f.visit.id));
    const originalRefresh = await db.selectFrom('event_outbox').select('payload').where('school_id', '=', f.schoolId)
      .where('event_type', '=', 'gate.visit_shared.updated').executeTakeFirstOrThrow();
    const store = new SimulationSnapshotStore(source, requireIsolatedTestDatabaseUrl(target), 3), opened: DatabaseService[] = [], namespaces: string[] = [];
    try {
      const snapshot = await store.capture(f.schoolId, f.now);
      expect(snapshot.counts.gate_visit_shares).toBe(1);
      await initializeSimulationResources(store.pool);
      const world = await openWorld(store, snapshot, f.schoolId), sibling = await openWorld(store, snapshot, f.schoolId);
      opened.push(world.database, sibling.database);
      namespaces.push(world.namespace, sibling.namespace);
      const at = visitGuestLater(f.now, 15);
      await world.runAt(at, async () => {
        expect((await world.database.selectFrom('school_memberships').select('access_scope').where('school_id', '=', f.schoolId)
          .where('user_id', '=', guest.id).executeTakeFirstOrThrow()).access_scope).toBe('assigned_work');
        expect(await world.sharing.sharedDetail(guest, f.schoolId, f.visit.id)).toEqual(original);
        await world.visits.update(f.user, f.schoolId, f.visit.id, { ...f.input, ...visitGuestCommand(1),
          starts_at: visitGuestLater(f.now, 200), ends_at: visitGuestLater(f.now, 300) });
        let detail = await world.sharing.ask(guest, f.schoolId, f.visit.id, { ...visitGuestCommand(0),
          share_id: sharing.current!.id, note: 'PRIVATE branch-only question about the changed meeting time.' });
        detail = await world.sharing.reply(f.user, f.schoolId, f.visit.id, detail.question!.id,
          { ...visitGuestCommand(detail.question!.revision), note: 'The coordinator confirms the revised time in this rehearsal.' });
        expect(detail.question).toMatchObject({ state: 'answered', revision: 2 });
        expect(detail.share.ends_at).toBe(input.ends_at);
        await world.visits.cancel(f.user, f.schoolId, f.visit.id, visitGuestCommand(2));
        expect((await world.sharing.sharedDetail(guest, f.schoolId, f.visit.id)).visit.state).toBe('cancelled');
      });
      await world.runAt(visitGuestLater(f.now, 210), async () => {
        const detail = await world.sharing.sharedDetail(guest, f.schoolId, f.visit.id);
        expect(detail.visit.state).toBe('cancelled');
        expect(detail.question).toMatchObject({ state: 'answered' });
        await world.sharing.revoke(f.user, f.schoolId, f.visit.id, sharing.current!.id, visitGuestCommand(sharing.share_revision));
        await expect(world.sharing.sharedDetail(guest, f.schoolId, f.visit.id)).rejects.toThrow();
      });
      await f.run(async () => {
        expect(await f.sharing.sharedDetail(guest, f.schoolId, f.visit.id)).toEqual(original);
        expect(await db.selectFrom('gate_visit_questions').select('id').where('school_id', '=', f.schoolId).execute()).toEqual([]);
      });
      await sibling.runAt(f.now, async () => {
        expect(await sibling.sharing.sharedDetail(guest, f.schoolId, f.visit.id)).toEqual(original);
        expect(await sibling.database.selectFrom('gate_visit_questions').select('id').where('school_id', '=', f.schoolId).execute()).toEqual([]);
      });
      await sibling.runAt(input.ends_at, async () => {
        await expect(sibling.sharing.sharedDetail(guest, f.schoolId, f.visit.id)).rejects.toThrow();
        expect((await sql<{ valid: boolean }>`SELECT event_user_is_authorized(${f.schoolId}::uuid,
          'gate.visit_shared.updated',${JSON.stringify(originalRefresh.payload)}::jsonb,${guest.id}::uuid) AS valid`
          .execute(sibling.database)).rows[0]!.valid).toBe(false);
      });
      expect((await world.resources.list(1, 20)).counts.effects).toMatchObject({ external_notification: 0, connector_call: 0 });
      expect((await sibling.resources.list(1, 20)).counts.effects).toMatchObject({ external_notification: 0, connector_call: 0 });
      const events = await world.runAt(visitGuestLater(f.now, 210), () => world.database.selectFrom('campus_model_events')
        .select(['payload', 'environment_namespace_id']).where('school_id', '=', f.schoolId).execute());
      expect(JSON.stringify(events)).not.toContain('PRIVATE');
    } finally {
      for (const namespace of namespaces) unbindSimulationResources(namespace);
      await Promise.all(opened.map(database => database.destroy()));
      await store.pool.end();
    }
  }, 120_000);
});
