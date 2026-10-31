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
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Req } from "@nestjs/common";
import { InstitutionSetupService } from "./institution-setup.service.js";
let InstitutionSetupController = class InstitutionSetupController {
    setup;
    constructor(setup) {
        this.setup = setup;
    }
    workspace(request, schoolId) {
        return this.setup.workspace(request.authUser, schoolId);
    }
    createCampus(request, schoolId, body) {
        return this.setup.createCampus(request.authUser, schoolId, body, request);
    }
    updateCampus(request, schoolId, campusId, body) {
        return this.setup.updateCampus(request.authUser, schoolId, campusId, body, request);
    }
    createSpace(request, schoolId, body) {
        return this.setup.createSpace(request.authUser, schoolId, body, request);
    }
    updateSpace(request, schoolId, spaceId, body) {
        return this.setup.updateSpace(request.authUser, schoolId, spaceId, body, request);
    }
    createAsset(request, schoolId, body) {
        return this.setup.createAsset(request.authUser, schoolId, body, request);
    }
    createResourceType(request, schoolId, body) {
        return this.setup.createResourceType(request.authUser, schoolId, body, request);
    }
    updateResourceType(request, schoolId, resourceTypeId, body) {
        return this.setup.updateResourceType(request.authUser, schoolId, resourceTypeId, body, request);
    }
    updateAsset(request, schoolId, assetId, body) {
        return this.setup.updateAsset(request.authUser, schoolId, assetId, body, request);
    }
    placeClass(request, schoolId, classSectionId, body) {
        return this.setup.placeClass(request.authUser, schoolId, classSectionId, body, request);
    }
    placeStaff(request, schoolId, staffProfileId, body) {
        return this.setup.placeStaff(request.authUser, schoolId, staffProfileId, body, request);
    }
    registerObservationSource(request, schoolId, body) {
        return this.setup.registerObservationSource(request.authUser, schoolId, body, request);
    }
    setObservationSourceStatus(request, schoolId, sourceId, body) {
        return this.setup.setObservationSourceStatus(request.authUser, schoolId, sourceId, body, request);
    }
};
__decorate([
    Get("/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], InstitutionSetupController.prototype, "workspace", null);
__decorate([
    Post("campuses/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], InstitutionSetupController.prototype, "createCampus", null);
__decorate([
    Patch("campuses/:campusId/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("campusId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], InstitutionSetupController.prototype, "updateCampus", null);
__decorate([
    Post("spaces/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], InstitutionSetupController.prototype, "createSpace", null);
__decorate([
    Patch("spaces/:spaceId/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("spaceId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], InstitutionSetupController.prototype, "updateSpace", null);
__decorate([
    Post("assets/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], InstitutionSetupController.prototype, "createAsset", null);
__decorate([
    Post("resource-types/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], InstitutionSetupController.prototype, "createResourceType", null);
__decorate([
    Patch("resource-types/:resourceTypeId/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("resourceTypeId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], InstitutionSetupController.prototype, "updateResourceType", null);
__decorate([
    Patch("assets/:assetId/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("assetId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], InstitutionSetupController.prototype, "updateAsset", null);
__decorate([
    Patch("classes/:classSectionId/location/"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("classSectionId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], InstitutionSetupController.prototype, "placeClass", null);
__decorate([
    Post("staff/:staffProfileId/campus/"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("staffProfileId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], InstitutionSetupController.prototype, "placeStaff", null);
__decorate([
    Post("observation-sources/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], InstitutionSetupController.prototype, "registerObservationSource", null);
__decorate([
    Patch("observation-sources/:sourceId/status/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("sourceId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], InstitutionSetupController.prototype, "setObservationSourceStatus", null);
InstitutionSetupController = __decorate([
    Controller("api/v1/schools/:schoolId/institution-setup"),
    __metadata("design:paramtypes", [InstitutionSetupService])
], InstitutionSetupController);
export { InstitutionSetupController };
//# sourceMappingURL=institution-setup.controller.js.map