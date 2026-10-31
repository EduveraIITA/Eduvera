var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Module } from "@nestjs/common";
import { CampusModelCoreModule } from "../campus-model-core/campus-model-core.module.js";
import { SchoolController } from "./school.controller.js";
import { SchoolEventService } from "./school-event.service.js";
import { SchoolService } from "./school.service.js";
import { StaffCoverageReconciliationModule } from "../staff-operations/staff-coverage-reconciliation.module.js";
import { OperatingDayModule } from "../operating-day/operating-day.module.js";
import { ActivityAttendanceKernelModule } from "../attendance/activity-attendance-kernel.module.js";
import { ClassPracticeService } from "./class-practice.service.js";
import { ClassPracticeController } from "./class-practice.controller.js";
let SchoolModule = class SchoolModule {
};
SchoolModule = __decorate([
    Module({ imports: [CampusModelCoreModule, ActivityAttendanceKernelModule, StaffCoverageReconciliationModule, OperatingDayModule], controllers: [SchoolController, ClassPracticeController], providers: [SchoolService, SchoolEventService, ClassPracticeService], exports: [SchoolService, SchoolEventService] })
], SchoolModule);
export { SchoolModule };
//# sourceMappingURL=school.module.js.map