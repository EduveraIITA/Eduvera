import { Module } from "@nestjs/common";
import { CampusModelCoreModule } from "../campus-model-core/campus-model-core.module.js";
import { SchedulePlanningModule } from "../schedule-planning/schedule-planning.module.js";
import { ActivityAttendanceModule } from "../attendance/activity-attendance.module.js";
import { AttendanceModelModule } from "../attendance-model/attendance-model.module.js";
import { SchoolModule } from "../school/school.module.js";
import { TeachingSessionsController } from "./teaching-sessions.controller.js";
import { TeachingSessionContextService } from "./teaching-session-context.service.js";
import { TeachingSessionModelService } from "./teaching-session-model.service.js";
import { TeachingSessionArtifactStore, TeachingSessionMaterialsService } from "./teaching-session-materials.service.js";
import { TeachingSessionsService } from "./teaching-sessions.service.js";
import { TeachingSessionWorkService } from "./teaching-session-work.service.js";

@Module({ imports:[CampusModelCoreModule,SchedulePlanningModule,ActivityAttendanceModule,AttendanceModelModule,SchoolModule],
  controllers:[TeachingSessionsController],providers:[TeachingSessionContextService,TeachingSessionModelService,TeachingSessionArtifactStore,
    TeachingSessionMaterialsService,TeachingSessionWorkService,TeachingSessionsService],exports:[TeachingSessionsService,TeachingSessionContextService,TeachingSessionModelService,TeachingSessionWorkService,
    TeachingSessionMaterialsService,TeachingSessionArtifactStore] })
export class TeachingSessionsModule {}
