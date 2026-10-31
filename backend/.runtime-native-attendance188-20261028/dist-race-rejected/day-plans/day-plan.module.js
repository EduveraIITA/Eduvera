var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Module } from "@nestjs/common";
import { SchoolModule } from "../school/school.module.js";
import { CampusModelCoreModule } from "../campus-model-core/campus-model-core.module.js";
import { DayPlanService } from "./day-plan.service.js";
import { DayPlanController } from "./day-plan.controller.js";
import { StaffCoverageReconciliationModule } from "../staff-operations/staff-coverage-reconciliation.module.js";
let DayPlanModule = class DayPlanModule {
};
DayPlanModule = __decorate([
    Module({
        imports: [SchoolModule, CampusModelCoreModule, StaffCoverageReconciliationModule],
        providers: [DayPlanService],
        controllers: [DayPlanController],
    })
], DayPlanModule);
export { DayPlanModule };
//# sourceMappingURL=day-plan.module.js.map