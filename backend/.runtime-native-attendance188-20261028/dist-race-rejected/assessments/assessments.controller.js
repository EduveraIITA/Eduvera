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
import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, Res } from "@nestjs/common";
import { RequirePermission } from "../roles/permissions.js";
import { AssessmentsService } from "./assessments.service.js";
import { ExamOperationsService } from "./exam-operations.service.js";
async function uploadBody(request) {
    if (!request.isMultipart())
        throw new BadRequestException("Upload evidence using multipart form data.");
    const body = {};
    let upload;
    for await (const part of request.parts()) {
        if (part.type === "file") {
            if (part.fieldname !== "file") {
                await part.toBuffer();
                continue;
            }
            if (upload)
                throw new BadRequestException("Only one evidence file may be uploaded at a time.");
            upload = { filename: part.filename, mimetype: part.mimetype, data: await part.toBuffer() };
        }
        else
            body[part.fieldname] = part.value;
    }
    if (!upload)
        throw new BadRequestException("Choose an evidence file.");
    return { body, upload };
}
let AssessmentsController = class AssessmentsController {
    assessments;
    examOperations;
    constructor(assessments, examOperations) {
        this.assessments = assessments;
        this.examOperations = examOperations;
    }
    examPolicy(req, schoolId) { return this.examOperations.policy(req.authUser, schoolId); }
    saveExamPolicy(req, schoolId, body) { return this.examOperations.savePolicy(req.authUser, schoolId, body); }
    calendar(req, schoolId, from, to, student) {
        return this.assessments.calendar(req.authUser, schoolId, from, to, student);
    }
    workspace(req, schoolId) {
        return this.assessments.workspace(req.authUser, schoolId);
    }
    family(req, schoolId, studentId) {
        return this.assessments.familyResults(req.authUser, schoolId, studentId);
    }
    detail(req, schoolId, assessmentId) {
        return this.assessments.detail(req.authUser, schoolId, assessmentId);
    }
    createCycle(req, schoolId, body) {
        return this.assessments.createCycle(req.authUser, schoolId, body);
    }
    createAssessment(req, schoolId, body) {
        return this.assessments.createAssessment(req.authUser, schoolId, body);
    }
    sitting(req, schoolId, assessmentId) { return this.examOperations.detail(req.authUser, schoolId, assessmentId); }
    sittingReadiness(req, schoolId, assessmentId) { return this.examOperations.readiness(req.authUser, schoolId, assessmentId); }
    createSitting(req, schoolId, assessmentId, body) { return this.examOperations.createSitting(req.authUser, schoolId, assessmentId, body); }
    updateSittingArrangements(req, schoolId, assessmentId, body) { return this.examOperations.updateArrangements(req.authUser, schoolId, assessmentId, body); }
    respondInvigilator(req, schoolId, assessmentId, assignmentId, body) { return this.examOperations.respondInvigilator(req.authUser, schoolId, assessmentId, assignmentId, body); }
    startSitting(req, schoolId, assessmentId, body) { return this.examOperations.start(req.authUser, schoolId, assessmentId, body); }
    recordSittingAttendance(req, schoolId, assessmentId, body) { return this.examOperations.recordAttendance(req.authUser, schoolId, assessmentId, body); }
    createSittingIncident(req, schoolId, assessmentId, body) { return this.examOperations.createIncident(req.authUser, schoolId, assessmentId, body); }
    resolveSittingIncident(req, schoolId, assessmentId, incidentId, body) { return this.examOperations.resolveIncident(req.authUser, schoolId, assessmentId, incidentId, body); }
    completeSitting(req, schoolId, assessmentId, body) { return this.examOperations.complete(req.authUser, schoolId, assessmentId, body); }
    action(req, schoolId, assessmentId, action, body) {
        return this.assessments.action(req.authUser, schoolId, assessmentId, action, body);
    }
    results(req, schoolId, assessmentId, body) {
        return this.assessments.recordResults(req.authUser, schoolId, assessmentId, body);
    }
    async addEvidence(req, schoolId, assessmentId, resultId) {
        const parsed = await uploadBody(req);
        return this.assessments.addEvidence(req.authUser, schoolId, assessmentId, resultId, parsed.body, parsed.upload);
    }
    async evidence(req, reply, schoolId, assessmentId, evidenceId) {
        const found = await this.assessments.evidence(req.authUser, schoolId, assessmentId, evidenceId);
        reply.type(found.record.content_type || "application/octet-stream");
        reply.header("Content-Disposition", `inline; filename="${found.record.original_name.replace(/[\r\n"]/g, "_")}"`);
        reply.header("X-ThatCampus-Evidence-Mode", found.evidence_mode);
        reply.header("X-ThatCampus-Source-Content-Omitted", String(found.source_content_omitted));
        return reply.send(found.stream);
    }
};
__decorate([
    Get("exam-policy/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], AssessmentsController.prototype, "examPolicy", null);
__decorate([
    Post("exam-policy/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], AssessmentsController.prototype, "saveExamPolicy", null);
__decorate([
    Get('calendar/'),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __param(2, Query('from')),
    __param(3, Query('to')),
    __param(4, Query('student_id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, String]),
    __metadata("design:returntype", void 0)
], AssessmentsController.prototype, "calendar", null);
__decorate([
    Get("workspace/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], AssessmentsController.prototype, "workspace", null);
__decorate([
    Get("family/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Query("student_id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], AssessmentsController.prototype, "family", null);
__decorate([
    Get(":assessmentId/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("assessmentId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], AssessmentsController.prototype, "detail", null);
__decorate([
    Post("cycles/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], AssessmentsController.prototype, "createCycle", null);
__decorate([
    Post(),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], AssessmentsController.prototype, "createAssessment", null);
__decorate([
    Get(":assessmentId/sitting/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("assessmentId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], AssessmentsController.prototype, "sitting", null);
__decorate([
    Get(":assessmentId/sitting/readiness/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("assessmentId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], AssessmentsController.prototype, "sittingReadiness", null);
__decorate([
    Post(":assessmentId/sitting/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("assessmentId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], AssessmentsController.prototype, "createSitting", null);
__decorate([
    Post(":assessmentId/sitting/arrangements/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("assessmentId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], AssessmentsController.prototype, "updateSittingArrangements", null);
__decorate([
    Post(":assessmentId/sitting/invigilators/:assignmentId/response/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("assessmentId")),
    __param(3, Param("assignmentId")),
    __param(4, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, Object]),
    __metadata("design:returntype", void 0)
], AssessmentsController.prototype, "respondInvigilator", null);
__decorate([
    Post(":assessmentId/sitting/actions/start/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("assessmentId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], AssessmentsController.prototype, "startSitting", null);
__decorate([
    Post(":assessmentId/sitting/attendance/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("assessmentId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], AssessmentsController.prototype, "recordSittingAttendance", null);
__decorate([
    Post(":assessmentId/sitting/incidents/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("assessmentId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], AssessmentsController.prototype, "createSittingIncident", null);
__decorate([
    Post(":assessmentId/sitting/incidents/:incidentId/resolve/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("assessmentId")),
    __param(3, Param("incidentId")),
    __param(4, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, Object]),
    __metadata("design:returntype", void 0)
], AssessmentsController.prototype, "resolveSittingIncident", null);
__decorate([
    Post(":assessmentId/sitting/actions/complete/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("assessmentId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], AssessmentsController.prototype, "completeSitting", null);
__decorate([
    Post(":assessmentId/actions/:action/"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("assessmentId")),
    __param(3, Param("action")),
    __param(4, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, Object]),
    __metadata("design:returntype", void 0)
], AssessmentsController.prototype, "action", null);
__decorate([
    Post(":assessmentId/results/"),
    RequirePermission("assessments.mark"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("assessmentId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], AssessmentsController.prototype, "results", null);
__decorate([
    Post(":assessmentId/results/:resultId/evidence/"),
    RequirePermission("assessments.mark"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("assessmentId")),
    __param(3, Param("resultId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", Promise)
], AssessmentsController.prototype, "addEvidence", null);
__decorate([
    Get(":assessmentId/evidence/:evidenceId/"),
    RequirePermission("assessments.view"),
    __param(0, Req()),
    __param(1, Res()),
    __param(2, Param("schoolId")),
    __param(3, Param("assessmentId")),
    __param(4, Param("evidenceId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String, String, String]),
    __metadata("design:returntype", Promise)
], AssessmentsController.prototype, "evidence", null);
AssessmentsController = __decorate([
    Controller("api/v1/schools/:schoolId/assessments"),
    __metadata("design:paramtypes", [AssessmentsService, ExamOperationsService])
], AssessmentsController);
export { AssessmentsController };
//# sourceMappingURL=assessments.controller.js.map