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
import { Controller, Get, Post, Param, Query, Req, HttpCode } from "@nestjs/common";
import { ApiTags, ApiCookieAuth } from "@nestjs/swagger";
import { PeopleService } from "./people.service.js";
import { GuardianAuthorityService } from "./guardian-authority.service.js";
let PeopleController = class PeopleController {
    people;
    authority;
    constructor(people, authority) {
        this.people = people;
        this.authority = authority;
    }
    authorityDetail(req, id, schoolId) { return this.authority.detail(req.authUser, id, schoolId); }
    authorityChange(req, id) { return this.authority.change(req, id, req.body); }
    list(req, query) { return this.people.list(req.authUser, query); }
    lifecycle(req, id, schoolId) { return this.people.lifecycle(req.authUser, id, schoolId); }
    previewLifecycle(req, id) { return this.people.previewLifecycle(req, id, req.body); }
    commitLifecycle(req, id) { return this.people.commitLifecycle(req, id); }
    guardians(req, query) { return this.people.guardians(req.authUser, query); }
    options(req, schoolId) { return this.people.options(req.authUser, schoolId); }
    preview(req) { return this.people.preview(req, req.body); }
    commit(req, id) { return this.people.commit(req, id); }
    linkGuardian(req) { return this.people.linkGuardian(req, req.body); }
};
__decorate([
    Get("guardian-relationships/:id/leave-authority"),
    __param(0, Req()),
    __param(1, Param("id")),
    __param(2, Query("school_id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], PeopleController.prototype, "authorityDetail", null);
__decorate([
    Post("guardian-relationships/:id/leave-authority"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], PeopleController.prototype, "authorityChange", null);
__decorate([
    Get("students"),
    __param(0, Req()),
    __param(1, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], PeopleController.prototype, "list", null);
__decorate([
    Get("students/:id/enrollment-lifecycle"),
    __param(0, Req()),
    __param(1, Param("id")),
    __param(2, Query("school_id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], PeopleController.prototype, "lifecycle", null);
__decorate([
    Post("students/:id/enrollment-change-reviews"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], PeopleController.prototype, "previewLifecycle", null);
__decorate([
    Post("enrollment-change-reviews/:id/commit"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], PeopleController.prototype, "commitLifecycle", null);
__decorate([
    Get("guardians"),
    __param(0, Req()),
    __param(1, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], PeopleController.prototype, "guardians", null);
__decorate([
    Get("enrollment-options"),
    __param(0, Req()),
    __param(1, Query("school_id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], PeopleController.prototype, "options", null);
__decorate([
    Post("enrollment-reviews"),
    HttpCode(200),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], PeopleController.prototype, "preview", null);
__decorate([
    Post("enrollment-reviews/:id/commit"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], PeopleController.prototype, "commit", null);
__decorate([
    Post("guardian-links"),
    HttpCode(200),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], PeopleController.prototype, "linkGuardian", null);
PeopleController = __decorate([
    ApiTags("people"),
    ApiCookieAuth(),
    Controller("api/v1/people"),
    __metadata("design:paramtypes", [PeopleService, GuardianAuthorityService])
], PeopleController);
export { PeopleController };
//# sourceMappingURL=people.controller.js.map