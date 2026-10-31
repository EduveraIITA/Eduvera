import { ConflictException, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PostgresDialect } from "kysely";
import { Pool } from "pg";
import { config } from "../config.js";
import type { TransientExecutionRunReference } from "../campus-model-core/transient-execution-run.contracts.js";
import { createSimulationExecutionEnvironment } from "../campus-model-core/execution-environment.runtime.js";
import { EXECUTION_EFFECT_KINDS } from "../campus-model-core/execution-effects.contracts.js";
import { ExecutionEffectRouter, RunScopedInMemoryExecutionEffectSink } from "../campus-model-core/execution-effects.runtime.js";
import { DeterministicVirtualClock } from "../campus-model-core/scenarios/runtime.js";
import { postgresClientConnectionConfig } from "./connection-policy.js";
import {
  ExecutionDataPlaneRegistry,
  REQUIRED_APPLICATION_SIMULATION_MODULES,
  type SimulationApplicationCoverageManifest,
} from "./execution-data-plane.js";

function run(command: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { stdio: ["ignore", "ignore", "pipe"] });
    let diagnostics = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { diagnostics = `${diagnostics}${chunk}`.slice(-2_000); });
    child.once("error", reject);
    child.once("exit", (code) => code === 0
      ? resolve()
      : reject(new Error(`${command} failed (${code ?? "signal"}): ${diagnostics.trim()}`)));
  });
}

function assertLocalDatabase(url: string, label: string): URL {
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)) {
    throw new ConflictException(`${label} must be loopback-only in the development Simulation adapter.`);
  }
  return parsed;
}

function databaseName(url: URL): string {
  const name = decodeURIComponent(url.pathname.replace(/^\//u, ""));
  if (!/^[a-zA-Z][a-zA-Z0-9_]{0,62}$/.test(name)) {
    throw new ConflictException("The development Simulation database name is invalid.");
  }
  return name;
}

async function resetDatabase(target: URL, create: boolean): Promise<void> {
  const name = databaseName(target);
  const maintenance = new URL(target.toString());
  maintenance.pathname = "/postgres";
  const pool = new Pool({
    ...postgresClientConnectionConfig(maintenance.toString(), {
      name: "CAMPUS_SIMULATION_DATABASE_URL",
      purpose: "application",
      requireRemoteTls: false,
    }),
    max: 1,
    application_name: "thatcampus_simulation_lifecycle",
  });
  try {
    await pool.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()", [name]);
    await pool.query(`DROP DATABASE IF EXISTS "${name}"`);
    if (create) await pool.query(`CREATE DATABASE "${name}"`);
  } finally {
    await pool.end();
  }
}

/**
 * Development adapter for the product's two-world contract. It creates a full,
 * separately addressed PostgreSQL fork. The generic request router therefore
 * gives every existing module the same contracts without any Live fallback.
 * Managed deployments must replace this adapter with a reviewed snapshot
 * provider; shell/database lifecycle commands are intentionally development-only.
 */
@Injectable()
export class CampusLabSimulationEnvironmentService {
  private active: TransientExecutionRunReference | null = null;
  private namespaceId: string | null = null;
  private preparing: Promise<TransientExecutionRunReference> | null = null;
  private clock: DeterministicVirtualClock | null = null;

  constructor(private readonly registry: ExecutionDataPlaneRegistry) {}

  current(): TransientExecutionRunReference | null {
    if (this.active && Date.parse(this.active.expires_at) <= Date.now()) {
      void this.discard();
      return null;
    }
    return this.active ? structuredClone(this.active) : null;
  }

  resolve(institutionId: string, runId: string): TransientExecutionRunReference | null {
    const active = this.current();
    return active?.institution_id === institutionId && active.run_id === runId ? active : null;
  }

  advance(institutionId: string, instant: string): TransientExecutionRunReference {
    const active = this.current();
    if (!active || !this.clock || active.institution_id !== institutionId) {
      throw new ConflictException("The isolated Cambridge Simulation environment is not active.");
    }
    const next = Date.parse(instant);
    if (!Number.isFinite(next)) throw new ConflictException("Simulation time must be an ISO instant.");
    if (next >= Date.parse(active.virtual_now)) this.clock.advanceTo(new Date(next).toISOString());
    this.active = { ...active, virtual_now: this.clock.nowIso() };
    return structuredClone(this.active);
  }

  async prepare(institutionId: string, timeZone: string): Promise<TransientExecutionRunReference> {
    const existing = this.current();
    if (existing?.institution_id === institutionId) return existing;
    if (this.preparing) return this.preparing;
    this.preparing = this.prepareOnce(institutionId, timeZone).finally(() => { this.preparing = null; });
    return this.preparing;
  }

  private async prepareOnce(institutionId: string, timeZone: string): Promise<TransientExecutionRunReference> {
    const settings = config();
    if (settings.DEPLOYMENT_ENVIRONMENT !== "development") {
      throw new ConflictException("A managed isolated Simulation snapshot provider is not configured for this deployment.");
    }
    const targetValue = settings.CAMPUS_SIMULATION_DATABASE_URL;
    if (!targetValue) throw new ConflictException("The isolated Simulation database is not configured.");
    const source = assertLocalDatabase(settings.DATABASE_URL, "Live database");
    const target = assertLocalDatabase(targetValue, "Simulation database");
    if (source.toString() === target.toString() || source.pathname === target.pathname) {
      throw new ConflictException("Simulation must use a database distinct from Live.");
    }

    await this.discard();
    const scratch = await mkdtemp(join(tmpdir(), "thatcampus-simulation-"));
    const archive = join(scratch, "live.dump");
    try {
      await run("pg_dump", ["--format=custom", "--no-owner", "--no-acl", `--file=${archive}`, source.toString()]);
      await resetDatabase(target, true);
      await run("pg_restore", ["--no-owner", "--no-acl", "--exit-on-error", `--dbname=${target.toString()}`, archive]);
    } catch (error) {
      await resetDatabase(target, false).catch(() => undefined);
      throw new ConflictException(error instanceof Error ? error.message : "The isolated Simulation database could not be prepared.");
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }

    const now = new Date();
    const expires = new Date(now.getTime() + 8 * 60 * 60 * 1_000);
    const runId = randomUUID();
    const scenarioId = randomUUID();
    const manifestRef = `coverage:${runId}:full-application`;
    const clockInitial = new Date(now.getTime() - 24 * 60 * 60 * 1_000);
    const clockHorizon = new Date(now.getTime() + 32 * 24 * 60 * 60 * 1_000);
    const clock = new DeterministicVirtualClock(clockInitial.toISOString(), clockHorizon.toISOString());
    const environment = createSimulationExecutionEnvironment({
      institution_id: institutionId,
      scenario_id: scenarioId,
      run_id: runId,
      virtual_clock: clock,
      source_snapshot_ref: `postgres-snapshot:${now.toISOString()}`,
      coverage_gate: { status: "passed", manifest_ref: manifestRef, checked_at: now.toISOString() },
      expires_at: expires.toISOString(),
    });
    const coverage: SimulationApplicationCoverageManifest = {
      manifest_ref: manifestRef,
      checked_at: now.toISOString(),
      enabled_modules: [],
      modules: REQUIRED_APPLICATION_SIMULATION_MODULES.map((module_id) => ({
        module_id,
        capabilities: { snapshot: "supported", queries: "supported", commands: "supported", events: "supported", realtime: "supported" },
      })),
      storage_mode: "isolated_copy_on_write",
      event_outbox_mode: "isolated",
      operational_message_mode: "sink_only",
      file_storage_mode: "disabled",
      external_connector_mode: "disabled",
      realtime_mode: "isolated",
      uncovered_effects: [],
    };
    const router = new ExecutionEffectRouter();
    const effectCoverage = router.bindSimulationSinks({
      environment,
      sinks: EXECUTION_EFFECT_KINDS.map((kind) => new RunScopedInMemoryExecutionEffectSink(
        kind, `campus-lab:${runId}:${kind}`, environment,
      )),
    });
    const pool = new Pool({
      ...postgresClientConnectionConfig(target.toString(), { name: "CAMPUS_SIMULATION_DATABASE_URL", purpose: "application", requireRemoteTls: false }),
      max: Math.min(5, settings.DATABASE_POOL_MAX),
      application_name: "thatcampus_simulation_fork",
    });
    const driver = new PostgresDialect({ pool }).createDriver();
    const descriptor = await this.registry.prepare({ environment, coverage, effectCoverage, driver });
    if (descriptor.status !== "ready") {
      await driver.destroy();
      throw new ConflictException("The Simulation fork did not pass full-application isolation coverage.");
    }
    this.namespaceId = environment.namespace_id;
    this.clock = clock;
    this.active = {
      institution_id: institutionId,
      scenario_id: scenarioId,
      run_id: runId,
      namespace_id: environment.namespace_id,
      virtual_now: clock.nowIso(),
      time_zone: timeZone,
      source_snapshot_at: now.toISOString(),
      source_snapshot_ref: environment.source_snapshot_ref,
      expires_at: expires.toISOString(),
    };
    return structuredClone(this.active);
  }

  async discard(): Promise<boolean> {
    const settings = config();
    const existed = Boolean(this.active || this.namespaceId);
    if (this.namespaceId) await this.registry.discard(this.namespaceId);
    this.active = null;
    this.namespaceId = null;
    this.clock = null;
    if (settings.DEPLOYMENT_ENVIRONMENT === "development" && settings.CAMPUS_SIMULATION_DATABASE_URL) {
      const target = assertLocalDatabase(settings.CAMPUS_SIMULATION_DATABASE_URL, "Simulation database");
      await resetDatabase(target, false).catch(() => undefined);
    }
    return existed;
  }
}
