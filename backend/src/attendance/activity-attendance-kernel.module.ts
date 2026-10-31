import { Module } from "@nestjs/common";
import { CampusModelCoreModule } from "../campus-model-core/campus-model-core.module.js";
import { ActivityAttendanceService } from "./activity-attendance.service.js";
import { AcademicParticipationBridge } from "./academic-participation-bridge.service.js";
import { ParticipationContextAuthorityRegistry } from "./participation-context-authority.js";
import { OwnedParticipationBridge } from "./owned-participation-bridge.service.js";

/** No Planning/School module dependency: owning adapters call this single writer. */
@Module({
  imports: [CampusModelCoreModule],
  providers: [ActivityAttendanceService, AcademicParticipationBridge, ParticipationContextAuthorityRegistry, OwnedParticipationBridge],
  exports: [ActivityAttendanceService, AcademicParticipationBridge, ParticipationContextAuthorityRegistry, OwnedParticipationBridge],
})
export class ActivityAttendanceKernelModule {}
