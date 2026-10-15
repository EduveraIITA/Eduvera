import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { CampusModelCoreModule } from "../campus-model-core/campus-model-core.module.js";
import { InstitutionSetupController } from "./institution-setup.controller.js";
import { InstitutionSetupService } from "./institution-setup.service.js";

@Module({
  imports: [AuthModule, CampusModelCoreModule],
  controllers: [InstitutionSetupController],
  providers: [InstitutionSetupService],
})
export class InstitutionSetupModule {}
