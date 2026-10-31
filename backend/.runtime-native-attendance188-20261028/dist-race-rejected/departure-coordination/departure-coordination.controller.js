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
import { Body, Controller, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { RequirePermission } from "../roles/permissions.js";
import { DepartureCoordinationService } from "./departure-coordination.service.js";
let DepartureCoordinationController = class DepartureCoordinationController {
    service;
    constructor(service) {
        this.service = service;
    }
    family(req, studentId, date, requestId) { return this.service.family(req.authUser, studentId, date, false, requestId); }
    student(req, date) { return this.service.family(req.authUser, undefined, date, true); }
    withdraw(req, requestId, body) { return this.service.withdrawRequest(req.authUser, requestId, body); }
    request(req, body) { return this.service.requestChange(req.authUser, body); }
    workspace(req, schoolId, planId, tripId) { return this.service.workspace(req.authUser, schoolId, planId, tripId); }
    policy(req, schoolId, body) { return this.service.savePolicy(req.authUser, schoolId, body); }
    route(req, schoolId, body) { return this.service.createRoute(req.authUser, schoolId, body); }
    assignment(req, schoolId, body) { return this.service.assignStudent(req.authUser, schoolId, body); }
    trip(req, schoolId, body) { return this.service.createTrip(req.authUser, schoolId, body); }
    journey(req, schoolId, tripId) { return this.service.journey(req.authUser, schoolId, tripId); }
    servicePattern(req, schoolId, body) { return this.service.createServicePattern(req.authUser, schoolId, body); }
    reconcileRider(req, schoolId, tripId, studentId, body) { return this.service.recordRider(req.authUser, tripId, studentId, body, schoolId); }
    closeJourney(req, schoolId, tripId, action, body) { return this.service.tripAction(req.authUser, tripId, action, body, schoolId); }
    generateTrips(req, schoolId, body) { return this.service.generateTrips(req.authUser, schoolId, body); }
    refreshTripRoster(req, schoolId, tripId, body) { return this.service.refreshTripRoster(req.authUser, schoolId, tripId, body); }
    assignTripCollector(req, schoolId, tripId, body) { return this.service.assignTripCollector(req.authUser, schoolId, tripId, body); }
    decideDutySwap(req, schoolId, swapId, body) { return this.service.decideDutySwap(req.authUser, schoolId, swapId, body); }
    authority(req, schoolId, body) { return this.service.createAuthority(req.authUser, schoolId, body); }
    revokeAuthority(req, schoolId, authorityId, body) { return this.service.revokeAuthority(req.authUser, schoolId, authorityId, body); }
    plan(req, schoolId, body) { return this.service.createPlan(req.authUser, schoolId, body); }
    officeRequest(req, schoolId, body) { return this.service.recordOfficeRequest(req.authUser, schoolId, body); }
    decision(req, schoolId, requestId, body) { return this.service.decideRequest(req.authUser, schoolId, requestId, body); }
    handover(req, schoolId, planId, body) { return this.service.recordHandover(req.authUser, schoolId, planId, body); }
    planAction(req, schoolId, planId, action, body) { return this.service.planAction(req.authUser, schoolId, planId, action, body); }
    // This inbox also includes cover invitations for staff without a trip yet.
    // The service limits reads to active staff and writes retain resource checks.
    collector(req, swapId) { return this.service.collectorWorkspace(req.authUser, swapId); }
    requestDutySwap(req, body) { return this.service.requestDutySwap(req.authUser, body); }
    // Target identity and current institution membership are checked in the transaction.
    respondDutySwap(req, swapId, body) { return this.service.respondDutySwap(req.authUser, swapId, body); }
    tripAction(req, tripId, action, body) { return this.service.tripAction(req.authUser, tripId, action, body); }
    location(req, tripId, body) { return this.service.recordLocation(req.authUser, tripId, body); }
    rider(req, tripId, studentId, body) { return this.service.recordRider(req.authUser, tripId, studentId, body); }
};
__decorate([
    Get("family/"),
    __param(0, Req()),
    __param(1, Query("student_id")),
    __param(2, Query("date")),
    __param(3, Query("request_id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], DepartureCoordinationController.prototype, "family", null);
__decorate([
    Get("student/"),
    __param(0, Req()),
    __param(1, Query("date")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], DepartureCoordinationController.prototype, "student", null);
__decorate([
    Post("family/requests/:requestId/withdraw/"),
    __param(0, Req()),
    __param(1, Param("requestId")),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], DepartureCoordinationController.prototype, "withdraw", null);
__decorate([
    Post("family/requests/"),
    __param(0, Req()),
    __param(1, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], DepartureCoordinationController.prototype, "request", null);
__decorate([
    Get("schools/:schoolId/workspace/"),
    RequirePermission("departure.manage"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Query("plan_id")),
    __param(3, Query("trip_id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], DepartureCoordinationController.prototype, "workspace", null);
__decorate([
    Patch("schools/:schoolId/policy/"),
    RequirePermission("departure.manage"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], DepartureCoordinationController.prototype, "policy", null);
__decorate([
    Post("schools/:schoolId/routes/"),
    RequirePermission("departure.manage"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], DepartureCoordinationController.prototype, "route", null);
__decorate([
    Post("schools/:schoolId/assignments/"),
    RequirePermission("departure.manage"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], DepartureCoordinationController.prototype, "assignment", null);
__decorate([
    Post("schools/:schoolId/trips/"),
    RequirePermission("departure.manage"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], DepartureCoordinationController.prototype, "trip", null);
__decorate([
    Get("schools/:schoolId/trips/:tripId/"),
    RequirePermission("departure.manage"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("tripId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], DepartureCoordinationController.prototype, "journey", null);
__decorate([
    Post("schools/:schoolId/service-patterns/"),
    RequirePermission("departure.manage"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], DepartureCoordinationController.prototype, "servicePattern", null);
__decorate([
    Post("schools/:schoolId/trips/:tripId/reconcile/:studentId/"),
    RequirePermission("departure.manage"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("tripId")),
    __param(3, Param("studentId")),
    __param(4, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, Object]),
    __metadata("design:returntype", void 0)
], DepartureCoordinationController.prototype, "reconcileRider", null);
__decorate([
    Post("schools/:schoolId/trips/:tripId/close/:action/"),
    RequirePermission("departure.manage"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("tripId")),
    __param(3, Param("action")),
    __param(4, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, Object]),
    __metadata("design:returntype", void 0)
], DepartureCoordinationController.prototype, "closeJourney", null);
__decorate([
    Post("schools/:schoolId/trips/generate/"),
    RequirePermission("departure.manage"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], DepartureCoordinationController.prototype, "generateTrips", null);
__decorate([
    Post("schools/:schoolId/trips/:tripId/roster/refresh/"),
    RequirePermission("departure.manage"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("tripId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], DepartureCoordinationController.prototype, "refreshTripRoster", null);
__decorate([
    Post("schools/:schoolId/trips/:tripId/assignment/"),
    RequirePermission("departure.manage"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("tripId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], DepartureCoordinationController.prototype, "assignTripCollector", null);
__decorate([
    Post("schools/:schoolId/duty-swaps/:swapId/decision/"),
    RequirePermission("departure.manage"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("swapId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], DepartureCoordinationController.prototype, "decideDutySwap", null);
__decorate([
    Post("schools/:schoolId/authorities/"),
    RequirePermission("departure.manage"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], DepartureCoordinationController.prototype, "authority", null);
__decorate([
    Post("schools/:schoolId/authorities/:authorityId/revoke/"),
    RequirePermission("departure.manage"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("authorityId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], DepartureCoordinationController.prototype, "revokeAuthority", null);
__decorate([
    Post("schools/:schoolId/plans/"),
    RequirePermission("departure.manage"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], DepartureCoordinationController.prototype, "plan", null);
__decorate([
    Post("schools/:schoolId/requests/"),
    RequirePermission("departure.manage"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], DepartureCoordinationController.prototype, "officeRequest", null);
__decorate([
    Post("schools/:schoolId/requests/:requestId/decision/"),
    RequirePermission("departure.manage"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("requestId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], DepartureCoordinationController.prototype, "decision", null);
__decorate([
    Post("schools/:schoolId/plans/:planId/handover/"),
    RequirePermission("departure.manage"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("planId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], DepartureCoordinationController.prototype, "handover", null);
__decorate([
    Post("schools/:schoolId/plans/:planId/actions/:action/"),
    RequirePermission("departure.manage"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("planId")),
    __param(3, Param("action")),
    __param(4, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, Object]),
    __metadata("design:returntype", void 0)
], DepartureCoordinationController.prototype, "planAction", null);
__decorate([
    Get("collector/")
    // This inbox also includes cover invitations for staff without a trip yet.
    // The service limits reads to active staff and writes retain resource checks.
    ,
    __param(0, Req()),
    __param(1, Query("swap")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], DepartureCoordinationController.prototype, "collector", null);
__decorate([
    Post("collector/duty-swaps/"),
    RequirePermission("departure.collect"),
    __param(0, Req()),
    __param(1, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], DepartureCoordinationController.prototype, "requestDutySwap", null);
__decorate([
    Post("collector/duty-swaps/:swapId/respond/")
    // Target identity and current institution membership are checked in the transaction.
    ,
    __param(0, Req()),
    __param(1, Param("swapId")),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], DepartureCoordinationController.prototype, "respondDutySwap", null);
__decorate([
    Post("trips/:tripId/actions/:action/"),
    RequirePermission("departure.collect"),
    __param(0, Req()),
    __param(1, Param("tripId")),
    __param(2, Param("action")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], DepartureCoordinationController.prototype, "tripAction", null);
__decorate([
    Post("trips/:tripId/location/"),
    RequirePermission("departure.collect"),
    __param(0, Req()),
    __param(1, Param("tripId")),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], DepartureCoordinationController.prototype, "location", null);
__decorate([
    Post("trips/:tripId/riders/:studentId/"),
    RequirePermission("departure.collect"),
    __param(0, Req()),
    __param(1, Param("tripId")),
    __param(2, Param("studentId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], DepartureCoordinationController.prototype, "rider", null);
DepartureCoordinationController = __decorate([
    Controller("api/v1/departure"),
    __metadata("design:paramtypes", [DepartureCoordinationService])
], DepartureCoordinationController);
export { DepartureCoordinationController };
//# sourceMappingURL=departure-coordination.controller.js.map