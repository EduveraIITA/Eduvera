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
import { Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { ParticipationPeopleService } from "./participation-people.service.js";
let ParticipationPeopleController = class ParticipationPeopleController {
    people;
    constructor(people) {
        this.people = people;
    }
    list(req, schoolId, query) { return this.people.list(req.authUser, schoolId, query); }
    create(req, schoolId) { return this.people.create(req, schoolId, req.body); }
    nameCheck(req, schoolId) { return this.people.nameCheck(req.authUser, schoolId, req.body); }
    resolve(req, schoolId, query) { return this.people.resolvePerson(req.authUser, schoolId, query); }
    detail(req, schoolId, id) { return this.people.detail(req.authUser, schoolId, id); }
    correctName(req, schoolId, id) { return this.people.correctName(req, schoolId, id, req.body); }
    correctProfile(req, schoolId, id) { return this.people.correctProfile(req, schoolId, id, req.body); }
    connections(req, schoolId, id, query) { return this.people.connections(req.authUser, schoolId, id, query); }
    connect(req, schoolId, id) { return this.people.createConnection(req, schoolId, id, req.body); }
    endConnection(req, schoolId, id) { return this.people.endConnection(req, schoolId, id, req.body); }
    personGroups(req, schoolId, id, query) { return this.people.personGroups(req.authUser, schoolId, id, query); }
    groups(req, schoolId, query) { return this.people.groups(req.authUser, schoolId, query); }
    groupCatalogue(req, schoolId, query) { return this.people.groupCatalogue(req.authUser, schoolId, query); }
    nativeGroup(req, schoolId, kind, id, query) { return this.people.nativeGroup(req.authUser, schoolId, kind, id, query); }
    createGroup(req, schoolId) { return this.people.createGroup(req, schoolId, req.body); }
    groupDetail(req, schoolId, id, query) { return this.people.groupDetail(req.authUser, schoolId, id, query); }
    groupHistory(req, schoolId, id, query) { return this.people.groupMembershipHistory(req.authUser, schoolId, id, query); }
    moveGroup(req, schoolId, id) { return this.people.moveGroup(req, schoolId, id, req.body); }
    replace(req, schoolId, id) { return this.people.replaceMembers(req, schoolId, id, req.body); }
};
__decorate([
    Get("participants"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], ParticipationPeopleController.prototype, "list", null);
__decorate([
    Post("participants"),
    HttpCode(201),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], ParticipationPeopleController.prototype, "create", null);
__decorate([
    Post("participants/name-check"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], ParticipationPeopleController.prototype, "nameCheck", null);
__decorate([
    Get("resolve-person"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], ParticipationPeopleController.prototype, "resolve", null);
__decorate([
    Get("participants/:id"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], ParticipationPeopleController.prototype, "detail", null);
__decorate([
    Patch("participants/:id"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], ParticipationPeopleController.prototype, "correctName", null);
__decorate([
    Patch("participants/:id/profile"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], ParticipationPeopleController.prototype, "correctProfile", null);
__decorate([
    Get("participants/:id/connections"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("id")),
    __param(3, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], ParticipationPeopleController.prototype, "connections", null);
__decorate([
    Post("participants/:id/connections"),
    HttpCode(201),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], ParticipationPeopleController.prototype, "connect", null);
__decorate([
    Patch("connections/:id"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], ParticipationPeopleController.prototype, "endConnection", null);
__decorate([
    Get("participants/:id/groups"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("id")),
    __param(3, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], ParticipationPeopleController.prototype, "personGroups", null);
__decorate([
    Get("participation-groups"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], ParticipationPeopleController.prototype, "groups", null);
__decorate([
    Get("group-catalogue"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], ParticipationPeopleController.prototype, "groupCatalogue", null);
__decorate([
    Get("group-catalogue/:kind/:id"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("kind")),
    __param(3, Param("id")),
    __param(4, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, Object]),
    __metadata("design:returntype", void 0)
], ParticipationPeopleController.prototype, "nativeGroup", null);
__decorate([
    Post("participation-groups"),
    HttpCode(201),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], ParticipationPeopleController.prototype, "createGroup", null);
__decorate([
    Get("participation-groups/:id"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("id")),
    __param(3, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], ParticipationPeopleController.prototype, "groupDetail", null);
__decorate([
    Get("participation-groups/:id/history"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("id")),
    __param(3, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], ParticipationPeopleController.prototype, "groupHistory", null);
__decorate([
    Post("participation-groups/:id/parent"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], ParticipationPeopleController.prototype, "moveGroup", null);
__decorate([
    Patch("participation-groups/:id/members"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], ParticipationPeopleController.prototype, "replace", null);
ParticipationPeopleController = __decorate([
    Controller("api/v1/schools/:schoolId/people"),
    __metadata("design:paramtypes", [ParticipationPeopleService])
], ParticipationPeopleController);
export { ParticipationPeopleController };
//# sourceMappingURL=participation-people.controller.js.map