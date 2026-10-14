import { Module } from "@nestjs/common";
import { SchoolModule } from "../school/school.module.js";
import { GateController } from "./gate.controller.js";
import { GateService } from "./gate.service.js";
@Module({imports:[SchoolModule],controllers:[GateController],providers:[GateService]})
export class GateModule {}
