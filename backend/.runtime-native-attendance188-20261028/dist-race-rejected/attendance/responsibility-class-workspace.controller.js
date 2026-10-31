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
import { ResponsibilityClassWorkspaceService } from "./responsibility-class-workspace.service.js";
let ResponsibilityClassWorkspaceController = class ResponsibilityClassWorkspaceController {
    classes;
    constructor(classes) {
        this.classes = classes;
    }
    directory(request, date) {
        return this.classes.classes(request.authUser, request.executionEnvironment, request.executionEnvironmentView, date);
    }
    updates(request, date) {
        return this.classes.updates(request.authUser, request.executionEnvironment, request.executionEnvironmentView, date);
    }
    detail(request, classSectionId, date) {
        return this.classes.classDetail(request.authUser, request.executionEnvironment, request.executionEnvironmentView, classSectionId, date);
    }
};
__decorate([
    Get(),
    __param(0, Req()),
    __param(1, Query("date")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], ResponsibilityClassWorkspaceController.prototype, "directory", null);
__decorate([
    Get("updates/"),
    __param(0, Req()),
    __param(1, Query("date")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], ResponsibilityClassWorkspaceController.prototype, "updates", null);
__decorate([
    Get(":classSectionId/"),
    __param(0, Req()),
    __param(1, Param("classSectionId")),
    __param(2, Query("date")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], ResponsibilityClassWorkspaceController.prototype, "detail", null);
ResponsibilityClassWorkspaceController = __decorate([
    Controller("api/v1/areas/people/classes"),
    __metadata("design:paramtypes", [ResponsibilityClassWorkspaceService])
], ResponsibilityClassWorkspaceController);
export { ResponsibilityClassWorkspaceController };
//# sourceMappingURL=responsibility-class-workspace.controller.js.map