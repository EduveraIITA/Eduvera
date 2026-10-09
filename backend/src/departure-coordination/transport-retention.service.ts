import { Injectable, Logger, type OnApplicationBootstrap, type BeforeApplicationShutdown } from "@nestjs/common";
import { sql } from "kysely";
import { DatabaseService } from "../database/database.service.js";

@Injectable()
export class TransportRetentionService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private timer?:ReturnType<typeof setInterval>;
  private busy=false;
  private readonly logger=new Logger(TransportRetentionService.name);
  constructor(private readonly db:DatabaseService) {}
  onApplicationBootstrap() {
    this.timer=setInterval(()=>void this.run(),60_000);this.timer.unref();void this.run();
  }
  beforeApplicationShutdown() { if(this.timer) clearInterval(this.timer); }
  async purgeExpired() {
    // Bound each pass and cooperate with other replicas. Audit milestones remain;
    // coordinates expire even when no further journey uploads occur.
    return this.db.transaction().execute(tx=>sql`DELETE FROM transport_location_samples WHERE id IN (
      SELECT sample.id FROM transport_location_samples sample LEFT JOIN departure_policies policy ON policy.school_id=sample.school_id
      WHERE sample.received_at<now()-make_interval(hours=>COALESCE(policy.location_retention_hours,24))
      ORDER BY sample.received_at LIMIT 1000 FOR UPDATE OF sample SKIP LOCKED
    )`.execute(tx));
  }
  private async run() {
    if(this.busy)return;this.busy=true;
    try { await this.purgeExpired(); } catch { this.logger.warn("Transport location retention pass failed; will retry."); } finally { this.busy=false; }
  }
}
