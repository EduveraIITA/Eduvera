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
import { Controller, Delete, ForbiddenException, Get, HttpCode, Param, Patch, Post, Query, Req, Res } from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import { SchoolEventService } from "./school-event.service.js";
import { SchoolService } from "./school.service.js";
async function bodyAndUpload(request) {
    if (!request.isMultipart())
        return { body: (request.body ?? {}) };
    const body = {};
    let upload;
    for await (const part of request.parts()) {
        if (part.type === "file") {
            if (part.fieldname !== "file")
                continue;
            if (upload)
                throw new (await import("@nestjs/common")).BadRequestException("Only one supporting document may be uploaded at a time.");
            upload = { filename: part.filename, mimetype: part.mimetype, data: await part.toBuffer() };
        }
        else {
            body[part.fieldname] = part.value;
        }
    }
    return { body, ...(upload ? { upload } : {}) };
}
let SchoolController = class SchoolController {
    school;
    events;
    constructor(school, events) {
        this.school = school;
        this.events = events;
    }
    practiceWritable(request) {
        const world = request.executionEnvironmentView;
        if (world?.mode === "simulation" && (world.unavailable || ["completed", "stopped"].includes(world.run_status ?? "")))
            throw new ForbiddenException("This simulation is read-only.");
    }
    async students(request) {
        return { results: await this.school.accessibleStudentDtos(request.authUser) };
    }
    async subjectAttendance(request, studentId) {
        const student = await this.school.studentForUser(request.authUser, studentId);
        const enrollment = await this.school.enrollment(student.id);
        return { term_id: enrollment.term_id, results: await this.school.subjectAttendance(student.id, enrollment.term_id) };
    }
    async gateEvents(request, studentId) {
        const student = await this.school.studentForUser(request.authUser, studentId);
        return { results: await this.school.latestGate(student.id) ? await this.school.dbGateEvents(student.id) : [] };
    }
    async timetable(request, studentId, weekdayValue) {
        const student = await this.school.studentForUser(request.authUser, studentId);
        const enrollment = await this.school.enrollment(student.id);
        const weekday = weekdayValue === undefined ? undefined : Number(weekdayValue);
        if (weekday !== undefined && (!Number.isInteger(weekday) || weekday < 1 || weekday > 7))
            throw new (await import("@nestjs/common")).BadRequestException("weekday must be an integer from 1 to 7.");
        return { results: await this.school.timetable(enrollment, weekday) };
    }
    async calendarDays(request, query) {
        return { results: await this.school.calendarDays(request.authUser, query) };
    }
    async attendanceRecords(request, studentId) {
        const student = await this.school.studentForUser(request.authUser, studentId);
        const enrollment = await this.school.enrollment(student.id);
        return { results: await this.school.attendanceRecords(student.id, enrollment) };
    }
    async leaves(request, studentId, status) {
        return { results: await this.school.leaveList(request.authUser, studentId, status, request) };
    }
    async createLeave(request) {
        const parsed = await bodyAndUpload(request);
        return this.school.createLeave(request.authUser, parsed.body, parsed.upload, request);
    }
    async leave(request, leaveId) {
        await this.school.leaveForUser(request.authUser, leaveId);
        return this.school.leaveDto(leaveId, request);
    }
    async addDocument(request, leaveId) {
        const parsed = await bodyAndUpload(request);
        if (!parsed.upload)
            throw new (await import("@nestjs/common")).BadRequestException("A file is required.");
        return this.school.addLeaveDocument(request.authUser, leaveId, parsed.upload, request);
    }
    async downloadDocument(request, reply, leaveId, documentId) {
        const result = await this.school.leaveDocument(request.authUser, leaveId, documentId);
        const filename = result.document.original_name.replace(/[\r\n"]/g, "_");
        reply.type(result.document.content_type || "application/octet-stream");
        reply.header("Content-Disposition", `inline; filename="${filename}"`);
        reply.header("X-ThatCampus-Evidence-Mode", result.evidence_mode);
        reply.header("X-ThatCampus-Source-Content-Omitted", String(result.source_content_omitted));
        return reply.send(result.stream);
    }
    async leaveAction(request, leaveId, action) {
        return this.school.performLeaveAction(request.authUser, leaveId, action, request.body?.note, request);
    }
    async diary(request, studentId, dateFrom, dateTo) {
        const student = await this.school.studentForUser(request.authUser, studentId);
        const enrollment = await this.school.enrollment(student.id);
        return { results: await this.school.diaryItems(student.id, enrollment, dateFrom, dateTo) };
    }
    async acknowledge(request, reply, itemId) {
        const result = await this.school.acknowledgeDiary(request.authUser, itemId, request.body?.student_id);
        reply.status(result.created ? 201 : 200);
        return result.data;
    }
    exactDiary(request, itemId, studentId) {
        return this.school.exactDiaryItem(request.authUser, itemId, studentId);
    }
    async note(request, itemId) {
        this.practiceWritable(request);
        const body = request.body;
        return this.school.addDiaryNote(request.authUser, itemId, body?.student_id, body?.body, body?.command);
    }
    async notifications(request, limit, cursor) {
        return this.school.notifications(request.authUser, { limit, cursor });
    }
    async notificationRead(request, notificationId) {
        return this.school.markNotificationRead(request.authUser, notificationId, request.body?.opened_target);
    }
    parentHome(request, studentId) {
        return this.school.parentHome(request.authUser, studentId);
    }
    completeHomework(request, itemId) {
        this.practiceWritable(request);
        const body = request.body;
        return this.school.setHomeworkCompleted(request.authUser, itemId, body?.student_id, true, body?.command);
    }
    async reopenHomework(request, itemId, studentId) {
        this.practiceWritable(request);
        return this.school.setHomeworkCompleted(request.authUser, itemId, studentId, false, request.body?.command);
    }
    parentAttendance(request, studentId) {
        return this.school.parentAttendance(request.authUser, studentId);
    }
    parentDiary(request, studentId, date) {
        return this.school.parentDiary(request.authUser, studentId, date);
    }
    parentLeave(request, leaveId, studentId) {
        return this.school.parentLeave(request.authUser, leaveId, studentId, request);
    }
    parentLeaveAuthority(request, studentId) {
        return this.school.parentLeaveAuthority(request.authUser, studentId);
    }
    parentTimetable(request, mode, studentId, date) {
        return this.school.timetableScreen(request.authUser, mode, studentId, date, "guardian");
    }
    parentTimetableSummary(request, start, end, date, studentId) {
        return this.school.timetableSummaryScreen(request.authUser, start, end, date, studentId, "guardian");
    }
    studentAttendance(request, studentId) {
        return this.school.studentAttendanceScreen(request.authUser, studentId);
    }
    studentHome(request, studentId) {
        return this.school.studentHomeScreen(request.authUser, studentId);
    }
    eligibility(request, studentId, subjectId, missed) {
        return this.school.eligibilityScreen(request.authUser, studentId, subjectId, missed);
    }
    studentTimetable(request, mode, studentId, date) {
        return this.school.timetableScreen(request.authUser, mode, studentId, date);
    }
    studentTimetableSummary(request, start, end, date, studentId) {
        return this.school.timetableSummaryScreen(request.authUser, start, end, date, studentId);
    }
    leaveApply(request, studentId) {
        return this.school.leaveApplyScreen(request.authUser, studentId, request);
    }
    leaveStatus(request, studentId) {
        return this.school.leaveStatusScreen(request.authUser, studentId, request);
    }
    teacherHome(request, date) {
        return this.school.teacherHomeScreen(request.authUser, date);
    }
    teacherAttendance(request, classSectionId, date) {
        return this.school.teacherAttendanceScreen(request.authUser, classSectionId, date);
    }
    teacherClassUpdates(request, date) {
        return this.school.teacherClassUpdates(request.authUser, date);
    }
    teacherAttendanceSave(request) {
        return this.school.saveTeacherAttendance(request.authUser, request.body, request);
    }
    studentAttendanceLookup(request, query) {
        return this.school.studentAttendanceLookup(request.authUser, query);
    }
    studentAttendanceSave(request) {
        return this.school.saveStudentAttendance(request.authUser, request.body, request);
    }
    attendanceContinuitySave(request) {
        return this.school.saveAttendanceContinuityBatch(request.authUser, request.body, request);
    }
    attendanceContinuityWorkspace(request, date, caseId) {
        return this.school.attendanceContinuityWorkspace(request.authUser, date, caseId);
    }
    attendanceContinuityDecision(request, caseId) {
        return this.school.decideAttendanceReconciliation(request.authUser, caseId, request.body, request);
    }
    attendanceRegister(request, classSectionId, date) {
        return this.school.teacherAttendanceScreen(request.authUser, classSectionId, date);
    }
    attendanceRegisterLock(request, classSectionId, date) {
        return this.school.setAttendanceRegisterLock(request.authUser, classSectionId, true, { ...(request.body ?? {}), date }, request);
    }
    attendanceRegisterUnlock(request, classSectionId, date) {
        return this.school.setAttendanceRegisterLock(request.authUser, classSectionId, false, { ...(request.body ?? {}), date }, request);
    }
    attendanceRegisterHistory(request, classSectionId, date) {
        return this.school.attendanceRegisterHistory(request.authUser, classSectionId, date ?? "");
    }
    eventStream(request, reply) {
        return this.events.openStream(request.authUser, reply, request);
    }
    principalHome(request, date) {
        return this.school.principalHomeScreen(request.authUser, date);
    }
    principalTimetable(request, termId) {
        return this.school.principalTimetableScreen(request.authUser, termId);
    }
    principalTimetableCreate(request) {
        return this.school.createTimetableSlot(request.authUser, request.body, request);
    }
    principalTimetableUpdate(request, slotId) {
        return this.school.updateTimetableSlot(request.authUser, slotId, request.body, request);
    }
    principalTimetableDelete(request, slotId) {
        return this.school.deleteTimetableSlot(request.authUser, slotId, request);
    }
    principalTimetableCopyDay(request) {
        return this.school.copyTimetableDay(request.authUser, request.body, request);
    }
    principalTimetableTarget(request) {
        return this.school.setCurriculumSubjectTarget(request.authUser, request.body, request);
    }
    principalCalendarClosureCreate(request) {
        return this.school.createSchoolClosure(request.authUser, request.body, request);
    }
    principalCalendarClosureDelete(request, date) {
        return this.school.deleteSchoolClosure(request.authUser, date, request.body, request);
    }
};
__decorate([
    Get("students/"),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], SchoolController.prototype, "students", null);
__decorate([
    Get("students/attendance/subjects/"),
    __param(0, Req()),
    __param(1, Query("student_id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], SchoolController.prototype, "subjectAttendance", null);
__decorate([
    Get("students/gate-events/"),
    __param(0, Req()),
    __param(1, Query("student_id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], SchoolController.prototype, "gateEvents", null);
__decorate([
    Get("students/timetable/"),
    __param(0, Req()),
    __param(1, Query("student_id")),
    __param(2, Query("weekday")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], SchoolController.prototype, "timetable", null);
__decorate([
    Get("calendar/days/"),
    __param(0, Req()),
    __param(1, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], SchoolController.prototype, "calendarDays", null);
__decorate([
    Get("attendance-records/"),
    __param(0, Req()),
    __param(1, Query("student_id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], SchoolController.prototype, "attendanceRecords", null);
__decorate([
    Get("leave-requests/"),
    __param(0, Req()),
    __param(1, Query("student_id")),
    __param(2, Query("status")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], SchoolController.prototype, "leaves", null);
__decorate([
    Post("leave-requests/"),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], SchoolController.prototype, "createLeave", null);
__decorate([
    Get("leave-requests/:leaveId/"),
    __param(0, Req()),
    __param(1, Param("leaveId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], SchoolController.prototype, "leave", null);
__decorate([
    Post("leave-requests/:leaveId/documents/"),
    __param(0, Req()),
    __param(1, Param("leaveId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], SchoolController.prototype, "addDocument", null);
__decorate([
    Get("leave-requests/:leaveId/documents/:documentId/download/"),
    __param(0, Req()),
    __param(1, Res()),
    __param(2, Param("leaveId")),
    __param(3, Param("documentId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String, String]),
    __metadata("design:returntype", Promise)
], SchoolController.prototype, "downloadDocument", null);
__decorate([
    Post("leave-requests/:leaveId/:action/"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("leaveId")),
    __param(2, Param("action")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], SchoolController.prototype, "leaveAction", null);
__decorate([
    Get("diary/"),
    __param(0, Req()),
    __param(1, Query("student_id")),
    __param(2, Query("date_from")),
    __param(3, Query("date_to")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", Promise)
], SchoolController.prototype, "diary", null);
__decorate([
    Post("diary/:itemId/acknowledge/"),
    __param(0, Req()),
    __param(1, Res({ passthrough: true })),
    __param(2, Param("itemId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String]),
    __metadata("design:returntype", Promise)
], SchoolController.prototype, "acknowledge", null);
__decorate([
    Get("diary/:itemId/"),
    __param(0, Req()),
    __param(1, Param("itemId")),
    __param(2, Query("student_id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], SchoolController.prototype, "exactDiary", null);
__decorate([
    Post("diary/:itemId/notes/"),
    __param(0, Req()),
    __param(1, Param("itemId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], SchoolController.prototype, "note", null);
__decorate([
    Get("notifications/"),
    __param(0, Req()),
    __param(1, Query("limit")),
    __param(2, Query("cursor")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], SchoolController.prototype, "notifications", null);
__decorate([
    Post("notifications/:notificationId/read/"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("notificationId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], SchoolController.prototype, "notificationRead", null);
__decorate([
    Get("screens/parent/home/"),
    __param(0, Req()),
    __param(1, Query("student_id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], SchoolController.prototype, "parentHome", null);
__decorate([
    Post("homework/:itemId/complete/"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("itemId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], SchoolController.prototype, "completeHomework", null);
__decorate([
    Delete("homework/:itemId/complete/"),
    __param(0, Req()),
    __param(1, Param("itemId")),
    __param(2, Query("student_id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], SchoolController.prototype, "reopenHomework", null);
__decorate([
    Get("screens/parent/attendance/"),
    __param(0, Req()),
    __param(1, Query("student_id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], SchoolController.prototype, "parentAttendance", null);
__decorate([
    Get("screens/parent/diary/"),
    __param(0, Req()),
    __param(1, Query("student_id")),
    __param(2, Query("date")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], SchoolController.prototype, "parentDiary", null);
__decorate([
    Get("screens/parent/leave/:leaveId/"),
    __param(0, Req()),
    __param(1, Param("leaveId")),
    __param(2, Query("student_id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], SchoolController.prototype, "parentLeave", null);
__decorate([
    Get("screens/parent/leave-authority/"),
    __param(0, Req()),
    __param(1, Query("student_id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], SchoolController.prototype, "parentLeaveAuthority", null);
__decorate([
    Get("screens/parent/timetable/:mode/"),
    __param(0, Req()),
    __param(1, Param("mode")),
    __param(2, Query("student_id")),
    __param(3, Query("date")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], SchoolController.prototype, "parentTimetable", null);
__decorate([
    Get("screens/parent/timetable-summary/"),
    __param(0, Req()),
    __param(1, Query("start")),
    __param(2, Query("end")),
    __param(3, Query("date")),
    __param(4, Query("student_id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, String]),
    __metadata("design:returntype", void 0)
], SchoolController.prototype, "parentTimetableSummary", null);
__decorate([
    Get("screens/student/attendance/"),
    __param(0, Req()),
    __param(1, Query("student_id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], SchoolController.prototype, "studentAttendance", null);
__decorate([
    Get("screens/student/home/"),
    __param(0, Req()),
    __param(1, Query("student_id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], SchoolController.prototype, "studentHome", null);
__decorate([
    Get("screens/student/attendance/eligibility/"),
    __param(0, Req()),
    __param(1, Query("student_id")),
    __param(2, Query("subject_id")),
    __param(3, Query("additional_missed")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], SchoolController.prototype, "eligibility", null);
__decorate([
    Get("screens/student/timetable/:mode/"),
    __param(0, Req()),
    __param(1, Param("mode")),
    __param(2, Query("student_id")),
    __param(3, Query("date")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], SchoolController.prototype, "studentTimetable", null);
__decorate([
    Get("screens/student/timetable-summary/"),
    __param(0, Req()),
    __param(1, Query("start")),
    __param(2, Query("end")),
    __param(3, Query("date")),
    __param(4, Query("student_id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, String]),
    __metadata("design:returntype", void 0)
], SchoolController.prototype, "studentTimetableSummary", null);
__decorate([
    Get("screens/student/leave/apply/"),
    __param(0, Req()),
    __param(1, Query("student_id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], SchoolController.prototype, "leaveApply", null);
__decorate([
    Get("screens/student/leave/status/"),
    __param(0, Req()),
    __param(1, Query("student_id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], SchoolController.prototype, "leaveStatus", null);
__decorate([
    Get("screens/teacher/home/"),
    RequirePermission("timetable.view"),
    __param(0, Req()),
    __param(1, Query("date")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], SchoolController.prototype, "teacherHome", null);
__decorate([
    Get("screens/teacher/attendance/"),
    RequirePermission("attendance.view"),
    __param(0, Req()),
    __param(1, Query("class_section_id")),
    __param(2, Query("date")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], SchoolController.prototype, "teacherAttendance", null);
__decorate([
    Get("screens/teacher/class-updates/"),
    RequirePermission("attendance.view"),
    __param(0, Req()),
    __param(1, Query("date")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], SchoolController.prototype, "teacherClassUpdates", null);
__decorate([
    Post("teacher/attendance/bulk/"),
    HttpCode(200),
    RequirePermission("attendance.record"),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], SchoolController.prototype, "teacherAttendanceSave", null);
__decorate([
    Get("teacher/attendance/student/"),
    RequirePermission("attendance.view"),
    __param(0, Req()),
    __param(1, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], SchoolController.prototype, "studentAttendanceLookup", null);
__decorate([
    Post("teacher/attendance/student/"),
    HttpCode(200),
    RequirePermission("attendance.record"),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], SchoolController.prototype, "studentAttendanceSave", null);
__decorate([
    Post("attendance-continuity/batches/"),
    HttpCode(200),
    RequirePermission("attendance.record"),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], SchoolController.prototype, "attendanceContinuitySave", null);
__decorate([
    Get("screens/principal/attendance/continuity/"),
    __param(0, Req()),
    __param(1, Query("date")),
    __param(2, Query("case_id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], SchoolController.prototype, "attendanceContinuityWorkspace", null);
__decorate([
    Post("attendance-continuity/cases/:caseId/decision/"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("caseId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], SchoolController.prototype, "attendanceContinuityDecision", null);
__decorate([
    Get("attendance-registers/:classSectionId/"),
    RequirePermission("attendance.view"),
    __param(0, Req()),
    __param(1, Param("classSectionId")),
    __param(2, Query("date")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], SchoolController.prototype, "attendanceRegister", null);
__decorate([
    Post("attendance-registers/:classSectionId/lock/"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("classSectionId")),
    __param(2, Query("date")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], SchoolController.prototype, "attendanceRegisterLock", null);
__decorate([
    Delete("attendance-registers/:classSectionId/lock/"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("classSectionId")),
    __param(2, Query("date")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], SchoolController.prototype, "attendanceRegisterUnlock", null);
__decorate([
    Get("attendance-registers/:classSectionId/history/"),
    RequirePermission("attendance.view"),
    __param(0, Req()),
    __param(1, Param("classSectionId")),
    __param(2, Query("date")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], SchoolController.prototype, "attendanceRegisterHistory", null);
__decorate([
    Get("events/stream/"),
    __param(0, Req()),
    __param(1, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], SchoolController.prototype, "eventStream", null);
__decorate([
    Get("screens/principal/home/"),
    __param(0, Req()),
    __param(1, Query("date")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], SchoolController.prototype, "principalHome", null);
__decorate([
    Get("screens/principal/timetable/"),
    __param(0, Req()),
    __param(1, Query("term_id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], SchoolController.prototype, "principalTimetable", null);
__decorate([
    Post("principal/timetable/slots/"),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], SchoolController.prototype, "principalTimetableCreate", null);
__decorate([
    Patch("principal/timetable/slots/:slotId/"),
    __param(0, Req()),
    __param(1, Param("slotId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], SchoolController.prototype, "principalTimetableUpdate", null);
__decorate([
    Delete("principal/timetable/slots/:slotId/"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("slotId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], SchoolController.prototype, "principalTimetableDelete", null);
__decorate([
    Post("principal/timetable/copy-day/"),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], SchoolController.prototype, "principalTimetableCopyDay", null);
__decorate([
    Post("principal/timetable/targets/"),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], SchoolController.prototype, "principalTimetableTarget", null);
__decorate([
    Post("principal/calendar/closures/"),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], SchoolController.prototype, "principalCalendarClosureCreate", null);
__decorate([
    Delete("principal/calendar/closures/:date/"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("date")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], SchoolController.prototype, "principalCalendarClosureDelete", null);
SchoolController = __decorate([
    ApiTags("school"),
    ApiCookieAuth(),
    Controller("api/v1"),
    __metadata("design:paramtypes", [SchoolService, SchoolEventService])
], SchoolController);
export { SchoolController };
//# sourceMappingURL=school.controller.js.map