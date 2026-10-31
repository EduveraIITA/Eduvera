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
import { RequirePermission } from "../roles/permissions.js";
import { Controller, Get, HttpCode, Param, Post, Query, Req } from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import { CampusEventsService } from "./campus-events.service.js";
let CampusEventsController = class CampusEventsController {
    campusEvents;
    constructor(campusEvents) {
        this.campusEvents = campusEvents;
    }
    getObservationPolicy(request, schoolId) {
        return this.campusEvents.getObservationPolicy(request.authUser, schoolId);
    }
    saveObservationPolicy(request) {
        return this.campusEvents.saveObservationPolicy(request, request.body);
    }
    catalog(request, schoolId) {
        return this.campusEvents.catalog(request.authUser, schoolId);
    }
    consentAuthorities(request, schoolId, studentId) {
        return this.campusEvents.consentAuthorities(request.authUser, schoolId, studentId);
    }
    grantConsentAuthority(request, relationshipId) {
        return this.campusEvents.grantConsentAuthority(request, relationshipId, request.body);
    }
    revokeConsentAuthority(request, relationshipId) {
        return this.campusEvents.revokeConsentAuthority(request, relationshipId, request.body);
    }
    list(request, query) {
        return this.campusEvents.list(request.authUser, query);
    }
    create(request) {
        return this.campusEvents.create(request, request.body);
    }
    detail(request, eventId, schoolId, studentId) {
        return this.campusEvents.detail(request.authUser, eventId, schoolId, studentId);
    }
    save(request, eventId) {
        return this.campusEvents.save(request, eventId, request.body);
    }
    publish(request, eventId) {
        return this.campusEvents.publish(request, eventId, request.body);
    }
    cancel(request, eventId) {
        return this.campusEvents.cancel(request, eventId, request.body);
    }
    complete(request, eventId) {
        return this.campusEvents.complete(request, eventId, request.body);
    }
    discard(request, eventId) {
        return this.campusEvents.discard(request, eventId, request.body);
    }
    rsvp(request, eventId) {
        return this.campusEvents.rsvp(request, eventId, request.body);
    }
    consent(request, eventId) {
        return this.campusEvents.consent(request, eventId, request.body);
    }
    checklist(request, eventId, itemId) {
        return this.campusEvents.checklist(request, eventId, itemId, request.body);
    }
    roster(request, eventId, sessionId, schoolId) {
        return this.campusEvents.roster(request.authUser, eventId, sessionId, schoolId);
    }
    attendance(request, eventId, sessionId) {
        return this.campusEvents.attendance(request, eventId, sessionId, request.body);
    }
    history(request, eventId, sessionId, schoolId) {
        return this.campusEvents.history(request.authUser, eventId, sessionId, schoolId);
    }
    lock(request, eventId, sessionId) {
        return this.campusEvents.lock(request, eventId, sessionId, request.body);
    }
    reopen(request, eventId, sessionId) {
        return this.campusEvents.reopen(request, eventId, sessionId, request.body);
    }
};
__decorate([
    Get("attendance-policy"),
    __param(0, Req()),
    __param(1, Query("school_id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], CampusEventsController.prototype, "getObservationPolicy", null);
__decorate([
    Post("attendance-policy"),
    HttpCode(200),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], CampusEventsController.prototype, "saveObservationPolicy", null);
__decorate([
    Get("catalog"),
    RequirePermission("events.view"),
    __param(0, Req()),
    __param(1, Query("school_id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], CampusEventsController.prototype, "catalog", null);
__decorate([
    Get("consent-authorities"),
    __param(0, Req()),
    __param(1, Query("school_id")),
    __param(2, Query("student_id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], CampusEventsController.prototype, "consentAuthorities", null);
__decorate([
    Post("consent-authorities/:relationshipId/grant"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("relationshipId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], CampusEventsController.prototype, "grantConsentAuthority", null);
__decorate([
    Post("consent-authorities/:relationshipId/revoke"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("relationshipId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], CampusEventsController.prototype, "revokeConsentAuthority", null);
__decorate([
    Get(),
    RequirePermission("events.view"),
    __param(0, Req()),
    __param(1, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], CampusEventsController.prototype, "list", null);
__decorate([
    Post(),
    HttpCode(200),
    RequirePermission("events.manage"),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], CampusEventsController.prototype, "create", null);
__decorate([
    Get(":eventId"),
    RequirePermission("events.view"),
    __param(0, Req()),
    __param(1, Param("eventId")),
    __param(2, Query("school_id")),
    __param(3, Query("student_id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], CampusEventsController.prototype, "detail", null);
__decorate([
    Post(":eventId/save"),
    HttpCode(200),
    RequirePermission("events.manage"),
    __param(0, Req()),
    __param(1, Param("eventId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], CampusEventsController.prototype, "save", null);
__decorate([
    Post(":eventId/publish"),
    HttpCode(200),
    RequirePermission("events.manage"),
    __param(0, Req()),
    __param(1, Param("eventId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], CampusEventsController.prototype, "publish", null);
__decorate([
    Post(":eventId/cancel"),
    HttpCode(200),
    RequirePermission("events.manage"),
    __param(0, Req()),
    __param(1, Param("eventId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], CampusEventsController.prototype, "cancel", null);
__decorate([
    Post(":eventId/complete"),
    HttpCode(200),
    RequirePermission("events.manage"),
    __param(0, Req()),
    __param(1, Param("eventId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], CampusEventsController.prototype, "complete", null);
__decorate([
    Post(":eventId/discard"),
    HttpCode(200),
    RequirePermission("events.manage"),
    __param(0, Req()),
    __param(1, Param("eventId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], CampusEventsController.prototype, "discard", null);
__decorate([
    Post(":eventId/rsvp"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("eventId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], CampusEventsController.prototype, "rsvp", null);
__decorate([
    Post(":eventId/consent"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("eventId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], CampusEventsController.prototype, "consent", null);
__decorate([
    Post(":eventId/checklist/:itemId"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("eventId")),
    __param(2, Param("itemId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], CampusEventsController.prototype, "checklist", null);
__decorate([
    Get(":eventId/sessions/:sessionId/roster"),
    RequirePermission("events.view"),
    __param(0, Req()),
    __param(1, Param("eventId")),
    __param(2, Param("sessionId")),
    __param(3, Query("school_id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], CampusEventsController.prototype, "roster", null);
__decorate([
    Post(":eventId/sessions/:sessionId/attendance"),
    HttpCode(200),
    RequirePermission("events.attendance"),
    __param(0, Req()),
    __param(1, Param("eventId")),
    __param(2, Param("sessionId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], CampusEventsController.prototype, "attendance", null);
__decorate([
    Get(":eventId/sessions/:sessionId/attendance/history"),
    RequirePermission("events.view"),
    __param(0, Req()),
    __param(1, Param("eventId")),
    __param(2, Param("sessionId")),
    __param(3, Query("school_id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], CampusEventsController.prototype, "history", null);
__decorate([
    Post(":eventId/sessions/:sessionId/attendance/lock"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("eventId")),
    __param(2, Param("sessionId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], CampusEventsController.prototype, "lock", null);
__decorate([
    Post(":eventId/sessions/:sessionId/attendance/reopen"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("eventId")),
    __param(2, Param("sessionId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], CampusEventsController.prototype, "reopen", null);
CampusEventsController = __decorate([
    ApiTags("campus events"),
    ApiCookieAuth(),
    Controller("api/v1/campus-events"),
    __metadata("design:paramtypes", [CampusEventsService])
], CampusEventsController);
export { CampusEventsController };
//# sourceMappingURL=campus-events.controller.js.map