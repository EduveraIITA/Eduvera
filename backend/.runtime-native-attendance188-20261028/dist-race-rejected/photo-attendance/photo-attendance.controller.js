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
import { BadRequestException, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import { PhotoAttendanceService } from "./photo-attendance.service.js";
async function photoAndFields(request) {
    if (!request.isMultipart())
        throw new BadRequestException("Upload a photo using multipart form data.");
    const fields = {};
    let photo;
    for await (const part of request.parts()) {
        if (part.type === "file") {
            if (part.fieldname !== "file") {
                await part.toBuffer();
                throw new BadRequestException("Use the file field for the attendance photo.");
            }
            if (photo)
                throw new BadRequestException("Upload one photo at a time.");
            photo = { filename: part.filename, mimetype: part.mimetype, data: await part.toBuffer() };
        }
        else {
            fields[part.fieldname] = String(part.value);
        }
    }
    if (!photo)
        throw new BadRequestException("Select a photo to continue.");
    return { fields, photo };
}
let PhotoAttendanceController = class PhotoAttendanceController {
    photoAttendance;
    constructor(photoAttendance) {
        this.photoAttendance = photoAttendance;
    }
    setup(request, classSectionId, date, sessionId) {
        return this.photoAttendance.setup(request.authUser, classSectionId, date, sessionId);
    }
    async enroll(request, studentId) {
        const { fields, photo } = await photoAndFields(request);
        return this.photoAttendance.enroll(request, studentId, fields, photo);
    }
    async analyze(request, classSectionId) {
        const { fields, photo } = await photoAndFields(request);
        return this.photoAttendance.analyze(request, classSectionId, fields, photo);
    }
    detail(request, sessionId) {
        return this.photoAttendance.detail(request.authUser, sessionId);
    }
};
__decorate([
    Get("classes/:classSectionId/setup/"),
    RequirePermission("photo.use"),
    __param(0, Req()),
    __param(1, Param("classSectionId")),
    __param(2, Query("date")),
    __param(3, Query("session_id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], PhotoAttendanceController.prototype, "setup", null);
__decorate([
    Post("students/:studentId/samples/"),
    RequirePermission("photo.use"),
    __param(0, Req()),
    __param(1, Param("studentId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], PhotoAttendanceController.prototype, "enroll", null);
__decorate([
    Post("classes/:classSectionId/analyze/"),
    RequirePermission("photo.use"),
    __param(0, Req()),
    __param(1, Param("classSectionId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], PhotoAttendanceController.prototype, "analyze", null);
__decorate([
    Get("sessions/:sessionId/"),
    RequirePermission("photo.use"),
    __param(0, Req()),
    __param(1, Param("sessionId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], PhotoAttendanceController.prototype, "detail", null);
PhotoAttendanceController = __decorate([
    ApiTags("photo attendance"),
    ApiCookieAuth(),
    Controller("api/v1/photo-attendance"),
    __metadata("design:paramtypes", [PhotoAttendanceService])
], PhotoAttendanceController);
export { PhotoAttendanceController };
//# sourceMappingURL=photo-attendance.controller.js.map