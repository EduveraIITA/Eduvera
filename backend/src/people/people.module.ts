import { Module } from "@nestjs/common";
import { SchoolModule } from "../school/school.module.js";
import { PeopleController } from "./people.controller.js";
import { PeopleService } from "./people.service.js";
import { GuardianAuthorityService } from "./guardian-authority.service.js";
import { PeopleImportService } from "./people-import.service.js";
import { PeopleImportController } from "./people-import.controller.js";
@Module({imports:[SchoolModule],controllers:[PeopleController,PeopleImportController],providers:[PeopleService,GuardianAuthorityService,PeopleImportService]})
export class PeopleModule {}
