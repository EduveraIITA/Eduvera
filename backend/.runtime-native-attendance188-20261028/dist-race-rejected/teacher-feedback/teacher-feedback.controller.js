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
import { Body, Controller, Get, Header, Param, Post, Req } from '@nestjs/common';
import { TeacherFeedbackService } from './teacher-feedback.service.js';
let TeacherFeedbackController = class TeacherFeedbackController {
    feedback;
    constructor(feedback) {
        this.feedback = feedback;
    }
    workspace(req, school) { return this.feedback.workspace(req.authUser, school); }
    create(req, school, body) { return this.feedback.create(req.authUser, school, body); }
    pending(req, school) { return this.feedback.pending(req.authUser, school); }
    results(req, school, id) { return this.feedback.results(req.authUser, school, id); }
    close(req, school, id) { return this.feedback.close(req.authUser, school, id); }
    submit(req, school, id, body) { return this.feedback.submit(req.authUser, school, id, body); }
};
__decorate([
    Get(),
    Header('Cache-Control', 'private, no-store'),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], TeacherFeedbackController.prototype, "workspace", null);
__decorate([
    Post(),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], TeacherFeedbackController.prototype, "create", null);
__decorate([
    Get('pending'),
    Header('Cache-Control', 'private, no-store'),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], TeacherFeedbackController.prototype, "pending", null);
__decorate([
    Get(':id/results'),
    Header('Cache-Control', 'private, no-store'),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __param(2, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], TeacherFeedbackController.prototype, "results", null);
__decorate([
    Post(':id/close'),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __param(2, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], TeacherFeedbackController.prototype, "close", null);
__decorate([
    Post(':id/responses'),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __param(2, Param('id')),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], TeacherFeedbackController.prototype, "submit", null);
TeacherFeedbackController = __decorate([
    Controller('api/v1/schools/:schoolId/teacher-feedback'),
    __metadata("design:paramtypes", [TeacherFeedbackService])
], TeacherFeedbackController);
export { TeacherFeedbackController };
//# sourceMappingURL=teacher-feedback.controller.js.map