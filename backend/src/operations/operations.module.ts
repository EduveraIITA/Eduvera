import { FeeReviewService } from "./fee-review.service.js";
import { Module } from "@nestjs/common";
import { OperationsController } from "./operations.controller.js";
import { OperationsService } from "./operations.service.js";

@Module({ controllers: [OperationsController], providers: [OperationsService, FeeReviewService] })
export class OperationsModule {}
