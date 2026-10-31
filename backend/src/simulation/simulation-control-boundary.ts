import { ConflictException, ServiceUnavailableException } from "@nestjs/common";
import { Pool, type PoolClient } from "pg";
import { config } from "../config.js";
import { postgresClientConnectionConfig } from "../database/connection-policy.js";

export const SIMULATION_CONTROL_BOUNDARY = Symbol.for("thatcampus.simulation-control-boundary");
export const simulationControlGateKey = (runId: string) => `simulation-control:${runId.toLowerCase()}`;

interface ControlLockPool {
  connect(): Promise<Pick<PoolClient, "query" | "release">>;
  end(): Promise<void>;
}

interface BoundaryTiming {
  max_wait_ms: number;
  poll_interval_ms: number;
  now(): number;
  wait(milliseconds: number): Promise<void>;
}

const defaultTiming: BoundaryTiming = {
  max_wait_ms: 25_000,
  poll_interval_ms: 100,
  now: Date.now,
  wait: milliseconds => new Promise(done => setTimeout(done, milliseconds)),
};

/**
 * A temporary control-plane admission gate, not a worker lease or pending intent.
 * Its dedicated connection never holds a domain pool slot or a row transaction
 * while the already-fenced checkpoint finishes. Worker claims use the same key.
 */
export class SimulationControlBoundary {
  private pool: ControlLockPool | null = null;

  constructor(
    private readonly poolFactory: () => ControlLockPool = () => {
      const settings = config();
      return new Pool({
        ...postgresClientConnectionConfig(settings.DATABASE_URL, {
          name: "DATABASE_URL", purpose: "simulation",
          requireRemoteTls: settings.DEPLOYMENT_ENVIRONMENT === "stage" || settings.DEPLOYMENT_ENVIRONMENT === "production",
        }),
        max: 2, connectionTimeoutMillis: 1_000, query_timeout: 1_000,
        idleTimeoutMillis: 30_000, application_name: "thatcampus_simulation_control_gates",
      });
    },
    private readonly timing: BoundaryTiming = defaultTiming,
  ) {}

  async settle<T>(runId: string, hasInFlightCheckpoint: () => Promise<boolean>, operation: () => Promise<T>): Promise<T> {
    const deadline = this.timing.now() + this.timing.max_wait_ms;
    const timeout = () => new ConflictException({
      code: "simulation_checkpoint_finishing",
      message: "The current checkpoint is still finishing. Try the control again shortly; no work was interrupted.",
    });
    const wait = async () => {
      const remaining = deadline - this.timing.now();
      if (remaining <= 0) throw timeout();
      await this.timing.wait(Math.min(this.timing.poll_interval_ms, remaining));
    };
    this.pool ??= this.poolFactory();
    const unavailable = () => new ServiceUnavailableException({
      code: "simulation_control_unavailable",
      message: "Simulation controls are temporarily busy. Try again shortly; no work was interrupted.",
    });
    let client: Awaited<ReturnType<ControlLockPool["connect"]>>;
    try { client = await this.pool.connect(); }
    catch { throw unavailable(); }
    const key = simulationControlGateKey(runId);
    let locked = false;
    let destroy = false;
    try {
      do {
        if (this.timing.now() >= deadline) throw timeout();
        try {
          locked = (await client.query<{ acquired: boolean }>(
            "SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired", [key],
          )).rows[0]?.acquired === true;
        } catch { throw unavailable(); }
        if (!locked) await wait();
      } while (!locked);
      while (await hasInFlightCheckpoint()) await wait();
      if (this.timing.now() >= deadline) throw timeout();
      return await operation();
    } catch (error) {
      // A failed network query could have acquired the session lock without
      // returning its result. Disconnect rather than reusing an uncertain lease.
      if (!locked) destroy = true;
      throw error;
    } finally {
      if (locked) {
        try {
          destroy = (await client.query<{ released: boolean }>(
            "SELECT pg_advisory_unlock(hashtextextended($1,0)) AS released", [key],
          )).rows[0]?.released !== true;
        } catch { destroy = true; }
      }
      client.release(destroy);
    }
  }

  async close(): Promise<void> {
    if (this.pool) await this.pool.end();
    this.pool = null;
  }
}
