import { Module } from "@nestjs/common";
import { CampusModelCoreModule } from "../campus-model-core/campus-model-core.module.js";
import { RestrictedCareController } from "./restricted-care.controller.js";
import { RestrictedCareService } from "./restricted-care.service.js";
import { RestrictedCareModel } from "./restricted-care.model.js";

@Module({ imports: [CampusModelCoreModule], controllers: [RestrictedCareController], providers: [RestrictedCareService, RestrictedCareModel], exports: [RestrictedCareService] })
export class RestrictedCareModule {}
