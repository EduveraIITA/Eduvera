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
import { Controller, Get, Param, Query, Req } from "@nestjs/common";
import { OperatingDayService } from "./operating-day.service.js";
let OperatingDayController = class OperatingDayController {
    operatingDay;
    constructor(operatingDay) {
        this.operatingDay = operatingDay;
    }
    view(request, schoolId, date) {
        return this.operatingDay.project(request.authUser, schoolId, date);
    }
};
__decorate([
    Get("/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Query("date")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], OperatingDayController.prototype, "view", null);
OperatingDayController = __decorate([
    Controller("api/v1/schools/:schoolId/operating-day"),
    __metadata("design:paramtypes", [OperatingDayService])
], OperatingDayController);
export { OperatingDayController };
//# sourceMappingURL=operating-day.controller.js.map