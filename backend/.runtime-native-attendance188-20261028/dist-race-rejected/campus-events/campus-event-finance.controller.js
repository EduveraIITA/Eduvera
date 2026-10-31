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
import { Controller, Get, HttpCode, Param, Post, Query, Req } from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import { CampusEventFinanceService } from "./campus-event-finance.service.js";
let CampusEventFinanceController = class CampusEventFinanceController {
    finance;
    constructor(finance) {
        this.finance = finance;
    }
    financeState(request, eventId, schoolId, studentId) {
        return this.finance.finance(request.authUser, eventId, schoolId, studentId);
    }
    withdraw(request, eventId, studentId) {
        return this.finance.withdraw(request, eventId, { ...request.body, student_id: studentId });
    }
    refund(request, eventId, studentId) {
        return this.finance.refund(request, eventId, { ...request.body, student_id: studentId });
    }
};
__decorate([
    Get(":eventId/finance"),
    __param(0, Req()),
    __param(1, Param("eventId")),
    __param(2, Query("school_id")),
    __param(3, Query("student_id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], CampusEventFinanceController.prototype, "financeState", null);
__decorate([
    Post(":eventId/participants/:studentId/withdraw"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("eventId")),
    __param(2, Param("studentId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], CampusEventFinanceController.prototype, "withdraw", null);
__decorate([
    Post(":eventId/participants/:studentId/refunds"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("eventId")),
    __param(2, Param("studentId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], CampusEventFinanceController.prototype, "refund", null);
CampusEventFinanceController = __decorate([
    ApiTags("campus event finance"),
    ApiCookieAuth(),
    Controller("api/v1/campus-events"),
    __metadata("design:paramtypes", [CampusEventFinanceService])
], CampusEventFinanceController);
export { CampusEventFinanceController };
//# sourceMappingURL=campus-event-finance.controller.js.map