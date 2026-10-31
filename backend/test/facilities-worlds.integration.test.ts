import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool, types } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { EXECUTION_EFFECT_KINDS } from "../src/campus-model-core/execution-effects.contracts.js";
import { ExecutionEffectRouter } from "../src/campus-model-core/execution-effects.runtime.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import { bindSimulationResources, unbindSimulationResources } from "../src/common/simulation-resources.js";
import type { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import { createSimulationBranch, SimulationBranchDriver } from "../src/database/simulation-branch.driver.js";
import { initializeSimulationResources, SimulationResourceStore } from "../src/database/simulation-resources.store.js";
import { SimulationSnapshotStore } from "../src/database/simulation-snapshot-store.js";
import { simulationRequestEnvironment } from "../src/database/simulation-world.service.js";
import { readFacilitiesReadiness } from "../src/institution-onboarding/facilities-readiness.js";
import { createFacilitiesFixture, facilitiesServices } from "./facilities.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
const source = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/facilities_worlds_unused_test";
const target = process.env.FACILITIES_SIMULATION_TEST_TARGET_URL;
types.setTypeParser(1082, value => value);
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: source, max: 3 }) }) }) as DatabaseService;
let temporaryUploads: string | undefined;
beforeAll(async () => {
  if (!enabled || !target) return;
  process.env.INVITATION_EMAIL_ENABLED = "false";
  temporaryUploads = await mkdtemp(join(tmpdir(), "thatcampus-facilities-cow-"));
  process.env.UPLOAD_DIR = temporaryUploads;
});
afterAll(async () => {
  await db.destroy();
  if (temporaryUploads) await rm(temporaryUploads, { recursive: true, force: true });
});
const content = async (stream: AsyncIterable<Buffer | string>) => {
  const chunks: Buffer[] = [];
  for await (const part of stream) chunks.push(Buffer.from(part));
  return Buffer.concat(chunks);
};
const png = (label: string) => Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from(label)]);

describe.skipIf(!enabled || !target)("Facilities repairs in actual COW worlds", () => {
  it("preserves captured evidence, completes and reopens only one branch, and never borrows Live photos", async () => {
    const f = await createFacilitiesFixture(db);
    const store = new SimulationSnapshotStore(source, requireIsolatedTestDatabaseUrl(target), 3);
    const opened: DatabaseService[] = [], namespaces: string[] = [];
    const livePhotoId = randomUUID(), branchPhotoId = randomUUID();
    const liveBytes = png("LIVE PRIVATE REPAIR IMAGE"), branchBytes = png("SCENARIO ONLY REPAIR IMAGE");
    let repairId = "";
    try {
      await f.run(async () => {
        expect((await readFacilitiesReadiness(db, f.core, f.user, f.schoolId)).operation.state).toBe("needs_intake");
        await f.facilities.saveSettings(f.user, f.schoolId, { command_id: randomUUID(), expected_revision: 0,
          handler_person_id: f.custodianPersonId, verifier_mode: "reporter" });
        expect((await readFacilitiesReadiness(db, f.core, f.borrower, f.schoolId)).operation.state).toBe("ready_to_report");
        const repair = await f.facilities.report(f.borrower, f.schoolId, { command_id: randomUUID(), expected_revision: 0,
          problem: "Fictional hostel window leak", location_note: "Fictional room 17", holding_id: f.holdingId });
        repairId = repair.id;
        await f.facilities.addPhoto(f.borrower, f.schoolId, repairId, { command_id: livePhotoId, expected_revision: 1 },
          { filename: "original-leak.png", mimetype: "image/png", data: liveBytes });
      });
      const snapshot = await store.capture(f.schoolId, f.now);
      expect(snapshot.counts.facilities_intake_rules).toBe(1);
      expect(snapshot.counts.facilities_repairs).toBe(1);
      expect(snapshot.counts.facilities_repair_receipts).toBe(2);
      expect(snapshot.counts.facilities_repair_photos).toBe(1);
      await initializeSimulationResources(store.pool);
      const open = async () => {
        const runId = randomUUID(), scenarioId = randomUUID(), namespace = `scenario:${scenarioId}:run:${runId}` as const;
        const branch = await createSimulationBranch(store.pool, snapshot, { run_id: runId, school_id: f.schoolId,
          scenario_id: scenarioId, namespace_id: namespace });
        const driver = new SimulationBranchDriver(store.pool, branch, snapshot), compiler = new PostgresDialect({ pool: store.pool });
        const database = new Kysely<Database>({ dialect: { createDriver: () => driver, createAdapter: () => compiler.createAdapter(),
          createQueryCompiler: () => compiler.createQueryCompiler(), createIntrospector: connection => compiler.createIntrospector(connection) } }) as DatabaseService;
        opened.push(database);
        const environment = simulationRequestEnvironment({ institution_id: f.schoolId, scenario_id: scenarioId, run_id: runId,
          virtual_now: f.now, source_snapshot_ref: `sha256:${snapshot.content_hash}`, manifest_ref: "facilities-real-cow-test", checked_at: f.now });
        const resources = new SimulationResourceStore(store.pool, environment), effects = new ExecutionEffectRouter();
        effects.bindSimulationSinks({ environment, sinks: EXECUTION_EFFECT_KINDS.map(kind => resources.sink(kind)) });
        const bind = () => bindSimulationResources({ environment, artifacts: resources, effects, effectReplay: resources });
        bind(); namespaces.push(namespace);
        return { ...facilitiesServices(database), database, namespace, resources, bind,
          run: <T>(fn: () => Promise<T>) => executionEnvironmentStorage.run(environment, fn),
          runAt: <T>(at: string, fn: () => Promise<T>) => executionEnvironmentStorage.run(simulationRequestEnvironment({
            institution_id: f.schoolId, scenario_id: scenarioId, run_id: runId, virtual_now: at,
            source_snapshot_ref: `sha256:${snapshot.content_hash}`, manifest_ref: "facilities-real-cow-test", checked_at: f.now,
          }), fn) };
      };
      const world = await open(), sibling = await open();
      let clockRepairId = "";
      await world.run(async () => {
        const omitted = await world.facilities.photo(f.borrower, f.schoolId, repairId, livePhotoId);
        expect(omitted).toMatchObject({ evidence_mode: "simulation", source_content_omitted: true });
        expect((await content(omitted.stream)).includes(liveBytes)).toBe(false);
        expect((await readFacilitiesReadiness(world.database, world.core, f.borrower, f.schoolId)).operation)
          .toMatchObject({ state: "repair_recorded", environment_namespace_id: world.namespace });
        const before = (await world.facilities.work(f.user, f.schoolId)).needs_me.find(item => item.repair_id === repairId)!;
        expect(before.action).toBe("accept");
        const upload = { command_id: branchPhotoId, expected_revision: 2 };
        const failed = vi.spyOn(world.model, "finish").mockRejectedValueOnce(new Error("Injected failure after immutable repair bytes"));
        try {
          await expect(world.facilities.addPhoto(f.borrower, f.schoolId, repairId, upload,
            { filename: "scenario-leak.png", mimetype: "image/png", data: branchBytes })).rejects.toThrow("Injected failure");
        } finally { failed.mockRestore(); }
        expect(await world.facilities.detail(f.borrower, f.schoolId, repairId)).toMatchObject({ revision: 2, state: "reported" });
        expect((await world.facilities.work(f.user, f.schoolId)).needs_me.find(item => item.repair_id === repairId)!.message_id).toBe(before.message_id);
        let repair = await world.facilities.addPhoto(f.borrower, f.schoolId, repairId, upload,
          { filename: "scenario-leak.png", mimetype: "image/png", data: branchBytes });
        expect(repair).toMatchObject({ state: "reported", revision: 3 });
        const after = (await world.facilities.work(f.user, f.schoolId)).needs_me.find(item => item.repair_id === repairId)!;
        expect(after.action).toBe("accept"); expect(after.message_id).not.toBe(before.message_id);
        expect(await world.database.selectFrom("campus_model_operational_message_outcomes").select(["state", "code", "response"])
          .where("message_id", "=", before.message_id!).execute()).toEqual([
          { state: "cancelled", code: "owning_domain_source_superseded", response: null },
        ]); // A reporter upload cannot impersonate the handler's acceptance.
        expect((await world.facilities.work(f.user, f.schoolId)).needs_me.filter(item => item.repair_id === repairId)).toHaveLength(1);
        expect(await world.facilities.addPhoto(f.borrower, f.schoolId, repairId, upload,
          { filename: "scenario-leak.png", mimetype: "image/png", data: branchBytes })).toMatchObject({ revision: 3 });
        await expect(world.facilities.addPhoto(f.borrower, f.schoolId, repairId, upload,
          { filename: "scenario-leak.png", mimetype: "image/png", data: png("DIFFERENT") })).rejects.toThrow("different repair work");
        const downloaded = await world.facilities.photo(f.borrower, f.schoolId, repairId, branchPhotoId);
        expect(downloaded).toMatchObject({ evidence_mode: "simulation", source_content_omitted: false });
        expect(await content(downloaded.stream)).toEqual(branchBytes);
        unbindSimulationResources(world.namespace);
        await expect(world.facilities.photo(f.borrower, f.schoolId, repairId, branchPhotoId)).rejects.toThrow("isolated effects and files are unavailable");
        world.bind();
        expect(await content((await world.facilities.photo(f.borrower, f.schoolId, repairId, branchPhotoId)).stream)).toEqual(branchBytes);
        await expect(world.facilities.act(f.borrower, f.schoolId, repairId,
          { command_id: randomUUID(), expected_revision: repair.revision, action: "accept" })).rejects.toThrow();
        const accept = { command_id: randomUUID(), expected_revision: repair.revision, action: "accept" };
        repair = await world.facilities.act(f.user, f.schoolId, repairId, accept);
        expect(repair).toMatchObject({ state: "accepted", revision: 4 });
        expect(await world.facilities.act(f.user, f.schoolId, repairId, accept)).toMatchObject({ state: "accepted", revision: 4 });
        repair = await world.facilities.act(f.user, f.schoolId, repairId, { command_id: randomUUID(), expected_revision: 4,
          action: "update", status: "waiting", wait_reason: "parts", note: "Replacement seal ordered; not yet repaired.",
          expected_finish_at: new Date(Date.parse(f.now) + 86_400_000).toISOString() });
        expect(repair).toMatchObject({ state: "waiting", wait_reason: "parts", revision: 5 });
        expect(repair.latest_progress).toMatchObject({ action: "updated", revision: 5, note: "Replacement seal ordered; not yet repaired." });
        expect((await world.facilities.work(f.user, f.schoolId)).needs_me.find(item => item.repair_id === repairId)!.due_at).toBeNull();
        await expect(world.facilities.act(f.user, f.schoolId, repairId, { command_id: randomUUID(), expected_revision: 4,
          action: "complete", note: "A stale action must not overwrite the wait." })).rejects.toThrow("changed");
        repair = await world.facilities.act(f.user, f.schoolId, repairId, { command_id: randomUUID(), expected_revision: 5,
          action: "complete", note: "Seal replaced; awaiting the resident's inspection." });
        expect(repair).toMatchObject({ state: "awaiting_verification", revision: 6 });
        expect((await world.facilities.detail(f.borrower, f.schoolId, repairId, { history_page: 2 })).latest_progress)
          .toMatchObject({ action: "completed", revision: 6, note: "Seal replaced; awaiting the resident's inspection." });
        expect((await world.facilities.work(f.borrower, f.schoolId)).needs_me.find(item => item.repair_id === repairId)!.action).toBe("verify");
        repair = await world.facilities.act(f.borrower, f.schoolId, repairId, { command_id: randomUUID(), expected_revision: 6,
          action: "reopen", note: "Still leaking near the window after the reported repair." });
        expect(repair).toMatchObject({ id: repairId, state: "reported", revision: 7 });
        expect(repair.latest_progress).toMatchObject({ action: "reopened", revision: 7, note: "Still leaking near the window after the reported repair." });
        repair = await world.facilities.act(f.user, f.schoolId, repairId, { command_id: randomUUID(), expected_revision: 7, action: "accept" });
        repair = await world.facilities.act(f.user, f.schoolId, repairId, { command_id: randomUUID(), expected_revision: 8,
          action: "complete", note: "Remaining window joint sealed and checked by the worker." });
        repair = await world.facilities.act(f.borrower, f.schoolId, repairId, { command_id: randomUUID(), expected_revision: 9,
          action: "verify", note: "Resident checked: no more dripping." });
        expect(repair).toMatchObject({ id: repairId, state: "closed", revision: 10 });
        expect((await sql<{ count: number }>`SELECT count(*)::int AS count FROM campus_model_agent_authorities
          WHERE school_id=${f.schoolId}::uuid AND grant_source='approved_coordination_policy' AND revoked_at IS NULL
            AND constraints->>'source_domain'='facilities' AND constraints->>'source_record_id'=${repairId}`
          .execute(world.database)).rows[0]!.count).toBe(0);
        expect((await world.facilities.work(f.user, f.schoolId)).needs_me.filter(item => item.repair_id === repairId)).toEqual([]);
        expect((await world.facilities.work(f.borrower, f.schoolId)).waiting.filter(item => item.repair_id === repairId)).toEqual([]);
        // An explicitly named technician needs only this repair responsibility,
        // never institution-wide settings/reassignment authority.
        await world.facilities.saveSettings(f.user, f.schoolId, { command_id: randomUUID(), expected_revision: 1,
          handler_person_id: f.borrowerPersonId, verifier_mode: "named", verifier_person_id: f.custodianPersonId });
        expect((await world.facilities.discovery(f.borrower, f.schoolId)).can_manage).toBe(false);
        let assigned = await world.facilities.report(f.user, f.schoolId, { command_id: randomUUID(), expected_revision: 0,
          problem: "Fictional branch-only broken lamp", location_note: "Fictional reading room" });
        assigned = await world.facilities.act(f.borrower, f.schoolId, assigned.id,
          { command_id: randomUUID(), expected_revision: 1, action: "accept" });
        expect(assigned.state).toBe("accepted");
        await expect(world.facilities.saveSettings(f.borrower, f.schoolId, { command_id: randomUUID(), expected_revision: 2,
          handler_person_id: f.borrowerPersonId, verifier_mode: "handler" })).rejects.toThrow();
        assigned = await world.facilities.act(f.borrower, f.schoolId, assigned.id,
          { command_id: randomUUID(), expected_revision: 2, action: "complete", note: "Assigned technician reports the lamp replaced." });
        expect(await world.facilities.act(f.user, f.schoolId, assigned.id,
          { command_id: randomUUID(), expected_revision: 3, action: "verify" })).toMatchObject({ state: "closed" });
        const commands = await world.database.selectFrom("campus_model_commands").select(["state", "environment_namespace_id"])
          .where("school_id", "=", f.schoolId).where("source_domain", "=", "facilities").where("correlation_id", "=", repairId).execute();
        expect(commands.every(command => command.state === "accepted")).toBe(true);
        expect(commands.some(command => command.environment_namespace_id === world.namespace)).toBe(true);
        const refresh = await world.database.selectFrom("event_outbox").select("payload")
          .where("school_id", "=", f.schoolId).where("event_type", "=", "facilities.updated").execute();
        expect(JSON.stringify(refresh)).not.toMatch(/Fictional room|window leak|seal ordered|scenario-leak|PRIVATE/u);
        expect((await world.resources.list(1, 10)).counts.artifacts).toBe(1);
        const clockRepair = await world.facilities.report(f.user, f.schoolId, { command_id: randomUUID(), expected_revision: 0,
          problem: "Fictional repair awaiting a dated technician", location_note: "Fictional clock-check room" });
        clockRepairId = clockRepair.id;
        const endpoint = await world.database.transaction().execute(tx => world.core.resolveAccountEndpoint(tx, {
          school_id: f.schoolId, user_id: f.borrower.id, at: f.now,
        }));
        if (!endpoint.acting) throw new Error("The captured technician needs a current exact endpoint.");
        const endpointRow = await world.database.selectFrom("campus_model_agent_endpoints").select("revision")
          .where("id", "=", endpoint.endpoint_id).executeTakeFirstOrThrow();
        await world.database.transaction().execute(tx => world.core.closeAccountEndpoint(tx, {
          school_id: f.schoolId, endpoint_id: endpoint.endpoint_id, actor_user_id: f.user.id,
          expected_revision: endpointRow.revision, effective_at: new Date(Date.parse(f.now) + 86_400_000).toISOString(),
          disposition: "ended", reason: "Fictional technician access ends tomorrow in this world only.",
          source_domain: "facilities_test", source_record_id: clockRepair.id, source_revision: 1,
          idempotency_key: `facilities-clock-end:${clockRepair.id}`,
        }));
        expect((await sql<{ available: boolean }>`SELECT facilities_repair_next_owner_available(${f.schoolId}::uuid,${clockRepair.id}::uuid) AS available`
          .execute(world.database)).rows[0]!.available).toBe(true);
      });
      await world.runAt(new Date(Date.parse(f.now) + 2 * 86_400_000).toISOString(), async () => {
        expect((await sql<{ available: boolean; instant: Date }>`SELECT facilities_repair_next_owner_available(${f.schoolId}::uuid,${clockRepairId}::uuid) AS available,now() AS instant`
          .execute(world.database)).rows[0]).toEqual({ available: false, instant: new Date(Date.parse(f.now) + 2 * 86_400_000) });
        expect((await world.facilities.work(f.user, f.schoolId)).needs_me.find(item => item.repair_id === clockRepairId))
          .toMatchObject({ action: "recover", state: "needs_reassignment" });
      });
      const unchanged = async (service: ReturnType<typeof facilitiesServices>["facilities"]) => {
        expect(await service.detail(f.borrower, f.schoolId, repairId)).toMatchObject({ state: "reported", revision: 2 });
        expect((await service.detail(f.borrower, f.schoolId, repairId)).latest_progress).toBeNull();
        expect((await service.detail(f.borrower, f.schoolId, repairId)).photos.map(photo => photo.id)).toEqual([livePhotoId]);
        await expect(service.photo(f.borrower, f.schoolId, repairId, branchPhotoId)).rejects.toThrow("unavailable");
      };
      await f.run(() => unchanged(f.facilities));
      await sibling.run(() => unchanged(sibling.facilities));
      expect(await f.run(() => f.facilities.settings(f.user, f.schoolId))).toMatchObject({ revision: 1, handler_person_id: f.custodianPersonId });
      expect(await f.run(() => f.facilities.photo(f.borrower, f.schoolId, repairId, livePhotoId)).then(file => content(file.stream))).toEqual(liveBytes);
      expect((await sibling.resources.list(1, 10)).counts.artifacts).toBe(0);
      for (const stable of [
        await f.run(() => db.transaction().execute(tx => f.core.resolveAccountEndpoint(tx, {
          school_id: f.schoolId, user_id: f.borrower.id, at: new Date(Date.parse(f.now) + 2 * 86_400_000).toISOString(),
        }))),
        await sibling.run(() => sibling.database.transaction().execute(tx => sibling.core.resolveAccountEndpoint(tx, {
          school_id: f.schoolId, user_id: f.borrower.id, at: new Date(Date.parse(f.now) + 2 * 86_400_000).toISOString(),
        }))),
      ]) expect(stable.acting).toBe(true);
      expect(await db.selectFrom("facilities_repair_receipts").select("revision").where("repair_id", "=", repairId).execute()).toHaveLength(2);
    } finally {
      for (const namespace of namespaces) unbindSimulationResources(namespace);
      await Promise.all(opened.map(database => database.destroy()));
      await store.pool.end();
    }
  }, 120_000);
});
