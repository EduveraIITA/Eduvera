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
import { Body, Controller, Get, Param, Patch, Post, Put, Query, Req } from "@nestjs/common";
import { SimulationService } from "./simulation.service.js";
let SimulationController = class SimulationController {
    simulations;
    constructor(simulations) {
        this.simulations = simulations;
    }
    list(request, schoolId, query) {
        return this.simulations.list(request.authUser, schoolId, query);
    }
    create(request, schoolId, body) {
        return this.simulations.create(request.authUser, schoolId, body);
    }
    compare(request, schoolId, body) {
        return this.simulations.compare(request.authUser, schoolId, body);
    }
    get(request, schoolId, runId) {
        return this.simulations.get(request.authUser, schoolId, runId);
    }
    updateDraft(request, schoolId, runId, body) {
        return this.simulations.updateDraft(request.authUser, schoolId, runId, body);
    }
    recordChange(request, schoolId, runId, body) {
        return this.simulations.recordChange(request.authUser, schoolId, runId, body);
    }
    configureBehaviour(request, schoolId, runId, body) {
        return this.simulations.configureBehaviour(request.authUser, schoolId, runId, body);
    }
    duplicate(request, schoolId, runId, body) {
        return this.simulations.duplicate(request.authUser, schoolId, runId, body);
    }
    start(request, schoolId, runId, body) {
        return this.simulations.start(request.authUser, schoolId, runId, body);
    }
    pause(request, schoolId, runId) {
        return this.simulations.pause(request.authUser, schoolId, runId);
    }
    resume(request, schoolId, runId, body) {
        return this.simulations.resume(request.authUser, schoolId, runId, body);
    }
    stop(request, schoolId, runId) {
        return this.simulations.stop(request.authUser, schoolId, runId);
    }
    pin(request, schoolId, runId) {
        return this.simulations.pin(request.authUser, schoolId, runId);
    }
    unpin(request, schoolId, runId) {
        return this.simulations.unpin(request.authUser, schoolId, runId);
    }
    remove(request, schoolId, runId, body) {
        return this.simulations.remove(request.authUser, schoolId, runId, body);
    }
};
__decorate([
    Get("runs"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], SimulationController.prototype, "list", null);
__decorate([
    Post("runs"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], SimulationController.prototype, "create", null);
__decorate([
    Post("compare"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], SimulationController.prototype, "compare", null);
__decorate([
    Get("runs/:runId"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("runId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], SimulationController.prototype, "get", null);
__decorate([
    Patch("runs/:runId/draft"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("runId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], SimulationController.prototype, "updateDraft", null);
__decorate([
    Post("runs/:runId/changes"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("runId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], SimulationController.prototype, "recordChange", null);
__decorate([
    Put("runs/:runId/behaviour"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("runId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], SimulationController.prototype, "configureBehaviour", null);
__decorate([
    Post("runs/:runId/duplicate"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("runId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], SimulationController.prototype, "duplicate", null);
__decorate([
    Post("runs/:runId/start"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("runId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], SimulationController.prototype, "start", null);
__decorate([
    Post("runs/:runId/pause"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("runId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], SimulationController.prototype, "pause", null);
__decorate([
    Post("runs/:runId/resume"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("runId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], SimulationController.prototype, "resume", null);
__decorate([
    Post("runs/:runId/stop"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("runId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], SimulationController.prototype, "stop", null);
__decorate([
    Post("runs/:runId/pin"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("runId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], SimulationController.prototype, "pin", null);
__decorate([
    Post("runs/:runId/unpin"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("runId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], SimulationController.prototype, "unpin", null);
__decorate([
    Post("runs/:runId/remove"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("runId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], SimulationController.prototype, "remove", null);
SimulationController = __decorate([
    Controller("api/v1/schools/:schoolId/simulation"),
    __metadata("design:paramtypes", [SimulationService])
], SimulationController);
export { SimulationController };
//# sourceMappingURL=simulation.controller.js.map