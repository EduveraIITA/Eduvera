var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var TransportRetentionService_1;
import { Injectable, Logger } from "@nestjs/common";
import { sql } from "kysely";
import { DatabaseService } from "../database/database.service.js";
let TransportRetentionService = TransportRetentionService_1 = class TransportRetentionService {
    db;
    timer;
    busy = false;
    logger = new Logger(TransportRetentionService_1.name);
    constructor(db) {
        this.db = db;
    }
    onApplicationBootstrap() {
        this.timer = setInterval(() => void this.run(), 60_000);
        this.timer.unref();
        void this.run();
    }
    beforeApplicationShutdown() { if (this.timer)
        clearInterval(this.timer); }
    async purgeExpired() {
        // Bound each pass and cooperate with other replicas. Audit milestones remain;
        // coordinates expire even when no further journey uploads occur.
        return this.db.transaction().execute(tx => sql `DELETE FROM transport_location_samples WHERE id IN (
      SELECT sample.id FROM transport_location_samples sample LEFT JOIN departure_policies policy ON policy.school_id=sample.school_id
      WHERE sample.received_at<now()-make_interval(hours=>COALESCE(policy.location_retention_hours,24))
      ORDER BY sample.received_at LIMIT 1000 FOR UPDATE OF sample SKIP LOCKED
    )`.execute(tx));
    }
    async run() {
        if (this.busy)
            return;
        this.busy = true;
        try {
            await this.purgeExpired();
        }
        catch {
            this.logger.warn("Transport location retention pass failed; will retry.");
        }
        finally {
            this.busy = false;
        }
    }
};
TransportRetentionService = TransportRetentionService_1 = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [DatabaseService])
], TransportRetentionService);
export { TransportRetentionService };
//# sourceMappingURL=transport-retention.service.js.map