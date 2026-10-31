/* eslint-disable @typescript-eslint/unbound-method -- Vitest spies intentionally inspect port methods. */
import { ConflictException, ForbiddenException, ServiceUnavailableException } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../src/common/request.js";
import type {
  PersistedSimulationRun,
  SimulationBehaviourView,
  SimulationMetricValue,
} from "../src/simulation/simulation.contracts.js";
import type { SimulationRepository } from "../src/simulation/simulation.repository.js";
import { SimulationService } from "../src/simulation/simulation.service.js";
import { DEFAULT_SIMULATION_RESOURCE_POLICY, SimulationCapacityException } from "../src/simulation/simulation-resource-policy.js";
import type {
  CaptureSimulationWorldResult,
  SimulationWorldPort,
} from "../src/simulation/simulation-world.port.js";

const SCHOOL_ID = "00000000-0000-4000-8000-000000000001";
const USER_ID = "00000000-0000-4000-8000-000000000002";
const RUN_ID = "00000000-0000-4000-8000-000000000003";
const SCENARIO_ID = "00000000-0000-4000-8000-000000000004";
const START = "2026-10-19T03:30:00.000Z";
const WALL = "2026-10-19T06:00:00.000Z";

const user: AuthUser = {
  id: USER_ID,
  username: "admin",
  email: "admin@example.test",
  first_name: "Admin",
  last_name: "User",
  role: "admin",
  is_active: true,
  active_school_id: SCHOOL_ID,
};

function run(overrides: Partial<PersistedSimulationRun> = {}): PersistedSimulationRun {
  return {
    id: RUN_ID,
    school_id: SCHOOL_ID,
    scenario_id: SCENARIO_ID,
    namespace_id: `scenario:${SCENARIO_ID}:run:${RUN_ID}`,
    created_by_user_id: USER_ID,
    kind: "scenario",
    name: "Scenario A",
    status: "draft",
    speed: 20,
    deterministic_seed: "a".repeat(64),
    time_zone: "Asia/Kolkata",
    source_snapshot_ref: `sha256:${"b".repeat(64)}`,
    source_snapshot_hash: "b".repeat(64),
    source_snapshot_at: START,
    source_revisions: { timetable: "revision:7" },
    world_ref: `simulation-world:${RUN_ID}`,
    world_revision: 1,
    manifest_ref: `manifest:${RUN_ID}`,
    manifest_checked_at: START,
    limitations: [],
    virtual_started_at: START,
    virtual_now: START,
    simulated_elapsed_ms: 0,
    end_at: null,
    retention_expires_at: null,
    resource_reservation_bytes: 104_857_600,
    observed_storage_bytes: 0,
    storage_measured_at: null,
    resource_paused_at: null,
    resource_pause_reason: null,
    lease_recovery_count: 0,
    retention_policy_version: 1,
    retention_started_at: null,
    pinned_at: null,
    pinned_by_user_id: null,
    gc_state: "retained",
    gc_lease_owner: null,
    gc_lease_token: null,
    gc_lease_until: null,
    gc_lease_fence: 0,
    gc_failure_count: 0,
    gc_failure_reason: null,
    gc_next_attempt_at: null,
    world_discarded_at: null,
    wall_anchor_at: null,
    virtual_anchor_at: null,
    next_wake_at: null,
    next_event_at: null,
    last_checkpoint_at: START,
    event_count: 0,
    checkpoint_count: 1,
    failure_reason: null,
    created_at: START,
    updated_at: START,
    started_at: null,
    paused_at: null,
    stopped_at: null,
    completed_at: null,
    lease_owner: null,
    lease_token: null,
    lease_until: null,
    lease_fence: 0,
    failure_count: 0,
    revision: 2,
    ...overrides,
  };
}

function capture(overrides: Partial<CaptureSimulationWorldResult> = {}): CaptureSimulationWorldResult {
  return {
    world_ref: `simulation-world:${RUN_ID}`,
    world_revision: 1,
    manifest_ref: `manifest:${RUN_ID}`,
    manifest_checked_at: START,
    time_zone: "Asia/Kolkata",
    virtual_start_at: START,
    source_snapshot: {
      ref: `sha256:${"b".repeat(64)}`,
      hash: "b".repeat(64),
      captured_at: START,
      source_revisions: { timetable: "revision:7" },
    },
    limitations: [],
    ...overrides,
  };
}

function fixture(resourcePolicy = DEFAULT_SIMULATION_RESOURCE_POLICY) {
  const repository = {
    hasActiveAdminMembership: vi.fn().mockResolvedValue(true),
    findOwnedByIdempotency: vi.fn().mockResolvedValue(null),
    createPreparing: vi.fn(),
    completeCapture: vi.fn(),
    failPreparing: vi.fn().mockResolvedValue(undefined),
    failNextStalePreparing: vi.fn(),
    requireOwned: vi.fn(),
    getOwned: vi.fn(),
    listOwned: vi.fn().mockResolvedValue([]),
    listRetainedOwned: vi.fn(),
    updateDraft: vi.fn(),
    recordDraftChange: vi.fn(),
    recordBehaviour: vi.fn().mockResolvedValue(undefined),
    behaviour: vi.fn().mockResolvedValue(null),
    metrics: vi.fn().mockResolvedValue([]),
    draftChanges: vi.fn().mockResolvedValue([]),
    start: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
    withControlBoundary: vi.fn().mockImplementation((_input: unknown, operation: () => Promise<unknown>) => operation()),
    checkpointOffsets: vi.fn(),
    latestCheckpointRef: vi.fn().mockResolvedValue("checkpoint:0"),
    claimDue: vi.fn(),
    retainAdvanceTarget: vi.fn().mockImplementation((lease, virtualTo) => Promise.resolve(lease.run.pending_advance ?? {
      virtual_from: lease.run.virtual_now, virtual_to: virtualTo, world_revision: lease.run.world_revision,
    })),
    completeAdvance: vi.fn(),
    failAdvance: vi.fn(),
    pauseAdvanceForResource: vi.fn(),
    pauseNextRunOverBudget: vi.fn().mockResolvedValue(null),
    pin: vi.fn(),
    unpin: vi.fn(),
    recordStorageMeasurement: vi.fn().mockResolvedValue(undefined),
    claimGarbageCollection: vi.fn(),
    claimRequestedRemoval: vi.fn(),
    hasActiveSessionReference: vi.fn().mockResolvedValue(false),
    deferGarbageCollection: vi.fn().mockResolvedValue(undefined),
    completeGarbageCollection: vi.fn().mockResolvedValue(undefined),
    failGarbageCollection: vi.fn().mockResolvedValue(undefined),
  };
  const world: SimulationWorldPort = {
    assertCaptureReady: vi.fn().mockResolvedValue(undefined),
    capture: vi.fn(),
    fork: vi.fn(),
    open: vi.fn().mockResolvedValue({
      manifest_ref: `manifest:${RUN_ID}`,
      checked_at: START,
      can_open: true,
      limitations: [],
    }),
    configureBehaviour: vi.fn(),
    advance: vi.fn(),
    stop: vi.fn().mockResolvedValue(undefined),
    discard: vi.fn().mockResolvedValue(undefined),
  };
  return {
    repository,
    world,
    service: new SimulationService(
      repository as unknown as SimulationRepository,
      world,
      resourcePolicy,
    ),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(WALL));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("durable Simulation control plane", () => {
  it("rejects an unavailable capture tool before creating or failing a quota-bearing run", async () => {
    const { repository, world, service } = fixture();
    vi.mocked(world.assertCaptureReady!).mockRejectedValue(new ServiceUnavailableException({
      code: "simulation_capture_unavailable", message: "Simulation cannot start because the server's snapshot tool is unavailable.",
    }));
    await expect(service.create(user, SCHOOL_ID, { kind: "baseline", speed: 20,
      idempotency_key: "missing-deployment-tool" })).rejects.toThrow(/snapshot tool is unavailable/u);
    expect(repository.findOwnedByIdempotency).toHaveBeenCalledWith(SCHOOL_ID, USER_ID,
      "missing-deployment-tool", expect.stringMatching(/^[a-f0-9]{64}$/u));
    expect(repository.createPreparing).not.toHaveBeenCalled();
    expect(repository.failPreparing).not.toHaveBeenCalled();
    expect(world.capture).not.toHaveBeenCalled();
  });

  it("replays an already accepted create without requiring the capture tool again", async () => {
    const { repository, world, service } = fixture();
    repository.findOwnedByIdempotency.mockResolvedValue(run());
    vi.mocked(world.assertCaptureReady!).mockRejectedValue(new Error("must not preflight an accepted replay"));
    const response = await service.create(user, SCHOOL_ID, { kind: "scenario", speed: 20,
      idempotency_key: "already-accepted-create" });
    expect(response.run.id).toBe(RUN_ID);
    expect(world.assertCaptureReady).not.toHaveBeenCalled();
    expect(repository.createPreparing).not.toHaveBeenCalled();
    expect(world.capture).not.toHaveBeenCalled();
  });

  it("preserves in-progress and changed-payload create refusals before dependency checks", async () => {
    const { repository, world, service } = fixture();
    repository.findOwnedByIdempotency.mockResolvedValue(run({ status: "preparing" }));
    const body = { kind: "scenario", speed: 20, idempotency_key: "in-flight-create" };
    await expect(service.create(user, SCHOOL_ID, body)).rejects.toThrow(/already being prepared/u);
    repository.findOwnedByIdempotency.mockRejectedValue(new ConflictException("This Simulation idempotency key was already used for another request."));
    await expect(service.create(user, SCHOOL_ID, body)).rejects.toThrow(/already used for another request/u);
    expect(world.assertCaptureReady).not.toHaveBeenCalled();
    expect(repository.createPreparing).not.toHaveBeenCalled();
  });

  it("allocates the run identity before snapshot capture and returns an openable scenario draft", async () => {
    const { repository, world, service } = fixture();
    repository.createPreparing.mockImplementation((input: { id: string; scenario_id: string }) => Promise.resolve(run({
      id: input.id,
      scenario_id: input.scenario_id,
      namespace_id: `scenario:${input.scenario_id}:run:${input.id}`,
      status: "preparing",
      source_snapshot_ref: null,
      source_snapshot_hash: null,
      source_snapshot_at: null,
      source_revisions: {},
      world_ref: null,
      manifest_ref: null,
      manifest_checked_at: null,
      virtual_started_at: null,
      virtual_now: null,
      checkpoint_count: 0,
    })));
    vi.mocked(world.capture).mockImplementation((input) => Promise.resolve(capture({
      world_ref: `simulation-world:${input.run_id}`,
      manifest_ref: `manifest:${input.run_id}`,
    })));
    repository.completeCapture.mockImplementation((input: { run_id: string; capture: CaptureSimulationWorldResult }) => Promise.resolve(run({
      id: input.run_id,
      world_ref: input.capture.world_ref,
      manifest_ref: input.capture.manifest_ref,
    })));

    const response = await service.create(user, SCHOOL_ID, {
      kind: "scenario",
      speed: 20,
      idempotency_key: "create-scenario-1",
    });

    expect(world.capture).toHaveBeenCalledWith(expect.objectContaining({
      institution_id: SCHOOL_ID,
      actor_id: USER_ID,
      run_id: expect.any(String),
      scenario_id: expect.any(String),
      namespace_id: expect.stringMatching(/^scenario:.+:run:.+$/u),
    }));
    expect(world.assertCaptureReady).toHaveBeenCalledOnce();
    expect(vi.mocked(world.assertCaptureReady!).mock.invocationCallOrder[0])
      .toBeLessThan(repository.createPreparing.mock.invocationCallOrder[0]!);
    expect(response.run.status).toBe("draft");
    expect(response.run.can_open).toBe(true);
    expect(response.run.snapshot?.hash).toBe("b".repeat(64));
    expect(response.run.world?.limitations).toEqual([]);
  });

  it("keeps a baseline closed until start while allowing an explicit approved cohort policy", async () => {
    const { repository, world, service } = fixture();
    const baseline = run({ kind: "baseline" });
    repository.requireOwned.mockResolvedValue(baseline);
    const behaviour: SimulationBehaviourView = {
      schema_version: 2,
      attendance: {
        enabled: true,
        present: 0.8,
        late: 0.1,
        absent: 0.05,
        excused: 0.05,
        submission_delay_minutes: 5,
        version_ref: "simulation-behaviour:v1",
        configuration_hash: "c".repeat(64),
        approved_by_agent_id: "00000000-0000-4000-8000-000000000099",
        configured_at: WALL,
      },
      coverage_offers: {
        enabled: false,
        accepted: 0,
        declined: 0,
        no_response: 1,
        response_delay_minutes: 10,
      },
      invigilation_offers: {
        enabled: false,
        accepted: 0,
        declined: 0,
        no_response: 1,
        response_delay_minutes: 10,
      },
      provenance: {
        version_ref: "simulation-behaviour:v1",
        configuration_hash: "c".repeat(64),
        approved_by_agent_id: "00000000-0000-4000-8000-000000000099",
        configured_at: WALL,
      },
    };
    vi.mocked(world.configureBehaviour!).mockResolvedValue({
      version_ref: behaviour.attendance.version_ref,
      configuration_hash: behaviour.attendance.configuration_hash,
      approved_by_agent_id: behaviour.attendance.approved_by_agent_id,
      configured_at: WALL,
    });
    repository.behaviour.mockResolvedValue(behaviour);

    const response = await service.configureBehaviour(user, SCHOOL_ID, RUN_ID, {
      schema_version: 1,
      attendance: {
        enabled: true,
        present: 0.8,
        late: 0.1,
        absent: 0.05,
        excused: 0.05,
        submission_delay_minutes: 5,
      },
    });

    expect(repository.recordBehaviour).toHaveBeenCalled();
    expect(response.run.can_open).toBe(false);
    expect(response.run.behaviour).toEqual(behaviour);
    await expect(service.configureBehaviour(user, SCHOOL_ID, RUN_ID, {
      schema_version: 1,
      attendance: {
        enabled: true,
        present: 0.9,
        late: 0.1,
        absent: 0.1,
        excused: 0,
        submission_delay_minutes: 5,
      },
    })).rejects.toThrow(/sum to 1/iu);
  });

  it("starts at 20x and advances through a leased, five-minute aligned checkpoint", async () => {
    const { repository, world, service } = fixture();
    const draft = run();
    repository.requireOwned.mockResolvedValue(draft);
    repository.start.mockImplementation((input: { next_wake_at: string; now: string }) => Promise.resolve(run({
      status: "running",
      started_at: input.now,
      wall_anchor_at: input.now,
      virtual_anchor_at: START,
      next_wake_at: input.next_wake_at,
    })));
    const started = await service.start(user, SCHOOL_ID, RUN_ID, {});
    expect(Date.parse(started.run.progress.next_wake_at!) - Date.parse(WALL)).toBe(15_000);

    const running = run({
      status: "running",
      started_at: WALL,
      wall_anchor_at: WALL,
      virtual_anchor_at: START,
      next_wake_at: "2026-10-19T06:00:15.000Z",
      lease_owner: "worker-1",
      lease_token: "00000000-0000-4000-8000-000000000010",
      lease_until: "2026-10-19T06:01:15.000Z",
      lease_fence: 1,
      updated_at: "2026-10-19T06:00:16.000Z",
    });
    const lease = {
      run: running,
      lease_owner: running.lease_owner!,
      lease_token: running.lease_token!,
      lease_until: running.lease_until!,
      lease_fence: running.lease_fence,
    };
    repository.claimDue.mockResolvedValue(lease);
    vi.mocked(world.advance).mockResolvedValue({
      world_revision: 2,
      checkpoint_ref: "checkpoint:1",
      emitted_event_count: 3,
      next_event_at: null,
      metrics: [{ key: "open_work", label: "Open work", unit: "items", value: 2 }],
    });
    repository.completeAdvance.mockImplementation((input: { checkpoint: { virtual_to: string; simulated_elapsed_ms: number } }) => Promise.resolve(run({
      status: "running",
      virtual_now: input.checkpoint.virtual_to,
      simulated_elapsed_ms: input.checkpoint.simulated_elapsed_ms,
      world_revision: 2,
    })));

    const advanced = await service.advanceNextDueRun("worker-1", "2026-10-19T06:00:16.000Z");
    expect(world.advance).toHaveBeenCalledWith(expect.objectContaining({
      virtual_from: START,
      virtual_to: "2026-10-19T03:35:00.000Z",
      lease_token: running.lease_token,
      lease_fence: 1,
    }));
    expect(repository.completeAdvance).toHaveBeenCalledWith(expect.objectContaining({
      checkpoint: expect.objectContaining({ simulated_elapsed_ms: 300_000 }),
    }));
    expect(advanced?.virtual_now).toBe("2026-10-19T03:35:00.000Z");
  });

  it("reuses a retained partial checkpoint after the world commit but before control completion", async () => {
    const { repository, world, service } = fixture();
    const partial = "2026-10-19T03:32:00.000Z";
    const running = run({ status: "running", speed: 1, started_at: WALL, wall_anchor_at: WALL,
      virtual_anchor_at: START, updated_at: "2026-10-19T06:03:00.000Z",
      pending_advance: { virtual_from: START, virtual_to: partial, world_revision: 1 },
      lease_owner: "recovery-worker", lease_token: "00000000-0000-4000-8000-000000000012",
      lease_until: "2026-10-19T06:04:00.000Z", lease_fence: 2 });
    repository.claimDue.mockResolvedValue({ run: running, lease_owner: running.lease_owner,
      lease_token: running.lease_token, lease_until: running.lease_until, lease_fence: running.lease_fence });
    vi.mocked(world.advance).mockResolvedValue({ world_revision: 2, checkpoint_ref: "partial-receipt",
      emitted_event_count: 0, next_event_at: null, metrics: [] });
    repository.completeAdvance.mockResolvedValue(run({ status: "running", virtual_now: partial, world_revision: 2 }));
    await service.advanceNextDueRun("recovery-worker");
    expect(repository.retainAdvanceTarget).toHaveBeenCalledWith(expect.anything(), partial);
    expect(world.advance).toHaveBeenCalledWith(expect.objectContaining({ virtual_from: START, virtual_to: partial, world_revision: 1, lease_fence: 2 }));
    expect(repository.completeAdvance).toHaveBeenCalledWith(expect.objectContaining({ checkpoint: expect.objectContaining({ virtual_to: partial, simulated_elapsed_ms: 120_000 }) }));
  });

  it("reconciles an older committed world receipt before calculating a new claim target", async () => {
    const { repository, world, service } = fixture();
    const partial = "2026-10-19T03:32:00.000Z";
    const running = run({ status: "running", speed: 1, started_at: WALL, wall_anchor_at: WALL,
      virtual_anchor_at: START, updated_at: "2026-10-19T06:03:00.000Z",
      lease_owner: "older-recovery", lease_token: "00000000-0000-4000-8000-000000000013",
      lease_until: "2026-10-19T06:04:00.000Z", lease_fence: 2 });
    repository.claimDue.mockResolvedValue({ run: running, lease_owner: running.lease_owner,
      lease_token: running.lease_token, lease_until: running.lease_until, lease_fence: running.lease_fence });
    const result = { world_revision: 2, checkpoint_ref: "older-partial", emitted_event_count: 0, next_event_at: null, metrics: [] };
    world.recoverAdvance = vi.fn().mockResolvedValue({ virtual_to: partial, result });
    vi.mocked(world.advance).mockResolvedValue(result);
    repository.completeAdvance.mockResolvedValue(run({ status: "running", virtual_now: partial, world_revision: 2 }));
    await service.advanceNextDueRun("older-recovery");
    expect(world.recoverAdvance).toHaveBeenCalledWith(expect.objectContaining({ virtual_from: START, world_revision: 1 }));
    expect(repository.retainAdvanceTarget).toHaveBeenCalledWith(expect.anything(), partial);
    expect(world.advance).toHaveBeenCalledWith(expect.objectContaining({ virtual_to: partial }));
  });

  it("completes exactly at an optional end and keeps the frozen world available", async () => {
    const { repository, world, service } = fixture();
    const endAt = "2026-10-19T03:35:00.000Z";
    const running = run({
      status: "running",
      end_at: endAt,
      started_at: WALL,
      wall_anchor_at: WALL,
      virtual_anchor_at: START,
      next_wake_at: "2026-10-19T06:00:15.000Z",
      lease_owner: "worker-end",
      lease_token: "00000000-0000-4000-8000-000000000011",
      lease_until: "2026-10-19T06:01:15.000Z",
      lease_fence: 1,
      updated_at: "2026-10-19T06:00:15.000Z",
    });
    repository.claimDue.mockResolvedValue({
      run: running,
      lease_owner: running.lease_owner!,
      lease_token: running.lease_token!,
      lease_until: running.lease_until!,
      lease_fence: running.lease_fence,
    });
    vi.mocked(world.advance).mockResolvedValue({
      world_revision: 2,
      checkpoint_ref: "checkpoint:end",
      emitted_event_count: 1,
      next_event_at: null,
      metrics: [],
    });
    const completed = run({
      status: "completed",
      end_at: endAt,
      virtual_now: endAt,
      simulated_elapsed_ms: 300_000,
      completed_at: "2026-10-19T06:00:15.000Z",
    });
    repository.completeAdvance.mockResolvedValue(completed);

    const result = await service.advanceNextDueRun("worker-end", "2026-10-19T06:00:15.000Z");

    expect(repository.completeAdvance).toHaveBeenCalledWith(expect.objectContaining({
      completed: true,
      next_wake_at: null,
      checkpoint: expect.objectContaining({ virtual_to: endAt }),
    }));
    expect(world.stop).toHaveBeenCalledWith(completed);
    expect(result?.status).toBe("completed");

    repository.requireOwned.mockResolvedValue(completed);
    const response = await service.get(user, SCHOOL_ID, RUN_ID);
    expect(response.run.can_open).toBe(true);
    expect(response.run.clock.virtual_now).toBe(endAt);
    expect(response.run.available_actions).toEqual(expect.arrayContaining(["open", "duplicate", "compare"]));
  });

  it("refuses start and duplicate before control-plane mutation when snapshot compatibility fails", async () => {
    const { repository, world, service } = fixture();
    const draft = run();
    repository.requireOwned.mockResolvedValue(draft);
    const incompatible = new ConflictException({
      statusCode: 409,
      code: "simulation_snapshot_incompatible",
      message: "This Simulation snapshot is incompatible with the current runtime.",
    });
    vi.mocked(world.open).mockRejectedValue(incompatible);

    await expect(service.start(user, SCHOOL_ID, RUN_ID, {})).rejects.toBe(incompatible);
    expect(repository.start).not.toHaveBeenCalled();
    await expect(service.duplicate(user, SCHOOL_ID, RUN_ID, {
      idempotency_key: "incompatible-snapshot-duplicate",
    })).rejects.toBe(incompatible);
    expect(repository.createPreparing).not.toHaveBeenCalled();
    expect(world.fork).not.toHaveBeenCalled();
  });

  it("supports durable pause, resume and explicit stop controls", async () => {
    const { repository, world, service } = fixture();
    const paused = run({ status: "paused", paused_at: WALL });
    repository.pause.mockResolvedValue(paused);
    expect((await service.pause(user, SCHOOL_ID, RUN_ID)).run.status).toBe("paused");
    expect(repository.withControlBoundary).toHaveBeenCalledWith({ run_id: RUN_ID, owner_id: USER_ID, school_id: SCHOOL_ID }, expect.any(Function));
    expect(repository.pause).toHaveBeenCalledWith({ run_id: RUN_ID, owner_id: USER_ID, school_id: SCHOOL_ID, now: WALL });

    repository.requireOwned.mockResolvedValue(paused);
    repository.resume.mockResolvedValue(run({
      status: "running",
      started_at: WALL,
      wall_anchor_at: WALL,
      virtual_anchor_at: START,
      next_wake_at: "2026-10-19T06:00:03.000Z",
    }));
    const resumed = await service.resume(user, SCHOOL_ID, RUN_ID, { speed: 100 });
    expect(world.open).toHaveBeenCalledWith(paused);
    expect(repository.resume).toHaveBeenCalledWith(expect.objectContaining({
      run_id: RUN_ID,
      owner_id: USER_ID,
      school_id: SCHOOL_ID,
      speed: 100,
      next_wake_at: "2026-10-19T06:00:03.000Z",
      now: WALL,
    }));
    expect(resumed.run.status).toBe("running");

    const stopped = run({ status: "stopped", stopped_at: WALL });
    repository.stop.mockResolvedValue(stopped);
    const response = await service.stop(user, SCHOOL_ID, RUN_ID);
    expect(repository.stop).toHaveBeenCalledWith({
      run_id: RUN_ID,
      school_id: SCHOOL_ID,
      owner_id: USER_ID,
      now: WALL,
      retention_expires_at: "2026-11-18T06:00:00.000Z",
    });
    expect(world.stop).toHaveBeenCalledWith(stopped);
    expect(response.run.status).toBe("stopped");
    expect(response.run.can_open).toBe(true);
  });

  it("forwards the exact reviewed draft guard and never stops its world after a stale discard", async () => {
    const { repository, world, service } = fixture();
    const conflict = new ConflictException("This draft changed or has started.");
    repository.stop.mockRejectedValue(conflict);
    await expect(service.stop(user, SCHOOL_ID, RUN_ID, {
      expected_revision: 2, expected_status: "draft",
    })).rejects.toBe(conflict);
    expect(repository.stop).toHaveBeenCalledWith(expect.objectContaining({
      school_id: SCHOOL_ID,
      draft_precondition: { expected_revision: 2, expected_status: "draft" },
    }));
    expect(world.stop).not.toHaveBeenCalled();
    expect(repository.claimRequestedRemoval).not.toHaveBeenCalled();
    expect(repository.withControlBoundary).not.toHaveBeenCalled();
  });

  it("does not invoke Pause or Stop when the checkpoint boundary times out", async () => {
    const { repository, world, service } = fixture();
    const timeout = new ConflictException({ code: "simulation_checkpoint_finishing", message: "Still finishing." });
    repository.withControlBoundary.mockRejectedValue(timeout);
    await expect(service.pause(user, SCHOOL_ID, RUN_ID)).rejects.toBe(timeout);
    await expect(service.stop(user, SCHOOL_ID, RUN_ID)).rejects.toBe(timeout);
    expect(repository.pause).not.toHaveBeenCalled();
    expect(repository.stop).not.toHaveBeenCalled();
    expect(world.stop).not.toHaveBeenCalled();
  });

  it.each([
    { expected_revision: 2 },
    { expected_status: "draft" },
    { expected_revision: 0, expected_status: "draft" },
    { expected_revision: 1.5, expected_status: "draft" },
    { expected_revision: "2", expected_status: "draft" },
    { expected_revision: 2, expected_status: "running" },
    { expected_revision: 2, expected_status: "draft", discard: true },
    null,
  ])("refuses malformed or partial conditional draft-stop bodies before mutation: %j", async (body) => {
    const { repository, world, service } = fixture();
    await expect(service.stop(user, SCHOOL_ID, RUN_ID, body)).rejects.toThrow();
    expect(repository.stop).not.toHaveBeenCalled();
    expect(world.stop).not.toHaveBeenCalled();
  });

  it("pins terminal evidence explicitly and starts a fresh retention window when unpinned", async () => {
    const { repository, service } = fixture();
    const pinned = run({
      status: "stopped",
      stopped_at: START,
      retention_started_at: START,
      retention_expires_at: null,
      pinned_at: WALL,
      pinned_by_user_id: USER_ID,
    });
    repository.pin.mockResolvedValue(pinned);

    const pinnedResponse = await service.pin(user, SCHOOL_ID, RUN_ID);
    expect(repository.pin).toHaveBeenCalledWith(expect.objectContaining({
      run_id: RUN_ID,
      school_id: SCHOOL_ID,
      owner_id: USER_ID,
    }));
    expect(pinnedResponse.run.retention).toMatchObject({
      pinned: true,
      expires_at: null,
      state: "retained",
    });
    expect(pinnedResponse.run.available_actions).toContain("unpin");

    const unpinned = run({
      status: "stopped",
      stopped_at: START,
      retention_started_at: WALL,
      retention_expires_at: "2026-11-18T06:00:00.000Z",
    });
    repository.unpin.mockResolvedValue(unpinned);
    const unpinnedResponse = await service.unpin(user, SCHOOL_ID, RUN_ID);
    expect(repository.unpin).toHaveBeenCalledWith(expect.objectContaining({
      retention_expires_at: "2026-11-18T06:00:00.000Z",
    }));
    expect(unpinnedResponse.run.retention.pinned).toBe(false);
    expect(unpinnedResponse.run.available_actions).toContain("pin");
  });

  it("turns a world storage-budget refusal into a safe pause without consuming failure retries", async () => {
    const { repository, world, service } = fixture();
    const running = run({
      status: "running",
      started_at: WALL,
      wall_anchor_at: WALL,
      virtual_anchor_at: START,
      next_wake_at: "2026-10-19T06:00:15.000Z",
      lease_owner: "worker-budget",
      lease_token: "00000000-0000-4000-8000-000000000012",
      lease_until: "2026-10-19T06:01:15.000Z",
      lease_fence: 2,
      updated_at: "2026-10-19T06:00:16.000Z",
    });
    const lease = {
      run: running,
      lease_owner: running.lease_owner!,
      lease_token: running.lease_token!,
      lease_until: running.lease_until!,
      lease_fence: running.lease_fence,
    };
    repository.claimDue.mockResolvedValue(lease);
    vi.mocked(world.advance).mockRejectedValue(new ConflictException({
      code: "simulation_resource_budget_exceeded",
      message: "This Simulation world reached its run-local artifact budget.",
    }));
    const paused = run({
      status: "paused",
      paused_at: WALL,
      resource_paused_at: WALL,
      resource_pause_reason: "This Simulation world reached its run-local artifact budget.",
    });
    repository.pauseAdvanceForResource.mockResolvedValue(paused);

    await expect(service.advanceNextDueRun("worker-budget", "2026-10-19T06:00:16.000Z"))
      .resolves.toMatchObject({ status: "paused", failure_count: 0 });
    expect(repository.pauseAdvanceForResource).toHaveBeenCalledWith(expect.objectContaining({
      lease,
    }));
    expect(repository.failAdvance).not.toHaveBeenCalled();
  });

  it("delegates stale preparation recovery to the DB-clock repository transition", async () => {
    const { repository, service } = fixture();
    const failed = run({
      status: "failed",
      source_snapshot_ref: null,
      source_snapshot_hash: null,
      source_snapshot_at: null,
      world_ref: null,
      manifest_ref: null,
      failure_reason: "Simulation preparation timed out before its snapshot was durably attached.",
      retention_started_at: WALL,
      retention_expires_at: "2026-11-18T06:00:00.000Z",
    });
    repository.failNextStalePreparing.mockResolvedValue(failed);

    await expect(service.failNextStalePreparation()).resolves.toBe(failed);
    expect(repository.failNextStalePreparing).toHaveBeenCalledWith(DEFAULT_SIMULATION_RESOURCE_POLICY);
  });

  it("safely pauses an active run when its retained snapshot is incompatible", async () => {
    const { repository, world, service } = fixture();
    const running = run({
      status: "running",
      started_at: WALL,
      wall_anchor_at: WALL,
      virtual_anchor_at: START,
      next_wake_at: "2026-10-19T06:00:15.000Z",
      lease_owner: "worker-compatibility",
      lease_token: "00000000-0000-4000-8000-000000000019",
      lease_until: "2026-10-19T06:01:15.000Z",
      lease_fence: 3,
      updated_at: "2026-10-19T06:00:16.000Z",
    });
    const lease = {
      run: running,
      lease_owner: running.lease_owner!,
      lease_token: running.lease_token!,
      lease_until: running.lease_until!,
      lease_fence: running.lease_fence,
    };
    repository.claimDue.mockResolvedValue(lease);
    vi.mocked(world.advance).mockRejectedValue(new ConflictException({
      code: "simulation_snapshot_incompatible",
      message: "This Simulation snapshot is incompatible with the current runtime.",
    }));
    repository.pauseAdvanceForResource.mockResolvedValue(run({
      status: "paused",
      resource_paused_at: "2026-10-19T06:00:16.000Z",
      resource_pause_reason: "Snapshot compatibility blocked this run.",
    }));

    await expect(service.advanceNextDueRun("worker-compatibility", "1900-01-01T00:00:00.000Z"))
      .resolves.toMatchObject({ status: "paused", failure_count: 0 });
    expect(repository.pauseAdvanceForResource).toHaveBeenCalledWith(expect.objectContaining({
      lease,
      now: "2026-10-19T06:00:16.000Z",
      reason: expect.stringContaining("Snapshot compatibility blocked this run"),
    }));
    expect(repository.failAdvance).not.toHaveBeenCalled();
  });

  it("collects only an expired unreferenced terminal world under a fenced GC lease", async () => {
    const policy = { ...DEFAULT_SIMULATION_RESOURCE_POLICY, gc_enabled: true };
    const { repository, world, service } = fixture(policy);
    const terminal = run({
      status: "stopped",
      stopped_at: START,
      retention_started_at: START,
      retention_expires_at: "2026-10-19T05:00:00.000Z",
      gc_state: "deleting",
      gc_lease_owner: "worker-gc",
      gc_lease_token: "00000000-0000-4000-8000-000000000013",
      gc_lease_until: "2026-10-19T06:02:00.000Z",
      gc_lease_fence: 3,
      updated_at: WALL,
    });
    const lease = {
      run: terminal,
      lease_owner: terminal.gc_lease_owner!,
      lease_token: terminal.gc_lease_token!,
      lease_until: terminal.gc_lease_until!,
      lease_fence: terminal.gc_lease_fence,
    };
    repository.claimGarbageCollection.mockResolvedValue(lease);
    world.garbageCollect = vi.fn().mockResolvedValue({
      released_bytes: 2048,
      retained_shared_snapshot: true,
      receipt_ref: "simulation-gc:receipt:3",
    });

    await expect(service.collectNextExpiredWorld("worker-gc", WALL)).resolves.toBe(true);
    expect(world.garbageCollect).toHaveBeenCalledWith(expect.objectContaining({
      run: terminal,
      gc_token: terminal.gc_lease_token,
      gc_fence: 3,
    }));
    expect(repository.completeGarbageCollection).toHaveBeenCalledWith(expect.objectContaining({
      released_bytes: 2048,
      retained_shared_snapshot: true,
    }));
    expect(repository.failGarbageCollection).not.toHaveBeenCalled();
  });

  it("defers cleanup when a selected authenticated session still references the world", async () => {
    const policy = { ...DEFAULT_SIMULATION_RESOURCE_POLICY, gc_enabled: true };
    const { repository, world, service } = fixture(policy);
    const terminal = run({
      status: "completed",
      completed_at: START,
      retention_started_at: START,
      retention_expires_at: "2026-10-19T05:00:00.000Z",
      gc_state: "deleting",
      gc_lease_owner: "worker-gc",
      gc_lease_token: "00000000-0000-4000-8000-000000000014",
      gc_lease_until: "2026-10-19T06:02:00.000Z",
      gc_lease_fence: 1,
      updated_at: WALL,
    });
    repository.claimGarbageCollection.mockResolvedValue({
      run: terminal,
      lease_owner: terminal.gc_lease_owner!,
      lease_token: terminal.gc_lease_token!,
      lease_until: terminal.gc_lease_until!,
      lease_fence: terminal.gc_lease_fence,
    });
    repository.hasActiveSessionReference.mockResolvedValue(true);
    world.garbageCollect = vi.fn();

    await expect(service.collectNextExpiredWorld("worker-gc", WALL)).resolves.toBe(true);
    expect(repository.deferGarbageCollection).toHaveBeenCalledWith(expect.objectContaining({
      reason: "session_reference_active",
    }));
    expect(world.garbageCollect).not.toHaveBeenCalled();
  });

  it("duplicates the exact immutable snapshot for a controlled experiment", async () => {
    const { repository, world, service } = fixture();
    const source = run({ kind: "baseline" });
    repository.requireOwned.mockResolvedValue(source);
    repository.createPreparing.mockImplementation((input: { id: string; scenario_id: string; kind: "baseline" | "scenario" }) => Promise.resolve(run({
      id: input.id,
      scenario_id: input.scenario_id,
      namespace_id: `scenario:${input.scenario_id}:run:${input.id}`,
      kind: input.kind,
      status: "preparing",
      source_snapshot_ref: null,
      source_snapshot_hash: null,
      source_snapshot_at: null,
      world_ref: null,
      manifest_ref: null,
      manifest_checked_at: null,
      virtual_started_at: null,
      virtual_now: null,
      checkpoint_count: 0,
    })));
    vi.mocked(world.fork).mockImplementation((input) => Promise.resolve(capture({
      world_ref: `simulation-world:${input.run_id}`,
      manifest_ref: `manifest:${input.run_id}`,
      source_snapshot: {
        ref: source.source_snapshot_ref!,
        hash: source.source_snapshot_hash!,
        captured_at: source.source_snapshot_at!,
        source_revisions: source.source_revisions,
      },
    })));
    repository.completeCapture.mockImplementation((input: { run_id: string; capture: CaptureSimulationWorldResult }) => Promise.resolve(run({
      id: input.run_id,
      kind: "scenario",
      world_ref: input.capture.world_ref,
      manifest_ref: input.capture.manifest_ref,
    })));

    const duplicated = await service.duplicate(user, SCHOOL_ID, RUN_ID, {
      kind: "scenario",
      idempotency_key: "duplicate-run-1",
    });
    expect(world.capture).not.toHaveBeenCalled();
    expect(world.fork).toHaveBeenCalledWith(expect.objectContaining({ source_run: source }));
    expect(repository.createPreparing).toHaveBeenCalledWith(expect.objectContaining({
      deterministic_seed: source.deterministic_seed,
    }));
    expect(duplicated.run.kind).toBe("scenario");
  });

  it("compares only a duration checkpoint shared by every run and discloses provenance", async () => {
    const { repository, service } = fixture();
    const secondId = "00000000-0000-4000-8000-000000000005";
    const first = run();
    const second = run({ id: secondId, name: "Scenario B" });
    repository.requireOwned.mockImplementation((id: string) => Promise.resolve(id === RUN_ID ? first : second));
    repository.checkpointOffsets.mockResolvedValue(new Map([
      [RUN_ID, [0, 300_000, 600_000]],
      [secondId, [0, 300_000, 600_000, 900_000]],
    ]));
    const sample = (value: number): SimulationMetricValue => ({
      key: "open_work",
      label: "Open work",
      unit: "items",
      value,
      measured_at: "2026-10-19T03:40:00.000Z",
      simulated_elapsed_ms: 600_000,
    });
    repository.metrics.mockImplementation((id: string, duration?: number) => Promise.resolve(
      duration === undefined ? [] : [sample(id === RUN_ID ? 10 : 7)],
    ));

    const response = await service.compare(user, SCHOOL_ID, { run_ids: [RUN_ID, secondId] });
    expect(response.comparison.duration_ms).toBe(600_000);
    expect(response.comparison.controlled_snapshot).toBe(true);
    expect(response.comparison.provenance_warning).toBeNull();
    expect(response.comparison.metrics[0]?.deltas_from_first[0]).toEqual({
      run_id: secondId,
      delta: -3,
      delta_percent: -30,
    });

    repository.requireOwned.mockImplementation((id: string) => Promise.resolve(
      id === RUN_ID ? first : { ...second, source_snapshot_hash: "d".repeat(64) },
    ));
    const uncontrolled = await service.compare(user, SCHOOL_ID, { run_ids: [RUN_ID, secondId] });
    expect(uncontrolled.comparison.controlled_snapshot).toBe(false);
    expect(uncontrolled.comparison.provenance_warning).toMatch(/different Live snapshots/iu);
  });

  it("reopens the durable world before returning a session catalogue reference", async () => {
    const { repository, world, service } = fixture();
    repository.getOwned.mockResolvedValue(run({ status: "paused" }));
    const result = await service.resolveAuthorizedRun({
      actor_id: USER_ID,
      institution_id: SCHOOL_ID,
      run_id: RUN_ID,
    });
    expect(world.open).toHaveBeenCalled();
    expect(result?.expires_at).toBe("9999-12-31T23:59:59.999Z");
    expect(result).toMatchObject({ run_status: "paused", speed: 20, world_revision: 1 });
  });

  it("keeps an absent historical finalization metric unavailable instead of inventing zero", async () => {
    const { repository, service } = fixture();
    const secondId = "00000000-0000-4000-8000-000000000005";
    repository.requireOwned.mockImplementation((id: string) => Promise.resolve(run({ id })));
    repository.checkpointOffsets.mockResolvedValue(new Map([[RUN_ID, [300_000]], [secondId, [300_000]]]));
    repository.metrics.mockImplementation((id: string) => Promise.resolve(id === RUN_ID ? [] : [{
      key: "finalized_registers", label: "Attendance registers finalized since snapshot", unit: "registers",
      value: 1, measured_at: "2026-10-19T03:35:00.000Z", simulated_elapsed_ms: 300_000,
    }]));
    const response = await service.compare(user, SCHOOL_ID, { run_ids: [RUN_ID, secondId] });
    expect(response.comparison.metrics[0]).toMatchObject({ key: "finalized_registers",
      values: [{ run_id: RUN_ID, value: null }, { run_id: secondId, value: 1 }],
      deltas_from_first: [{ run_id: secondId, delta: null, delta_percent: null }],
    });
    repository.metrics.mockResolvedValue([]);
    expect((await service.compare(user, SCHOOL_ID, { run_ids: [RUN_ID, secondId] })).comparison.metrics).toEqual([]);
  });

  it("exposes a new durable checkpoint revision even when its virtual instant is unchanged", async () => {
    const { repository, service } = fixture();
    repository.getOwned.mockResolvedValue(run({ status: "paused", world_revision: 4 }));
    const input = { actor_id: USER_ID, institution_id: SCHOOL_ID, run_id: RUN_ID };
    const first = await service.resolveAuthorizedRun(input);
    repository.getOwned.mockResolvedValue(run({ status: "paused", world_revision: 5 }));
    const next = await service.resolveAuthorizedRun(input);
    expect(first).toMatchObject({ world_revision: 4 });
    expect(next).toMatchObject({ world_revision: 5, virtual_now: first?.virtual_now, namespace_id: first?.namespace_id });
  });

  it.each(["stopped", "completed"] as const)(
    "retains an openable frozen world after a run is %s",
    async (status) => {
      const { repository, world, service } = fixture();
      repository.getOwned.mockResolvedValue(run({
        status,
        stopped_at: status === "stopped" ? WALL : null,
        completed_at: status === "completed" ? WALL : null,
        end_at: status === "completed" ? START : null,
      }));
      repository.requireOwned.mockResolvedValue(run({
        status,
        stopped_at: status === "stopped" ? WALL : null,
        completed_at: status === "completed" ? WALL : null,
        end_at: status === "completed" ? START : null,
      }));

      const result = await service.resolveAuthorizedRun({
        actor_id: USER_ID,
        institution_id: SCHOOL_ID,
        run_id: RUN_ID,
      });

      expect(world.open).toHaveBeenCalled();
      expect(result).toMatchObject({ run_id: RUN_ID, run_status: status, speed: 20 });
      const response = await service.get(user, SCHOOL_ID, RUN_ID);
      expect(response.run.can_open).toBe(true);
      expect(response.run.available_actions).toEqual(expect.arrayContaining([
        "open",
        "duplicate",
        "compare",
      ]));
    },
  );

  it("fails authorization before any snapshot work", async () => {
    const { repository, world, service } = fixture();
    repository.hasActiveAdminMembership.mockResolvedValue(false);
    await expect(service.create(user, SCHOOL_ID, {
      kind: "baseline",
      speed: 20,
      idempotency_key: "unauthorized-run",
    })).rejects.toBeInstanceOf(ForbiddenException);
    expect(world.capture).not.toHaveBeenCalled();
  });

  it("keeps an already-committed domain response successful when its change receipt needs reconciliation", async () => {
    const { repository, service } = fixture();
    repository.recordDraftChange.mockRejectedValue(new Error("control plane temporarily unavailable"));

    await expect(service.recordChangeBestEffort(user, SCHOOL_ID, RUN_ID, {
      domain: "timetable",
      change_kind: "patch",
      target_ref: null,
      summary: "Updated timetable",
      source_revision: "request:00000000-0000-4000-8000-000000000099",
      idempotency_key: "00000000-0000-4000-8000-000000000099",
    })).resolves.toBe(false);
    expect(repository.recordDraftChange).toHaveBeenCalledTimes(3);
  });

  it("reports the actual capacity recovery instead of claiming stopping frees a saved place", () => {
    const expected = { worlds: /remove an ended/i, running_runs: /pause or stop another running/i,
      storage: /storage is full/i, pinned_runs: /unpin another ended/i } as const;
    for (const resource of Object.keys(expected) as Array<keyof typeof expected>) {
      expect(new SimulationCapacityException(resource, 12).getResponse()).toMatchObject({
        code: "simulation_institution_capacity", resource, limit: 12,
        message: expect.stringMatching(expected[resource]),
      });
    }
  });

  it("pages all saved worlds independently from latest-ten history and includes the control revision", async () => {
    const { repository, service } = fixture();
    repository.listRetainedOwned.mockResolvedValue({ runs: [run()],
      page: { number: 3, page_size: 5, total: 12, total_pages: 3 } });
    const response = await service.list(user, SCHOOL_ID, { view: "retained", page: "3" });
    expect(repository.listRetainedOwned).toHaveBeenCalledWith(USER_ID, SCHOOL_ID, 3);
    expect(repository.listOwned).not.toHaveBeenCalled();
    expect(response).toMatchObject({ page: { number: 3, page_size: 5, total: 12, total_pages: 3 },
      results: [{ id: RUN_ID, revision: 2 }] });
  });

  it("removes only through the shared fenced storage path even while automatic GC is disabled", async () => {
    const { repository, world, service } = fixture();
    const deleting = run({ status: "stopped", gc_state: "deleting", retention_started_at: WALL,
      retention_expires_at: WALL, gc_lease_owner: "owner-removal", gc_lease_token: USER_ID,
      gc_lease_fence: 1, gc_lease_until: "2026-10-19T06:02:00.000Z" });
    const lease = { run: deleting, lease_owner: "owner-removal", lease_token: USER_ID,
      lease_fence: 1, lease_until: deleting.gc_lease_until! };
    repository.claimRequestedRemoval.mockResolvedValue({ run: deleting, lease });
    repository.requireOwned.mockResolvedValue(run({ status: "stopped", gc_state: "deleted", world_discarded_at: WALL }));
    world.garbageCollect = vi.fn().mockResolvedValue({ receipt_ref: "removed:1", released_bytes: 1,
      retained_shared_snapshot: true });
    const response = await service.remove(user, SCHOOL_ID, RUN_ID, { expected_revision: 2 });
    expect(repository.claimRequestedRemoval).toHaveBeenCalledWith(expect.objectContaining({
      run_id: RUN_ID, owner_id: USER_ID, school_id: SCHOOL_ID, expected_revision: 2,
    }));
    expect(world.garbageCollect).toHaveBeenCalledWith(expect.objectContaining({ run: deleting, gc_fence: 1 }));
    expect(world.discard).not.toHaveBeenCalled();
    expect(repository.completeGarbageCollection).toHaveBeenCalledWith(expect.objectContaining({ reason: "owner_requested" }));
    expect(response.run.retention.state).toBe("deleted");
    expect(response.run.available_actions).toEqual([]);
  });

  it("returns an already accepted removal without repeating isolated deletion", async () => {
    const { repository, world, service } = fixture();
    const removed = run({ status: "stopped", gc_state: "deleted", world_discarded_at: WALL });
    repository.claimRequestedRemoval.mockResolvedValue({ run: removed, lease: null });
    repository.requireOwned.mockResolvedValue(removed);
    world.garbageCollect = vi.fn();
    expect((await service.remove(user, SCHOOL_ID, RUN_ID, { expected_revision: 2 })).run.retention.state).toBe("deleted");
    expect(world.garbageCollect).not.toHaveBeenCalled();
  });

  it("retains a failed fenced removal attempt and offers a truthful safe retry", async () => {
    const { repository, world, service } = fixture();
    const deleting = run({ status: "stopped", gc_state: "deleting", gc_lease_fence: 1 });
    repository.claimRequestedRemoval.mockResolvedValue({ run: deleting, lease: {
      run: deleting, lease_owner: "owner-removal", lease_token: USER_ID, lease_fence: 1, lease_until: WALL,
    } });
    world.garbageCollect = vi.fn().mockRejectedValue(new Error("isolated store unavailable"));
    await expect(service.remove(user, SCHOOL_ID, RUN_ID, { expected_revision: 2 }))
      .rejects.toMatchObject({ response: { code: "simulation_removal_pending" } });
    expect(repository.failGarbageCollection).toHaveBeenCalledWith(expect.objectContaining({ reason_code: "owner_requested" }));
    expect(repository.completeGarbageCollection).not.toHaveBeenCalled();
  });

  it("does not advertise removal for active, pinned, selected, leased or already deleted worlds", async () => {
    const { repository, service } = fixture();
    const variants: Partial<PersistedSimulationRun>[] = [{ status: "draft" }, { status: "running" },
      { status: "paused" }, { status: "stopped", pinned_at: WALL },
      { status: "stopped", lease_token: USER_ID }, { status: "stopped", gc_state: "deleting" },
      { status: "stopped", world_discarded_at: WALL, gc_state: "deleted" }];
    for (const variant of variants) {
      repository.requireOwned.mockResolvedValue(run(variant));
      expect((await service.get(user, SCHOOL_ID, RUN_ID)).run.available_actions).not.toContain("remove");
    }
    repository.requireOwned.mockResolvedValue(run({ status: "stopped" }));
    repository.hasActiveSessionReference.mockResolvedValue(true);
    expect((await service.get(user, SCHOOL_ID, RUN_ID)).run.available_actions).not.toContain("remove");
  });
});
