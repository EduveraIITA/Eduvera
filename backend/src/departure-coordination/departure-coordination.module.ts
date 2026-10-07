import { Module } from "@nestjs/common";
import { DepartureCoordinationController } from "./departure-coordination.controller.js";
import { DepartureCoordinationService } from "./departure-coordination.service.js";
import { SchoolModule } from "../school/school.module.js";

@Module({ imports:[SchoolModule],controllers: [DepartureCoordinationController], providers: [DepartureCoordinationService] })
export class DepartureCoordinationModule {}
