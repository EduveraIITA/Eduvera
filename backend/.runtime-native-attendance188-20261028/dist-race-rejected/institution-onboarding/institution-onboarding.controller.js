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
import { Controller, Get, Patch, Post, Put, Req } from "@nestjs/common";
import { InstitutionOnboardingService } from "./institution-onboarding.service.js";
let InstitutionOnboardingController = class InstitutionOnboardingController {
    onboarding;
    constructor(onboarding) {
        this.onboarding = onboarding;
    }
    workspace(request) {
        return this.onboarding.workspace(request.authUser);
    }
    provisionWorkspace(request) {
        return this.onboarding.provision(request.authUser, request.sessionHash, request.body, request);
    }
    goals(request) {
        return this.onboarding.setGoals(request.authUser, request.body, request);
    }
    resume(request) {
        return this.onboarding.setResume(request.authUser, request.body, request);
    }
    profile(request) {
        return this.onboarding.setProfile(request.authUser, request.body, request);
    }
    submitInstitution(request) {
        return this.onboarding.submitFormal(request.authUser, request.body, request);
    }
};
__decorate([
    Get("workspace/"),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], InstitutionOnboardingController.prototype, "workspace", null);
__decorate([
    Post("workspace/"),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], InstitutionOnboardingController.prototype, "provisionWorkspace", null);
__decorate([
    Put("goals/"),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], InstitutionOnboardingController.prototype, "goals", null);
__decorate([
    Patch("resume/"),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], InstitutionOnboardingController.prototype, "resume", null);
__decorate([
    Patch("workspace-profile/"),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], InstitutionOnboardingController.prototype, "profile", null);
__decorate([
    Post("institution-applications/"),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], InstitutionOnboardingController.prototype, "submitInstitution", null);
InstitutionOnboardingController = __decorate([
    Controller("api/v1/onboarding"),
    __metadata("design:paramtypes", [InstitutionOnboardingService])
], InstitutionOnboardingController);
export { InstitutionOnboardingController };
//# sourceMappingURL=institution-onboarding.controller.js.map