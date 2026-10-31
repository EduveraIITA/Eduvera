var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
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
let TeachingSessionsModule = class TeachingSessionsModule {
};
TeachingSessionsModule = __decorate([
    Module({ imports: [CampusModelCoreModule, SchedulePlanningModule, ActivityAttendanceModule, AttendanceModelModule, SchoolModule],
        controllers: [TeachingSessionsController], providers: [TeachingSessionContextService, TeachingSessionModelService, TeachingSessionArtifactStore,
            TeachingSessionMaterialsService, TeachingSessionWorkService, TeachingSessionsService], exports: [TeachingSessionsService, TeachingSessionContextService, TeachingSessionModelService, TeachingSessionWorkService,
            TeachingSessionMaterialsService, TeachingSessionArtifactStore] })
], TeachingSessionsModule);
export { TeachingSessionsModule };
//# sourceMappingURL=teaching-sessions.module.js.map