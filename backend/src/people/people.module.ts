import { Module } from "@nestjs/common";
import { SchoolModule } from "../school/school.module.js";
import { PeopleController } from "./people.controller.js";
import { PeopleService } from "./people.service.js";
import { GuardianAuthorityService } from "./guardian-authority.service.js";
import { PeopleImportService } from "./people-import.service.js";
import { PeopleImportController } from "./people-import.controller.js";
import { CampusModelCoreModule } from "../campus-model-core/campus-model-core.module.js";
import { ParticipationPeopleController } from "./participation-people.controller.js";
import { ParticipationPeopleService } from "./participation-people.service.js";
import { ActivityAttendanceKernelModule } from "../attendance/activity-attendance-kernel.module.js";
@Module({imports:[SchoolModule,CampusModelCoreModule,ActivityAttendanceKernelModule],controllers:[PeopleController,PeopleImportController,ParticipationPeopleController],providers:[PeopleService,GuardianAuthorityService,PeopleImportService,ParticipationPeopleService],exports:[PeopleImportService,ParticipationPeopleService]})
export class PeopleModule {}
