import { Module } from "@nestjs/common";
import { DepartureCoordinationController } from "./departure-coordination.controller.js";
import { DepartureCoordinationService } from "./departure-coordination.service.js";
import { SchoolModule } from "../school/school.module.js";
import { TransportRetentionService } from "./transport-retention.service.js";

@Module({ imports:[SchoolModule],controllers: [DepartureCoordinationController], providers: [DepartureCoordinationService,TransportRetentionService] })
export class DepartureCoordinationModule {}
