import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../src/database/database.service.js";
import {
  DEFAULT_SIMULATION_RESOURCE_POLICY,
  SimulationCapacityException,
  type SimulationResourcePolicy,
} from "../src/simulation/simulation-resource-policy.js";
import { SimulationRepository } from "../src/simulation/simulation.repository.js";
import { SimulationControlBoundary, simulationControlGateKey } from "../src/simulation/simulation-control-boundary.js";
import type { PersistedSimulationRun, SimulationAdvanceLease } from "../src/simulation/simulation.contracts.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.SIMULATION_LIFECYCLE_DATABASE_TEST_ISOLATED === "true";
const databaseUrl = enabled
  ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL)
  : "postgresql://invalid.invalid/simulation_lifecycle_test";

interface FixtureIdentity {
  schoolId: string;
  userId: string;
}

function policy(overrides: Partial<SimulationResourcePolicy> = {}): SimulationResourcePolicy {
  return { ...DEFAULT_SIMULATION_RESOURCE_POLICY, ...overrides };
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

describe.runIf(enabled)("Simulation lifecycle coordination against PostgreSQL", () => {
  const control = new Pool({ connectionString: databaseUrl, max: 4 });
  const fixtureSchools: string[] = [];
  const fixtureUsers: string[] = [];
  let databaseA: DatabaseService;
  let databaseB: DatabaseService;
  let repositoryA: SimulationRepository;
  let repositoryB: SimulationRepository;
  const controlRepositories: SimulationRepository[] = [];

  beforeAll(async () => {
    const migrated = await control.query<{ present: string | null }>(
      "SELECT to_regclass('public.simulation_institution_resource_states')::text AS present",
    );
    if (!migrated.rows[0]?.present) {
      throw new Error("Migration 151 must be applied to the isolated lifecycle test database.");
    }
    const immutableReceipts = await control.query<{ present: string | null }>(
      "SELECT to_regprocedure('reject_simulation_gc_receipt_change()')::text AS present",
    );
    if (!immutableReceipts.rows[0]?.present) {
      throw new Error("Migration 152 must be applied to the isolated lifecycle test database.");
    }
    // Append-only receipts intentionally prevent deleting prior fixture runs.
    // Neutralize only this suite's named leftovers so global worker claims stay
    // deterministic when the dedicated database is reused.
    await control.query(`UPDATE simulation_runs run SET
        next_wake_at=CASE WHEN run.status='running' THEN '2999-01-01T00:00:00Z' ELSE run.next_wake_at END,
        lease_owner=CASE WHEN run.status='running' THEN NULL ELSE run.lease_owner END,
        lease_token=CASE WHEN run.status='running' THEN NULL ELSE run.lease_token END,
        lease_until=CASE WHEN run.status='running' THEN NULL ELSE run.lease_until END,
        created_at=CASE WHEN run.status='preparing' THEN clock_timestamp() ELSE run.created_at END,
        retention_expires_at=CASE WHEN run.status IN ('stopped','completed','failed')
          AND run.world_discarded_at IS NULL THEN '2999-01-01T00:00:00Z' ELSE run.retention_expires_at END,
        gc_state=CASE WHEN run.status IN ('stopped','completed','failed')
          AND run.world_discarded_at IS NULL THEN 'retained' ELSE run.gc_state END,
        gc_lease_owner=NULL,gc_lease_token=NULL,gc_lease_until=NULL
      FROM schools school WHERE school.id=run.school_id
        AND school.name LIKE 'Simulation lifecycle %'`);
    databaseA = new DatabaseService();
    databaseB = new DatabaseService();
    repositoryA = new SimulationRepository(databaseA);
    repositoryB = new SimulationRepository(databaseB);
  });

  afterAll(async () => {
    if (fixtureSchools.length) {
      await control.query(
        "DELETE FROM simulation_run_gc_receipts WHERE school_id=ANY($1::uuid[])",
        [fixtureSchools],
      ).catch(() => undefined);
      await control.query("DELETE FROM schools WHERE id=ANY($1::uuid[])", [fixtureSchools])
        .catch(() => undefined);
    }
    if (fixtureUsers.length) {
      await control.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [fixtureUsers])
        .catch(() => undefined);
    }
    await Promise.all([
      ...controlRepositories.map(repository => repository.onApplicationShutdown()),
      databaseA?.destroy(),
      databaseB?.destroy(),
      control.end(),
    ]);
  });

  async function identity(label: string): Promise<FixtureIdentity> {
    const schoolId = randomUUID();
    const userId = randomUUID();
    fixtureSchools.push(schoolId);
    fixtureUsers.push(userId);
    const unique = hash(`${label}:${schoolId}`).slice(0, 16);
    const client = await control.connect();
    try {
      await client.query("BEGIN");
      await client.query(`INSERT INTO users(
          id,username,email,password_hash,first_name,last_name,role,is_active
        ) VALUES($1,$2,$3,'simulation-lifecycle-test','Lifecycle',$4,'admin',true)`,
      [userId, `sim-lifecycle-${unique}`, `sim-lifecycle-${unique}@example.test`, label]);
      await client.query(
        "INSERT INTO schools(id,name,code) VALUES($1,$2,$3)",
        [schoolId, `Simulation lifecycle ${label}`, `SL-${unique}`],
      );
      await client.query(`INSERT INTO school_memberships(user_id,school_id,role,is_active)
        VALUES($1,$2,'admin',true)`, [userId, schoolId]);
      await client.query("COMMIT");
      return { schoolId, userId };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async function draft(
    repository: SimulationRepository,
    owner: FixtureIdentity,
    now: string,
    resourcePolicy = policy(),
  ): Promise<PersistedSimulationRun> {
    const runId = randomUUID();
    const scenarioId = randomUUID();
    const preparing = await repository.createPreparing({
      id: runId,
      scenario_id: scenarioId,
      namespace_id: `scenario:${scenarioId}:run:${runId}`,
      school_id: owner.schoolId,
      created_by_user_id: owner.userId,
      kind: "scenario",
      name: `Lifecycle ${runId.slice(0, 8)}`,
      speed: 20,
      end_at: null,
      deterministic_seed: hash(`seed:${runId}`),
      idempotency_key: `lifecycle:${runId}`,
      request_hash: hash(`request:${runId}`),
      now,
      resource_policy: resourcePolicy,
    });
    return repository.completeCapture({
      run_id: preparing.id,
      owner_id: owner.userId,
      capture: {
        world_ref: `test-world:${runId}`,
        world_revision: 1,
        manifest_ref: `test-manifest:${runId}`,
        manifest_checked_at: now,
        time_zone: "UTC",
        virtual_start_at: now,
        source_snapshot: {
          ref: `test-snapshot:${runId}`,
          hash: hash(`snapshot:${runId}`),
          captured_at: now,
          source_revisions: { fixture: `fixture:${runId}` },
        },
        limitations: [],
      },
      end_at: null,
      observed_storage_bytes: 1024,
      storage_measured_at: now,
      now,
    });
  }

  async function running(
    repository: SimulationRepository,
    owner: FixtureIdentity,
    now: string,
    dueAt: string,
    resourcePolicy = policy(),
  ): Promise<PersistedSimulationRun> {
    const run = await draft(repository, owner, now, resourcePolicy);
    return repository.start({
      run_id: run.id,
      owner_id: owner.userId,
      school_id: owner.schoolId,
      next_wake_at: dueAt,
      now,
      resource_policy: resourcePolicy,
    });
  }

  async function expiredTerminal(
    repository: SimulationRepository,
    owner: FixtureIdentity,
    createdAt: string,
    stoppedAt: string,
    expiresAt: string,
  ): Promise<PersistedSimulationRun> {
    const run = await draft(repository, owner, createdAt);
    // createPreparing intentionally stamps the database clock. Backdate only
    // this isolated fixture so terminal retention is already due for GC tests.
    await control.query(
      "UPDATE simulation_runs SET created_at=$2,updated_at=$2 WHERE id=$1",
      [run.id, createdAt],
    );
    return repository.stop({ run_id: run.id, owner_id: owner.userId, school_id: owner.schoolId,
      now: stoppedAt, retention_expires_at: expiresAt });
  }

  function signal() {
    let done!: () => void;
    const promise = new Promise<void>(resolve => { done = resolve; });
    return { promise, done };
  }

  function controlledRepository(onWait: () => void, timeout = 1000) {
    const boundary = new SimulationControlBoundary(undefined, {
      max_wait_ms: timeout, poll_interval_ms: 5, now: Date.now,
      wait: milliseconds => { onWait(); return new Promise(done => setTimeout(done, milliseconds)); },
    });
    const repository = new SimulationRepository(databaseB, boundary);
    controlRepositories.push(repository);
    return repository;
  }

  async function commitCheckpoint(repository: SimulationRepository, lease: SimulationAdvanceLease) {
    const virtualTo = lease.run.pending_advance?.virtual_to
      ?? new Date(Date.parse(lease.run.virtual_now!) + 300_000).toISOString();
    await repository.retainAdvanceTarget(lease, virtualTo);
    const committedAt = new Date().toISOString();
    return repository.completeAdvance({ lease, checkpoint: {
      virtual_from: lease.run.virtual_now!, virtual_to: virtualTo,
      simulated_elapsed_ms: Date.parse(virtualTo) - Date.parse(lease.run.virtual_started_at!),
      world_checkpoint_ref: `test-control-boundary:${lease.run.id}:${lease.lease_fence}`,
      world_revision: lease.run.world_revision + 1, emitted_event_count: 0,
      lease_fence: lease.lease_fence, lease_token: lease.lease_token, next_event_at: null, metrics: [],
    }, next_wake_at: committedAt, completed: false, observed_storage_bytes: 1024,
    storage_measured_at: committedAt, max_storage_bytes_per_institution: policy().max_storage_bytes_per_institution,
    retention_expires_at: new Date(Date.now() + 86_400_000).toISOString(), now: committedAt });
  }

  it("waits for a healthy in-flight checkpoint and prevents concurrent workers stealing the Pause boundary", async () => {
    const owner = await identity("control-healthy-pause");
    const now = new Date().toISOString();
    const captured = await running(repositoryA, owner, now, now);
    const lease = await repositoryA.claimDue("control-healthy-worker", randomUUID(), now, 60, 1);
    expect(lease?.run.id).toBe(captured.id);
    await repositoryA.retainAdvanceTarget(lease!, new Date(Date.parse(now) + 300_000).toISOString());
    const waiting = signal(), boundaryReady = signal(), continueControl = signal();
    const coordinator = controlledRepository(waiting.done);
    const action = coordinator.withControlBoundary({ run_id: captured.id, owner_id: owner.userId, school_id: owner.schoolId }, async () => {
      boundaryReady.done(); await continueControl.promise;
      return coordinator.pause({ run_id: captured.id, owner_id: owner.userId, school_id: owner.schoolId, now: new Date().toISOString() });
    });
    await waiting.promise;
    expect((await repositoryA.requireOwned(captured.id, owner.userId, owner.schoolId)).lease_token).toBe(lease!.lease_token);
    await commitCheckpoint(repositoryA, lease!);
    await boundaryReady.promise;
    const claims = await Promise.all([
      repositoryA.claimDue("control-other-worker-a", randomUUID(), now, 60, 1),
      repositoryB.claimDue("control-other-worker-b", randomUUID(), now, 60, 1),
    ]);
    expect(claims).toEqual([null, null]);
    const otherOwner = await identity("control-other-institution");
    const otherNow = new Date().toISOString();
    const otherRun = await running(repositoryA, otherOwner, otherNow, otherNow);
    const otherClaim = await repositoryA.claimDue("control-unrelated-worker", randomUUID(), otherNow, 60, 1);
    expect(otherClaim?.run.id).toBe(otherRun.id);
    await commitCheckpoint(repositoryA, otherClaim!);
    await repositoryA.stop({ run_id: otherRun.id, owner_id: otherOwner.userId, school_id: otherOwner.schoolId,
      now: new Date().toISOString(), retention_expires_at: new Date(Date.now() + 86_400_000).toISOString() });
    continueControl.done();
    expect(await action).toMatchObject({ status: "paused", checkpoint_count: 2, pending_advance: null, lease_token: null });
  });

  it("allows exact pending-target recovery through a waiting Stop gate and keeps the recovered fence", async () => {
    const owner = await identity("control-pending-stop");
    const now = new Date().toISOString();
    const captured = await running(repositoryA, owner, now, now);
    const first = await repositoryA.claimDue("control-crashed-worker", randomUUID(), now, 60, 1);
    expect(first?.run.id).toBe(captured.id);
    const target = await repositoryA.retainAdvanceTarget(first!, new Date(Date.parse(now) + 300_000).toISOString());
    await control.query("UPDATE simulation_runs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1", [captured.id]);
    const waiting = signal();
    const coordinator = controlledRepository(waiting.done);
    const action = coordinator.withControlBoundary({ run_id: captured.id, owner_id: owner.userId, school_id: owner.schoolId },
      () => coordinator.stop({ run_id: captured.id, owner_id: owner.userId, school_id: owner.schoolId,
        now: new Date().toISOString(), retention_expires_at: new Date(Date.now() + 86_400_000).toISOString() }));
    await waiting.promise;
    const recovered = await repositoryA.claimDue("control-recovery-worker", randomUUID(), now, 60, 1);
    expect(recovered?.run.id).toBe(captured.id);
    expect(recovered?.lease_fence).toBe(first!.lease_fence + 1);
    expect(recovered?.run.pending_advance).toEqual(target);
    await commitCheckpoint(repositoryA, recovered!);
    expect(await action).toMatchObject({ status: "stopped", checkpoint_count: 2,
      lease_fence: recovered!.lease_fence, lease_token: null, pending_advance: null });
  });

  it("rechecks current authority after waiting and releases the gate when Pause is refused", async () => {
    const owner = await identity("control-revoked-pause");
    const now = new Date().toISOString();
    const captured = await running(repositoryA, owner, now, now);
    const lease = await repositoryA.claimDue("control-revoked-worker", randomUUID(), now, 60, 1);
    expect(lease?.run.id).toBe(captured.id);
    await repositoryA.retainAdvanceTarget(lease!, new Date(Date.parse(now) + 300_000).toISOString());
    const waiting = signal();
    const coordinator = controlledRepository(waiting.done);
    const action = coordinator.withControlBoundary({ run_id: captured.id, owner_id: owner.userId, school_id: owner.schoolId },
      () => coordinator.pause({ run_id: captured.id, owner_id: owner.userId, school_id: owner.schoolId, now: new Date().toISOString() }));
    const refused = expect(action).rejects.toThrow("active institution administrator");
    await waiting.promise;
    await control.query("UPDATE school_memberships SET is_active=false WHERE user_id=$1 AND school_id=$2", [owner.userId, owner.schoolId]);
    const committed = await commitCheckpoint(repositoryA, lease!);
    await refused;
    expect(await repositoryA.requireOwned(captured.id, owner.userId, owner.schoolId)).toEqual(committed);
    expect((await control.query("SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) acquired", [simulationControlGateKey(captured.id)])).rows[0].acquired).toBe(true);
    await control.query("UPDATE school_memberships SET is_active=true WHERE user_id=$1 AND school_id=$2", [owner.userId, owner.schoolId]);
    await repositoryA.stop({ run_id: captured.id, owner_id: owner.userId, school_id: owner.schoolId,
      now, retention_expires_at: new Date(Date.now() + 86_400_000).toISOString() });
  });

  it("times out without altering an in-flight lease/target and releases the gate for later normal Stop", async () => {
    const owner = await identity("control-timeout-stop");
    const now = new Date().toISOString();
    const captured = await running(repositoryA, owner, now, now);
    const lease = await repositoryA.claimDue("control-slow-worker", randomUUID(), now, 60, 1);
    expect(lease?.run.id).toBe(captured.id);
    await repositoryA.retainAdvanceTarget(lease!, new Date(Date.parse(now) + 300_000).toISOString());
    const before = await repositoryA.requireOwned(captured.id, owner.userId, owner.schoolId);
    const coordinator = controlledRepository(() => undefined, 40);
    await expect(coordinator.withControlBoundary({ run_id: captured.id, owner_id: owner.userId, school_id: owner.schoolId },
      () => coordinator.stop({ run_id: captured.id, owner_id: owner.userId, school_id: owner.schoolId,
        now, retention_expires_at: new Date(Date.now() + 86_400_000).toISOString() })))
      .rejects.toMatchObject({ response: { code: "simulation_checkpoint_finishing" } });
    expect(await repositoryA.requireOwned(captured.id, owner.userId, owner.schoolId)).toEqual(before);
    expect((await control.query("SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) acquired", [simulationControlGateKey(captured.id)])).rows[0].acquired).toBe(true);
    await commitCheckpoint(repositoryA, lease!);
    expect(await coordinator.withControlBoundary({ run_id: captured.id, owner_id: owner.userId, school_id: owner.schoolId },
      () => coordinator.stop({ run_id: captured.id, owner_id: owner.userId, school_id: owner.schoolId,
        now: new Date().toISOString(), retention_expires_at: new Date(Date.now() + 86_400_000).toISOString() })))
      .toMatchObject({ status: "stopped", checkpoint_count: 2, lease_token: null, pending_advance: null });
  });

  it("serializes concurrent admission and concurrent start capacity per institution", async () => {
    const owner = await identity("capacity");
    const now = new Date(Date.now() - 60_000).toISOString();
    const oneWorld = policy({ max_worlds_per_institution: 1 });
    const attempts = await Promise.allSettled([
      draft(repositoryA, owner, now, oneWorld),
      draft(repositoryB, owner, now, oneWorld),
    ]);
    expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = attempts.find((result) => result.status === "rejected");
    expect(rejected?.status === "rejected" ? rejected.reason : null)
      .toBeInstanceOf(SimulationCapacityException);

    const startOwner = await identity("concurrent-start");
    const startPolicy = policy({ max_running_runs_per_institution: 1 });
    const first = await draft(repositoryA, startOwner, now, startPolicy);
    const second = await draft(repositoryB, startOwner, now, startPolicy);
    const starts = await Promise.allSettled([
      repositoryA.start({ run_id: first.id, owner_id: startOwner.userId,
        school_id: startOwner.schoolId, next_wake_at: now, now, resource_policy: startPolicy }),
      repositoryB.start({ run_id: second.id, owner_id: startOwner.userId,
        school_id: startOwner.schoolId, next_wake_at: now, now, resource_policy: startPolicy }),
    ]);
    expect(starts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(starts.find((result) => result.status === "rejected")?.status).toBe("rejected");
  });

  it("pages every owned retained world beyond recent history without including another owner's worlds", async () => {
    const owner = await identity("retained-pages");
    const other = await identity("retained-pages-other");
    const now = new Date().toISOString();
    const created = [];
    for (let index = 0; index < 12; index += 1) created.push(await draft(repositoryA, owner, now));
    await draft(repositoryA, other, now);
    const pages = await Promise.all([1, 2, 3].map(page => repositoryA.listRetainedOwned(owner.userId, owner.schoolId, page)));
    expect(pages.map(page => page.runs.length)).toEqual([5, 5, 2]);
    expect(pages[2]!.page).toEqual({ number: 3, page_size: 5, total: 12, total_pages: 3 });
    expect(new Set(pages.flatMap(page => page.runs.map(run => run.id)))).toEqual(new Set(created.map(run => run.id)));
    expect(await repositoryA.listRetainedOwned(other.userId, owner.schoolId, 1)).toMatchObject({ runs: [], page: { total: 0 } });
  });

  it("never stops active work when draft discard races a start", async () => {
    const owner = await identity("draft-discard-start-race");
    const now = new Date().toISOString();
    const captured = await draft(repositoryA, owner, now);
    const guardedStop = {
      run_id: captured.id, owner_id: owner.userId, school_id: owner.schoolId, now,
      retention_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      draft_precondition: { expected_revision: captured.revision, expected_status: "draft" as const },
    };
    const attempts = await Promise.allSettled([
      repositoryA.start({ run_id: captured.id, owner_id: owner.userId, school_id: owner.schoolId,
        next_wake_at: "2999-01-01T00:00:00.000Z", now, resource_policy: policy() }),
      repositoryB.stop(guardedStop),
    ]);
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    const current = await repositoryA.requireOwned(captured.id, owner.userId, owner.schoolId);
    expect(current.revision).toBe(captured.revision + 1);
    expect(current.status).toBe(attempts[0].status === "fulfilled" ? "running" : "stopped");
    await expect(repositoryB.stop(guardedStop)).rejects.toThrow("changed or has started");
    expect(await repositoryA.requireOwned(captured.id, owner.userId, owner.schoolId)).toEqual(current);
  });

  it("refuses changed draft revisions and current authority revocation before conditional stop", async () => {
    const owner = await identity("draft-discard-guards");
    const now = new Date().toISOString();
    const captured = await draft(repositoryA, owner, now);
    const input = { run_id: captured.id, owner_id: owner.userId, school_id: owner.schoolId, now,
      retention_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      draft_precondition: { expected_revision: captured.revision, expected_status: "draft" as const } };
    const edited = await repositoryA.updateDraft({ run_id: captured.id, owner_id: owner.userId,
      name: "A deliberate later edit", now });
    await expect(repositoryB.stop(input)).rejects.toThrow("changed or has started");
    expect(await repositoryA.requireOwned(captured.id, owner.userId, owner.schoolId)).toEqual(edited);
    await control.query("UPDATE school_memberships SET is_active=false WHERE user_id=$1 AND school_id=$2", [owner.userId, owner.schoolId]);
    await expect(repositoryB.stop({ ...input,
      draft_precondition: { expected_revision: edited.revision, expected_status: "draft" } }))
      .rejects.toThrow("active institution administrator");
    expect(await repositoryA.requireOwned(captured.id, owner.userId, owner.schoolId)).toEqual(edited);
    await control.query("UPDATE school_memberships SET is_active=true WHERE user_id=$1 AND school_id=$2", [owner.userId, owner.schoolId]);
    const stopped = await repositoryB.stop({ ...input,
      draft_precondition: { expected_revision: edited.revision, expected_status: "draft" } });
    expect(stopped).toMatchObject({ status: "stopped", revision: edited.revision + 1 });
    const removal = await repositoryB.claimRequestedRemoval({ run_id: captured.id,
      school_id: owner.schoolId, owner_id: owner.userId, expected_revision: stopped.revision,
      lease_token: randomUUID(), lease_seconds: 60 });
    expect(removal.run.gc_state).toBe("deleting");
    expect(removal.lease?.run.id).toBe(captured.id);
    await repositoryB.completeGarbageCollection({ lease: removal.lease!, adapter_receipt_ref: "test-draft-discard:1",
      released_bytes: 1024, retained_shared_snapshot: false, reason: "owner_requested", now });
    expect((await repositoryA.requireOwned(captured.id, owner.userId, owner.schoolId)))
      .toMatchObject({ status: "stopped", gc_state: "deleted", world_discarded_at: now });
    expect((await repositoryA.listRetainedOwned(owner.userId, owner.schoolId, 1)).page.total).toBe(0);
    expect((await repositoryA.listOwned(owner.userId, owner.schoolId, 10))[0]?.id).toBe(captured.id);
  });

  it("requires current ownership, authority, revision, terminal state, no pin and no selected session for explicit removal", async () => {
    const owner = await identity("remove-guards");
    const outsider = await identity("remove-outsider");
    const now = new Date().toISOString();
    const run = await draft(repositoryA, owner, now);
    const claim = (revision: number, userId = owner.userId, schoolId = owner.schoolId) => repositoryA.claimRequestedRemoval({
      run_id: run.id, school_id: schoolId, owner_id: userId, expected_revision: revision,
      lease_token: randomUUID(), lease_seconds: 60,
    });
    await expect(claim(run.revision)).rejects.toThrow("Only an ended");
    const stopped = await repositoryA.stop({ run_id: run.id, owner_id: owner.userId, school_id: owner.schoolId,
      now, retention_expires_at: new Date(Date.now() + 86_400_000).toISOString() });
    await expect(claim(stopped.revision, outsider.userId, outsider.schoolId)).rejects.toThrow("not found");
    await expect(claim(run.revision)).rejects.toThrow("changed");
    await repositoryA.pin({ run_id: run.id, owner_id: owner.userId, school_id: owner.schoolId, now, resource_policy: policy() });
    const pinned = await repositoryA.requireOwned(run.id, owner.userId, owner.schoolId);
    await expect(claim(pinned.revision)).rejects.toThrow("Only an ended");
    const unpinned = await repositoryA.unpin({ run_id: run.id, owner_id: owner.userId, school_id: owner.schoolId,
      now, retention_expires_at: new Date(Date.now() + 86_400_000).toISOString() });
    const tokenHash = hash(randomUUID());
    await control.query(`INSERT INTO auth_sessions(token_hash,user_id,active_school_id,csrf_token,expires_at)
      VALUES($1,$2,$3,$4,clock_timestamp()+interval '1 hour')`, [tokenHash, owner.userId, owner.schoolId, hash("csrf")]);
    await control.query(`INSERT INTO auth_session_execution_environments(token_hash,school_id,scenario_id,run_id,namespace_id,expires_at,bound_by)
      VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '1 hour',$6)`,
    [tokenHash, owner.schoolId, run.scenario_id, run.id, run.namespace_id, owner.userId]);
    await expect(claim(unpinned.revision)).rejects.toThrow("Return every session");
    await control.query("DELETE FROM auth_sessions WHERE token_hash=$1", [tokenHash]);
    await control.query("UPDATE school_memberships SET is_active=false WHERE user_id=$1 AND school_id=$2", [owner.userId, owner.schoolId]);
    await expect(claim(unpinned.revision)).rejects.toThrow("active institution administrator");
    expect((await control.query("SELECT count(*) AS count FROM audit_events WHERE target_id=$1 AND action='simulation.world_removal.requested'", [run.id])).rows[0].count).toBe("0");
    expect((await repositoryA.requireOwned(run.id, owner.userId, owner.schoolId)).gc_state).toBe("retained");
  });

  it("retains one exact removal intent across a failed fenced attempt and returns an accepted replay", async () => {
    const owner = await identity("remove-retry");
    const now = new Date().toISOString();
    const draftRun = await draft(repositoryA, owner, now);
    const stopped = await repositoryA.stop({ run_id: draftRun.id, owner_id: owner.userId, school_id: owner.schoolId,
      now, retention_expires_at: new Date(Date.now() + 86_400_000).toISOString() });
    const input = { run_id: stopped.id, school_id: owner.schoolId, owner_id: owner.userId,
      expected_revision: stopped.revision, lease_token: randomUUID(), lease_seconds: 60 };
    const first = await repositoryA.claimRequestedRemoval(input);
    expect(first.run.gc_state).toBe("deleting");
    expect(first.lease?.lease_fence).toBe(1);
    await expect(repositoryB.claimRequestedRemoval({ ...input, lease_token: randomUUID() })).rejects.toThrow("Only an ended");
    await repositoryA.failGarbageCollection({ lease: first.lease!, reason: "isolated adapter unavailable", reason_code: "owner_requested",
      retry_at: now, now });
    const retry = await repositoryB.claimRequestedRemoval({ ...input, lease_token: randomUUID() });
    expect(retry.lease?.lease_fence).toBe(2);
    expect(retry.lease?.lease_token).not.toBe(first.lease?.lease_token);
    await repositoryB.completeGarbageCollection({ lease: retry.lease!, adapter_receipt_ref: "test-owner-removal:2",
      released_bytes: 1024, retained_shared_snapshot: false, reason: "owner_requested", now });
    const replay = await repositoryA.claimRequestedRemoval({ ...input, lease_token: randomUUID() });
    expect(replay.lease).toBeNull();
    expect(replay.run).toMatchObject({ gc_state: "deleted", resource_reservation_bytes: 0, observed_storage_bytes: 0 });
    expect((await control.query("SELECT actor_id,metadata->>'expected_revision' AS revision FROM audit_events WHERE target_id=$1 AND action='simulation.world_removal.requested'", [stopped.id])).rows)
      .toEqual([{ actor_id: owner.userId, revision: String(stopped.revision) }]);
    expect((await control.query("SELECT outcome,reason FROM simulation_run_gc_receipts WHERE run_id=$1 ORDER BY gc_lease_fence", [stopped.id])).rows)
      .toEqual([{ outcome: "failed", reason: "owner_requested" }, { outcome: "completed", reason: "owner_requested" }]);
    expect((await repositoryA.listRetainedOwned(owner.userId, owner.schoolId, 1)).page.total).toBe(0);
    expect((await repositoryA.listOwned(owner.userId, owner.schoolId, 10))[0]?.id).toBe(stopped.id);
  });

  it("claims fairly across institutions and fences recovery of an expired lease", async () => {
    const ownerA = await identity("worker-a");
    const ownerB = await identity("worker-b");
    const base = Date.now() - 120_000;
    const createdAt = new Date(base).toISOString();
    const claimAt = new Date(base + 60_000).toISOString();
    const runA = await running(repositoryA, ownerA, createdAt, new Date(base + 10_000).toISOString());
    const runB = await running(repositoryA, ownerB, createdAt, new Date(base + 20_000).toISOString());

    const first = await repositoryA.claimDue("lifecycle-worker-a", randomUUID(), claimAt, 60, 1);
    expect(first?.run.id).toBe(runA.id);
    expect(Date.parse(first!.run.updated_at)).toBeGreaterThan(Date.parse(claimAt));
    const second = await repositoryB.claimDue("lifecycle-worker-b", randomUUID(), claimAt, 60, 1);
    expect(second?.run.id).toBe(runB.id);

    await control.query("UPDATE simulation_runs SET lease_until=$2 WHERE id=$1", [
      runA.id,
      new Date(base + 50_000).toISOString(),
    ]);
    const recovered = await repositoryB.claimDue(
      "lifecycle-worker-recovery",
      randomUUID(),
      claimAt,
      60,
      1,
    );
    expect(recovered?.run.id).toBe(runA.id);
    expect(recovered?.lease_fence).toBe(2);
    expect(recovered?.run.lease_recovery_count).toBe(1);
    expect(recovered?.lease_token).not.toBe(first?.lease_token);

    const checkpointsBefore = await control.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM simulation_run_checkpoints WHERE run_id=$1",
      [runA.id],
    );
    await control.query(
      "UPDATE simulation_runs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
      [runA.id],
    );
    const virtualFrom = recovered!.run.virtual_now!;
    const virtualTo = new Date(Date.parse(virtualFrom) + 300_000).toISOString();
    await expect(repositoryB.completeAdvance({
      lease: recovered!,
      checkpoint: {
        virtual_from: virtualFrom,
        virtual_to: virtualTo,
        simulated_elapsed_ms: 300_000,
        world_checkpoint_ref: "expired-lease-checkpoint",
        world_revision: recovered!.run.world_revision + 1,
        emitted_event_count: 0,
        lease_fence: recovered!.lease_fence,
        lease_token: recovered!.lease_token,
        next_event_at: null,
        metrics: [],
      },
      next_wake_at: new Date(Date.now() + 10_000).toISOString(),
      completed: false,
      observed_storage_bytes: 1024,
      storage_measured_at: new Date().toISOString(),
      max_storage_bytes_per_institution: policy().max_storage_bytes_per_institution,
      retention_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      // A caller-controlled future instant must not revive an expired lease.
      now: "2099-01-01T00:00:00.000Z",
    })).rejects.toThrow("lease is unavailable or expired");
    const checkpointsAfter = await control.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM simulation_run_checkpoints WHERE run_id=$1",
      [runA.id],
    );
    expect(checkpointsAfter.rows[0]?.count).toBe(checkpointsBefore.rows[0]?.count);
  });

  it("recovers an expired cleanup lease with a monotonically increasing fence", async () => {
    const owner = await identity("gc-recovery");
    const base = Date.now() - 120_000;
    const run = await expiredTerminal(
      repositoryA,
      owner,
      new Date(base).toISOString(),
      new Date(base + 10_000).toISOString(),
      new Date(base + 20_000).toISOString(),
    );
    const first = await repositoryA.claimGarbageCollection({
      worker_id: "gc-worker-a",
      lease_token: randomUUID(),
      now: new Date(base + 30_000).toISOString(),
      lease_seconds: 60,
    });
    expect(first?.run.id).toBe(run.id);
    await control.query("UPDATE simulation_runs SET gc_lease_until=$2 WHERE id=$1", [
      run.id,
      new Date(base + 25_000).toISOString(),
    ]);
    await expect(repositoryA.deferGarbageCollection({
      lease: first!,
      reason: "expired_lease_must_not_commit",
      retry_at: new Date(Date.now() + 86_400_000).toISOString(),
      now: "2099-01-01T00:00:00.000Z",
    })).rejects.toThrow("cleanup lease is no longer owned");
    const recovered = await repositoryB.claimGarbageCollection({
      worker_id: "gc-worker-b",
      lease_token: randomUUID(),
      now: new Date(base + 40_000).toISOString(),
      lease_seconds: 60,
    });
    expect(recovered?.run.id).toBe(run.id);
    expect(recovered?.lease_fence).toBe(2);
    expect(recovered?.lease_token).not.toBe(first?.lease_token);
    await repositoryB.deferGarbageCollection({
      lease: recovered!,
      reason: "integration_test",
      retry_at: new Date(Date.now() + 86_400_000).toISOString(),
      now: new Date(base + 41_000).toISOString(),
    });
    await expect(control.query(
      "UPDATE simulation_run_gc_receipts SET reason='mutated' WHERE run_id=$1",
      [run.id],
    )).rejects.toThrow("append-only");
    await expect(control.query("TRUNCATE simulation_run_gc_receipts"))
      .rejects.toThrow("append-only");
  });

  it("recovers a crashed stale preparation once and fences a late capture completion", async () => {
    const owner = await identity("stale-preparation");
    const runId = randomUUID();
    const scenarioId = randomUUID();
    const createdAfter = Date.now();
    const preparing = await repositoryA.createPreparing({
      id: runId,
      scenario_id: scenarioId,
      namespace_id: `scenario:${scenarioId}:run:${runId}`,
      school_id: owner.schoolId,
      created_by_user_id: owner.userId,
      kind: "scenario",
      name: "Crashed preparation",
      speed: 20,
      end_at: null,
      deterministic_seed: hash(`seed:${runId}`),
      idempotency_key: `stale-preparation:${runId}`,
      request_hash: hash(`request:${runId}`),
      // Persistence must not trust this caller instant for crash recovery.
      now: "1900-01-01T00:00:00.000Z",
      resource_policy: policy(),
    });
    expect(Date.parse(preparing.created_at)).toBeGreaterThanOrEqual(createdAfter - 1_000);
    await control.query(`UPDATE simulation_runs
      SET created_at='1970-01-01T00:00:00Z',updated_at='1970-01-01T00:00:00Z'
      WHERE id=$1`, [runId]);

    const recovered = await Promise.all([
      repositoryA.failNextStalePreparing(policy()),
      repositoryB.failNextStalePreparing(policy()),
    ]);
    const ownedRecovery = recovered.filter((run) => run?.id === runId);
    expect(ownedRecovery).toHaveLength(1);
    expect(ownedRecovery[0]).toMatchObject({
      status: "failed",
      world_ref: null,
      source_snapshot_ref: null,
      world_discarded_at: null,
    });
    expect(ownedRecovery[0]?.failure_reason).toContain("preparation timed out");
    expect(Math.abs((Date.parse(ownedRecovery[0]!.retention_expires_at!)
      - Date.parse(ownedRecovery[0]!.retention_started_at!))
      - policy().terminal_retention_ms)).toBeLessThan(1_000);

    await expect(repositoryA.completeCapture({
      run_id: runId,
      owner_id: owner.userId,
      capture: {
        world_ref: `test-world:${runId}`,
        world_revision: 1,
        manifest_ref: `test-manifest:${runId}`,
        manifest_checked_at: new Date().toISOString(),
        time_zone: "UTC",
        virtual_start_at: new Date().toISOString(),
        source_snapshot: {
          ref: `test-snapshot:${runId}`,
          hash: hash(`snapshot:${runId}`),
          captured_at: new Date().toISOString(),
          source_revisions: {},
        },
        limitations: [],
      },
      end_at: null,
      observed_storage_bytes: 1024,
      storage_measured_at: new Date().toISOString(),
      now: new Date().toISOString(),
    })).rejects.toThrow("no longer awaiting snapshot capture");
  });

  it("serializes final Auth binding with cleanup and then observes the active reference", async () => {
    const owner = await identity("auth-race");
    const createdAt = new Date(Date.now() - 60_000).toISOString();
    const run = await expiredTerminal(
      repositoryA,
      owner,
      createdAt,
      new Date(Date.now() - 30_000).toISOString(),
      new Date(Date.now() + 30_000).toISOString(),
    );
    const tokenHash = hash(`session:${run.id}`);
    await control.query(`INSERT INTO auth_sessions(
        token_hash,user_id,csrf_token,expires_at,active_school_id
      ) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour',$4)`,
    [tokenHash, owner.userId, hash(`csrf:${run.id}`), owner.schoolId]);
    await control.query(
      "UPDATE simulation_runs SET retention_expires_at=clock_timestamp()+interval '750 milliseconds' WHERE id=$1",
      [run.id],
    );

    const binding = await control.connect();
    try {
      await binding.query("BEGIN");
      await binding.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [`simulation-retention:${run.id}`],
      );
      const retained = await binding.query(`SELECT id FROM simulation_runs
        WHERE id=$1 AND gc_state NOT IN ('deleting','deleted')
          AND world_discarded_at IS NULL
          AND (retention_expires_at IS NULL OR retention_expires_at>clock_timestamp())
        FOR KEY SHARE`, [run.id]);
      expect(retained.rowCount).toBe(1);

      await new Promise((resolve) => setTimeout(resolve, 900));
      const claimWhileBinding = await repositoryB.claimGarbageCollection({
        worker_id: "gc-auth-race",
        lease_token: randomUUID(),
        now: new Date().toISOString(),
        lease_seconds: 60,
      });
      expect(claimWhileBinding).toBeNull();
      await binding.query(`INSERT INTO auth_session_execution_environments(
          token_hash,school_id,scenario_id,run_id,namespace_id,expires_at,bound_by
        ) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '30 minutes',$6)`,
      [tokenHash, owner.schoolId, run.scenario_id, run.id, run.namespace_id, owner.userId]);
      await binding.query("COMMIT");
    } catch (error) {
      await binding.query("ROLLBACK");
      throw error;
    } finally {
      binding.release();
    }

    const claimAfterBinding = await repositoryA.claimGarbageCollection({
      worker_id: "gc-after-auth-binding",
      lease_token: randomUUID(),
      now: new Date().toISOString(),
      lease_seconds: 60,
    });
    expect(claimAfterBinding).toBeNull();
    expect(await repositoryA.hasActiveSessionReference(run.id, owner.schoolId, new Date().toISOString()))
      .toBe(true);
  }, 10_000);
});
