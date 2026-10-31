var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Global, Module } from "@nestjs/common";
import { AttendanceModelModule } from "../attendance-model/attendance-model.module.js";
import { ActivityAttendanceModule } from "../attendance/activity-attendance.module.js";
import { SchedulePlanningModule } from "../schedule-planning/schedule-planning.module.js";
import { CampusModelCoreModule } from "../campus-model-core/campus-model-core.module.js";
import { SchoolModule } from "../school/school.module.js";
import { StaffOperationsModule } from "../staff-operations/staff-operations.module.js";
import { AssessmentsModule } from "../assessments/assessments.module.js";
import { PeopleModule } from "../people/people.module.js";
import { DepartureCoordinationModule } from "../departure-coordination/departure-coordination.module.js";
import { SimulationOfferResponseAdapter } from "../simulation/simulation-offer-response.adapter.js";
import { OperationsModule } from "../operations/operations.module.js";
import { ChatModule } from "../chat/chat.module.js";
import { SIMULATION_WORLD_PORT } from "../simulation/simulation-world.port.js";
import { SimulationCampusRuntimeService } from "./simulation-campus-runtime.service.js";
import { SIMULATION_DOMAIN_RUNTIME, SimulationWorldService } from "./simulation-world.service.js";
let SimulationWorldModule = class SimulationWorldModule {
};
SimulationWorldModule = __decorate([
    Global(),
    Module({ imports: [CampusModelCoreModule, ActivityAttendanceModule, SchedulePlanningModule, AttendanceModelModule, SchoolModule, StaffOperationsModule, AssessmentsModule, PeopleModule, DepartureCoordinationModule, OperationsModule, ChatModule], providers: [SimulationOfferResponseAdapter, SimulationCampusRuntimeService,
            { provide: SIMULATION_DOMAIN_RUNTIME, useExisting: SimulationCampusRuntimeService }, SimulationWorldService,
            { provide: SIMULATION_WORLD_PORT, useExisting: SimulationWorldService }], exports: [SIMULATION_WORLD_PORT, SimulationWorldService] })
], SimulationWorldModule);
export { SimulationWorldModule };
//# sourceMappingURL=simulation-world.module.js.map