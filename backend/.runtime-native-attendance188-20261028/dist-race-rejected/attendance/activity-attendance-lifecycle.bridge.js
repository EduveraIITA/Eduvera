var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Injectable } from "@nestjs/common";
import { sql } from "kysely";
import { executionNow } from "../campus-model-core/execution-time.runtime.js";
import { DatabaseService } from "../database/database.service.js";
import { ExecutionDataPlaneScope } from "../database/execution-data-plane.js";
import { ActivityPlanningService } from "../schedule-planning/activity-planning.service.js";
import { SchoolEventService } from "../school/school-event.service.js";
import { ActivityAttendanceService } from "./activity-attendance.service.js";
/** Reuses the campus worker and virtual-time checkpoint; never starts a timer. */
let ActivityAttendanceLifecycleBridge = class ActivityAttendanceLifecycleBridge {
    db;
    scope;
    planning;
    attendance;
    events;
    unregister;
    lastLiveSchoolId = null;
    constructor(db, scope, planning, attendance, events) {
        this.db = db;
        this.scope = scope;
        this.planning = planning;
        this.attendance = attendance;
        this.events = events;
    }
    onApplicationBootstrap() {
        this.unregister = this.events.registerDomainWork("participation_attendance", async () => {
            const selected = this.scope.current();
            const at = executionNow().toISOString();
            // The selected database is already isolated. No source-campus lookup is
            // permitted when advancing a Simulation world.
            const schools = (await sql `
        SELECT school.id,((${at}::timestamptz AT TIME ZONE school.timezone)::date-1)::text AS from_date,
          ((${at}::timestamptz AT TIME ZONE school.timezone)::date+7)::text AS until_date
        FROM schools school WHERE EXISTS(SELECT 1 FROM schedule_versions plan
          WHERE plan.school_id=school.id AND plan.state='published' AND plan.planning_origin='activity')
          ${selected?.kind === "simulation" ? sql `AND school.id=${selected.institution_id}::uuid` : sql ``}
          ${selected?.kind !== "simulation" && this.lastLiveSchoolId ? sql `AND school.id>${this.lastLiveSchoolId}::uuid` : sql ``}
        ORDER BY school.id LIMIT 100
      `.execute(this.db)).rows;
            for (const school of schools)
                await this.planning.ensureOccurrences(school.id, school.from_date, school.until_date);
            if (selected?.kind !== "simulation")
                this.lastLiveSchoolId = schools.at(-1)?.id ?? null;
            await this.attendance.finalizeDue(selected?.kind === "simulation" ? selected.institution_id : undefined);
        });
    }
    beforeApplicationShutdown() { this.unregister?.(); }
};
ActivityAttendanceLifecycleBridge = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [DatabaseService, ExecutionDataPlaneScope,
        ActivityPlanningService, ActivityAttendanceService,
        SchoolEventService])
], ActivityAttendanceLifecycleBridge);
export { ActivityAttendanceLifecycleBridge };
//# sourceMappingURL=activity-attendance-lifecycle.bridge.js.map