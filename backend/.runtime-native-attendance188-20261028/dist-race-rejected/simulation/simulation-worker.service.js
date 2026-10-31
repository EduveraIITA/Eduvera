var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var SimulationWorkerService_1;
import { Injectable, Inject, Logger, Optional, } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DEFAULT_SIMULATION_RESOURCE_POLICY, SIMULATION_RESOURCE_POLICY, } from "./simulation-resource-policy.js";
import { SimulationService } from "./simulation.service.js";
/**
 * One bounded worker loop per application process. PostgreSQL leases coordinate
 * multiple instances; there is deliberately no timer or process per run.
 */
let SimulationWorkerService = SimulationWorkerService_1 = class SimulationWorkerService {
    simulations;
    logger = new Logger(SimulationWorkerService_1.name);
    workerId = `simulation-worker-${process.pid}-${randomUUID()}`;
    policy;
    timer;
    drainPromise = null;
    stopping = false;
    nextGcAt = 0;
    constructor(simulations, policy) {
        this.simulations = simulations;
        this.policy = policy ?? DEFAULT_SIMULATION_RESOURCE_POLICY;
    }
    onApplicationBootstrap() {
        if (this.timer)
            return;
        this.timer = setInterval(() => { this.scheduleDrain(); }, this.policy.worker_interval_ms);
        this.timer.unref();
        this.scheduleDrain();
    }
    scheduleDrain() {
        if (this.stopping || this.drainPromise)
            return;
        this.drainPromise = this.drain()
            .catch((error) => {
            const message = error instanceof Error ? error.message : "unknown worker failure";
            this.logger.warn(`Simulation worker poll failed: ${message}`);
        })
            .finally(() => { this.drainPromise = null; });
    }
    async drain() {
        for (let index = 0; index < this.policy.worker_max_runs_per_poll && !this.stopping; index += 1) {
            const recovered = await this.simulations.failNextStalePreparation();
            if (!recovered)
                break;
            this.logger.warn(`Marked stale Simulation preparation ${recovered.id} failed; its retained target lineage is eligible for fenced cleanup.`);
        }
        for (let index = 0; index < this.policy.worker_max_runs_per_poll && !this.stopping; index += 1) {
            const paused = await this.simulations.pauseNextRunOverBudget();
            if (!paused)
                break;
            this.logger.warn(`Paused Simulation run ${paused.id} because an institution resource budget was exceeded.`);
        }
        for (let index = 0; index < this.policy.worker_max_runs_per_poll && !this.stopping; index += 1) {
            const advanced = await this.simulations.advanceNextDueRun(this.workerId);
            if (!advanced)
                break;
        }
        if (!this.policy.gc_enabled || !this.policy.gc_batch_size || Date.now() < this.nextGcAt)
            return;
        this.nextGcAt = Date.now() + this.policy.gc_interval_ms;
        for (let index = 0; index < this.policy.gc_batch_size && !this.stopping; index += 1) {
            if (!(await this.simulations.collectNextExpiredWorld(this.workerId)))
                return;
        }
    }
    async onApplicationShutdown() {
        this.stopping = true;
        if (this.timer)
            clearInterval(this.timer);
        this.timer = undefined;
        await this.drainPromise;
    }
};
SimulationWorkerService = SimulationWorkerService_1 = __decorate([
    Injectable(),
    __param(1, Optional()),
    __param(1, Inject(SIMULATION_RESOURCE_POLICY)),
    __metadata("design:paramtypes", [SimulationService, Object])
], SimulationWorkerService);
export { SimulationWorkerService };
//# sourceMappingURL=simulation-worker.service.js.map