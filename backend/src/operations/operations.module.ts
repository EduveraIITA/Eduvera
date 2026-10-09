import { RazorpayClient } from "./razorpay.client.js";
import { PaymentEmailService } from "./payment-email.service.js";
import { RazorpayService } from "./razorpay.service.js";
import { RazorpayController } from "./razorpay.controller.js";
import { FeeReviewService } from "./fee-review.service.js";
import { Module } from "@nestjs/common";
import { OperationsController } from "./operations.controller.js";
import { OperationsService } from "./operations.service.js";

@Module({ controllers: [OperationsController, RazorpayController], providers: [OperationsService, FeeReviewService, RazorpayClient, RazorpayService, PaymentEmailService] })
export class OperationsModule {}
