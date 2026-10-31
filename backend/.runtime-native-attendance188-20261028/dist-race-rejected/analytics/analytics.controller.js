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
import { Controller, Get, Param, Query, Req, Header } from "@nestjs/common";
import { AnalyticsService } from "./analytics.service.js";
let AnalyticsController = class AnalyticsController {
    analytics;
    constructor(analytics) {
        this.analytics = analytics;
    }
    report(request, schoolId, query) {
        return this.analytics.principalReport(request.authUser, schoolId, query);
    }
    // All four personas are authorized independently inside the read model.
    // No generic staff permission may widen a family or assigned-class scope.
    overview(request, schoolId, portal, query) {
        return this.analytics.overview(request.authUser, schoolId, portal, query);
    }
};
__decorate([
    Get('principal/report'),
    Header('Cache-Control', 'private, no-store'),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __param(2, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], AnalyticsController.prototype, "report", null);
__decorate([
    Get(":portal/"),
    Header('Cache-Control', 'private, no-store'),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("portal")),
    __param(3, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], AnalyticsController.prototype, "overview", null);
AnalyticsController = __decorate([
    Controller("api/v1/schools/:schoolId/analytics"),
    __metadata("design:paramtypes", [AnalyticsService])
], AnalyticsController);
export { AnalyticsController };
//# sourceMappingURL=analytics.controller.js.map