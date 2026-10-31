var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Module } from "@nestjs/common";
import { CampusLabHostedController } from "./campus-lab-hosted.controller.js";
import { CampusLabHostedService } from "./campus-lab-hosted.service.js";
import { AuthModule } from "../auth/auth.module.js";
import { CampusLabSimulationEnvironmentService } from "../database/campus-lab-simulation-environment.service.js";
/**
 * Development-harness boundary. The product AppModule deliberately does not
 * import this module; a dedicated local harness bootstrap may opt into it.
 */
let CampusLabHostedModule = class CampusLabHostedModule {
};
CampusLabHostedModule = __decorate([
    Module({
        imports: [AuthModule],
        controllers: [CampusLabHostedController],
        providers: [CampusLabHostedService, CampusLabSimulationEnvironmentService],
    })
], CampusLabHostedModule);
export { CampusLabHostedModule };
//# sourceMappingURL=campus-lab-hosted.module.js.map