import { RazorpayClient } from "./razorpay.client.js";
import { PaymentEmailService } from "./payment-email.service.js";
import { RazorpayService } from "./razorpay.service.js";
import { RazorpayController } from "./razorpay.controller.js";
import { FeeReviewService } from "./fee-review.service.js";
import { Module } from "@nestjs/common";
import { OperationsController } from "./operations.controller.js";
import { OperationsService } from "./operations.service.js";
import { StaffCoverageReconciliationModule } from "../staff-operations/staff-coverage-reconciliation.module.js";
import { CampusModelCoreModule } from "../campus-model-core/campus-model-core.module.js";
import { PersonAccountInvitationsService } from "./person-account-invitations.service.js";
import { LegacyPeopleModelService } from "./legacy-people-model.service.js";
import { FeeLedgerService } from "./fee-ledger.service.js";
import { FeeChargeBatchService } from "./fee-charge-batch.service.js";
import { FeeChargeBatchController } from "./fee-charge-batch.controller.js";
import { FeeCorrectionsService } from "./fee-corrections.service.js";
import { FeeCorrectionsController } from "./fee-corrections.controller.js";
import { NativeFeeReviewsModule } from "./native-fee-reviews.module.js";

@Module({ imports: [StaffCoverageReconciliationModule, CampusModelCoreModule, NativeFeeReviewsModule], controllers: [OperationsController, RazorpayController, FeeChargeBatchController, FeeCorrectionsController], providers: [OperationsService, PersonAccountInvitationsService, LegacyPeopleModelService, FeeLedgerService, FeeChargeBatchService, FeeCorrectionsService, FeeReviewService, RazorpayClient, RazorpayService, PaymentEmailService], exports: [RazorpayService, PaymentEmailService] })
export class OperationsModule {}
