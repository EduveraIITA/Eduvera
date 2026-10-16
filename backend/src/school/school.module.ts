import { Module } from "@nestjs/common";
import { CampusModelCoreModule } from "../campus-model-core/campus-model-core.module.js";
import { SchoolController } from "./school.controller.js";
import { SchoolEventService } from "./school-event.service.js";
import { SchoolService } from "./school.service.js";

@Module({ imports: [CampusModelCoreModule], controllers: [SchoolController], providers: [SchoolService, SchoolEventService], exports: [SchoolService, SchoolEventService] })
export class SchoolModule {}
