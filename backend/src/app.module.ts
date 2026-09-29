import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AiModule } from "./ai/ai.module.js";
import { CoordinationModule } from "./coordination/coordination.module.js";
import { PeopleModule } from "./people/people.module.js";
import { DayPlanModule } from "./day-plans/day-plan.module.js";
import { AppController } from "./app.controller.js";
import { AuthModule } from "./auth/auth.module.js";
import { CsrfGuard, SessionGuard } from "./auth/guards.js";
import { DatabaseModule } from "./database/database.module.js";
import { ReleaseController } from "./release.controller.js";
import { SchoolModule } from "./school/school.module.js";
import { SpaController } from "./spa.controller.js";
import { PhotoAttendanceModule } from "./photo-attendance/photo-attendance.module.js";

@Module({
  imports: [DatabaseModule, AuthModule, SchoolModule, AiModule, CoordinationModule, PeopleModule, DayPlanModule, PhotoAttendanceModule],
  controllers: [AppController, ReleaseController, SpaController],
  providers: [
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
  ],
})
export class AppModule {}
