import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { InstitutionOnboardingController } from "./institution-onboarding.controller.js";
import { InstitutionOnboardingService } from "./institution-onboarding.service.js";

@Module({ imports: [AuthModule], controllers: [InstitutionOnboardingController], providers: [InstitutionOnboardingService] })
export class InstitutionOnboardingModule {}
