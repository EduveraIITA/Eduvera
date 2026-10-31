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
import { Controller, Get, Param, Optional, Query, Req } from "@nestjs/common";
import { CampusViewKpiService } from "./campus-view-kpi.service.js";
import { CampusViewService } from "./campus-view.service.js";
import { CampusPersonalService } from "./campus-personal.service.js";
import { CampusOperationsService } from "./campus-operations.service.js";
let CampusViewController = class CampusViewController {
    campusView;
    campusKpis;
    personal;
    operations;
    constructor(campusView, campusKpis, personal, operations) {
        this.campusView = campusView;
        this.campusKpis = campusKpis;
        this.personal = personal;
        this.operations = operations;
    }
    operationsView(request, schoolId, query) {
        if (!this.operations)
            throw new Error('Campus asset and activity context is unavailable.');
        return this.operations.view(request.authUser, schoolId, query);
    }
    mine(request, schoolId, query) {
        if (!this.personal)
            throw new Error("Personal campus context is unavailable.");
        return this.personal.mine(request.authUser, schoolId, query);
    }
    view(request, schoolId, campusId, at) {
        return this.campusView.view(request.authUser, schoolId, {
            ...(campusId ? { campus_id: campusId } : {}),
            ...(at ? { at } : {}),
        });
    }
    kpis(request, schoolId, campusId, page, range, at) {
        if (!this.campusKpis)
            throw new Error("Campus KPI service is unavailable.");
        return this.campusKpis.view(request.authUser, schoolId, {
            ...(campusId ? { campus_id: campusId } : {}),
            ...(page ? { page } : {}),
            ...(range ? { range } : {}),
            ...(at ? { at } : {}),
        });
    }
};
__decorate([
    Get('/operations'),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __param(2, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], CampusViewController.prototype, "operationsView", null);
__decorate([
    Get("/mine"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], CampusViewController.prototype, "mine", null);
__decorate([
    Get("/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Query("campus_id")),
    __param(3, Query("at")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], CampusViewController.prototype, "view", null);
__decorate([
    Get("/kpis"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Query("campus_id")),
    __param(3, Query("page")),
    __param(4, Query("range")),
    __param(5, Query("at")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, String, String]),
    __metadata("design:returntype", void 0)
], CampusViewController.prototype, "kpis", null);
CampusViewController = __decorate([
    Controller("api/v1/schools/:schoolId/campus-view"),
    __param(1, Optional()),
    __param(2, Optional()),
    __param(3, Optional()),
    __metadata("design:paramtypes", [CampusViewService,
        CampusViewKpiService,
        CampusPersonalService,
        CampusOperationsService])
], CampusViewController);
export { CampusViewController };
//# sourceMappingURL=campus-view.controller.js.map