import { Injectable, type OnApplicationBootstrap, type BeforeApplicationShutdown } from "@nestjs/common";
import { sql } from "kysely";
import { executionNow } from "../campus-model-core/execution-time.runtime.js";
import { DatabaseService } from "../database/database.service.js";
import { ExecutionDataPlaneScope } from "../database/execution-data-plane.js";
import { ActivityPlanningService } from "../schedule-planning/activity-planning.service.js";
import { SchoolEventService } from "../school/school-event.service.js";
import { ActivityAttendanceService } from "./activity-attendance.service.js";

/** Reuses the campus worker and virtual-time checkpoint; never starts a timer. */
@Injectable()
export class ActivityAttendanceLifecycleBridge implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private unregister?: () => void;
  private lastLiveSchoolId: string | null = null;
  constructor(private readonly db: DatabaseService, private readonly scope: ExecutionDataPlaneScope,
    private readonly planning: ActivityPlanningService, private readonly attendance: ActivityAttendanceService,
    private readonly events: SchoolEventService) {}

  onApplicationBootstrap(): void {
    this.unregister = this.events.registerDomainWork("participation_attendance", async () => {
      const selected = this.scope.current();
      const at = executionNow().toISOString();
      // The selected database is already isolated. No source-campus lookup is
      // permitted when advancing a Simulation world.
      const schools = (await sql<{ id: string; from_date: string; until_date: string }>`
        SELECT school.id,((${at}::timestamptz AT TIME ZONE school.timezone)::date-1)::text AS from_date,
          ((${at}::timestamptz AT TIME ZONE school.timezone)::date+7)::text AS until_date
        FROM schools school WHERE EXISTS(SELECT 1 FROM schedule_versions plan
          WHERE plan.school_id=school.id AND plan.state='published' AND plan.planning_origin='activity')
          ${selected?.kind === "simulation" ? sql`AND school.id=${selected.institution_id}::uuid` : sql``}
          ${selected?.kind !== "simulation" && this.lastLiveSchoolId ? sql`AND school.id>${this.lastLiveSchoolId}::uuid` : sql``}
        ORDER BY school.id LIMIT 100
      `.execute(this.db)).rows;
      // This horizon extends published neutral activities. Academic registers,
      // events and examinations retain their owning adapters; finalization below
      // still considers every already-open participation register.
      for (const school of schools) await this.planning.ensureOccurrences(school.id, school.from_date, school.until_date, undefined, { source: "activity" });
      if (selected?.kind !== "simulation") this.lastLiveSchoolId = schools.at(-1)?.id ?? null;
      await this.attendance.finalizeDue(selected?.kind === "simulation" ? selected.institution_id : undefined);
    });
  }

  beforeApplicationShutdown(): void { this.unregister?.(); }
}
