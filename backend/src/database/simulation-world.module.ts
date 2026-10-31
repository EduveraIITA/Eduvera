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

@Global()
@Module({ imports: [CampusModelCoreModule, ActivityAttendanceModule, SchedulePlanningModule, AttendanceModelModule, SchoolModule, StaffOperationsModule, AssessmentsModule, PeopleModule, DepartureCoordinationModule, OperationsModule, ChatModule], providers: [SimulationOfferResponseAdapter, SimulationCampusRuntimeService,
  { provide: SIMULATION_DOMAIN_RUNTIME, useExisting: SimulationCampusRuntimeService }, SimulationWorldService,
  { provide: SIMULATION_WORLD_PORT, useExisting: SimulationWorldService }], exports: [SIMULATION_WORLD_PORT, SimulationWorldService] })
export class SimulationWorldModule {}
