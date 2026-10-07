import { Module } from "@nestjs/common";
import { SchoolController } from "./school.controller.js";
import { SchoolEventService } from "./school-event.service.js";
import { SchoolService } from "./school.service.js";

@Module({ controllers: [SchoolController], providers: [SchoolService, SchoolEventService], exports: [SchoolService, SchoolEventService] })
export class SchoolModule {}
