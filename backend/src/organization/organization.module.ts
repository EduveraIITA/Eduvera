import { Module } from "@nestjs/common";
import { CampusModelCoreModule } from "../campus-model-core/campus-model-core.module.js";
import { OrganizationController } from "./organization.controller.js";
import { OrganizationService } from "./organization.service.js";

@Module({ imports: [CampusModelCoreModule], controllers: [OrganizationController], providers: [OrganizationService] })
export class OrganizationModule {}
