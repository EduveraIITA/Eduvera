import {
  Injectable,
  Inject,
  Logger,
  Optional,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_SIMULATION_RESOURCE_POLICY,
  SIMULATION_RESOURCE_POLICY,
  type SimulationResourcePolicy,
} from "./simulation-resource-policy.js";
import { SimulationService } from "./simulation.service.js";

/**
 * One bounded worker loop per application process. PostgreSQL leases coordinate
 * multiple instances; there is deliberately no timer or process per run.
 */
@Injectable()
export class SimulationWorkerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(SimulationWorkerService.name);
  private readonly workerId = `simulation-worker-${process.pid}-${randomUUID()}`;
  private readonly policy: SimulationResourcePolicy;
  private timer: ReturnType<typeof setInterval> | undefined;
  private drainPromise: Promise<void> | null = null;
  private stopping = false;
  private nextGcAt = 0;

  constructor(
    private readonly simulations: SimulationService,
    @Optional() @Inject(SIMULATION_RESOURCE_POLICY) policy?: SimulationResourcePolicy,
  ) {
    this.policy = policy ?? DEFAULT_SIMULATION_RESOURCE_POLICY;
  }

  onApplicationBootstrap(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { this.scheduleDrain(); }, this.policy.worker_interval_ms);
    this.timer.unref();
    this.scheduleDrain();
  }

  private scheduleDrain(): void {
    if (this.stopping || this.drainPromise) return;
    this.drainPromise = this.drain()
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "unknown worker failure";
        this.logger.warn(`Simulation worker poll failed: ${message}`);
      })
      .finally(() => { this.drainPromise = null; });
  }

  private async drain(): Promise<void> {
    for (let index = 0; index < this.policy.worker_max_runs_per_poll && !this.stopping; index += 1) {
      const recovered = await this.simulations.failNextStalePreparation();
      if (!recovered) break;
      this.logger.warn(`Marked stale Simulation preparation ${recovered.id} failed; its retained target lineage is eligible for fenced cleanup.`);
    }
    for (let index = 0; index < this.policy.worker_max_runs_per_poll && !this.stopping; index += 1) {
      const paused = await this.simulations.pauseNextRunOverBudget();
      if (!paused) break;
      this.logger.warn(`Paused Simulation run ${paused.id} because an institution resource budget was exceeded.`);
    }
    for (let index = 0; index < this.policy.worker_max_runs_per_poll && !this.stopping; index += 1) {
      const advanced = await this.simulations.advanceNextDueRun(this.workerId);
      if (!advanced) break;
    }
    if (!this.policy.gc_enabled || !this.policy.gc_batch_size || Date.now() < this.nextGcAt) return;
    this.nextGcAt = Date.now() + this.policy.gc_interval_ms;
    for (let index = 0; index < this.policy.gc_batch_size && !this.stopping; index += 1) {
      if (!(await this.simulations.collectNextExpiredWorld(this.workerId))) return;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.drainPromise;
  }
}
