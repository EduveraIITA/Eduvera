import { RazorpayClient } from "./razorpay.client.js";
import { RazorpayService } from "./razorpay.service.js";
import { RazorpayController } from "./razorpay.controller.js";
import { FeeReviewService } from "./fee-review.service.js";
import { Module } from "@nestjs/common";
import { OperationsController } from "./operations.controller.js";
import { OperationsService } from "./operations.service.js";

@Module({ controllers: [OperationsController, RazorpayController], providers: [OperationsService, FeeReviewService, RazorpayClient, RazorpayService] })
export class OperationsModule {}
