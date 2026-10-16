import { Module } from "@nestjs/common";
import { CampusModelCoreModule } from "../campus-model-core/campus-model-core.module.js";
import { SchoolModule } from "../school/school.module.js";
import { GateController } from "./gate.controller.js";
import { GateService } from "./gate.service.js";
@Module({imports:[SchoolModule,CampusModelCoreModule],controllers:[GateController],providers:[GateService]})
export class GateModule {}
