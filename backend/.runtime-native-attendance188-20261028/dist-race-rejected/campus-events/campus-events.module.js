var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Module } from "@nestjs/common";
import { SchoolModule } from "../school/school.module.js";
import { CampusEventFinanceController } from "./campus-event-finance.controller.js";
import { CampusEventFinanceService } from "./campus-event-finance.service.js";
import { CampusEventsController } from "./campus-events.controller.js";
import { CampusEventsService } from "./campus-events.service.js";
import { ActivityAttendanceKernelModule } from "../attendance/activity-attendance-kernel.module.js";
import { SchedulePlanningModule } from '../schedule-planning/schedule-planning.module.js';
import { CampusModelCoreModule } from '../campus-model-core/campus-model-core.module.js';
let CampusEventsModule = class CampusEventsModule {
};
CampusEventsModule = __decorate([
    Module({
        imports: [SchoolModule, CampusModelCoreModule, ActivityAttendanceKernelModule, SchedulePlanningModule],
        controllers: [CampusEventsController, CampusEventFinanceController],
        providers: [CampusEventsService, CampusEventFinanceService],
        exports: [CampusEventsService],
    })
], CampusEventsModule);
export { CampusEventsModule };
//# sourceMappingURL=campus-events.module.js.map