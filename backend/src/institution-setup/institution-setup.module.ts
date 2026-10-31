import { Module } from "@nestjs/common";
import { AuditService } from "../common/audit.service.js";
import { CampusModelCoreModule } from "../campus-model-core/campus-model-core.module.js";
import { InstitutionSetupController } from "./institution-setup.controller.js";
import { InstitutionSetupService } from "./institution-setup.service.js";

@Module({
  // Authentication and CSRF are application-global guards. This owner does not
  // consume Auth providers; importing Auth here creates an ESM cycle through
  // Simulation → Attendance → Workspace → Resources → topology.
  imports: [CampusModelCoreModule],
  controllers: [InstitutionSetupController],
  providers: [InstitutionSetupService, AuditService],
  exports: [InstitutionSetupService],
})
export class InstitutionSetupModule {}
