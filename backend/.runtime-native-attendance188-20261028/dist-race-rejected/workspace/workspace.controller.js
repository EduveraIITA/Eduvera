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
import { Controller, Get, Req } from "@nestjs/common";
import { WorkspaceService } from "./workspace.service.js";
let WorkspaceController = class WorkspaceController {
    workspace;
    constructor(workspace) {
        this.workspace = workspace;
    }
    manifest(request) {
        return this.workspace.manifest(request.authUser, request.executionEnvironment, request.executionEnvironmentView);
    }
};
__decorate([
    Get(),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], WorkspaceController.prototype, "manifest", null);
WorkspaceController = __decorate([
    Controller("api/v1/workspace"),
    __metadata("design:paramtypes", [WorkspaceService])
], WorkspaceController);
export { WorkspaceController };
//# sourceMappingURL=workspace.controller.js.map