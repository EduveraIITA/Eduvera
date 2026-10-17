import { Module } from "@nestjs/common";
import { CampusModelCoreModule } from "../campus-model-core/campus-model-core.module.js";
import { SchoolController } from "./school.controller.js";
import { SchoolEventService } from "./school-event.service.js";
import { SchoolService } from "./school.service.js";
import { StaffCoverageReconciliationModule } from "../staff-operations/staff-coverage-reconciliation.module.js";

@Module({ imports: [CampusModelCoreModule, StaffCoverageReconciliationModule], controllers: [SchoolController], providers: [SchoolService, SchoolEventService], exports: [SchoolService, SchoolEventService] })
export class SchoolModule {}
