var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
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
let PeopleModule = class PeopleModule {
};
PeopleModule = __decorate([
    Module({ imports: [SchoolModule, CampusModelCoreModule, ActivityAttendanceKernelModule], controllers: [PeopleController, PeopleImportController, ParticipationPeopleController], providers: [PeopleService, GuardianAuthorityService, PeopleImportService, ParticipationPeopleService], exports: [PeopleImportService, ParticipationPeopleService] })
], PeopleModule);
export { PeopleModule };
//# sourceMappingURL=people.module.js.map