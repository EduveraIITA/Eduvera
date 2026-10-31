var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Module } from "@nestjs/common";
import { SchoolModule } from "../school/school.module.js";
import { CoordinationController } from "./coordination.controller.js";
import { CoordinationService } from "./coordination.service.js";
import { CampusModelCoreModule } from "../campus-model-core/campus-model-core.module.js";
import { FollowupModelBridgeService } from "./followup-model-bridge.service.js";
let CoordinationModule = class CoordinationModule {
};
CoordinationModule = __decorate([
    Module({ imports: [SchoolModule, CampusModelCoreModule], controllers: [CoordinationController], providers: [CoordinationService, FollowupModelBridgeService] })
], CoordinationModule);
export { CoordinationModule };
//# sourceMappingURL=coordination.module.js.map