import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool, types } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Database } from '../src/database/types.js';
import type { DatabaseService } from '../src/database/database.service.js';
import type { SceneDocument } from '../src/campus-scenes/campus-scenes.contracts.js';
import { CampusSceneImportProvider } from '../src/campus-scene-import/scene-import.provider.js';
import { CampusSceneImportService } from '../src/campus-scene-import/scene-import.service.js';
import { executionEnvironmentStorage } from '../src/campus-model-core/execution-time.runtime.js';
import { EXECUTION_EFFECT_KINDS } from '../src/campus-model-core/execution-effects.contracts.js';
import { ExecutionEffectRouter } from '../src/campus-model-core/execution-effects.runtime.js';
import { bindSimulationResources, unbindSimulationResources } from '../src/common/simulation-resources.js';
import { createSimulationBranch, SimulationBranchDriver } from '../src/database/simulation-branch.driver.js';
import { SimulationSnapshotStore } from '../src/database/simulation-snapshot-store.js';
import { initializeSimulationResources, SimulationResourceStore } from '../src/database/simulation-resources.store.js';
import { simulationRequestEnvironment } from '../src/database/simulation-world.service.js';
import { campusScenePng } from './campus-scenes.test-support.js';
import { campusOperationsServices } from './campus-operations.test-support.js';
import { createFloorPlanFixture, extractedFloorPlan, floorPlanReview, furnishFloor, type FloorPlanFixture } from './floor-plan-onboarding.test-support.js';
import { resourceLoanRequest } from './resource-loans.test-support.js';
import { requireIsolatedTestDatabaseUrl } from './test-database.js';

const enabled = process.env.TEST_DATABASE_ISOLATED === 'true';
const source = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL)
  : 'postgresql://invalid.invalid/floor_plan_unused_test';
const target = process.env.FLOOR_PLAN_ONBOARDING_SIMULATION_TEST_TARGET_URL;
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: source, max: 4 }) }) }) as DatabaseService;
types.setTypeParser(1082, value => value);
beforeAll(() => {
  process.env.INVITATION_EMAIL_ENABLED = 'false';
  // External inference is stubbed only at its provider boundary below. Native
  // allowance, proposal, topology, scene, repair and Core paths remain real.
  process.env.AGENT_ENABLED = 'true';
  process.env.AGENT_ENABLED_UNTIL = '2099-01-01T00:00:00Z';
  process.env.AGENT_PROVIDER = 'vertex';
  process.env.AGENT_DAILY_BUDGET_MICROS = '2000000';
  process.env.AGENT_MONTHLY_BUDGET_MICROS = '20000000';
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => db.destroy());
const command = (revision: number) => ({ command_id: randomUUID(), expected_revision: revision });

/** Compare every relevant tenant row instead of relying on one convenient count. */
async function state(database: DatabaseService, schoolId: string) {
  return (await sql<Record<string, unknown>>`SELECT
    (SELECT coalesce(jsonb_agg(to_jsonb(row) ORDER BY row.id),'[]'::jsonb) FROM campus_spaces row WHERE school_id=${schoolId}::uuid) AS places,
    (SELECT coalesce(jsonb_agg(to_jsonb(row) ORDER BY row.id),'[]'::jsonb) FROM campus_resource_holdings row WHERE school_id=${schoolId}::uuid) AS holdings,
    (SELECT coalesce(jsonb_agg(to_jsonb(row) ORDER BY row.id),'[]'::jsonb) FROM campus_visual_scenes row WHERE school_id=${schoolId}::uuid) AS scenes,
    (SELECT coalesce(jsonb_agg(to_jsonb(row) ORDER BY row.id),'[]'::jsonb) FROM campus_scene_revisions row WHERE school_id=${schoolId}::uuid) AS scene_revisions,
    (SELECT coalesce(jsonb_agg(to_jsonb(row) ORDER BY row.id),'[]'::jsonb) FROM facilities_repairs row WHERE school_id=${schoolId}::uuid) AS repairs,
    (SELECT coalesce(jsonb_agg(to_jsonb(row) ORDER BY row.id),'[]'::jsonb) FROM facilities_repair_receipts row WHERE school_id=${schoolId}::uuid) AS repair_receipts,
    (SELECT coalesce(jsonb_agg(to_jsonb(row) ORDER BY row.id),'[]'::jsonb) FROM institution_setup_audits row WHERE school_id=${schoolId}::uuid) AS setup_audits,
    (SELECT coalesce(jsonb_agg(to_jsonb(row) ORDER BY row.id),'[]'::jsonb) FROM campus_model_commands row WHERE school_id=${schoolId}::uuid) AS commands,
    (SELECT coalesce(jsonb_agg(to_jsonb(row) ORDER BY row.id),'[]'::jsonb) FROM campus_model_command_outcomes row
      WHERE command_id IN (SELECT id FROM campus_model_commands WHERE school_id=${schoolId}::uuid)) AS outcomes,
    (SELECT coalesce(jsonb_agg(to_jsonb(row) ORDER BY row.id),'[]'::jsonb) FROM event_outbox row WHERE school_id=${schoolId}::uuid) AS events`.execute(database)).rows[0]!;
}

async function imageProposal(f: FloorPlanFixture) {
  const image = await f.scenes.uploadImage(f.user, f.schoolId, f.campusId, {
    idempotency_key: randomUUID(), rights_confirmed: true, data_url: campusScenePng,
  });
  const generate = vi.spyOn(f.provider, 'image').mockImplementation(async (_input, reserve) => {
    await reserve(100, 6144);
    return extractedFloorPlan(image.image.id);
  });
  const input = { kind: 'image', purpose: 'floor_plan', source_kind: 'site_plan',
    idempotency_key: randomUUID(), image_asset_id: image.image.id, label: 'Learning block first-floor plan',
    target: { building_id: f.buildingId, expected_building_revision: f.buildingRevision } };
  const result = await f.importer.import(f.user, f.schoolId, f.campusId, input).catch(async error => {
    // The native importer deliberately sanitizes provider failures. Preserve a
    // failing controlled seam as useful isolated-test diagnostics instead.
    const controlled = generate.mock.results.at(-1);
    if (controlled?.type === 'return') await controlled.value;
    throw error;
  });
  return { input, result, generate };
}

async function locatedTaskLight(f: FloorPlanFixture, roomId: string) {
  const type = await f.topology.createResourceType(f.user, f.schoolId, {
    name: 'Task lights', code: 'TASK-LIGHT', category: 'lab_equipment', tracking_mode: 'individual', unit_label: 'lights',
  }, resourceLoanRequest(f.user));
  const item = await f.topology.createAsset(f.user, f.schoolId, {
    campus_id: f.campusId, space_id: roomId, resource_type_id: type.id,
    name: 'Laboratory task light', quantity: 1, asset_tag: 'WIL-LR102-L01', state: 'available', notes: '',
  }, resourceLoanRequest(f.user));
  return { id: String(item.id) };
}

async function installReviewedFloor(f: FloorPlanFixture, proposal: SceneDocument, revision: number) {
  const review = floorPlanReview(f, proposal, revision);
  const saved = await f.scenes.saveReviewedPlaces(f.user, f.schoolId, f.campusId, review, resourceLoanRequest(f.user));
  const floorId = saved.mappings.find(row => row.proposal_id === 'first-floor')!.space_id;
  const roomId = saved.mappings.find(row => row.proposal_id === 'laboratory')!.space_id;
  const item = await locatedTaskLight(f, roomId);
  const furnished = furnishFloor(saved.document, floorId, roomId, item.id);
  // The administrator explicitly reviews the inferred outlines AND illustration.
  furnished.elements.forEach(element => { element.review_state = 'reviewed'; });
  const complete = await f.scenes.saveDraft(f.user, f.schoolId, f.campusId, {
    idempotency_key: randomUUID(), expected_revision: saved.revision, document: furnished,
  });
  await f.scenes.publish(f.user, f.schoolId, f.campusId, {
    idempotency_key: randomUUID(), expected_revision: complete.revision,
  });
  return { review, saved, floorId, roomId, holdingId: item.id };
}

async function reportAndVerify(f: FloorPlanFixture, holdingId: string, roomId: string) {
  const read = async () => (await f.operations.view(f.borrower, f.schoolId, { campus_id: f.campusId })).assets
    .find(asset => asset.holding_id === holdingId)!;
  expect(await read()).toMatchObject({ element_id: 'lab-lamp', holding_id: holdingId,
    native_state: 'available', reportable: true, signal: { state: 'unknown', open_reports: 0 } });
  const input = { ...command(0), holding_id: holdingId, space_id: roomId, asset_impact: 'not_working',
    problem: 'Private: the task light does not turn on at this laboratory workbench.' };
  let repair = await f.facilities.report(f.borrower, f.schoolId, input);
  expect(await f.facilities.report(f.borrower, f.schoolId, input)).toMatchObject({ id: repair.id, revision: 1 });
  expect(await read()).toMatchObject({ signal: { state: 'reported_fault', impact: 'not_working', open_reports: 1 } });
  expect((await f.facilities.work(f.user, f.schoolId, { campus_id: f.campusId })).needs_me)
    .toContainEqual(expect.objectContaining({ repair_id: repair.id, action: 'accept' }));
  repair = await f.facilities.act(f.user, f.schoolId, repair.id, { ...command(repair.revision), action: 'accept' });
  repair = await f.facilities.act(f.user, f.schoolId, repair.id, {
    ...command(repair.revision), action: 'update', status: 'waiting', wait_reason: 'parts',
    note: 'Awaiting the matching power adapter; this is not a completion.',
  });
  expect(await read()).toMatchObject({ signal: { state: 'reported_fault', open_reports: 1 } });
  repair = await f.facilities.act(f.user, f.schoolId, repair.id, {
    ...command(repair.revision), action: 'complete', note: 'Adapter replaced; the reporter must check the light.',
  });
  expect(await read()).toMatchObject({ signal: { state: 'awaiting_verification', open_reports: 1 } });
  await expect(f.facilities.act(f.user, f.schoolId, repair.id, {
    ...command(repair.revision), action: 'verify',
  })).rejects.toThrow(/exact responsible/);
  const verify = { ...command(repair.revision), action: 'verify', note: 'Checked at the workbench: the light turns on.' };
  repair = await f.facilities.act(f.borrower, f.schoolId, repair.id, verify);
  expect(await f.facilities.act(f.borrower, f.schoolId, repair.id, verify)).toMatchObject({ id: repair.id, state: 'closed', revision: repair.revision });
  expect(await read()).toMatchObject({ native_state: 'available', signal: { state: 'verified_resolution', open_reports: 0 } });
  return { repair, read };
}

describe.skipIf(!enabled)('Floor-plan onboarding to exact asset repair lifecycle on a fresh campus', () => {
  it('reviews one plan into a native floor and three rooms once, preserves illustration versus inventory, then reports and verifies the exact mapped light', async () => {
    const f = await createFloorPlanFixture(db);
    await f.run(async () => {
      const opened = await f.scenes.reopen(f.user, f.schoolId, f.campusId, {
        idempotency_key: randomUUID(), expected_revision: f.publishedRevision,
      });
      const before = await state(db, f.schoolId), { input, result, generate } = await imageProposal(f);
      expect(result.document.elements.every(element => element.review_state === 'needs_review'
        && element.space_id === null && element.floor_id === null)).toBe(true);
      expect(await f.importer.import(f.user, f.schoolId, f.campusId, input)).toEqual(result);
      expect(generate).toHaveBeenCalledTimes(1);
      const afterProposal = await state(db, f.schoolId);
      // Uploading private source bytes has its own native command and outbox
      // evidence; inference itself creates no layout, place or inventory facts.
      for (const key of ['places', 'holdings', 'scenes', 'scene_revisions']) expect(afterProposal[key]).toEqual(before[key]);
      await expect(f.importer.import(f.borrower, f.schoolId, f.campusId, input)).rejects.toThrow(/administrator/);
      const review = floorPlanReview(f, result.document, opened.revision);
      const saved = await f.scenes.saveReviewedPlaces(f.user, f.schoolId, f.campusId, review, resourceLoanRequest(f.user));
      const after = await state(db, f.schoolId);
      const replay = await f.scenes.saveReviewedPlaces(f.user, f.schoolId, f.campusId, review, resourceLoanRequest(f.user));
      expect(replay).toMatchObject({ replayed: true, mappings: saved.mappings });
      expect(await state(db, f.schoolId)).toEqual(after);
      await expect(f.scenes.saveReviewedPlaces(f.user, f.schoolId, f.campusId,
        { ...review, rows: review.rows.map(row => ({ ...row, name: `${row.name} changed` })) }, resourceLoanRequest(f.user))).rejects.toThrow(/different/);
      const floorId = saved.mappings.find(row => row.proposal_id === 'first-floor')!.space_id;
      const roomId = saved.mappings.find(row => row.proposal_id === 'laboratory')!.space_id;
      const spaces = await db.selectFrom('campus_spaces').select(['id', 'kind', 'parent_space_id']).where('school_id', '=', f.schoolId).execute();
      expect(spaces).toHaveLength(5);
      expect(spaces.find(row => row.id === floorId)).toMatchObject({ kind: 'floor', parent_space_id: f.buildingId });
      expect(spaces.filter(row => row.parent_space_id === floorId)).toHaveLength(3);
      expect(saved.document.elements.filter(element => element.id.startsWith('plan-')).every(element => element.floor_id === floorId)).toBe(true);
      expect(saved.document.elements.filter(element => element.kind === 'room').map(element => element.space_id).filter(Boolean)).toHaveLength(3);
      await expect(f.scenes.publish(f.user, f.schoolId, f.campusId, {
        idempotency_key: randomUUID(), expected_revision: saved.revision,
      })).rejects.toThrow(/Review every/);
      // Drawing furniture is not inventory and creates no accepted resources.
      const holdingsBefore = await db.selectFrom('campus_resource_holdings').select('id').where('school_id', '=', f.schoolId).execute();
      const item = await locatedTaskLight(f, roomId);
      const furnished = furnishFloor(saved.document, floorId, roomId, item.id);
      furnished.elements.forEach(element => { element.review_state = 'reviewed'; });
      const finalDraft = await f.scenes.saveDraft(f.user, f.schoolId, f.campusId, {
        idempotency_key: randomUUID(), expected_revision: saved.revision, document: furnished,
      });
      await f.scenes.publish(f.user, f.schoolId, f.campusId, { idempotency_key: randomUUID(), expected_revision: finalDraft.revision });
      expect(await db.selectFrom('campus_resource_holdings').select('id').where('school_id', '=', f.schoolId).execute()).toHaveLength(holdingsBefore.length + 1);
      const publicationBeforeRepair = await f.scenes.published(f.borrower, f.schoolId, f.campusId);
      const { repair, read } = await reportAndVerify(f, item.id, roomId);
      expect(await f.scenes.published(f.borrower, f.schoolId, f.campusId)).toEqual(publicationBeforeRepair);
      // Verified repair does not override the independent native inventory owner.
      const holding = await db.selectFrom('campus_resource_holdings').selectAll().where('id', '=', item.id).executeTakeFirstOrThrow();
      const { campus_id, space_id, resource_type_id, name, quantity, asset_tag, notes } = holding;
      await f.topology.updateAsset(f.user, f.schoolId, item.id, {
        campus_id, space_id, resource_type_id, name, quantity, asset_tag, notes, state: 'unavailable', expected_revision: holding.revision,
      }, resourceLoanRequest(f.user));
      expect(await read()).toMatchObject({ native_state: 'unavailable', signal: { state: 'verified_resolution' } });
      await f.facilities.act(f.borrower, f.schoolId, repair.id, { ...command(repair.revision), action: 'reopen',
        reopen_kind: 'further_work', note: 'The same adapter failure recurred after the checked repair.' });
      expect(await read()).toMatchObject({ native_state: 'unavailable', signal: { state: 'reported_fault', open_reports: 1 } });
      const refresh = await db.selectFrom('event_outbox').select('payload').where('school_id', '=', f.schoolId)
        .where('event_type', '=', 'campus_assets.updated').execute();
      expect(JSON.stringify(refresh)).not.toMatch(/Private|workbench|adapter|repair_id|person_id|problem|note/);
    });
  }, 180_000);

  it('refuses foreign/stale parents and later code conflicts atomically without leaving a floor, rooms, source events or a changed draft', async () => {
    const f = await createFloorPlanFixture(db), foreign = await createFloorPlanFixture(db);
    await f.run(async () => {
      const opened = await f.scenes.reopen(f.user, f.schoolId, f.campusId, { idempotency_key: randomUUID(), expected_revision: f.publishedRevision });
      const proposal = extractedFloorPlan(randomUUID());
      for (const alter of [
        (review: ReturnType<typeof floorPlanReview>) => { review.rows[0]!.expected_parent_revision = f.buildingRevision + 1; },
        (review: ReturnType<typeof floorPlanReview>) => { review.rows[0]!.parent_space_id = foreign.buildingId; },
        (review: ReturnType<typeof floorPlanReview>) => { review.rows[3]!.code = 'LEARNING'; },
      ]) {
        const review = floorPlanReview(f, proposal, opened.revision); alter(review);
        const before = await state(db, f.schoolId);
        await expect(f.scenes.saveReviewedPlaces(f.user, f.schoolId, f.campusId, review, resourceLoanRequest(f.user))).rejects.toThrow();
        expect(await state(db, f.schoolId)).toEqual(before);
      }
      const wrongRevision = floorPlanReview(f, proposal, opened.revision - 1), before = await state(db, f.schoolId);
      await expect(f.scenes.saveReviewedPlaces(f.user, f.schoolId, f.campusId, wrongRevision, resourceLoanRequest(f.user))).rejects.toThrow(/scene changed/);
      expect(await state(db, f.schoolId)).toEqual(before);
    });
  }, 180_000);

  it('reuses an exact existing floor without creating another floor and refuses to move an already scoped drawing through review', async () => {
    const f = await createFloorPlanFixture(db);
    await f.run(async () => {
      const floor = await f.topology.createSpace(f.user, f.schoolId, {
        campus_id: f.campusId, parent_space_id: f.buildingId, name: 'First floor', code: 'LEARNING-F1', kind: 'floor',
      }, resourceLoanRequest(f.user));
      const opened = await f.scenes.reopen(f.user, f.schoolId, f.campusId, { idempotency_key: randomUUID(), expected_revision: f.publishedRevision });
      const review = floorPlanReview(f, extractedFloorPlan(randomUUID()), opened.revision);
      const reuse = { ...review, rows: [{ proposal_id: 'first-floor', action: 'reuse',
        element_ids: [], floor_element_ids: review.rows[0]!.floor_element_ids,
        space_id: String(floor.id), expected_space_revision: Number(floor.revision) }, ...review.rows.slice(1)] };
      const wrong = structuredClone(reuse);
      wrong.document.elements.find(element => element.id === 'plan-laboratory')!.floor_id = randomUUID();
      const before = await state(db, f.schoolId);
      await expect(f.scenes.saveReviewedPlaces(f.user, f.schoolId, f.campusId, wrong, resourceLoanRequest(f.user)))
        .rejects.toThrow(/already belongs to another floor/);
      expect(await state(db, f.schoolId)).toEqual(before);
      const saved = await f.scenes.saveReviewedPlaces(f.user, f.schoolId, f.campusId, reuse, resourceLoanRequest(f.user));
      expect(saved.mappings[0]).toMatchObject({ proposal_id: 'first-floor', element_ids: [], space_id: floor.id, action: 'reused' });
      expect(await db.selectFrom('campus_spaces').select('id').where('school_id', '=', f.schoolId).where('kind', '=', 'floor').execute())
        .toEqual([{ id: floor.id }]);
      expect(saved.document.elements.filter(element => element.id.startsWith('plan-')).every(element => element.floor_id === floor.id)).toBe(true);
      expect(await db.selectFrom('campus_spaces').select('id').where('school_id', '=', f.schoolId).where('parent_space_id', '=', String(floor.id)).execute()).toHaveLength(3);
    });
  }, 180_000);

  it('refuses a reused floor from a different mapped building even when all proposed rooms would share that floor', async () => {
    const f = await createFloorPlanFixture(db);
    await f.run(async () => {
      const other = await f.topology.createSpace(f.user, f.schoolId, {
        campus_id: f.campusId, name: 'Arts block', code: 'ARTS', kind: 'building',
      }, resourceLoanRequest(f.user));
      const floor = await f.topology.createSpace(f.user, f.schoolId, {
        campus_id: f.campusId, parent_space_id: String(other.id), name: 'Arts first floor', code: 'ARTS-F1', kind: 'floor',
      }, resourceLoanRequest(f.user));
      const opened = await f.scenes.reopen(f.user, f.schoolId, f.campusId, { idempotency_key: randomUUID(), expected_revision: f.publishedRevision });
      const review = floorPlanReview(f, extractedFloorPlan(randomUUID()), opened.revision);
      // Every graphic still belongs to Learning block A. Explicit floor B is a
      // valid current same-campus floor, but cannot move these graphics into B.
      const wrong = { ...review, rows: [{ proposal_id: 'first-floor', action: 'reuse', element_ids: [],
        floor_element_ids: review.rows[0]!.floor_element_ids, space_id: String(floor.id),
        expected_space_revision: Number(floor.revision) }, ...review.rows.slice(1)] };
      const before = await state(db, f.schoolId);
      await expect(f.scenes.saveReviewedPlaces(f.user, f.schoolId, f.campusId, wrong, resourceLoanRequest(f.user))).rejects.toThrow();
      expect(await state(db, f.schoolId)).toEqual(before);
    });
  }, 180_000);

  it.skipIf(!target)('creates the floor, rooms, tagged item and verified repair only in one actual COW branch using a captured proposal, leaving its source and sibling byte-for-byte unchanged', async () => {
    const f = await createFloorPlanFixture(db);
    const captured = await f.run(async () => {
      const opened = await f.scenes.reopen(f.user, f.schoolId, f.campusId, { idempotency_key: randomUUID(), expected_revision: f.publishedRevision });
      return { ...await imageProposal(f), revision: opened.revision };
    });
    const store = new SimulationSnapshotStore(source, requireIsolatedTestDatabaseUrl(target), 3);
    const opened: DatabaseService[] = [], namespaces: string[] = [];
    try {
      const sourceBefore = await f.run(() => state(db, f.schoolId));
      const snapshot = await store.capture(f.schoolId, f.now);
      await initializeSimulationResources(store.pool);
      const open = async () => {
        const runId = randomUUID(), scenarioId = randomUUID(), namespace = `scenario:${scenarioId}:run:${runId}` as const;
        const branch = await createSimulationBranch(store.pool, snapshot, {
          run_id: runId, school_id: f.schoolId, scenario_id: scenarioId, namespace_id: namespace,
        });
        const driver = new SimulationBranchDriver(store.pool, branch, snapshot), compiler = new PostgresDialect({ pool: store.pool });
        const database = new Kysely<Database>({ dialect: { createDriver: () => driver, createAdapter: () => compiler.createAdapter(),
          createQueryCompiler: () => compiler.createQueryCompiler(), createIntrospector: connection => compiler.createIntrospector(connection) } }) as DatabaseService;
        opened.push(database); namespaces.push(namespace);
        const environment = simulationRequestEnvironment({ institution_id: f.schoolId, scenario_id: scenarioId, run_id: runId,
          virtual_now: f.now, source_snapshot_ref: `sha256:${snapshot.content_hash}`, manifest_ref: 'floor-plan-onboarding-lifecycle-cow', checked_at: f.now });
        const artifacts = new SimulationResourceStore(store.pool, environment), effects = new ExecutionEffectRouter();
        effects.bindSimulationSinks({ environment, sinks: EXECUTION_EFFECT_KINDS.map(kind => artifacts.sink(kind)) });
        bindSimulationResources({ environment, artifacts, effects, effectReplay: artifacts });
        const services = campusOperationsServices(database), provider = new CampusSceneImportProvider();
        const generate = vi.spyOn(provider, 'image').mockRejectedValue(new Error('Simulation must not contact an image provider.'));
        return { ...f, ...services, db: database, provider, generate,
          importer: new CampusSceneImportService(database, services.scenes, provider), namespace,
          run: <T>(operation: () => Promise<T>) => executionEnvironmentStorage.run(environment, operation) };
      };
      const world = await open(), sibling = await open();
      const siblingBefore = await sibling.run(() => state(sibling.db, f.schoolId));
      await world.run(async () => {
        const proposal = await world.importer.import(f.user, f.schoolId, f.campusId, captured.input);
        expect(proposal.document.elements).toEqual(captured.result.document.elements);
        expect(world.generate).not.toHaveBeenCalled();
        const installed = await installReviewedFloor(world, proposal.document, captured.revision);
        const { repair, read } = await reportAndVerify(world, installed.holdingId, installed.roomId);
        expect(repair.state).toBe('closed');
        expect(await read()).toMatchObject({ signal: { state: 'verified_resolution', open_reports: 0 } });
        expect((await world.operations.view(f.user, f.schoolId, { campus_id: f.campusId })).environment)
          .toEqual({ kind: 'simulation', namespace_id: world.namespace });
        const commands = await world.db.selectFrom('campus_model_commands').select(['state', 'environment_namespace_id'])
          .where('school_id', '=', f.schoolId).where('correlation_id', '=', repair.id).execute();
        expect(commands.length).toBeGreaterThan(3);
        expect(commands.every(row => row.state === 'accepted' && row.environment_namespace_id === world.namespace)).toBe(true);
        const replay = await world.scenes.saveReviewedPlaces(f.user, f.schoolId, f.campusId, installed.review, resourceLoanRequest(f.user));
        expect(replay).toMatchObject({ replayed: true, mappings: installed.saved.mappings });
        expect(world.generate).not.toHaveBeenCalled();
      });
      expect(await f.run(() => state(db, f.schoolId))).toEqual(sourceBefore);
      expect(await sibling.run(() => state(sibling.db, f.schoolId))).toEqual(siblingBefore);
      expect(await f.run(() => db.selectFrom('campus_spaces').select('id').where('school_id', '=', f.schoolId).where('kind', '=', 'floor').execute())).toEqual([]);
      expect(await sibling.run(() => sibling.db.selectFrom('campus_spaces').select('id').where('school_id', '=', f.schoolId).where('kind', '=', 'floor').execute())).toEqual([]);
    } finally {
      for (const namespace of namespaces) unbindSimulationResources(namespace);
      for (const database of opened) await database.destroy();
      await store.pool.end();
    }
  }, 240_000);
});
