import { Module } from "@nestjs/common";
import { CampusModelCoreModule } from "../campus-model-core/campus-model-core.module.js";
import { FinanceArrangementsModule } from "./finance-arrangements.module.js";
import { NativeFeeReviewsController } from "./native-fee-reviews.controller.js";
import { NativeFeeReviewsModel } from "./native-fee-reviews.model.js";
import { NativeFeeReviewsService } from "./native-fee-reviews.service.js";

@Module({ imports: [CampusModelCoreModule, FinanceArrangementsModule], controllers: [NativeFeeReviewsController],
  providers: [NativeFeeReviewsModel, NativeFeeReviewsService], exports: [NativeFeeReviewsService, NativeFeeReviewsModel] })
export class NativeFeeReviewsModule {}
