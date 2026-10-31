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
import { Body, Controller, ForbiddenException, Get, HttpCode, Param, Post, Query, Req } from "@nestjs/common";
import { FinanceArrangementsReadService } from "./finance-arrangements.read.js";
import { FinanceArrangementsService } from "./finance-arrangements.service.js";
let FinanceArrangementsController = class FinanceArrangementsController {
    arrangements;
    reads;
    constructor(arrangements, reads) {
        this.arrangements = arrangements;
        this.reads = reads;
    }
    writable(req) {
        const world = req.executionEnvironmentView;
        if (world?.mode === "simulation" && (world.unavailable || ["completed", "stopped"].includes(world.run_status ?? "")))
            throw new ForbiddenException("This Simulation is read-only. Return to a working world to change an arrangement.");
    }
    workspace(req, schoolId, studentId, invoiceId, commandId, personId) {
        return this.reads.workspace(req.authUser, schoolId, studentId, invoiceId, commandId, personId);
    }
    request(req, schoolId, invoiceId, body) {
        this.writable(req);
        return this.arrangements.request(req.authUser, schoolId, invoiceId, body);
    }
    decide(req, schoolId, requestId, body) {
        this.writable(req);
        return this.arrangements.decide(req.authUser, schoolId, requestId, body);
    }
    withdraw(req, schoolId, requestId, body) {
        this.writable(req);
        return this.arrangements.withdraw(req.authUser, schoolId, requestId, body);
    }
    enable(req, schoolId, invoiceId, body) {
        this.writable(req);
        return this.arrangements.enableSelfPayer(req.authUser, schoolId, invoiceId, body);
    }
    revoke(req, schoolId, invoiceId, body) {
        this.writable(req);
        return this.arrangements.revokeSelfPayer(req.authUser, schoolId, invoiceId, body);
    }
};
__decorate([
    Get("arrangements/workspace/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Query("student_id")),
    __param(3, Query("invoice_id")),
    __param(4, Query("command_id")),
    __param(5, Query("person_id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, String, String]),
    __metadata("design:returntype", void 0)
], FinanceArrangementsController.prototype, "workspace", null);
__decorate([
    Post("invoices/:invoiceId/arrangements/request/"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("invoiceId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], FinanceArrangementsController.prototype, "request", null);
__decorate([
    Post("arrangements/:requestId/decision/"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("requestId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], FinanceArrangementsController.prototype, "decide", null);
__decorate([
    Post("arrangements/:requestId/withdraw/"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("requestId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], FinanceArrangementsController.prototype, "withdraw", null);
__decorate([
    Post("invoices/:invoiceId/self-payer/enable/"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("invoiceId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], FinanceArrangementsController.prototype, "enable", null);
__decorate([
    Post("invoices/:invoiceId/self-payer/revoke/"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("invoiceId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], FinanceArrangementsController.prototype, "revoke", null);
FinanceArrangementsController = __decorate([
    Controller("api/v1/schools/:schoolId/fees"),
    __metadata("design:paramtypes", [FinanceArrangementsService, FinanceArrangementsReadService])
], FinanceArrangementsController);
export { FinanceArrangementsController };
//# sourceMappingURL=finance-arrangements.controller.js.map