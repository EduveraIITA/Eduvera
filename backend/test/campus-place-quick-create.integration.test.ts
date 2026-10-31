import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuditService } from "../src/common/audit.service.js";
import type { AuthenticatedRequest, AuthUser } from "../src/common/request.js";
import { DatabaseService } from "../src/database/database.service.js";
import { ExecutionDataPlaneRegistry, ExecutionDataPlaneScope } from "../src/database/execution-data-plane.js";
import { SimulationWorldService, simulationRequestEnvironment } from "../src/database/simulation-world.service.js";
import { CampusModelCoreService } from "../src/campus-model-core/campus-model-core.service.js";
import { acceptedChangeProjectionHash } from "../src/campus-model-core/accepted-change-command.binding.js";
import { createLiveExecutionEnvironment } from "../src/campus-model-core/execution-environment.runtime.js";
import type { AcceptedCampusModelChange } from "../src/campus-model-core/contracts.js";
import { InstitutionSetupService } from "../src/institution-setup/institution-setup.service.js";
import { ProgressiveWorkspaceProvisioner } from "../src/institution-onboarding/progressive-workspace.provisioner.js";
import { ActivityPlanningService } from "../src/schedule-planning/activity-planning.service.js";
import { ResponsibilityProjectionService } from "../src/campus-model-core/responsibility-projection.service.js";
import { SchoolEventService } from "../src/school/school-event.service.js";
import type { PersistedSimulationRun } from "../src/simulation/simulation.contracts.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.PLACE_DATABASE_TEST_ISOLATED === "true";
const sourceUrl = enabled ? requireIsolatedTestDatabaseUrl(process.env.PLACE_TEST_SOURCE_DATABASE_URL) : "postgresql://invalid.invalid/place_source_test";
const targetUrl = enabled ? requireIsolatedTestDatabaseUrl(process.env.PLACE_TEST_TARGET_DATABASE_URL) : "postgresql://invalid.invalid/place_world_test";
const request = (user: AuthUser) => ({ authUser: user, requestId: randomUUID(), ip: "127.0.0.1" }) as AuthenticatedRequest;
const createBody = (name = "Workshop room") => ({ name, code: `PLACE-${randomUUID().slice(0, 8).toUpperCase()}`,
  kind: "other", create_campus_if_missing: true, idempotency_key: randomUUID() });

describe.skipIf(!enabled)("canonical place creation for progressive attendance", () => {
  let db: DatabaseService;
  let core: CampusModelCoreService;
  let setup: InstitutionSetupService;
  let planning: ActivityPlanningService;
  let world: SimulationWorldService;
  const scope = new ExecutionDataPlaneScope();
  const registry = new ExecutionDataPlaneRegistry();
  const source = new Pool({ connectionString: sourceUrl, max: 2 });
  const worlds = new Pool({ connectionString: targetUrl, max: 2 });

  beforeAll(() => {
    if (new URL(sourceUrl).pathname === new URL(targetUrl).pathname) throw new Error("Place isolation requires separate Live and Simulation databases.");
    process.env.DATABASE_URL = sourceUrl;
    process.env.CAMPUS_SIMULATION_DATABASE_URL = targetUrl;
    db = new DatabaseService(scope, registry);
    core = new CampusModelCoreService(db, scope);
    setup = new InstitutionSetupService(db, new AuditService(db), core, core, core, core);
    planning = new ActivityPlanningService(db, new SchoolEventService(db, core), core, core, core, new ResponsibilityProjectionService(core));
    world = new SimulationWorldService(registry, scope);
  });
  afterAll(async () => {
    await world?.onApplicationShutdown();
    await registry.discardAll();
    await db?.destroy();
    await Promise.all([source.end(), worlds.end()]);
  });

  async function fixture() {
    const suffix = randomUUID();
    const account = await db.insertInto("users").values({ username: `place-${suffix}`, email: `place-${suffix}@example.test`,
      password_hash: "isolated-test-only-hash", first_name: "Place", last_name: "Owner", role: "admin" })
      .returning(["id", "username", "email", "first_name", "last_name", "role", "is_active"]).executeTakeFirstOrThrow();
    const schoolId = await db.transaction().execute(tx => new ProgressiveWorkspaceProvisioner(core).createForAccount(tx, account, "Asia/Kolkata"));
    const user: AuthUser = { ...account, active_school_id: schoolId };
    const actor = await db.transaction().execute(tx => core.resolveAccountEndpoint(tx, { school_id: schoolId, user_id: user.id, at: new Date().toISOString() }));
    if (!actor.acting) throw new Error("The isolated founder must have an acting canonical person.");
    return { schoolId, user, personId: actor.person_id };
  }

  it.each([
    ["Asia/Kolkata", "2037-06-15T18:30:00.000Z"],
    ["America/Los_Angeles", "2037-06-16T07:00:00.000Z"],
    ["America/New_York", "2027-03-14T05:00:00.000Z"],
  ])("projects and selects campus placements at local midnight in %s", async (timezone, boundary) => {
    const { schoolId, user } = await fixture();
    const campus = await setup.createCampus(user, schoolId, { name: "Timezone campus", code: "LOCAL", campus_type: "main", is_primary: true, timezone }, request(user));
    const day = timezone === "America/New_York" ? "2027-03-14" : "2037-06-16";
    const section = await db.insertInto("class_sections").values({ school_id: schoolId, academic_year: "2037-38", grade: "Local", section: "A" }).returning("id").executeTakeFirstOrThrow();
    let now = new Date(Date.parse(boundary) - 1);
    const environment = createLiveExecutionEnvironment({ institution_id: schoolId, clock: { now: () => new Date(now), nowIso: () => now.toISOString() } });
    await scope.run(environment, async () => {
      const saved = await setup.placeClass(user, schoolId, section.id, { campus_id: campus.id, effective_from: day, expected_current_revision: null }, request(user));
      const relation = await db.selectFrom("campus_model_relationships").select("effective_from")
        .where("school_id", "=", schoolId).where("source_record_id", "=", saved.id).where("relation_type", "=", "located_in").executeTakeFirstOrThrow();
      expect(relation.effective_from.toISOString()).toBe(boundary);
      expect((await setup.workspace(user, schoolId)).classes.find((row: { id: string }) => row.id === section.id)).toMatchObject({ placement_id: null });
      now = new Date(boundary);
      expect((await setup.workspace(user, schoolId)).classes.find((row: { id: string }) => row.id === section.id)).toMatchObject({ placement_id: saved.id });
    });
  });

  it("starts participant attendance with unspecified location without inventing a campus or place", async () => {
    const { schoolId, user, personId } = await fixture();
    expect((await setup.workspace(user, schoolId)).campuses).toEqual([]);
    const person = await db.insertInto("school_people").values({ school_id: schoolId, first_name: "No account attendee", last_name: "" }).returning("id").executeTakeFirstOrThrow();
    const day = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const plan = await planning.create(request(user), schoolId, { idempotency_key: randomUUID(), title: "Daily participation", purpose: "duty", timezone: "Asia/Kolkata",
      starts_on: day, recurrence: "once", starts_at: "10:00", ends_at: "11:00", person_ids: [person.id], attendance_mode: "roll_call",
      recorder_person_id: personId, reviewer_person_id: personId, space_id: null, location_kind: "unspecified", location_label: "", location_url: "" });
    await planning.publish(request(user), schoolId, plan.id, { idempotency_key: randomUUID(), expected_revision: 1 });
    expect((await planning.listOccurrences(user, schoolId, { from: day, until: day })).items).toEqual([
      expect.objectContaining({ location_kind: "unspecified", space_id: null, participants: [expect.objectContaining({ person_id: person.id })] }),
    ]);
    expect((await sql<{ campuses: number; places: number; physical_contexts: number }>`SELECT
      (SELECT count(*)::int FROM institution_campuses WHERE school_id=${schoolId}::uuid) AS campuses,
      (SELECT count(*)::int FROM campus_spaces WHERE school_id=${schoolId}::uuid) AS places,
      (SELECT count(*)::int FROM campus_model_schedule_occurrences WHERE school_id=${schoolId}::uuid AND context_entity_id IS NOT NULL) AS physical_contexts`.execute(db)).rows[0])
      .toEqual({ campuses: 0, places: 0, physical_contexts: 0 });
    await expect(planning.create(request(user), schoolId, { idempotency_key: randomUUID(), title: "Invalid reservation", purpose: "other", timezone: "Asia/Kolkata",
      starts_on: day, recurrence: "once", starts_at: "12:00", ends_at: "13:00", person_ids: [], attendance_mode: "none", location_kind: "unspecified" })).rejects.toThrow();
  });

  it("creates first canonical campus and place atomically, replays exact retries and retains one accepted trace", async () => {
    const { schoolId, user } = await fixture();
    const input = createBody();
    const [place, retry] = await Promise.all([setup.createSpace(user, schoolId, input, request(user)), setup.createSpace(user, schoolId, input, request(user))]);
    expect(retry).toEqual(place);
    expect(place).toMatchObject({ school_id: schoolId, name: input.name, code: input.code, kind: "other", revision: 1, status: "active" });
    const campus = await db.selectFrom("institution_campuses").selectAll().where("school_id", "=", schoolId).executeTakeFirstOrThrow();
    expect(campus).toMatchObject({ id: place.campus_id, is_primary: true, code: "MAIN", name: "Your campus" });
    expect(await planning.catalogue(user, schoolId)).toMatchObject({ can_create_places: true,
      campuses: [expect.objectContaining({ id: campus.id, label: "Your campus", is_primary: true })],
      spaces: [expect.objectContaining({ id: place.id, label: input.name })] });
    const counts = (await sql<{ commands: number; pending: number; audits: number; outcomes: number; events: number; relationships: number }>`SELECT
      (SELECT count(*)::int FROM campus_model_commands WHERE school_id=${schoolId}::uuid AND command_type='space.created') AS commands,
      (SELECT count(*)::int FROM campus_model_commands WHERE school_id=${schoolId}::uuid AND state='pending') AS pending,
      (SELECT count(*)::int FROM institution_setup_audits WHERE school_id=${schoolId}::uuid AND action='space.created') AS audits,
      (SELECT count(*)::int FROM campus_model_command_outcomes outcome JOIN campus_model_commands command ON command.id=outcome.command_id
        WHERE command.school_id=${schoolId}::uuid AND command.command_type='space.created' AND outcome.status='accepted') AS outcomes,
      (SELECT count(*)::int FROM event_outbox WHERE school_id=${schoolId}::uuid AND event_type='institution.setup.updated') AS events,
      (SELECT count(*)::int FROM campus_model_relationships WHERE school_id=${schoolId}::uuid AND relation_type='part_of') AS relationships`.execute(db)).rows[0];
    expect(counts).toEqual({ commands: 1, pending: 0, audits: 1, outcomes: 1, events: 1, relationships: 2 });
    await expect(setup.createSpace(user, schoolId, { ...input, name: "Changed retry" }, request(user))).rejects.toThrow("different details");
    await expect(setup.createSpace(user, schoolId, { ...input, idempotency_key: randomUUID() }, request(user))).rejects.toThrow("already exists");
    expect((await setup.workspace(user, schoolId)).spaces).toHaveLength(1);
    await db.updateTable("school_memberships").set({ is_active: false }).where("school_id", "=", schoolId).where("user_id", "=", user.id).execute();
    await expect(setup.createSpace(user, schoolId, input, request(user))).rejects.toThrow("administrator");
    await db.updateTable("school_memberships").set({ is_active: true }).where("school_id", "=", schoolId).where("user_id", "=", user.id).execute();
    await db.updateTable("users").set({ is_active: false }).where("id", "=", user.id).execute();
    await expect(setup.createSpace(user, schoolId, input, request(user))).rejects.toThrow("active campus person");
  });

  it("requires real administrator authority and explicit tenant/campus context, preserving revision checks", async () => {
    const { schoolId, user } = await fixture();
    const first = await setup.createSpace(user, schoolId, createBody(), request(user));
    const secondCampus = await setup.createCampus(user, schoolId, { name: "Second campus", code: "SECOND", campus_type: "branch" }, request(user));
    await expect(setup.createSpace(user, schoolId, createBody(), request(user))).rejects.toThrow("which campus");
    const second = await setup.createSpace(user, schoolId, { ...createBody("Second workshop"), campus_id: secondCampus.id }, request(user));
    expect(second.campus_id).toBe(secondCampus.id);
    const inactive = await setup.createCampus(user, schoolId, { name: "Closed campus", code: "CLOSED", campus_type: "branch", status: "inactive" }, request(user));
    await expect(setup.createSpace(user, schoolId, { ...createBody(), campus_id: inactive.id }, request(user))).rejects.toThrow("active campus");
    await expect(setup.createSpace(user, schoolId, { ...createBody(), idempotency_key: undefined }, request(user))).rejects.toThrow();
    const foreign = await fixture();
    const foreignPlace = await setup.createSpace(foreign.user, foreign.schoolId, createBody(), request(foreign.user));
    await expect(setup.createSpace(user, schoolId, { ...createBody(), campus_id: foreignPlace.campus_id }, request(user))).rejects.toThrow("not found in this institution");
    await expect(setup.createSpace(user, schoolId, { ...createBody(), campus_id: first.campus_id, parent_space_id: foreignPlace.id }, request(user))).rejects.toThrow("selected campus");
    await expect(setup.updateSpace(user, schoolId, String(first.id), { campus_id: first.campus_id, name: "Changed", code: first.code, kind: "other", expected_revision: 9 }, request(user))).rejects.toThrow("changed");
    await db.updateTable("school_memberships").set({ role: "staff" }).where("school_id", "=", schoolId).where("user_id", "=", user.id).execute();
    await expect(setup.createSpace(user, schoolId, { ...createBody(), campus_id: first.campus_id }, request(user))).rejects.toThrow("administrator");
  });

  it("rolls back the new campus, place, audit and pending command when connected projection fails", async () => {
    const { schoolId, user } = await fixture();
    const refusingProjection = new InstitutionSetupService(db, new AuditService(db), { ...core,
      recentActivity: (...args) => core.recentActivity(...args), operationalSignals: (...args) => core.operationalSignals(...args),
      recordAcceptedChange: () => Promise.reject(new Error("isolated projection refusal")),
    }, core, core, core);
    await expect(refusingProjection.createSpace(user, schoolId, createBody(), request(user))).rejects.toThrow("isolated projection refusal");
    expect((await sql<{ campuses: number; places: number; audits: number; commands: number; events: number }>`SELECT
      (SELECT count(*)::int FROM institution_campuses WHERE school_id=${schoolId}::uuid) AS campuses,
      (SELECT count(*)::int FROM campus_spaces WHERE school_id=${schoolId}::uuid) AS places,
      (SELECT count(*)::int FROM institution_setup_audits WHERE school_id=${schoolId}::uuid) AS audits,
      (SELECT count(*)::int FROM campus_model_commands WHERE school_id=${schoolId}::uuid AND command_type='space.created') AS commands,
      (SELECT count(*)::int FROM event_outbox WHERE school_id=${schoolId}::uuid) AS events`.execute(db)).rows[0])
      .toEqual({ campuses: 0, places: 0, audits: 0, commands: 0, events: 0 });
  });

  async function preparedProjection(user: AuthUser, schoolId: string, validUntil: string | null = null) {
    const id = randomUUID(); const eventId = randomUUID();
    const projection: AcceptedCampusModelChange = { school_id: schoolId, actor_user_id: user.id, command_type: "space.created",
      target: { domain: "campus_topology", domain_id: id }, idempotency_key: `prepared-place:${randomUUID()}`, correlation_id: randomUUID(), causation_id: null,
      expected_revision: 0, authority_evidence: ["active_institution_administrator"], operating_rule_version_ref: null,
      source_domain: "campus_topology", safe_context: { explicit_place: true },
      entities: [{ domain: "campus_topology", domain_id: id, kind: "space", label: "Bound topology", lifecycle_state: "active", source_revision: 1, metadata: {} }], relationships: [],
      outcome: { code: "space_created", explanation: "The explicit canonical place was created.", resulting_revision: 1, metadata: {} }, domain_event_id: eventId };
    const prepared = await db.transaction().execute(tx => core.prepareDomainCommand(tx, { school_id: schoolId, actor_user_id: user.id, command_type: projection.command_type,
      handler_key: "campus_topology.space.create", handler_version: 1, source_domain: projection.source_domain, target: projection.entities[0]!, current_revision: 0, expected_revision: 0,
      capability: "campus_topology:manage", purpose: "create_canonical_campus_place", requested_at: new Date().toISOString(), correlation_id: projection.correlation_id,
      causation_id: null, idempotency_key: projection.idempotency_key, operating_rule_version_ref: null, configuration_refs: [], authority_attestation: {
        evaluator_domain: "campus_topology", decision: "allowed", reason_codes: ["active_institution_administrator"], authority_source_refs: [{ school_id: schoolId }], operating_rule_refs: [], valid_until: validUntil },
      safe_context: { accepted_change_hash: acceptedChangeProjectionHash(projection) } }));
    if (prepared.status !== "ready") throw new Error("A fresh prepared projection is required.");
    return { ...projection, prepared_command_id: prepared.command_id, prepared_request_hash: prepared.request_hash };
  }

  it("binds prepared change acceptance to exact payload, actor, tenant, target, type, request, authority and state", async () => {
    const { schoolId, user } = await fixture();
    const projection = await preparedProjection(user, schoolId);
    const reject = (value: AcceptedCampusModelChange) => expect(db.transaction().execute(tx => core.recordAcceptedChange(tx, value))).rejects.toThrow("prepared campus change");
    await reject({ ...projection, prepared_request_hash: "0".repeat(64) });
    await reject({ ...projection, command_type: "space.updated" });
    await reject({ ...projection, source_domain: "another_domain" });
    await reject({ ...projection, correlation_id: randomUUID() });
    await reject({ ...projection, expected_revision: 1 });
    await reject({ ...projection, entities: [{ ...projection.entities[0]!, kind: "campus" }] });
    await reject({ ...projection, entities: [{ ...projection.entities[0]!, label: "Different payload" }] });
    const anotherId = randomUUID();
    await reject({ ...projection, target: { ...projection.target, domain_id: anotherId }, entities: [{ ...projection.entities[0]!, domain_id: anotherId }] });
    const another = await fixture();
    await expect(db.transaction().execute(tx => core.recordAcceptedChange(tx, { ...projection, school_id: another.schoolId, actor_user_id: another.user.id }))).rejects.toThrow();
    const otherPerson = await db.insertInto("school_people").values({ school_id: schoolId, first_name: "Another operator" }).returning("id").executeTakeFirstOrThrow();
    await db.insertInto("school_memberships").values({ school_id: schoolId, user_id: another.user.id, role: "admin" }).execute();
    const profile = await db.insertInto("staff_profiles").values({ school_id: schoolId, person_id: otherPerson.id, user_id: another.user.id,
      staff_code: `OP-${randomUUID().slice(0, 8)}`,   
      staff_kind: "non_teaching", designation: "Campus operator", employment_type: "unspecified", status: "active" }).returning("id").executeTakeFirstOrThrow();
    await db.transaction().execute(tx => core.linkAccountEndpoint(tx, { school_id: schoolId, person_id: otherPerson.id, user_id: another.user.id,
      actor_user_id: user.id, effective_from: new Date().toISOString(), effective_until: null, source_domain: "staff_operations", source_record_id: profile.id, source_revision: 1, metadata: {} }));
    await reject({ ...projection, actor_user_id: another.user.id });
    await reject({ ...projection, authority_receipt_id: randomUUID() });
    await db.transaction().execute(tx => core.completeDomainCommand(tx, { school_id: schoolId, command_id: projection.prepared_command_id,
      terminal_state: "rejected", code: "place_refused", explanation: "The owning domain refused this command.", resulting_revision: null,
      domain_event_id: null, metadata: {}, completed_at: new Date().toISOString() }));
    await reject(projection);
    const expiring = await preparedProjection(user, schoolId, new Date(Date.now() + 60_000).toISOString());
    const afterExpiry = new Date(Date.now() + 120_000);
    await scope.run(createLiveExecutionEnvironment({ institution_id: schoolId, clock: { now: () => afterExpiry, nowIso: () => afterExpiry.toISOString() } }), () => reject(expiring));
    const accepted = await preparedProjection(user, schoolId);
    const receipt = await db.transaction().execute(async tx => {
      await tx.insertInto("event_outbox").values({ id: accepted.domain_event_id!, school_id: schoolId, event_type: "institution.setup.updated", aggregate_type: "campus_space",
        aggregate_id: accepted.target.domain_id, audience_user_ids: [user.id], payload: {}, idempotency_key: accepted.idempotency_key }).execute();
      return core.recordAcceptedChange(tx, accepted);
    });
    expect(await db.transaction().execute(tx => core.recordAcceptedChange(tx, accepted))).toEqual(receipt);
    await reject({ ...accepted, outcome: { ...accepted.outcome, explanation: "A changed outcome must not replace retained history." } });
    expect((await sql<{ count: number }>`SELECT count(*)::int AS count FROM campus_model_command_outcomes WHERE command_id=${accepted.prepared_command_id}::uuid`.execute(db)).rows[0]!.count).toBe(1);
  });

  it("uses the same canonical command inside the selected Simulation while Live and a sibling keep their captured places", async () => {
    const { schoolId, user } = await fixture();
    const livePlace = await setup.createSpace(user, schoolId, createBody("Live existing room"), request(user));
    const livePrepared = await preparedProjection(user, schoolId);
    const capturedAt = new Date().toISOString(); const scenarioId = randomUUID(); const runId = randomUUID(); const siblingId = randomUUID();
    const address = (id: string) => ({ institution_id: schoolId, school_id: schoolId, scenario_id: scenarioId, run_id: id, namespace_id: `scenario:${scenarioId}:run:${id}` as const });
    const captured = await world.capture({ ...address(runId), actor_id: user.id, kind: "scenario", deterministic_seed: "place-isolation", requested_at: capturedAt });
    const run = { id: runId, school_id: schoolId, scenario_id: scenarioId, namespace_id: address(runId).namespace_id,
      virtual_now: capturedAt, source_snapshot_at: capturedAt, source_snapshot_ref: captured.source_snapshot.ref,
      source_snapshot_hash: captured.source_snapshot.hash, source_revisions: captured.source_snapshot.source_revisions } as PersistedSimulationRun;
    const sibling = await world.fork({ ...address(siblingId), actor_id: user.id, kind: "scenario", deterministic_seed: "place-isolation-sibling", source_run: run, requested_at: capturedAt });
    const environment = simulationRequestEnvironment({ ...address(runId), virtual_now: capturedAt, source_snapshot_ref: captured.source_snapshot.ref,
      manifest_ref: captured.manifest_ref, checked_at: captured.manifest_checked_at });
    const siblingEnvironment = simulationRequestEnvironment({ ...address(siblingId), virtual_now: capturedAt, source_snapshot_ref: sibling.source_snapshot.ref,
      manifest_ref: sibling.manifest_ref, checked_at: sibling.manifest_checked_at });
    const input = { ...createBody("Scenario-only workshop"), campus_id: String(livePlace.campus_id) };
    const isolated = await scope.run(environment, async () => {
      await expect(db.transaction().execute(tx => core.recordAcceptedChange(tx, livePrepared))).rejects.toThrow("prepared campus change");
      const place = await setup.createSpace(user, schoolId, input, request(user));
      expect(await setup.createSpace(user, schoolId, input, request(user))).toEqual(place);
      const catalogue = await planning.catalogue(user, schoolId);
      expect(catalogue.spaces.map(row => row.id)).toEqual(expect.arrayContaining([livePlace.id, place.id]));
      return place;
    });
    expect((await setup.workspace(user, schoolId)).spaces.map(row => row.id)).toEqual([livePlace.id]);
    expect((await scope.run(siblingEnvironment, () => setup.workspace(user, schoolId))).spaces.map(row => row.id)).toEqual([livePlace.id]);
    expect((await source.query("SELECT 1 FROM campus_spaces WHERE id=$1", [isolated.id])).rowCount).toBe(0);
    const isolatedTrace = await scope.run(environment, () => sql<{ count: number; namespace: string }>`SELECT count(*)::int AS count,min(environment_namespace_id) AS namespace
      FROM campus_model_commands WHERE school_id=${schoolId}::uuid AND idempotency_key=${`campus-place:${user.id}:${input.idempotency_key}`}`.execute(db));
    expect(isolatedTrace.rows[0]).toEqual({ count: 1, namespace: environment.namespace_id });
  }, 120_000);

  it("creates a first physical context only in an explicitly edited empty Simulation", async () => {
    const { schoolId, user } = await fixture();
    const capturedAt = new Date().toISOString(); const scenarioId = randomUUID(); const runId = randomUUID();
    const namespaceId = `scenario:${scenarioId}:run:${runId}` as const;
    const captured = await world.capture({ institution_id: schoolId, scenario_id: scenarioId, run_id: runId, namespace_id: namespaceId,
      actor_id: user.id, kind: "scenario", deterministic_seed: "empty-place-isolation", requested_at: capturedAt });
    const environment = simulationRequestEnvironment({ institution_id: schoolId, scenario_id: scenarioId, run_id: runId, virtual_now: capturedAt,
      source_snapshot_ref: captured.source_snapshot.ref, manifest_ref: captured.manifest_ref, checked_at: captured.manifest_checked_at });
    await scope.run(environment, async () => {
      const place = await setup.createSpace(user, schoolId, createBody("First scenario room"), request(user));
      expect(place.name).toBe("First scenario room");
      expect((await setup.workspace(user, schoolId)).campuses).toEqual([expect.objectContaining({ id: place.campus_id, is_primary: true })]);
    });
    const live = await setup.workspace(user, schoolId);
    expect(live.campuses).toEqual([]);
    expect(live.spaces).toEqual([]);
  }, 120_000);
});
