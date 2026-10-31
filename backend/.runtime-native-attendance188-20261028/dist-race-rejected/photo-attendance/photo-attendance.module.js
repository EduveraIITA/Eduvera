var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Module } from "@nestjs/common";
import { SchoolModule } from "../school/school.module.js";
import { AttendanceModelModule } from "../attendance-model/attendance-model.module.js";
import { PhotoAttendanceController } from "./photo-attendance.controller.js";
import { PhotoAttendanceService } from "./photo-attendance.service.js";
import { PhotoAttendanceVisionClient } from "./vision-client.js";
let PhotoAttendanceModule = class PhotoAttendanceModule {
};
PhotoAttendanceModule = __decorate([
    Module({
        imports: [SchoolModule, AttendanceModelModule],
        controllers: [PhotoAttendanceController],
        providers: [PhotoAttendanceService, PhotoAttendanceVisionClient],
        exports: [PhotoAttendanceService],
    })
], PhotoAttendanceModule);
export { PhotoAttendanceModule };
//# sourceMappingURL=photo-attendance.module.js.map