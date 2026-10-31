import { Module } from "@nestjs/common";
import { CampusModelCoreModule } from "../../campus-model-core/campus-model-core.module.js";
import { ResourceLoansModule } from "../../resource-loans/resource-loans.module.js";
import { AccommodationService } from "./accommodation.service.js";
import { AccommodationAccess } from "./accommodation.access.js";
import { AccommodationModel } from "./accommodation.model.js";
import { AccommodationController } from "./accommodation.controller.js";
@Module({
  imports: [CampusModelCoreModule, ResourceLoansModule],
  controllers: [AccommodationController],
  providers: [AccommodationService, AccommodationAccess, AccommodationModel],
  exports: [AccommodationService],
})
export class AccommodationModule {}
