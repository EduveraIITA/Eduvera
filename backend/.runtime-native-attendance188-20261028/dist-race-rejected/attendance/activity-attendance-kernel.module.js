var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Module } from "@nestjs/common";
import { CampusModelCoreModule } from "../campus-model-core/campus-model-core.module.js";
import { ActivityAttendanceService } from "./activity-attendance.service.js";
import { AcademicParticipationBridge } from "./academic-participation-bridge.service.js";
import { ParticipationContextAuthorityRegistry } from "./participation-context-authority.js";
import { OwnedParticipationBridge } from "./owned-participation-bridge.service.js";
/** No Planning/School module dependency: owning adapters call this single writer. */
let ActivityAttendanceKernelModule = class ActivityAttendanceKernelModule {
};
ActivityAttendanceKernelModule = __decorate([
    Module({
        imports: [CampusModelCoreModule],
        providers: [ActivityAttendanceService, AcademicParticipationBridge, ParticipationContextAuthorityRegistry, OwnedParticipationBridge],
        exports: [ActivityAttendanceService, AcademicParticipationBridge, ParticipationContextAuthorityRegistry, OwnedParticipationBridge],
    })
], ActivityAttendanceKernelModule);
export { ActivityAttendanceKernelModule };
//# sourceMappingURL=activity-attendance-kernel.module.js.map