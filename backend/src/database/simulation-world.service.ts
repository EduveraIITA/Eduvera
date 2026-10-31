import { ConflictException, Injectable, Optional, Inject, ServiceUnavailableException, type OnApplicationShutdown } from "@nestjs/common";
import { createHash } from "node:crypto";
import { CompiledQuery } from "kysely";
import { Pool } from "pg";
import { config } from "../config.js";
import { createSimulationExecutionEnvironment } from "../campus-model-core/execution-environment.runtime.js";
import type { SimulationExecutionEnvironment } from "../campus-model-core/execution-environment.contracts.js";
import { EXECUTION_EFFECT_KINDS } from "../campus-model-core/execution-effects.contracts.js";
import { ExecutionEffectRouter } from "../campus-model-core/execution-effects.runtime.js";
import { bindSimulationResources, unbindSimulationResources } from "../common/simulation-resources.js";
import type { PersistedSimulationRun } from "../simulation/simulation.contracts.js";
import { SIMULATION_WORLD_METRIC_CATALOGUE as metrics } from "../simulation/simulation-metrics.js";
import type { AdvanceSimulationWorldInput, AdvanceSimulationWorldResult, CaptureSimulationWorldInput, CaptureSimulationWorldResult, ConfigureSimulationWorldBehaviourInput, ConfigureSimulationWorldBehaviourResult, ForkSimulationWorldInput, OpenSimulationWorldResult, RecoverSimulationWorldAdvanceInput, SimulationWorldPort } from "../simulation/simulation-world.port.js";
import { ExecutionDataPlaneRegistry, ExecutionDataPlaneScope, REQUIRED_APPLICATION_SIMULATION_MODULES, type SimulationApplicationCoverageManifest } from "./execution-data-plane.js";
import { SimulationSnapshotStore } from "./simulation-snapshot-store.js";
import { SimulationBranchDriver, createSimulationBranch, type SimulationBranch } from "./simulation-branch.driver.js";
import { quoteSimulationIdentifier as identifier } from "./simulation-sql.js";
import { postgresClientConnectionConfig } from "./connection-policy.js";
import { initializeSimulationResources, SimulationResourceStore } from "./simulation-resources.store.js";
import { garbageCollectSimulationWorld, measureSimulationWorld } from "./simulation-world-lifecycle.js";
import type { GarbageCollectSimulationWorldInput } from "../simulation/simulation-world.port.js";
import {
  SimulationSnapshotCompatibilityError,
  assertSimulationSnapshotCompatibility,
  type SimulationSnapshotCompatibilityManifest,
} from "../simulation/simulation-runtime-compatibility.js";
import { assertCurrentSimulationPlatformConformance, currentSimulationPlatformConformance } from "../simulation-conformance/index.js";
import { SimulationCaptureDependencyError } from "./simulation-pg-dump.js";

export const SIMULATION_DOMAIN_RUNTIME = Symbol.for("thatcampus.simulation-domain-runtime");
export interface SimulationDomainRuntime {
  advance(input: AdvanceSimulationWorldInput, environment: SimulationExecutionEnvironment): Promise<void>;
}
const indefiniteRetention = "9999-12-31T23:59:59.999Z";

export function simulationRequestEnvironment(input: {
  institution_id: string; scenario_id: string; run_id: string; virtual_now: string;
  source_snapshot_ref: string; manifest_ref: string; checked_at: string;
  retention_expires_at?: string | null;
}): SimulationExecutionEnvironment {
  const now = new Date(input.virtual_now).toISOString();
  return createSimulationExecutionEnvironment({ institution_id: input.institution_id, scenario_id: input.scenario_id,
    run_id: input.run_id, source_snapshot_ref: input.source_snapshot_ref,
    coverage_gate: { status: "passed", manifest_ref: input.manifest_ref, checked_at: input.checked_at },
    virtual_clock: { now: () => new Date(now), nowIso: () => now,
      advanceBy: () => { throw new Error("Only the durable Simulation worker may advance virtual time."); },
      advanceTo: () => { throw new Error("Only the durable Simulation worker may advance virtual time."); } },
    expires_at: input.retention_expires_at ?? indefiniteRetention });
}

/** Infrastructure adapter for the existing Model Core execution environment. */
@Injectable()
export class SimulationWorldService implements SimulationWorldPort, OnApplicationShutdown {
  private store: SimulationSnapshotStore | null = null;
  private lockPool: Pool | null = null;
  private readonly openings = new Map<string, Promise<OpenSimulationWorldResult>>();
  private resourcesInitialized: Promise<void> | null = null;
  constructor(private readonly registry: ExecutionDataPlaneRegistry, private readonly scope: ExecutionDataPlaneScope,
    @Optional() @Inject(SIMULATION_DOMAIN_RUNTIME) private readonly runtime?: SimulationDomainRuntime) {}

  private storage(): SimulationSnapshotStore {
    if (this.store) return this.store;
    const settings = config();
    if (!settings.CAMPUS_SIMULATION_DATABASE_URL) throw new ConflictException("Simulation storage is not configured for this deployment.");
    this.store = new SimulationSnapshotStore(settings.DATABASE_URL, settings.CAMPUS_SIMULATION_DATABASE_URL,
      Math.min(settings.DATABASE_POOL_MAX, 10), settings.SIMULATION_PG_DUMP_PATH);
    return this.store;
  }

  async assertCaptureReady(): Promise<void> {
    try {
      await this.storage().assertCaptureReady();
    } catch (error) {
      if (!(error instanceof SimulationCaptureDependencyError)) throw error;
      throw new ServiceUnavailableException({ statusCode: 503, error: "Service Unavailable",
        code: "simulation_capture_unavailable", message: error.message });
    }
  }

  /**
   * Advance locks use a dedicated pool because the domain runtime deliberately
   * acquires branch connections while the cross-process advisory lock is held.
   * Keeping those connections separate prevents pool starvation and deadlock.
   */
  private locks(): Pool {
    if (this.lockPool) return this.lockPool;
    const settings = config();
    if (!settings.CAMPUS_SIMULATION_DATABASE_URL) {
      throw new ConflictException("Simulation storage is not configured for this deployment.");
    }
    this.lockPool = new Pool({
      ...postgresClientConnectionConfig(settings.CAMPUS_SIMULATION_DATABASE_URL, {
        name: "CAMPUS_SIMULATION_DATABASE_URL",
        purpose: "simulation",
        requireRemoteTls: false,
      }),
      max: 4,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      application_name: "thatcampus_simulation_advance_locks",
    });
    return this.lockPool;
  }

  private async withAdvanceLock<T>(runId: string, operation: () => Promise<T>): Promise<T> {
    const client = await this.locks().connect();
    let locked = false;
    try {
      await client.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [`simulation-advance:${runId}`]);
      locked = true;
      return await operation();
    } finally {
      let destroy = false;
      if (locked) {
        await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [`simulation-advance:${runId}`])
          .catch(() => { destroy = true; });
      }
      client.release(destroy);
    }
  }

  private async branch(runId: string, schoolId: string): Promise<SimulationBranch> {
    const storage = this.storage();
    await storage.initialize();
    const row = (await storage.pool.query<SimulationBranch>("SELECT * FROM dt_simulation.worlds WHERE run_id=$1 AND school_id=$2", [runId, schoolId])).rows[0];
    if (!row) throw new ConflictException("The isolated campus for this Simulation is unavailable.");
    return { ...row, virtual_now: new Date(row.virtual_now).toISOString(), revision: Number(row.revision) };
  }

  private compatibleSnapshot(snapshot: Awaited<ReturnType<SimulationSnapshotStore["getSnapshot"]>>): SimulationSnapshotCompatibilityManifest {
    try {
      return assertSimulationSnapshotCompatibility({
        manifest: snapshot.compatibility_manifest,
        hash: snapshot.compatibility_hash,
        identity: { template_schema: snapshot.template_schema, catalogue: snapshot.catalogue },
      });
    } catch (error) {
      if (!(error instanceof SimulationSnapshotCompatibilityError)) throw error;
      throw new ConflictException({
        statusCode: 409,
        error: "Conflict",
        code: error.code,
        message: error.message,
        incompatibilities: error.incompatibilities,
        recovery: "Capture a fresh Simulation run, or apply a reviewed target-only snapshot upgrade before reopening this run.",
      });
    }
  }

  private async register(branch: SimulationBranch, virtualNow: string, retentionExpiresAt?: string | null): Promise<OpenSimulationWorldResult> {
    const conformance = assertCurrentSimulationPlatformConformance();
    const storage = this.storage();
    const snapshot = await storage.getSnapshot(branch.snapshot_id);
    const capturedCompatibility = this.compatibleSnapshot(snapshot);
    this.resourcesInitialized ??= initializeSimulationResources(storage.pool).catch((error: unknown) => {
      this.resourcesInitialized = null;
      throw error;
    });
    await this.resourcesInitialized;
    const manifestRef = `${capturedCompatibility.conformance_manifest_version}:${capturedCompatibility.conformance_fingerprint}:${snapshot.compatibility_hash}:${branch.run_id}:${snapshot.content_hash}`;
    const checkedAt = snapshot.captured_at;
    const environment = simulationRequestEnvironment({ institution_id: branch.school_id, scenario_id: branch.scenario_id,
      run_id: branch.run_id, virtual_now: virtualNow, source_snapshot_ref: `sha256:${snapshot.content_hash}`,
      manifest_ref: manifestRef, checked_at: checkedAt,
      ...(retentionExpiresAt !== undefined ? { retention_expires_at: retentionExpiresAt } : {}) });
    const existing = this.registry.descriptor({ institutionId: branch.school_id, runId: branch.run_id, namespaceId: environment.namespace_id });
    if (existing?.status === "ready") {
      // Capture/worker callers do not own retention transitions. Only a durable
      // run supplied by open/configure/stop may reconcile its current lifetime.
      if (retentionExpiresAt !== undefined) this.registry.reconcileRetention(environment);
      return { manifest_ref: manifestRef, checked_at: checkedAt, can_open: true, limitations: this.limitations() };
    }
    const enabledModules = conformance.modules.filter(module => module.disposition === 'campus_operational').map(module => module.module_id);
    const coverage: SimulationApplicationCoverageManifest = {
      manifest_ref: manifestRef, checked_at: checkedAt, enabled_modules: enabledModules,
      // These are implemented data-plane operations, not assertions that every
      // product workflow has been exhaustively validated. The independent
      // conformance receipt preserves capability-specific evidence and gaps.
      modules: [...new Set([...REQUIRED_APPLICATION_SIMULATION_MODULES, ...enabledModules])].map((module_id) => ({ module_id,
        capabilities: { snapshot: "supported", queries: "supported", commands: "supported", events: "supported", realtime: "supported" } })),
      storage_mode: "isolated_copy_on_write", event_outbox_mode: "isolated", operational_message_mode: "sink_only",
      file_storage_mode: "isolated", external_connector_mode: "sink_only", realtime_mode: "isolated", uncovered_effects: [],
    };
    const effectRouter = new ExecutionEffectRouter();
    const resources = new SimulationResourceStore(storage.pool, environment);
    const effectCoverage = effectRouter.bindSimulationSinks({ environment,
      sinks: EXECUTION_EFFECT_KINDS.map((kind) => resources.sink(kind)) });
    await this.registry.prepare({ environment, coverage, effectCoverage,
      driver: new SimulationBranchDriver(storage.pool, branch, snapshot) });
    bindSimulationResources({ environment, effects: effectRouter, artifacts: resources, effectReplay: resources });
    return { manifest_ref: manifestRef, checked_at: checkedAt, can_open: true, limitations: this.limitations() };
  }

  private limitations(): readonly string[] {
    return [
      "Synthetic responses require an administrator-approved, versioned cohort policy; an unconfigured counterpart remains passive.",
      "External effects are captured only inside this run. They never send messages, transfer money, contact devices or prove physical events.",
      "Source file contents and restricted evidence are not copied. Clearly labelled placeholders and new run-local files are used instead.",
    ];
  }

  async capture(input: CaptureSimulationWorldInput): Promise<CaptureSimulationWorldResult> {
    const storage = this.storage();
    const snapshot = await storage.capture(input.institution_id, input.requested_at, input.run_id);
    const branch = await createSimulationBranch(storage.pool, snapshot, { run_id: input.run_id,
      school_id: input.institution_id, scenario_id: input.scenario_id, namespace_id: input.namespace_id });
    const opened = await this.register(branch, snapshot.captured_at);
    return { world_ref: `simulation-world:${input.run_id}`, world_revision: 1, manifest_ref: opened.manifest_ref,
      manifest_checked_at: opened.checked_at, time_zone: snapshot.time_zone, virtual_start_at: snapshot.captured_at,
      source_snapshot: { ref: `sha256:${snapshot.content_hash}`, hash: snapshot.content_hash, captured_at: snapshot.captured_at,
        source_revisions: Object.fromEntries(Object.entries(snapshot.counts).map(([table, count]) => [table, `snapshot:${count}`])) },
      limitations: opened.limitations };
  }

  async open(run: PersistedSimulationRun): Promise<OpenSimulationWorldResult> {
    const pending = this.openings.get(run.id);
    if (pending) return pending;
    const opening = (async () => {
      // A failed/older stop may have committed its control state before sealing
      // the separate store. Complete that bounded privacy seal before any
      // terminal session is allowed to expose campus reads.
      if (["stopped", "completed"].includes(run.status)) await this.stop(run);
      const branch = await this.branch(run.id, run.school_id);
      if (branch.scenario_id !== run.scenario_id || branch.namespace_id !== run.namespace_id) {
        throw new ConflictException("Simulation world identity mismatch.");
      }
      return this.register(branch, run.virtual_now ?? run.source_snapshot_at!, run.retention_expires_at);
    })()
      .finally(() => this.openings.delete(run.id));
    this.openings.set(run.id, opening);
    return opening;
  }

  async fork(input: ForkSimulationWorldInput): Promise<CaptureSimulationWorldResult> {
    const storage = this.storage();
    const source = await this.branch(input.source_run.id, input.institution_id);
    const snapshot = await storage.getSnapshot(source.snapshot_id);
    this.compatibleSnapshot(snapshot);
    const branch = await createSimulationBranch(storage.pool, snapshot, { run_id: input.run_id,
      school_id: input.institution_id, scenario_id: input.scenario_id, namespace_id: input.namespace_id });
    const opened = await this.register(branch, snapshot.captured_at);
    return { world_ref: `simulation-world:${input.run_id}`, world_revision: 1, manifest_ref: opened.manifest_ref,
      manifest_checked_at: opened.checked_at, time_zone: snapshot.time_zone, virtual_start_at: snapshot.captured_at,
      source_snapshot: { ref: input.source_run.source_snapshot_ref!, hash: input.source_run.source_snapshot_hash!,
        captured_at: input.source_run.source_snapshot_at!, source_revisions: input.source_run.source_revisions },
      limitations: opened.limitations };
  }

  async configureBehaviour(input: ConfigureSimulationWorldBehaviourInput): Promise<ConfigureSimulationWorldBehaviourResult> {
    const branch = await this.branch(input.run.id, input.run.school_id);
    const snapshot = await this.storage().getSnapshot(branch.snapshot_id);
    const opened = await this.register(branch, input.run.virtual_now!, input.run.retention_expires_at);
    const environment = simulationRequestEnvironment({ institution_id: input.run.school_id, scenario_id: input.run.scenario_id,
      run_id: input.run.id, virtual_now: input.run.virtual_now!, source_snapshot_ref: input.run.source_snapshot_ref!,
      manifest_ref: opened.manifest_ref, checked_at: opened.checked_at });
    return this.scope.run(environment, async () => {
      const driver = this.registry.driverFor(environment);
      const connection = await driver.acquireConnection();
      try {
        await driver.beginTransaction(connection, {});
        const actor = (await connection.executeQuery<{ id: string }>(CompiledQuery.raw(`SELECT agent.id FROM campus_model_agents agent
          JOIN campus_model_agent_endpoints endpoint ON endpoint.agent_id=agent.id AND endpoint.school_id=agent.school_id
          WHERE agent.school_id=$1 AND agent.agent_kind='human' AND agent.status='active' AND endpoint.user_id=$2
            AND endpoint.endpoint_kind='account' AND endpoint.provider='thatcampus' AND endpoint.status='active'
          ORDER BY endpoint.effective_from DESC LIMIT 1`, [input.run.school_id, input.actor_id]))).rows[0];
        if (!actor) throw new ConflictException("The administrator has no captured Digital Twin identity for approving this policy.");
        await connection.executeQuery(CompiledQuery.raw("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`simulation-behaviour:${input.run.id}`]));
        const configurationHash = createHash("sha256").update(JSON.stringify(input.configuration)).digest("hex");
        const prior = (await connection.executeQuery<{ id: string; version: number; configuration: unknown }>(CompiledQuery.raw(`SELECT id,version,configuration FROM campus_model_behaviour_versions
          WHERE school_id=$1 AND behaviour_key='simulation_campus_activity' ORDER BY version DESC LIMIT 1`, [input.run.school_id]))).rows[0];
        if (prior && JSON.stringify(prior.configuration) === JSON.stringify(input.configuration)) {
          await driver.commitTransaction(connection);
          return { version_ref: prior.id, configuration_hash: configurationHash, approved_by_agent_id: actor.id, configured_at: input.configured_at };
        }
        await connection.executeQuery(CompiledQuery.raw(`UPDATE campus_model_behaviour_versions SET status='retired',retired_at=$2
          WHERE school_id=$1 AND behaviour_key='simulation_campus_activity' AND status='approved'`, [input.run.school_id, input.run.virtual_now]));
        const version = (prior?.version ?? 0) + 1;
        const saved = (await connection.executeQuery<{ id: string }>(CompiledQuery.raw(`INSERT INTO campus_model_behaviour_versions(
          school_id,behaviour_key,version,status,effective_from,effective_until,configuration,configuration_schema_version,
          created_by_agent_id,approved_by_agent_id,approved_at) VALUES($1,'simulation_campus_activity',$2,'approved',$3,NULL,$4,$7,$5,$5,$6) RETURNING id`,
        [input.run.school_id, version, snapshot.captured_at, JSON.stringify(input.configuration), actor.id, input.configured_at, input.configuration.schema_version]))).rows[0]!;
        await driver.commitTransaction(connection);
        return { version_ref: saved.id, configuration_hash: configurationHash, approved_by_agent_id: actor.id, configured_at: input.configured_at };
      } catch (error) { await driver.rollbackTransaction(connection); throw error; }
      finally { await driver.releaseConnection(connection); }
    });
  }

  async recoverAdvance(input: RecoverSimulationWorldAdvanceInput) {
    return this.withAdvanceLock(input.run_id, async () => {
      const branch = await this.branch(input.run_id, input.institution_id);
      if (branch.namespace_id !== input.namespace_id || branch.scenario_id !== input.scenario_id) throw new ConflictException("Simulation world identity mismatch.");
      const receipts = (await this.storage().pool.query<{ virtual_to: Date | string; result: AdvanceSimulationWorldResult }>(
        `SELECT checkpoint.virtual_to,checkpoint.result FROM dt_simulation.checkpoints checkpoint
          JOIN dt_simulation.worlds world ON world.run_id=checkpoint.run_id
          WHERE checkpoint.run_id=$1 AND world.school_id=$2 AND checkpoint.virtual_from=$3::timestamptz
            AND (checkpoint.result->>'world_revision')::bigint=$4
            AND world.revision=$4 AND world.virtual_now=checkpoint.virtual_to
            AND world.last_checkpoint_ref=checkpoint.checkpoint_ref LIMIT 2`,
        [input.run_id, input.institution_id, input.virtual_from, input.world_revision + 1])).rows;
      if (receipts.length > 1) throw new ConflictException("The Simulation checkpoint recovery receipt is ambiguous.");
      const receipt = receipts[0];
      return receipt ? { virtual_to: new Date(receipt.virtual_to).toISOString(), result: receipt.result } : null;
    });
  }

  async advance(input: AdvanceSimulationWorldInput): Promise<AdvanceSimulationWorldResult> {
    const assertLeaseCurrent = () => {
      if (!Number.isFinite(Date.parse(input.lease_until)) || Date.parse(input.lease_until) <= Date.now()) {
        throw new ConflictException("This Simulation worker lease expired; a fresh fenced claim must retry the checkpoint.");
      }
    };
    assertLeaseCurrent();
    const virtualFrom = Date.parse(input.virtual_from);
    const virtualTo = Date.parse(input.virtual_to);
    if (!Number.isFinite(virtualFrom) || !Number.isFinite(virtualTo) || virtualTo <= virtualFrom) {
      throw new ConflictException("Simulation time must move forward between valid instants.");
    }
    if (!Number.isSafeInteger(input.lease_fence) || input.lease_fence <= 0
      || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(input.lease_token)) {
      throw new ConflictException("Simulation advance requires a valid durable lease fence.");
    }
    const checkpointRef = createHash("sha256").update(`${input.run_id}:${input.virtual_from}:${input.virtual_to}`).digest("hex");
    return this.withAdvanceLock(input.run_id, async () => {
      assertLeaseCurrent();
      const storage = this.storage();
      await storage.initialize();
      const branch = await this.branch(input.run_id, input.institution_id);
      if (branch.namespace_id !== input.namespace_id || branch.scenario_id !== input.scenario_id) {
        throw new ConflictException("Simulation world identity mismatch.");
      }
      const replay = (await storage.pool.query<{ result: AdvanceSimulationWorldResult }>(
        "SELECT result FROM dt_simulation.checkpoints WHERE run_id=$1 AND checkpoint_ref=$2",
        [input.run_id, checkpointRef],
      )).rows[0];
      if (replay) return replay.result;
      const world = (await storage.pool.query<{
        virtual_now: Date | string;
        revision: number | string;
        last_lease_fence: number | string;
        last_lease_token: string | null;
      }>(`SELECT virtual_now,revision,last_lease_fence,last_lease_token
          FROM dt_simulation.worlds WHERE run_id=$1 AND school_id=$2`,
      [input.run_id, input.institution_id])).rows[0];
      if (!world || new Date(world.virtual_now).getTime() !== virtualFrom
        || Number(world.revision) !== input.world_revision) {
        throw new ConflictException("The Simulation world no longer matches this checkpoint base.");
      }
      const priorFence = Number(world.last_lease_fence);
      if (input.lease_fence < priorFence
        || (input.lease_fence === priorFence && world.last_lease_token !== input.lease_token)) {
        throw new ConflictException("A newer Simulation worker fence owns this world.");
      }
      const snapshot = await storage.getSnapshot(branch.snapshot_id);
      this.compatibleSnapshot(snapshot);
      const claimed = await storage.pool.query(`UPDATE dt_simulation.worlds
        SET last_lease_fence=$2,last_lease_token=$3
        WHERE run_id=$1 AND (last_lease_fence<$2
          OR (last_lease_fence=$2 AND last_lease_token=$3))`,
      [input.run_id, input.lease_fence, input.lease_token]);
      if (claimed.rowCount !== 1) throw new ConflictException("The Simulation world rejected this worker fence.");

      const opened = await this.register(branch, input.virtual_to);
      const environment = simulationRequestEnvironment({ institution_id: input.institution_id, scenario_id: input.scenario_id,
        run_id: input.run_id, virtual_now: input.virtual_to, source_snapshot_ref: `sha256:${snapshot.content_hash}`,
        manifest_ref: opened.manifest_ref, checked_at: opened.checked_at });
      assertLeaseCurrent();
      await this.scope.run(environment, async () => { await this.runtime?.advance(input, environment); });
      assertLeaseCurrent();

      const client = await storage.pool.connect();
      try {
        await client.query("BEGIN");
        // Raw metric reads bypass the branch driver, so they join the same
        // run-scoped COW lock protocol explicitly. A shared lock allows other
        // readers while excluding view-to-table swaps for the whole read set.
        await client.query(
          "SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))",
          [`cow:${input.run_id}`],
        );
        const current = (await client.query<{ result: AdvanceSimulationWorldResult }>(
          "SELECT result FROM dt_simulation.checkpoints WHERE run_id=$1 AND checkpoint_ref=$2",
          [input.run_id, checkpointRef],
        )).rows[0];
        if (current) { await client.query("COMMIT"); return current.result; }
        const fenced = (await client.query<{ last_lease_fence: number | string; last_lease_token: string | null }>(
          "SELECT last_lease_fence,last_lease_token FROM dt_simulation.worlds WHERE run_id=$1 FOR UPDATE",
          [input.run_id],
        )).rows[0];
        if (!fenced || Number(fenced.last_lease_fence) !== input.lease_fence
          || fenced.last_lease_token !== input.lease_token) {
          throw new ConflictException("The Simulation world fence changed before checkpoint commit.");
        }
        const schema = identifier(branch.schema_name);
        const counts = (await client.query<{
          step_events: string;
          model_events: string;
          open_work: string;
          submitted: string;
          finalized: string;
          learners: string;
        }>(`SELECT
          (SELECT count(*) FROM ${schema}.campus_model_events
            WHERE event_at>$1::timestamptz AND event_at<=$2::timestamptz) AS step_events,
          (SELECT count(*) FROM ${schema}.campus_model_events
            WHERE event_at>$3::timestamptz AND event_at<=$2::timestamptz) AS model_events,
          (SELECT count(*) FROM ${schema}.campus_model_operational_messages
            WHERE state IN ('queued','delivered','acknowledged')) AS open_work,
          ((SELECT count(*) FROM ${schema}.attendance_registers legacy
              WHERE state IN ('submitted','locked')
                AND submitted_at>$3::timestamptz AND submitted_at<=$2::timestamptz
                AND NOT EXISTS(SELECT 1 FROM ${schema}.activity_attendance_source_contexts migrated
                  WHERE migrated.school_id=legacy.school_id AND migrated.source_kind='daily_class' AND migrated.state='active'
                    AND migrated.source_id=concat(legacy.class_section_id,':',legacy.term_id,':',legacy.date)))
            +(SELECT count(*) FROM ${schema}.attendance_session_registers legacy
              WHERE state IN ('submitted','locked')
                AND submitted_at>$3::timestamptz AND submitted_at<=$2::timestamptz
                AND NOT EXISTS(SELECT 1 FROM ${schema}.activity_attendance_source_contexts migrated
                  WHERE migrated.school_id=legacy.school_id AND migrated.source_kind='scheduled_session'
                    AND migrated.state='active' AND migrated.source_id=legacy.id::text))
            +(SELECT count(*) FROM ${schema}.activity_attendance_registers common
              WHERE state IN ('submitted','locked')
                AND submitted_at>$3::timestamptz AND submitted_at<=$2::timestamptz
                AND NOT EXISTS(SELECT 1 FROM ${schema}.activity_attendance_source_contexts imported
                  WHERE imported.register_id=common.id AND imported.school_id=common.school_id AND imported.state<>'active'))) AS submitted,
          ((SELECT count(*) FROM ${schema}.attendance_registers legacy
              WHERE state='locked' AND locked_at>$3::timestamptz AND locked_at<=$2::timestamptz
                AND NOT EXISTS(SELECT 1 FROM ${schema}.activity_attendance_source_contexts migrated
                  WHERE migrated.school_id=legacy.school_id AND migrated.source_kind='daily_class' AND migrated.state='active'
                    AND migrated.source_id=concat(legacy.class_section_id,':',legacy.term_id,':',legacy.date)))
            +(SELECT count(*) FROM ${schema}.attendance_session_registers legacy
              WHERE state='locked' AND locked_at>$3::timestamptz AND locked_at<=$2::timestamptz
                AND NOT EXISTS(SELECT 1 FROM ${schema}.activity_attendance_source_contexts migrated
                  WHERE migrated.school_id=legacy.school_id AND migrated.source_kind='scheduled_session'
                    AND migrated.state='active' AND migrated.source_id=legacy.id::text))
            +(SELECT count(*) FROM ${schema}.activity_attendance_registers common
              WHERE state='locked' AND locked_at>$3::timestamptz AND locked_at<=$2::timestamptz
                AND NOT EXISTS(SELECT 1 FROM ${schema}.activity_attendance_source_contexts imported
                  WHERE imported.register_id=common.id AND imported.school_id=common.school_id AND imported.state<>'active'))) AS finalized,
          (SELECT count(*) FROM ${schema}.students) AS learners`,
        [input.virtual_from, input.virtual_to, snapshot.captured_at])).rows[0]!;
        const nextEvent = (await client.query<{ next_at: Date | null }>(`SELECT min(due) AS next_at FROM (
          SELECT auto_finalize_at AS due FROM ${schema}.attendance_registers legacy WHERE state='submitted' AND auto_finalize_at>$1::timestamptz
            AND NOT EXISTS(SELECT 1 FROM ${schema}.activity_attendance_source_contexts migrated WHERE migrated.school_id=legacy.school_id
              AND migrated.source_kind='daily_class' AND migrated.state='active'
              AND migrated.source_id=concat(legacy.class_section_id,':',legacy.term_id,':',legacy.date))
          UNION ALL SELECT auto_finalize_at FROM ${schema}.attendance_session_registers legacy WHERE state='submitted' AND auto_finalize_at>$1::timestamptz
            AND NOT EXISTS(SELECT 1 FROM ${schema}.activity_attendance_source_contexts migrated WHERE migrated.school_id=legacy.school_id
              AND migrated.source_kind='scheduled_session' AND migrated.state='active' AND migrated.source_id=legacy.id::text)
          UNION ALL SELECT auto_finalize_at FROM ${schema}.activity_attendance_registers common WHERE state='submitted' AND auto_finalize_at>$1::timestamptz
            AND NOT EXISTS(SELECT 1 FROM ${schema}.activity_attendance_source_contexts imported WHERE imported.register_id=common.id
              AND imported.school_id=common.school_id AND imported.state<>'active')
          UNION ALL SELECT response_due_at FROM ${schema}.campus_model_operational_messages WHERE state IN ('queued','delivered','acknowledged') AND response_due_at>$1::timestamptz) pending`, [input.virtual_to])).rows[0]?.next_at;
        const updated = await client.query<{ revision: number | string }>(`UPDATE dt_simulation.worlds
          SET virtual_now=$2,revision=revision+1,last_checkpoint_ref=$3
          WHERE run_id=$1 AND virtual_now=$4::timestamptz AND revision=$5
            AND last_lease_fence=$6 AND last_lease_token=$7
          RETURNING revision`, [input.run_id, input.virtual_to, checkpointRef, input.virtual_from,
          input.world_revision, input.lease_fence, input.lease_token]);
        const revision = Number(updated.rows[0]?.revision);
        if (!Number.isSafeInteger(revision)) {
          throw new ConflictException("The Simulation world moved before checkpoint commit.");
        }
        const result: AdvanceSimulationWorldResult = { world_revision: revision, checkpoint_ref: checkpointRef,
          emitted_event_count: Number(counts.step_events), next_event_at: nextEvent ? new Date(nextEvent).toISOString() : null,
          metrics: [
            { ...metrics.open_work, value: Number(counts.open_work) },
            { ...metrics.submitted_registers, value: Number(counts.submitted) },
            { ...metrics.finalized_registers, value: Number(counts.finalized) },
            { ...metrics.model_events, value: Number(counts.model_events) },
            { ...metrics.learners, value: Number(counts.learners) },
          ] };
        await client.query(`INSERT INTO dt_simulation.checkpoints(
          run_id,checkpoint_ref,virtual_from,virtual_to,lease_fence,lease_token,result
        ) VALUES($1,$2,$3,$4,$5,$6,$7)`, [input.run_id, checkpointRef, input.virtual_from,
          input.virtual_to, input.lease_fence, input.lease_token, JSON.stringify(result)]);
        assertLeaseCurrent();
        await client.query("COMMIT");
        return result;
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    });
  }

  async stop(run: PersistedSimulationRun): Promise<void> {
    await this.withAdvanceLock(run.id, async () => {
      const branch = await this.branch(run.id, run.school_id);
      if (branch.scenario_id !== run.scenario_id || branch.namespace_id !== run.namespace_id) {
        throw new ConflictException("Simulation world identity mismatch.");
      }
      const opened = await this.register(branch, run.virtual_now!, run.retention_expires_at);
      const environment = simulationRequestEnvironment({ institution_id: run.school_id, scenario_id: run.scenario_id,
        run_id: run.id, virtual_now: run.virtual_now!, source_snapshot_ref: run.source_snapshot_ref!,
        manifest_ref: opened.manifest_ref, checked_at: opened.checked_at });
      await this.scope.run(environment, async () => {
        const driver = this.registry.driverFor(environment), connection = await driver.acquireConnection();
        try {
          await driver.beginTransaction(connection, {});
          // The branch transaction already owns the COW gate. It excludes every
          // ordinary domain write through cleanup and the durable terminal seal.
          const state = (await connection.executeQuery<{ domain_read_only: boolean }>(CompiledQuery.raw(
            "SELECT domain_read_only FROM dt_simulation.worlds WHERE run_id=$1 AND school_id=$2 FOR UPDATE", [run.id, run.school_id]))).rows[0];
          if (!state) throw new ConflictException("The retained Simulation world is unavailable.");
          if (!state.domain_read_only) {
            const expired = await connection.executeQuery<{ id: string }>(CompiledQuery.raw(`WITH expired AS (
                SELECT id FROM people_imports WHERE school_id=$1 AND state='draft' AND expires_at<=$2::timestamptz FOR UPDATE
              ), cleared AS (
                UPDATE people_import_rows SET raw_values='{}'::jsonb,guardian_choice='{}'::jsonb
                  WHERE school_id=$1 AND import_id IN (SELECT id FROM expired) RETURNING import_id
              ) UPDATE people_imports SET state='expired',revision=revision+1,updated_at=$2::timestamptz
                WHERE school_id=$1 AND id IN (SELECT id FROM expired) RETURNING id`, [run.school_id, run.virtual_now]));
            const receipt = { policy: "terminal-import-privacy/v1", virtual_at: run.virtual_now,
              expired_import_count: expired.rows.length, source_raw_data_returned: false };
            await connection.executeQuery(CompiledQuery.raw(`INSERT INTO audit_events(
                school_id,actor_id,action,target_type,target_id,request_id,ip_hash,metadata)
              VALUES($1,NULL,'simulation.terminal_privacy_sealed','simulation_run',$2,$2,NULL,$3::jsonb)`,
            [run.school_id, run.id, JSON.stringify(receipt)]));
            await connection.executeQuery(CompiledQuery.raw(`UPDATE dt_simulation.worlds SET
              domain_read_only=true,terminal_privacy_receipt=$3::jsonb,virtual_now=$4::timestamptz
              WHERE run_id=$1 AND school_id=$2`, [run.id, run.school_id, JSON.stringify(receipt), run.virtual_now]));
          }
          await driver.commitTransaction(connection);
        } catch (error) { await driver.rollbackTransaction(connection); throw error; }
        finally { await driver.releaseConnection(connection); }
      });
    });
  }

  async discard(run: PersistedSimulationRun): Promise<void> {
    // Retained source/checkpoint evidence is immutable. Discard only deactivates
    // request access; lifecycle retention can later remove a closed world.
    await this.registry.discard(run.namespace_id);
    unbindSimulationResources(run.namespace_id);
  }

  async resources(institutionId: string, runId: string, page: number, pageSize: number) {
    const branch = await this.branch(runId, institutionId);
    const snapshot = await this.storage().getSnapshot(branch.snapshot_id);
    const environment = simulationRequestEnvironment({ institution_id: institutionId, scenario_id: branch.scenario_id,
      run_id: runId, virtual_now: branch.virtual_now, source_snapshot_ref: `sha256:${snapshot.content_hash}`,
      manifest_ref: `simulation-resources/v1:${runId}`, checked_at: snapshot.captured_at });
    await initializeSimulationResources(this.storage().pool);
    const resources = await new SimulationResourceStore(this.storage().pool, environment).list(page, pageSize);
    const conformance = currentSimulationPlatformConformance();
    return { ...resources, conformance: { manifest_version: conformance.manifest_version, fingerprint: conformance.fingerprint,
      coverage_complete: conformance.coverage_complete, coverage_gap_count: conformance.coverage_gaps.length } };
  }

  async measure(run: PersistedSimulationRun) {
    await this.storage().initialize();
    await initializeSimulationResources(this.storage().pool);
    return measureSimulationWorld(this.storage().pool, run);
  }

  async garbageCollect(input: GarbageCollectSimulationWorldInput) {
    await this.storage().initialize();
    await initializeSimulationResources(this.storage().pool);
    return this.withAdvanceLock(input.run.id, async () => {
      const result = await garbageCollectSimulationWorld(this.storage().pool, input);
      await this.registry.discard(input.run.namespace_id);
      unbindSimulationResources(input.run.namespace_id);
      return result;
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([this.store?.pool.end(), this.lockPool?.end()]);
  }
}
