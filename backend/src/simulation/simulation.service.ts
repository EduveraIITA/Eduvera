import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  Optional,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  TransientExecutionRunCatalog,
  TransientExecutionRunReference,
} from "../campus-model-core/transient-execution-run.contracts.js";
import type { AuthUser } from "../common/request.js";
import {
  compareSimulationRunsSchema,
  configureSimulationBehaviourSchema,
  createSimulationRunSchema,
  duplicateSimulationRunSchema,
  listSimulationRunsSchema,
  normalizeSimulationBehaviourConfiguration,
  recordSimulationDraftChangeSchema,
  resumeSimulationRunSchema,
  startSimulationRunSchema,
  stopSimulationRunSchema,
  removeSimulationRunSchema,
  updateSimulationDraftSchema,
  type CompareSimulationRunsInput,
  type CreateSimulationRunInput,
  type DuplicateSimulationRunInput,
  type PersistedSimulationRun,
  type SimulationComparisonResponse,
  type SimulationMetricValue,
  type SimulationRunAction,
  type SimulationRunListResponse,
  type SimulationRunResponse,
  type SimulationRunView,
} from "./simulation.contracts.js";
import { SimulationRepository, type SimulationGarbageCollectionLease } from "./simulation.repository.js";
import {
  DEFAULT_SIMULATION_RESOURCE_POLICY,
  SIMULATION_RESOURCE_POLICY,
  terminalRetentionExpiry,
  type SimulationResourcePolicy,
} from "./simulation-resource-policy.js";
import {
  advanceTarget,
  greatestCommonCheckpointDuration,
  metricDelta,
  nextSimulationWakeAt,
  simulationReachedEnd,
} from "./simulation-time.runtime.js";
import {
  SIMULATION_WORLD_PORT,
  type CaptureSimulationWorldResult,
  type SimulationWorldPort,
} from "./simulation-world.port.js";

const runIdSchema = z.string().uuid();
const COMPATIBILITY_NO_EXPIRY = "9999-12-31T23:59:59.999Z";
const MAX_ADVANCE_FAILURES = 5;
type OpenSimulationRunStatus = NonNullable<TransientExecutionRunReference["run_status"]>;

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function failureReason(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim().slice(0, 500);
  return "The isolated Simulation world could not complete this operation.";
}

function isWorldResourceBudgetError(error: unknown): boolean {
  if (!(error instanceof HttpException)) return false;
  const response = error.getResponse();
  return typeof response === "object" && response !== null
    && "code" in response
    && response.code === "simulation_resource_budget_exceeded";
}

function isWorldSnapshotCompatibilityError(error: unknown): boolean {
  if (!(error instanceof HttpException)) return false;
  const response = error.getResponse();
  return typeof response === "object" && response !== null
    && "code" in response
    && response.code === "simulation_snapshot_incompatible";
}

function defaultRunName(kind: "baseline" | "scenario", now: string): string {
  const label = kind === "baseline" ? "Baseline" : "Scenario";
  return `${label} · ${now.slice(0, 10)}`;
}

function address(run: PersistedSimulationRun) {
  return {
    institution_id: run.school_id,
    scenario_id: run.scenario_id,
    run_id: run.id,
    namespace_id: run.namespace_id,
    kind: run.kind,
    deterministic_seed: run.deterministic_seed,
  } as const;
}

function withCapture(
  run: PersistedSimulationRun,
  capture: CaptureSimulationWorldResult,
): PersistedSimulationRun {
  return {
    ...run,
    time_zone: capture.time_zone,
    source_snapshot_ref: capture.source_snapshot.ref,
    source_snapshot_hash: capture.source_snapshot.hash,
    source_snapshot_at: capture.source_snapshot.captured_at,
    source_revisions: capture.source_snapshot.source_revisions,
    world_ref: capture.world_ref,
    world_revision: capture.world_revision,
    manifest_ref: capture.manifest_ref,
    manifest_checked_at: capture.manifest_checked_at,
    limitations: capture.limitations,
    virtual_started_at: capture.virtual_start_at,
    virtual_now: capture.virtual_start_at,
  };
}

function canOpen(run: PersistedSimulationRun): boolean {
  if (!run.world_ref || !run.manifest_ref || !run.virtual_now) return false;
  if (run.world_discarded_at || run.gc_state === "deleting" || run.gc_state === "deleted") return false;
  if (run.retention_expires_at && Date.parse(run.retention_expires_at) <= Date.now()) return false;
  if (["running", "paused", "stopped", "completed"].includes(run.status)) return true;
  return run.status === "draft" && run.kind === "scenario";
}

function isOpenStatus(status: PersistedSimulationRun["status"]): status is OpenSimulationRunStatus {
  return status !== "preparing" && status !== "failed";
}

function actions(run: PersistedSimulationRun, removable = false): SimulationRunAction[] {
  const result: SimulationRunAction[] = [];
  if (canOpen(run)) result.push("open");
  if (run.status === "draft") result.push("start", "stop");
  if (run.status === "running") result.push("pause", "stop");
  if (run.status === "paused") result.push("resume", "stop");
  if (run.source_snapshot_hash && !run.world_discarded_at && run.gc_state !== "deleted"
    && run.gc_state !== "deleting") result.push("duplicate", "compare");
  if (["stopped", "completed", "failed"].includes(run.status)
    && run.world_ref && run.source_snapshot_ref && !run.world_discarded_at
    && run.gc_state !== "deleting" && run.gc_state !== "deleted") {
    result.push(run.pinned_at ? "unpin" : "pin");
  }
  if (removable) result.push("remove");
  return result;
}

@Injectable()
export class SimulationService implements TransientExecutionRunCatalog {
  private readonly logger = new Logger(SimulationService.name);
  private readonly resourcePolicy: SimulationResourcePolicy;

  constructor(
    private readonly repository: SimulationRepository,
    @Inject(SIMULATION_WORLD_PORT) private readonly world: SimulationWorldPort,
    @Optional() @Inject(SIMULATION_RESOURCE_POLICY) resourcePolicy?: SimulationResourcePolicy,
  ) {
    this.resourcePolicy = resourcePolicy ?? DEFAULT_SIMULATION_RESOURCE_POLICY;
  }

  private now(): string {
    return new Date().toISOString();
  }

  private async assertAdmin(user: AuthUser, schoolId: string): Promise<void> {
    if (user.active_school_id !== schoolId
      || !(await this.repository.hasActiveAdminMembership(user.id, schoolId))) {
      throw new ForbiddenException("An active institution administrator membership is required.");
    }
  }

  private async view(run: PersistedSimulationRun, actorId: string): Promise<SimulationRunView> {
    const [metrics, draftChanges, behaviour] = await Promise.all([
      this.repository.metrics(run.id),
      this.repository.draftChanges(run.id),
      this.repository.behaviour(run.id),
    ]);
    const snapshot = run.source_snapshot_ref && run.source_snapshot_hash && run.source_snapshot_at
      ? {
          ref: run.source_snapshot_ref,
          hash: run.source_snapshot_hash,
          captured_at: run.source_snapshot_at,
          source_revisions: run.source_revisions,
        }
      : null;
    const world = run.world_ref && run.manifest_ref
      ? {
          ref: run.world_ref,
          revision: run.world_revision,
          manifest_ref: run.manifest_ref,
          limitations: run.limitations,
        }
      : null;
    const removable = ["stopped", "completed", "failed"].includes(run.status)
      && !run.pinned_at && !run.world_discarded_at && run.gc_state !== "deleting" && run.gc_state !== "deleted"
      && !run.lease_token && !run.pending_advance
      && !(await this.repository.hasActiveSessionReference(run.id, run.school_id, this.now()));
    return {
      id: run.id,
      revision: run.revision,
      scenario_id: run.scenario_id,
      namespace_id: run.namespace_id,
      kind: run.kind,
      name: run.name,
      status: run.status,
      created_at: run.created_at,
      updated_at: run.updated_at,
      started_at: run.started_at,
      paused_at: run.paused_at,
      stopped_at: run.stopped_at,
      completed_at: run.completed_at,
      failure_reason: run.failure_reason,
      created_by_me: run.created_by_user_id === actorId,
      speed: run.speed,
      clock: {
        virtual_now: run.virtual_now ?? run.source_snapshot_at ?? run.created_at,
        time_zone: run.time_zone,
        simulated_elapsed_ms: run.simulated_elapsed_ms,
        end_at: run.end_at,
        unbounded: run.end_at === null,
      },
      can_open: canOpen(run),
      available_actions: actions(run, removable),
      snapshot,
      world,
      progress: {
        event_count: run.event_count,
        checkpoint_count: run.checkpoint_count,
        last_checkpoint_at: run.last_checkpoint_at,
        next_wake_at: run.next_wake_at,
      },
      metrics,
      draft_changes: draftChanges,
      behaviour,
      retention: {
        pinned: run.pinned_at !== null,
        pinned_at: run.pinned_at,
        expires_at: run.retention_expires_at,
        policy_version: run.retention_policy_version,
        state: run.gc_state,
        world_discarded_at: run.world_discarded_at,
      },
      resources: {
        reservation_bytes: run.resource_reservation_bytes,
        observed_storage_bytes: run.observed_storage_bytes,
        measured_at: run.storage_measured_at,
        paused_at: run.resource_paused_at,
        pause_reason: run.resource_pause_reason,
        lease_recovery_count: run.lease_recovery_count,
      },
    };
  }

  private async response(run: PersistedSimulationRun, actorId: string): Promise<SimulationRunResponse> {
    return { schema_version: 1, run: await this.view(run, actorId) };
  }

  private async measureWorld(run: PersistedSimulationRun): Promise<{
    observed_storage_bytes: number;
    storage_measured_at: string | null;
  }> {
    if (!this.world.measure) return { observed_storage_bytes: 0, storage_measured_at: null };
    const usage = await this.world.measure(run);
    const observed = usage.exclusive_bytes + usage.shared_snapshot_bytes;
    if (!Number.isSafeInteger(usage.exclusive_bytes) || usage.exclusive_bytes < 0
      || !Number.isSafeInteger(usage.shared_snapshot_bytes) || usage.shared_snapshot_bytes < 0
      || !Number.isSafeInteger(observed)
      || !Number.isFinite(Date.parse(usage.measured_at))) {
      throw new ConflictException("The Simulation storage adapter returned invalid resource accounting.");
    }
    return {
      observed_storage_bytes: observed,
      storage_measured_at: new Date(usage.measured_at).toISOString(),
    };
  }

  async create(user: AuthUser, schoolId: string, body: unknown): Promise<SimulationRunResponse> {
    await this.assertAdmin(user, schoolId);
    const input = createSimulationRunSchema.parse(body);
    return this.createNewRun(user, schoolId, input);
  }

  private async createNewRun(
    user: AuthUser,
    schoolId: string,
    input: CreateSimulationRunInput,
  ): Promise<SimulationRunResponse> {
    const requestHash = digest({
      kind: input.kind,
      name: input.name ?? null,
      speed: input.speed,
      end_at: input.end_at ?? null,
    });
    const replay = await this.repository.findOwnedByIdempotency(
      schoolId, user.id, input.idempotency_key, requestHash,
    );
    if (replay) {
      if (replay.status === "preparing") {
        throw new ConflictException("This Simulation snapshot is already being prepared.");
      }
      return this.response(replay, user.id);
    }
    // Missing deployment dependencies must not consume capacity as failed runs.
    // Accepted exact-key retries above remain usable during a later tool outage.
    await this.world.assertCaptureReady?.();
    const now = this.now();
    const runId = randomUUID();
    const scenarioId = randomUUID();
    const namespaceId = `scenario:${scenarioId}:run:${runId}` as const;
    const request = {
      kind: input.kind,
      name: input.name ?? defaultRunName(input.kind, now),
      speed: input.speed,
      end_at: input.end_at ?? null,
      idempotency_key: input.idempotency_key,
    };
    const run = await this.repository.createPreparing({
      id: runId,
      scenario_id: scenarioId,
      namespace_id: namespaceId,
      school_id: schoolId,
      created_by_user_id: user.id,
      kind: request.kind,
      name: request.name,
      speed: request.speed,
      end_at: request.end_at,
      deterministic_seed: digest({ schoolId, scenarioId, runId, snapshot: "pending" }),
      idempotency_key: request.idempotency_key,
      request_hash: requestHash,
      now,
      resource_policy: this.resourcePolicy,
    });
    if (run.id !== runId) {
      if (run.status === "preparing") {
        throw new ConflictException("This Simulation snapshot is already being prepared.");
      }
      return this.response(run, user.id);
    }

    let capture: CaptureSimulationWorldResult | null = null;
    try {
      capture = await this.world.capture({ ...address(run), actor_id: user.id, requested_at: now });
      if (request.end_at !== null && Date.parse(request.end_at) <= Date.parse(capture.virtual_start_at)) {
        throw new BadRequestException("Simulation end must follow the captured virtual start time.");
      }
      const usage = await this.measureWorld(withCapture(run, capture));
      const captured = await this.repository.completeCapture({
        run_id: run.id,
        owner_id: user.id,
        capture,
        end_at: request.end_at,
        ...usage,
        now: this.now(),
      });
      return this.response(captured, user.id);
    } catch (error) {
      if (capture) await this.world.discard(withCapture(run, capture)).catch(() => undefined);
      const failedAt = this.now();
      await this.repository.failPreparing(
        run.id,
        user.id,
        failureReason(error),
        failedAt,
        terminalRetentionExpiry(failedAt, this.resourcePolicy),
      );
      throw error;
    }
  }

  async duplicate(
    user: AuthUser,
    schoolId: string,
    runIdValue: string,
    body: unknown,
  ): Promise<SimulationRunResponse> {
    await this.assertAdmin(user, schoolId);
    const sourceRunId = runIdSchema.parse(runIdValue);
    const input = duplicateSimulationRunSchema.parse(body);
    const source = await this.repository.requireOwned(sourceRunId, user.id, schoolId);
    if (!source.source_snapshot_ref || !source.source_snapshot_hash || !source.world_ref) {
      throw new ConflictException("Only a captured Simulation run can be duplicated.");
    }
    const sourceWorld = await this.world.open(source);
    if (!sourceWorld.can_open || sourceWorld.manifest_ref !== source.manifest_ref) {
      throw new ConflictException("The source Simulation world cannot be duplicated.");
    }
    const now = this.now();
    const runId = randomUUID();
    const scenarioId = randomUUID();
    const kind = input.kind ?? source.kind;
    const request: DuplicateSimulationRunInput & { source_run_id: string } = {
      ...input,
      kind,
      source_run_id: source.id,
    };
    const run = await this.repository.createPreparing({
      id: runId,
      scenario_id: scenarioId,
      namespace_id: `scenario:${scenarioId}:run:${runId}`,
      school_id: schoolId,
      created_by_user_id: user.id,
      kind,
      name: input.name ?? `${source.name} copy`,
      speed: input.speed ?? source.speed,
      end_at: Object.prototype.hasOwnProperty.call(input, "end_at") ? input.end_at ?? null : source.end_at,
      // A duplicate is a controlled branch of the same synthetic world. Keep
      // cohort draws stable so only explicit scenario changes create deltas.
      deterministic_seed: source.deterministic_seed,
      idempotency_key: input.idempotency_key,
      request_hash: digest(request),
      now,
      resource_policy: this.resourcePolicy,
    });
    if (run.id !== runId) {
      if (run.status === "preparing") throw new ConflictException("This duplicate is already being prepared.");
      return this.response(run, user.id);
    }

    let capture: CaptureSimulationWorldResult | null = null;
    try {
      capture = await this.world.fork({
        ...address(run),
        actor_id: user.id,
        requested_at: now,
        source_run: source,
      });
      if (capture.source_snapshot.hash !== source.source_snapshot_hash
        || capture.source_snapshot.ref !== source.source_snapshot_ref) {
        throw new ConflictException("A duplicated run must retain the exact source snapshot provenance.");
      }
      const endAt = Object.prototype.hasOwnProperty.call(input, "end_at") ? input.end_at ?? null : source.end_at;
      if (endAt !== null && Date.parse(endAt) <= Date.parse(capture.virtual_start_at)) {
        throw new BadRequestException("Simulation end must follow the duplicated virtual start time.");
      }
      const usage = await this.measureWorld(withCapture(run, capture));
      const captured = await this.repository.completeCapture({
        run_id: run.id,
        owner_id: user.id,
        capture,
        end_at: endAt,
        ...usage,
        now: this.now(),
      });
      return this.response(captured, user.id);
    } catch (error) {
      if (capture) await this.world.discard(withCapture(run, capture)).catch(() => undefined);
      const failedAt = this.now();
      await this.repository.failPreparing(
        run.id,
        user.id,
        failureReason(error),
        failedAt,
        terminalRetentionExpiry(failedAt, this.resourcePolicy),
      );
      throw error;
    }
  }

  async get(user: AuthUser, schoolId: string, runIdValue: string): Promise<SimulationRunResponse> {
    await this.assertAdmin(user, schoolId);
    const run = await this.repository.requireOwned(runIdSchema.parse(runIdValue), user.id, schoolId);
    return this.response(run, user.id);
  }

  async list(user: AuthUser, schoolId: string, query: unknown): Promise<SimulationRunListResponse> {
    await this.assertAdmin(user, schoolId);
    const { limit, view, page } = listSimulationRunsSchema.parse(query);
    if (view === "retained") {
      const result = await this.repository.listRetainedOwned(user.id, schoolId, page);
      return { schema_version: 1, results: await Promise.all(result.runs.map((run) => this.view(run, user.id))),
        page: result.page };
    }
    const runs = await this.repository.listOwned(user.id, schoolId, limit);
    return { schema_version: 1, results: await Promise.all(runs.map((run) => this.view(run, user.id))) };
  }

  async updateDraft(user: AuthUser, schoolId: string, runIdValue: string, body: unknown): Promise<SimulationRunResponse> {
    await this.assertAdmin(user, schoolId);
    const input = updateSimulationDraftSchema.parse(body);
    const run = await this.repository.updateDraft({
      run_id: runIdSchema.parse(runIdValue),
      owner_id: user.id,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.speed !== undefined ? { speed: input.speed } : {}),
      ...(Object.prototype.hasOwnProperty.call(input, "end_at") ? { end_at: input.end_at ?? null } : {}),
      now: this.now(),
    });
    return this.response(run, user.id);
  }

  async recordChange(user: AuthUser, schoolId: string, runIdValue: string, body: unknown): Promise<SimulationRunResponse> {
    await this.assertAdmin(user, schoolId);
    const runId = runIdSchema.parse(runIdValue);
    const change = recordSimulationDraftChangeSchema.parse(body);
    await this.repository.recordDraftChange({
      run_id: runId,
      school_id: schoolId,
      actor_id: user.id,
      change,
      now: this.now(),
    });
    return this.response(await this.repository.requireOwned(runId, user.id, schoolId), user.id);
  }

  /**
   * A domain command has already committed before this receipt is attempted.
   * Receipt persistence must therefore never turn a successful command into an
   * apparent failure. The run-local domain audit remains the reconciliation
   * source if all bounded control-plane retries fail.
   */
  async recordChangeBestEffort(
    user: AuthUser,
    schoolId: string,
    runIdValue: string,
    body: unknown,
  ): Promise<boolean> {
    let runId: string;
    let change: ReturnType<typeof recordSimulationDraftChangeSchema.parse>;
    try {
      await this.assertAdmin(user, schoolId);
      runId = runIdSchema.parse(runIdValue);
      change = recordSimulationDraftChangeSchema.parse(body);
    } catch {
      this.logger.warn(`Simulation draft receipt validation failed for run ${runIdValue}; domain audit retained.`);
      return false;
    }
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await this.repository.recordDraftChange({
          run_id: runId,
          school_id: schoolId,
          actor_id: user.id,
          change,
          now: this.now(),
        });
        return true;
      } catch {
        if (attempt === 3) {
          this.logger.warn(`Simulation draft receipt pending reconciliation for run ${runId}; domain audit retained.`);
        }
      }
    }
    return false;
  }

  async configureBehaviour(
    user: AuthUser,
    schoolId: string,
    runIdValue: string,
    body: unknown,
  ): Promise<SimulationRunResponse> {
    await this.assertAdmin(user, schoolId);
    const runId = runIdSchema.parse(runIdValue);
    const configuration = normalizeSimulationBehaviourConfiguration(
      configureSimulationBehaviourSchema.parse(body),
    );
    const run = await this.repository.requireOwned(runId, user.id, schoolId);
    if (run.status !== "draft") {
      throw new ConflictException("Simulation behaviour can be configured only before the run starts.");
    }
    if (!this.world.configureBehaviour) {
      throw new ConflictException("This deployment has no approved Simulation behaviour adapter.");
    }
    const receipt = await this.world.configureBehaviour({
      run,
      actor_id: user.id,
      configured_at: this.now(),
      configuration,
    });
    if (!/^[0-9a-f]{64}$/.test(receipt.configuration_hash)) {
      throw new ConflictException("The Simulation behaviour adapter returned invalid configuration provenance.");
    }
    await this.repository.recordBehaviour({
      run_id: run.id,
      school_id: schoolId,
      actor_id: user.id,
      configuration,
      receipt,
    });
    return this.response(await this.repository.requireOwned(run.id, user.id, schoolId), user.id);
  }

  async start(user: AuthUser, schoolId: string, runIdValue: string, body: unknown): Promise<SimulationRunResponse> {
    await this.assertAdmin(user, schoolId);
    const runId = runIdSchema.parse(runIdValue);
    const input = startSimulationRunSchema.parse(body);
    const current = await this.repository.requireOwned(runId, user.id, schoolId);
    if (!current.virtual_now) throw new ConflictException("The Simulation snapshot is not ready.");
    const opened = await this.world.open(current);
    if (!opened.can_open || opened.manifest_ref !== current.manifest_ref) {
      throw new ConflictException("The isolated Simulation world is not ready to start.");
    }
    const speed = input.speed ?? current.speed;
    const endAt = Object.prototype.hasOwnProperty.call(input, "end_at") ? input.end_at ?? null : current.end_at;
    const now = this.now();
    const nextWake = nextSimulationWakeAt({
      wall_now: now,
      virtual_now: current.virtual_now,
      virtual_started_at: current.virtual_started_at ?? current.virtual_now,
      speed,
      end_at: endAt,
      next_event_at: current.next_event_at,
    });
    if (!nextWake) throw new ConflictException("The Simulation has already reached its end.");
    const run = await this.repository.start({
      run_id: runId,
      owner_id: user.id,
      school_id: schoolId,
      ...(input.speed !== undefined ? { speed: input.speed } : {}),
      ...(Object.prototype.hasOwnProperty.call(input, "end_at") ? { end_at: input.end_at ?? null } : {}),
      next_wake_at: nextWake,
      now,
      resource_policy: this.resourcePolicy,
    });
    return this.response(run, user.id);
  }

  async pause(user: AuthUser, schoolId: string, runIdValue: string): Promise<SimulationRunResponse> {
    await this.assertAdmin(user, schoolId);
    const input = { run_id: runIdSchema.parse(runIdValue), owner_id: user.id, school_id: schoolId };
    const run = await this.repository.withControlBoundary(input,
      () => this.repository.pause({ ...input, now: this.now() }));
    return this.response(run, user.id);
  }

  async resume(user: AuthUser, schoolId: string, runIdValue: string, body: unknown): Promise<SimulationRunResponse> {
    await this.assertAdmin(user, schoolId);
    const runId = runIdSchema.parse(runIdValue);
    const input = resumeSimulationRunSchema.parse(body);
    const current = await this.repository.requireOwned(runId, user.id, schoolId);
    if (!current.virtual_now) throw new ConflictException("The Simulation clock is unavailable.");
    const opened = await this.world.open(current);
    if (!opened.can_open) throw new ConflictException("The isolated Simulation world cannot be resumed.");
    const speed = input.speed ?? current.speed;
    const now = this.now();
    const nextWake = nextSimulationWakeAt({
      wall_now: now,
      virtual_now: current.virtual_now,
      virtual_started_at: current.virtual_started_at ?? current.virtual_now,
      speed,
      end_at: current.end_at,
      next_event_at: current.next_event_at,
    });
    if (!nextWake) throw new ConflictException("The Simulation has already reached its end.");
    const run = await this.repository.resume({
      run_id: runId,
      owner_id: user.id,
      school_id: schoolId,
      speed: input.speed,
      next_wake_at: nextWake,
      now,
      resource_policy: this.resourcePolicy,
    });
    return this.response(run, user.id);
  }

  async stop(user: AuthUser, schoolId: string, runIdValue: string, body: unknown = {}): Promise<SimulationRunResponse> {
    await this.assertAdmin(user, schoolId);
    const input = stopSimulationRunSchema.parse(body);
    const stop = () => {
      const now = this.now();
      return this.repository.stop({
        run_id: runIdSchema.parse(runIdValue),
        school_id: schoolId,
        owner_id: user.id,
        now,
        retention_expires_at: terminalRetentionExpiry(now, this.resourcePolicy),
        ...(input.expected_revision === undefined ? {} : { draft_precondition: {
          expected_revision: input.expected_revision,
          expected_status: "draft" as const,
        } }),
      });
    };
    const run = input.expected_revision === undefined
      ? await this.repository.withControlBoundary({ run_id: runIdSchema.parse(runIdValue), owner_id: user.id, school_id: schoolId }, stop)
      : await stop();
    await this.world.stop(run).catch(() => undefined);
    return this.response(run, user.id);
  }

  async pin(user: AuthUser, schoolId: string, runIdValue: string): Promise<SimulationRunResponse> {
    await this.assertAdmin(user, schoolId);
    const run = await this.repository.pin({
      run_id: runIdSchema.parse(runIdValue),
      owner_id: user.id,
      school_id: schoolId,
      now: this.now(),
      resource_policy: this.resourcePolicy,
    });
    return this.response(run, user.id);
  }

  async unpin(user: AuthUser, schoolId: string, runIdValue: string): Promise<SimulationRunResponse> {
    await this.assertAdmin(user, schoolId);
    const now = this.now();
    const run = await this.repository.unpin({
      run_id: runIdSchema.parse(runIdValue),
      owner_id: user.id,
      school_id: schoolId,
      now,
      retention_expires_at: terminalRetentionExpiry(now, this.resourcePolicy),
    });
    return this.response(run, user.id);
  }

  async remove(user: AuthUser, schoolId: string, runIdValue: string, body: unknown): Promise<SimulationRunResponse> {
    await this.assertAdmin(user, schoolId);
    const input = removeSimulationRunSchema.parse(body);
    if (!this.world.garbageCollect) throw new ConflictException("Saved simulation removal is unavailable on this deployment.");
    const claimed = await this.repository.claimRequestedRemoval({
      run_id: runIdSchema.parse(runIdValue), school_id: schoolId, owner_id: user.id,
      expected_revision: input.expected_revision, lease_token: randomUUID(),
      lease_seconds: this.resourcePolicy.gc_lease_seconds,
    });
    if (claimed.lease) {
      try {
        await this.cleanupClaimedWorld(claimed.lease, "owner_requested");
      } catch {
        throw new ConflictException({ code: "simulation_removal_pending",
          message: "Removal has not finished. Retry removal to safely complete it; Live is unchanged." });
      }
    }
    return this.response(await this.repository.requireOwned(claimed.run.id, user.id, schoolId), user.id);
  }

  async compare(user: AuthUser, schoolId: string, body: unknown): Promise<SimulationComparisonResponse> {
    await this.assertAdmin(user, schoolId);
    const input: CompareSimulationRunsInput = compareSimulationRunsSchema.parse(body);
    const runs = await Promise.all(input.run_ids.map((runId) => this.repository.requireOwned(runId, user.id, schoolId)));
    if (runs.some((run) => !run.source_snapshot_hash || !run.source_snapshot_ref || !run.source_snapshot_at)) {
      throw new ConflictException("Every compared run must have a captured snapshot.");
    }
    const offsets = await this.repository.checkpointOffsets(input.run_ids);
    let duration: number;
    try {
      duration = greatestCommonCheckpointDuration(
        input.run_ids.map((runId) => offsets.get(runId) ?? []),
        input.duration_ms,
      );
    } catch (error) {
      throw new ConflictException(failureReason(error));
    }
    const metricSets = await Promise.all(runs.map((run) => this.repository.metrics(run.id, duration)));
    const keys = [...new Set(metricSets.flatMap((metrics) => metrics.map((item) => item.key)))].sort();
    const baselineMetrics = new Map(metricSets[0]?.map((item) => [item.key, item]) ?? []);
    const metrics = keys.map((key) => {
      const values = runs.map((run, index) => {
        const selected = metricSets[index]?.find((item) => item.key === key);
        return { run_id: run.id, value: selected?.value ?? null, measured_at: selected?.measured_at ?? run.source_snapshot_at! };
      });
      const first = baselineMetrics.get(key);
      return {
        key,
        label: first?.label ?? metricSets.flat().find((item) => item.key === key)?.label ?? null,
        unit: first?.unit ?? metricSets.flat().find((item) => item.key === key)?.unit ?? "count",
        values,
        deltas_from_first: values.slice(1).map((item) => ({ run_id: item.run_id, ...metricDelta(values[0]?.value ?? null, item.value) })),
      };
    });
    const hashes = new Set(runs.map((run) => run.source_snapshot_hash));
    const controlledSnapshot = hashes.size === 1;
    return {
      schema_version: 1,
      comparison: {
        duration_ms: duration,
        controlled_snapshot: controlledSnapshot,
        provenance_warning: controlledSnapshot
          ? null
          : "These runs began from different Live snapshots. Differences can reflect both scenario changes and changed source state.",
        runs: runs.map((run) => ({
          run_id: run.id,
          name: run.name,
          kind: run.kind,
          status: run.status,
          snapshot: {
            ref: run.source_snapshot_ref!,
            hash: run.source_snapshot_hash!,
            captured_at: run.source_snapshot_at!,
            source_revisions: run.source_revisions,
          },
          actual_duration_ms: duration,
        })),
        metrics,
      },
    };
  }

  /**
   * Claims and advances at most one due run. A deployment may call this from one
   * shared worker loop; no run owns a process or timer.
   */
  async advanceNextDueRun(workerId: string, wallNow = this.now()): Promise<PersistedSimulationRun | null> {
    const worker = z.string().trim().min(3).max(160).parse(workerId);
    const lease = await this.repository.claimDue(
      worker,
      randomUUID(),
      wallNow,
      this.resourcePolicy.worker_lease_seconds,
      this.resourcePolicy.max_leases_per_institution,
    );
    if (!lease) return null;
    const run = lease.run;
    // Repository claims stamp updated_at and lease_until from PostgreSQL's
    // clock. Use that authoritative claim instant for every wall-to-virtual
    // calculation; the caller-supplied wallNow is only a polling hint.
    const claimWallNow = run.updated_at;
    try {
      if (!run.virtual_now || !run.virtual_started_at || !run.world_ref
        || !run.wall_anchor_at || !run.virtual_anchor_at) {
        throw new Error("The claimed Simulation run has no prepared virtual world.");
      }
      // Keep the originally retained target across claims. Older builds could
      // commit a partial world checkpoint before recording its target here, so
      // reconcile an exact receipt from this base before calculating new time.
      const recovered = !run.pending_advance && this.world.recoverAdvance
        ? await this.world.recoverAdvance({ ...address(run), world_revision: run.world_revision, virtual_from: run.virtual_now })
        : null;
      const target = await this.repository.retainAdvanceTarget(lease,
        run.pending_advance?.virtual_to ?? recovered?.virtual_to ?? advanceTarget({ run, wall_now: claimWallNow }));
      const virtualTo = target.virtual_to;
      const elapsed = Date.parse(virtualTo) - Date.parse(run.virtual_started_at);
      if (elapsed <= run.simulated_elapsed_ms) throw new Error("The due run has no forward virtual-time step.");
      const result = await this.world.advance({
        ...address(run),
        world_ref: run.world_ref,
        world_revision: target.world_revision,
        checkpoint_ref: await this.repository.latestCheckpointRef(run.id),
        virtual_from: target.virtual_from,
        virtual_to: virtualTo,
        lease_token: lease.lease_token,
        lease_fence: lease.lease_fence,
        lease_until: lease.lease_until,
      });
      const completed = simulationReachedEnd(virtualTo, run.end_at);
      const nextWake = completed ? null : nextSimulationWakeAt({
        wall_now: claimWallNow,
        virtual_now: virtualTo,
        virtual_started_at: run.virtual_started_at,
        wall_anchor_at: run.wall_anchor_at,
        virtual_anchor_at: run.virtual_anchor_at,
        speed: run.speed,
        end_at: run.end_at,
        next_event_at: result.next_event_at,
      });
      const metrics: SimulationMetricValue[] = result.metrics.map((item) => ({
        ...item,
        measured_at: virtualTo,
        simulated_elapsed_ms: elapsed,
      }));
      const usage = await this.measureWorld({
        ...run,
        virtual_now: virtualTo,
        world_revision: result.world_revision,
      });
      const advanced = await this.repository.completeAdvance({
        lease,
        checkpoint: {
          virtual_from: run.virtual_now,
          virtual_to: virtualTo,
          simulated_elapsed_ms: elapsed,
          world_checkpoint_ref: result.checkpoint_ref,
          world_revision: result.world_revision,
          emitted_event_count: result.emitted_event_count,
          lease_fence: lease.lease_fence,
          lease_token: lease.lease_token,
          next_event_at: result.next_event_at,
          metrics,
        },
        next_wake_at: nextWake,
        completed,
        ...usage,
        max_storage_bytes_per_institution: this.resourcePolicy.max_storage_bytes_per_institution,
        retention_expires_at: terminalRetentionExpiry(claimWallNow, this.resourcePolicy),
        now: claimWallNow,
      });
      if (completed) await this.world.stop(advanced).catch(() => undefined);
      return advanced;
    } catch (error) {
      if (isWorldSnapshotCompatibilityError(error)) {
        return this.repository.pauseAdvanceForResource({
          lease,
          reason: `Snapshot compatibility blocked this run: ${failureReason(error)}`,
          now: claimWallNow,
        });
      }
      if (isWorldResourceBudgetError(error)) {
        const usage = await this.measureWorld(run).catch(() => null);
        if (usage?.storage_measured_at) {
          await this.repository.recordStorageMeasurement({
            run_id: run.id,
            observed_storage_bytes: usage.observed_storage_bytes,
            measured_at: usage.storage_measured_at,
          }).catch(() => undefined);
        }
        return this.repository.pauseAdvanceForResource({
          lease,
          reason: failureReason(error),
          now: claimWallNow,
        });
      }
      const backoffSeconds = Math.min(300, 2 ** Math.min(run.failure_count, 8));
      const retryAt = new Date(Date.parse(claimWallNow) + backoffSeconds * 1_000).toISOString();
      return this.repository.failAdvance({
        lease,
        reason: failureReason(error),
        retry_at: retryAt,
        now: claimWallNow,
        max_failures: MAX_ADVANCE_FAILURES,
        retention_expires_at: terminalRetentionExpiry(claimWallNow, this.resourcePolicy),
      });
    }
  }

  async pauseNextRunOverBudget(wallNow = this.now()): Promise<PersistedSimulationRun | null> {
    return this.repository.pauseNextRunOverBudget(wallNow, this.resourcePolicy);
  }

  async failNextStalePreparation(): Promise<PersistedSimulationRun | null> {
    return this.repository.failNextStalePreparing(this.resourcePolicy);
  }

  async collectNextExpiredWorld(workerId: string, wallNow = this.now()): Promise<boolean> {
    if (!this.resourcePolicy.gc_enabled || !this.world.garbageCollect) return false;
    const worker = z.string().trim().min(3).max(160).parse(workerId);
    const lease = await this.repository.claimGarbageCollection({
      worker_id: worker,
      lease_token: randomUUID(),
      now: wallNow,
      lease_seconds: this.resourcePolicy.gc_lease_seconds,
    });
    if (!lease) return false;
    try {
      await this.cleanupClaimedWorld(lease);
    } catch {
      // The failed fenced attempt is retained by the shared cleanup owner.
    }
    return true;
  }

  private async cleanupClaimedWorld(
    lease: SimulationGarbageCollectionLease,
    reason?: "owner_requested",
  ): Promise<void> {
    if (!this.world.garbageCollect) throw new ConflictException("Saved simulation removal is unavailable on this deployment.");
    const claimWallNow = lease.run.updated_at;
    try {
      if (await this.repository.hasActiveSessionReference(lease.run.id, lease.run.school_id, claimWallNow)) {
        if (reason) throw new ConflictException("Return to Live before removing this simulation.");
        await this.repository.deferGarbageCollection({
          lease,
          reason: "session_reference_active",
          retry_at: new Date(Date.parse(claimWallNow) + this.resourcePolicy.gc_interval_ms).toISOString(),
          now: claimWallNow,
        });
        return;
      }
      const result = await this.world.garbageCollect({
        run: lease.run,
        gc_token: lease.lease_token,
        gc_fence: lease.lease_fence,
        requested_at: claimWallNow,
      });
      if (!result.receipt_ref.trim()
        || !Number.isSafeInteger(result.released_bytes)
        || result.released_bytes < 0) {
        throw new Error("The Simulation storage adapter returned an invalid cleanup receipt.");
      }
      await this.repository.completeGarbageCollection({
        lease,
        adapter_receipt_ref: result.receipt_ref,
        released_bytes: result.released_bytes,
        retained_shared_snapshot: result.retained_shared_snapshot,
        now: claimWallNow,
        ...(reason ? { reason } : {}),
      });
    } catch (error) {
      const backoffSeconds = Math.min(3_600, 2 ** Math.min(lease.run.gc_failure_count + 1, 11));
      await this.repository.failGarbageCollection({
        lease,
        reason: failureReason(error),
        retry_at: new Date(Date.parse(claimWallNow) + backoffSeconds * 1_000).toISOString(),
        now: claimWallNow,
        ...(reason ? { reason_code: reason } : {}),
      });
      throw error;
    }
  }

  async resolveAuthorizedRun(input: {
    actor_id: string;
    institution_id: string;
    run_id: string;
  }): Promise<TransientExecutionRunReference | null> {
    if (!(await this.repository.hasActiveAdminMembership(input.actor_id, input.institution_id))) {
      throw new ForbiddenException("An active institution administrator membership is required.");
    }
    const run = await this.repository.getOwned(input.run_id, input.actor_id, input.institution_id);
    if (!run || !isOpenStatus(run.status) || !canOpen(run)
      || !run.virtual_now || !run.source_snapshot_at || !run.source_snapshot_ref) return null;
    const opened = await this.world.open(run);
    if (!opened.can_open || opened.manifest_ref !== run.manifest_ref) return null;
    return {
      institution_id: run.school_id,
      scenario_id: run.scenario_id,
      run_id: run.id,
      namespace_id: run.namespace_id,
      virtual_now: run.virtual_now,
      time_zone: run.time_zone,
      source_snapshot_at: run.source_snapshot_at,
      source_snapshot_ref: run.source_snapshot_ref,
      expires_at: run.retention_expires_at ?? COMPATIBILITY_NO_EXPIRY,
      run_status: run.status,
      speed: run.speed,
      world_revision: run.world_revision,
    };
  }
}
