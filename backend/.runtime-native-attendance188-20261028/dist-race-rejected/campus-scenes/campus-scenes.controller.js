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
import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req, Res, } from "@nestjs/common";
import { CampusScenesService } from "./campus-scenes.service.js";
let CampusSceneDirectoryController = class CampusSceneDirectoryController {
    scenes;
    constructor(scenes) {
        this.scenes = scenes;
    }
    directory(request, school) {
        return this.scenes.directory(request.authUser, school);
    }
};
__decorate([
    Get("/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], CampusSceneDirectoryController.prototype, "directory", null);
CampusSceneDirectoryController = __decorate([
    Controller("api/v1/schools/:schoolId/campus-scenes"),
    __metadata("design:paramtypes", [CampusScenesService])
], CampusSceneDirectoryController);
export { CampusSceneDirectoryController };
let CampusScenesController = class CampusScenesController {
    scenes;
    constructor(scenes) {
        this.scenes = scenes;
    }
    resources(request, school, campus, query) {
        return this.scenes.resources(request.authUser, school, campus, query);
    }
    resourceStates(request, school, campus) {
        return this.scenes.resourceStates(request.authUser, school, campus);
    }
    published(request, school, campus) {
        return this.scenes.published(request.authUser, school, campus);
    }
    workspace(request, school, campus) {
        return this.scenes.workspace(request.authUser, school, campus);
    }
    save(request, school, campus, body) {
        return this.scenes.saveDraft(request.authUser, school, campus, body);
    }
    publish(request, school, campus, body) {
        return this.scenes.publish(request.authUser, school, campus, body);
    }
    reviewedPlaces(request, school, campus, body) {
        return this.scenes.saveReviewedPlaces(request.authUser, school, campus, body, request);
    }
    reopen(request, school, campus, body) {
        return this.scenes.reopen(request.authUser, school, campus, body);
    }
    image(request, school, campus, body) {
        return this.scenes.uploadImage(request.authUser, school, campus, body);
    }
    async readImage(request, school, campus, id, reply) {
        const image = await this.scenes.readImage(request.authUser, school, campus, id);
        return reply
            .header("Content-Type", image.mime_type)
            .header("X-Content-Type-Options", "nosniff")
            .header("Cache-Control", "private, no-store")
            .send(image.bytes);
    }
};
__decorate([
    Get("resources/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("campusId")),
    __param(3, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], CampusScenesController.prototype, "resources", null);
__decorate([
    Get("resource-states/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("campusId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], CampusScenesController.prototype, "resourceStates", null);
__decorate([
    Get("published/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("campusId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], CampusScenesController.prototype, "published", null);
__decorate([
    Get("workspace/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("campusId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], CampusScenesController.prototype, "workspace", null);
__decorate([
    Put("draft/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("campusId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], CampusScenesController.prototype, "save", null);
__decorate([
    Post("publish/"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("campusId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], CampusScenesController.prototype, "publish", null);
__decorate([
    Post("reviewed-places/"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("campusId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], CampusScenesController.prototype, "reviewedPlaces", null);
__decorate([
    Post("reopen/"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("campusId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], CampusScenesController.prototype, "reopen", null);
__decorate([
    Post("images/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("campusId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], CampusScenesController.prototype, "image", null);
__decorate([
    Get("images/:imageId/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("campusId")),
    __param(3, Param("imageId")),
    __param(4, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, Object]),
    __metadata("design:returntype", Promise)
], CampusScenesController.prototype, "readImage", null);
CampusScenesController = __decorate([
    Controller("api/v1/schools/:schoolId/campus-scenes/:campusId"),
    __metadata("design:paramtypes", [CampusScenesService])
], CampusScenesController);
export { CampusScenesController };
//# sourceMappingURL=campus-scenes.controller.js.map