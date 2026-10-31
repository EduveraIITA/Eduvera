var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { Controller, Get, Param, Query, Req } from "@nestjs/common";
import { z } from "zod";
import { SimulationWorldService } from "../database/simulation-world.service.js";
import { SimulationService } from "./simulation.service.js";
let SimulationResourcesController = class SimulationResourcesController {
    simulations;
    worlds;
    constructor(simulations, worlds) {
        this.simulations = simulations;
        this.worlds = worlds;
    }
    async list(request, schoolId, runId, query) {
        const page = z.object({ page: z.coerce.number().int().min(1).max(100_000).default(1),
            page_size: z.coerce.number().int().min(1).max(25).default(5) }).strict().parse(query);
        // The ordinary Live control-plane administrator + tenant/retention check is
        // mandatory even if the caller currently has a Simulation selected.
        await this.simulations.get(request.authUser, schoolId, runId);
        return this.worlds.resources(schoolId, runId, page.page, page.page_size);
    }
};
__decorate([
    Get("runs/:runId/resources"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("runId")),
    __param(3, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", Promise)
], SimulationResourcesController.prototype, "list", null);
SimulationResourcesController = __decorate([
    Controller("api/v1/schools/:schoolId/simulation"),
    __metadata("design:paramtypes", [SimulationService, SimulationWorldService])
], SimulationResourcesController);
export { SimulationResourcesController };
//# sourceMappingURL=simulation-resources.controller.js.map