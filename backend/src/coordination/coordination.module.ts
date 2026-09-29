import { Module } from "@nestjs/common";
import { SchoolModule } from "../school/school.module.js";
import { CoordinationController } from "./coordination.controller.js";
import { CoordinationService } from "./coordination.service.js";

@Module({ imports: [SchoolModule], controllers: [CoordinationController], providers: [CoordinationService] })
export class CoordinationModule {}
