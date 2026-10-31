import { Module } from "@nestjs/common";
import { CampusModelCoreModule } from "../campus-model-core/campus-model-core.module.js";
import { CampusDatesController } from "./campus-dates.controller.js";
import { CampusDatesModel } from "./campus-dates.model.js";
import { CampusDatesService } from "./campus-dates.service.js";
@Module({ imports: [CampusModelCoreModule], controllers: [CampusDatesController], providers: [CampusDatesModel, CampusDatesService], exports: [CampusDatesService] })
export class CampusDatesModule {}
