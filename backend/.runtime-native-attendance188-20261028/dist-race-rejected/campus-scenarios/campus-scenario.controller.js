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
import { Body, Controller, Delete, Get, Param, Post, Query, Req } from "@nestjs/common";
import { CampusScenarioService } from "./campus-scenario.service.js";
let CampusScenarioController = class CampusScenarioController {
    scenarios;
    constructor(scenarios) {
        this.scenarios = scenarios;
    }
    targets(request, schoolId, query) {
        return this.scenarios.targets(request.authUser, schoolId, query);
    }
    create(request, schoolId, body) {
        return this.scenarios.create(request.authUser, schoolId, body);
    }
    get(request, schoolId, runId) {
        return this.scenarios.get(request.authUser, schoolId, runId);
    }
    discard(request, schoolId, runId) {
        return this.scenarios.discard(request.authUser, schoolId, runId);
    }
};
__decorate([
    Get("targets"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], CampusScenarioController.prototype, "targets", null);
__decorate([
    Post(),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], CampusScenarioController.prototype, "create", null);
__decorate([
    Get(":runId"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("runId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], CampusScenarioController.prototype, "get", null);
__decorate([
    Delete(":runId"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("runId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], CampusScenarioController.prototype, "discard", null);
CampusScenarioController = __decorate([
    Controller("api/v1/schools/:schoolId/campus-view/scenarios"),
    __metadata("design:paramtypes", [CampusScenarioService])
], CampusScenarioController);
export { CampusScenarioController };
//# sourceMappingURL=campus-scenario.controller.js.map