import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { InstitutionActivationController } from "./institution-activation.controller.js";
import { InstitutionActivationService } from "./institution-activation.service.js";

@Module({
  imports: [AuthModule],
  controllers: [InstitutionActivationController],
  providers: [InstitutionActivationService],
})
export class InstitutionActivationModule {}
