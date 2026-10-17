import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { CampusModelCoreModule } from "../campus-model-core/campus-model-core.module.js";
import { InstitutionOnboardingController } from "./institution-onboarding.controller.js";
import { InstitutionOnboardingService } from "./institution-onboarding.service.js";

@Module({
  imports: [AuthModule, CampusModelCoreModule],
  controllers: [InstitutionOnboardingController],
  providers: [InstitutionOnboardingService],
})
export class InstitutionOnboardingModule {}
