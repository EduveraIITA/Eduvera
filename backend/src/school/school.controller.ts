import { RequirePermission } from "../roles/permissions.js";
import { Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req, Res } from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import type { FastifyReply } from "fastify";
import type { AuthenticatedRequest } from "../common/request.js";
import { SchoolEventService } from "./school-event.service.js";
import { SchoolService, type UploadInput } from "./school.service.js";

async function bodyAndUpload(request: AuthenticatedRequest): Promise<{ body: Record<string, unknown>; upload?: UploadInput }> {
  if (!request.isMultipart()) return { body: (request.body ?? {}) as Record<string, unknown> };
  const body: Record<string, unknown> = {};
  let upload: UploadInput | undefined;
  for await (const part of request.parts()) {
    if (part.type === "file") {
      if (part.fieldname !== "file") continue;
      if (upload) throw new (await import("@nestjs/common")).BadRequestException("Only one supporting document may be uploaded at a time.");
      upload = { filename: part.filename, mimetype: part.mimetype, data: await part.toBuffer() };
    } else {
      body[part.fieldname] = part.value;
    }
  }
  return { body, ...(upload ? { upload } : {}) };
}

@ApiTags("school")
@ApiCookieAuth()
@Controller("api/v1")
export class SchoolController {
  constructor(private readonly school: SchoolService, private readonly events: SchoolEventService) {}

  @Get("students/")
  async students(@Req() request: AuthenticatedRequest) {
    return { results: await this.school.accessibleStudentDtos(request.authUser) };
  }

  @Get("students/attendance/subjects/")
  async subjectAttendance(@Req() request: AuthenticatedRequest, @Query("student_id") studentId?: string) {
    const student = await this.school.studentForUser(request.authUser, studentId);
    const enrollment = await this.school.enrollment(student.id);
    return { term_id: enrollment.term_id, results: await this.school.subjectAttendance(student.id, enrollment.term_id) };
  }

  @Get("students/gate-events/")
  async gateEvents(@Req() request: AuthenticatedRequest, @Query("student_id") studentId?: string) {
    const student = await this.school.studentForUser(request.authUser, studentId);
    return { results: await this.school.latestGate(student.id) ? await this.school.dbGateEvents(student.id) : [] };
  }

  @Get("students/timetable/")
  async timetable(@Req() request: AuthenticatedRequest, @Query("student_id") studentId?: string, @Query("weekday") weekdayValue?: string) {
    const student = await this.school.studentForUser(request.authUser, studentId);
    const enrollment = await this.school.enrollment(student.id);
    const weekday = weekdayValue === undefined ? undefined : Number(weekdayValue);
    if (weekday !== undefined && (!Number.isInteger(weekday) || weekday < 1 || weekday > 7)) throw new (await import("@nestjs/common")).BadRequestException("weekday must be an integer from 1 to 7.");
    return { results: await this.school.timetable(enrollment, weekday) };
  }

  @Get("calendar/days/")
  async calendarDays(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string>) {
    return { results: await this.school.calendarDays(request.authUser, query) };
  }

  @Get("attendance-records/")
  async attendanceRecords(@Req() request: AuthenticatedRequest, @Query("student_id") studentId?: string) {
    const student = await this.school.studentForUser(request.authUser, studentId);
    const enrollment = await this.school.enrollment(student.id);
    return { results: await this.school.attendanceRecords(student.id, enrollment) };
  }

  @Get("leave-requests/")
  async leaves(@Req() request: AuthenticatedRequest, @Query("student_id") studentId?: string, @Query("status") status?: string) {
    return { results: await this.school.leaveList(request.authUser, studentId, status, request) };
  }

  @Post("leave-requests/")
  async createLeave(@Req() request: AuthenticatedRequest) {
    const parsed = await bodyAndUpload(request);
    return this.school.createLeave(request.authUser, parsed.body, parsed.upload, request);
  }

  @Get("leave-requests/:leaveId/")
  async leave(@Req() request: AuthenticatedRequest, @Param("leaveId") leaveId: string) {
    await this.school.leaveForUser(request.authUser, leaveId);
    return this.school.leaveDto(leaveId, request);
  }

  @Post("leave-requests/:leaveId/documents/")
  async addDocument(@Req() request: AuthenticatedRequest, @Param("leaveId") leaveId: string) {
    const parsed = await bodyAndUpload(request);
    if (!parsed.upload) throw new (await import("@nestjs/common")).BadRequestException("A file is required.");
    return this.school.addLeaveDocument(request.authUser, leaveId, parsed.upload, request);
  }

  @Get("leave-requests/:leaveId/documents/:documentId/download/")
  async downloadDocument(@Req() request: AuthenticatedRequest, @Res() reply: FastifyReply, @Param("leaveId") leaveId: string, @Param("documentId") documentId: string) {
    const { document, stream } = await this.school.leaveDocument(request.authUser, leaveId, documentId);
    const filename = document.original_name.replace(/[\r\n"]/g, "_");
    reply.type(document.content_type || "application/octet-stream");
    reply.header("Content-Disposition", `inline; filename="${filename}"`);
    return reply.send(stream);
  }

  @Post("leave-requests/:leaveId/:action/")
  @HttpCode(200)
  async leaveAction(@Req() request: AuthenticatedRequest, @Param("leaveId") leaveId: string, @Param("action") action: string) {
    return this.school.performLeaveAction(request.authUser, leaveId, action, (request.body as any)?.note, request);
  }

  @Get("diary/")
  async diary(@Req() request: AuthenticatedRequest, @Query("student_id") studentId?: string, @Query("date_from") dateFrom?: string, @Query("date_to") dateTo?: string) {
    const student = await this.school.studentForUser(request.authUser, studentId);
    const enrollment = await this.school.enrollment(student.id);
    return { results: await this.school.diaryItems(student.id, enrollment, dateFrom, dateTo) };
  }

  @Post("diary/:itemId/acknowledge/")
  async acknowledge(@Req() request: AuthenticatedRequest, @Res({ passthrough: true }) reply: FastifyReply, @Param("itemId") itemId: string) {
    const result = await this.school.acknowledgeDiary(request.authUser, itemId, (request.body as any)?.student_id);
    reply.status(result.created ? 201 : 200);
    return result.data;
  }

  @Post("diary/:itemId/notes/")
  async note(@Req() request: AuthenticatedRequest, @Param("itemId") itemId: string) {
    return this.school.addDiaryNote(request.authUser, itemId, (request.body as any)?.student_id, (request.body as any)?.body);
  }

  @Get("notifications/")
  async notifications(@Req() request: AuthenticatedRequest, @Query("limit") limit?: string, @Query("cursor") cursor?: string) {
    return this.school.notifications(request.authUser, { limit, cursor });
  }

  @Post("notifications/:notificationId/read/")
  @HttpCode(200)
  async notificationRead(@Req() request: AuthenticatedRequest, @Param("notificationId") notificationId: string) {
    return this.school.markNotificationRead(request.authUser, notificationId);
  }

  @Get("screens/parent/home/")
  parentHome(@Req() request: AuthenticatedRequest, @Query("student_id") studentId?: string) {
    return this.school.parentHome(request.authUser, studentId);
  }

  @Post("homework/:itemId/complete/")
  @HttpCode(200)
  completeHomework(@Req() request: AuthenticatedRequest, @Param("itemId") itemId: string) {
    return this.school.setHomeworkCompleted(request.authUser, itemId, (request.body as { student_id?: string })?.student_id, true);
  }

  @Delete("homework/:itemId/complete/")
  async reopenHomework(@Req() request: AuthenticatedRequest, @Param("itemId") itemId: string, @Query("student_id") studentId?: string) {
    return this.school.setHomeworkCompleted(request.authUser, itemId, studentId, false);
  }

  @Get("screens/parent/attendance/")
  parentAttendance(@Req() request: AuthenticatedRequest, @Query("student_id") studentId?: string) {
    return this.school.parentAttendance(request.authUser, studentId);
  }

  @Get("screens/parent/diary/")
  parentDiary(@Req() request: AuthenticatedRequest, @Query("student_id") studentId?: string, @Query("date") date?: string) {
    return this.school.parentDiary(request.authUser, studentId, date);
  }

  @Get("screens/parent/leave/:leaveId/")
  parentLeave(@Req() request: AuthenticatedRequest, @Param("leaveId") leaveId: string, @Query("student_id") studentId?: string) {
    return this.school.parentLeave(request.authUser, leaveId, studentId, request);
  }

  @Get("screens/parent/timetable/:mode/")
  parentTimetable(@Req() request: AuthenticatedRequest, @Param("mode") mode: string, @Query("student_id") studentId?: string, @Query("date") date?: string) {
    return this.school.timetableScreen(request.authUser, mode, studentId, date, "guardian");
  }

  @Get("screens/parent/timetable-summary/")
  parentTimetableSummary(@Req() request: AuthenticatedRequest, @Query("start") start: string, @Query("end") end: string, @Query("date") date?: string, @Query("student_id") studentId?: string) {
    return this.school.timetableSummaryScreen(request.authUser, start, end, date, studentId, "guardian");
  }

  @Get("screens/student/attendance/")
  studentAttendance(@Req() request: AuthenticatedRequest, @Query("student_id") studentId?: string) {
    return this.school.studentAttendanceScreen(request.authUser, studentId);
  }

  @Get("screens/student/home/")
  studentHome(@Req() request: AuthenticatedRequest, @Query("student_id") studentId?: string) {
    return this.school.studentHomeScreen(request.authUser, studentId);
  }

  @Get("screens/student/attendance/eligibility/")
  eligibility(@Req() request: AuthenticatedRequest, @Query("student_id") studentId?: string, @Query("subject_id") subjectId?: string, @Query("additional_missed") missed?: string) {
    return this.school.eligibilityScreen(request.authUser, studentId, subjectId, missed);
  }

  @Get("screens/student/timetable/:mode/")
  studentTimetable(@Req() request: AuthenticatedRequest, @Param("mode") mode: string, @Query("student_id") studentId?: string, @Query("date") date?: string) {
    return this.school.timetableScreen(request.authUser, mode, studentId, date);
  }

  @Get("screens/student/timetable-summary/")
  studentTimetableSummary(@Req() request: AuthenticatedRequest, @Query("start") start: string, @Query("end") end: string, @Query("date") date?: string, @Query("student_id") studentId?: string) {
    return this.school.timetableSummaryScreen(request.authUser, start, end, date, studentId);
  }

  @Get("screens/student/leave/apply/")
  leaveApply(@Req() request: AuthenticatedRequest, @Query("student_id") studentId?: string) {
    return this.school.leaveApplyScreen(request.authUser, studentId, request);
  }

  @Get("screens/student/leave/status/")
  leaveStatus(@Req() request: AuthenticatedRequest, @Query("student_id") studentId?: string) {
    return this.school.leaveStatusScreen(request.authUser, studentId, request);
  }

  @Get("screens/teacher/home/")
  @RequirePermission("timetable.view")
  teacherHome(@Req() request: AuthenticatedRequest, @Query("date") date?: string) {
    return this.school.teacherHomeScreen(request.authUser, date);
  }

  @Get("screens/teacher/attendance/")
  @RequirePermission("attendance.view")
  teacherAttendance(@Req() request: AuthenticatedRequest, @Query("class_section_id") classSectionId?: string, @Query("date") date?: string) {
    return this.school.teacherAttendanceScreen(request.authUser, classSectionId, date);
  }

  @Get("screens/teacher/class-updates/")
  @RequirePermission("attendance.view")
  teacherClassUpdates(@Req() request: AuthenticatedRequest, @Query("date") date?: string) {
    return this.school.teacherClassUpdates(request.authUser, date);
  }

  @Post("teacher/attendance/bulk/")
  @HttpCode(200)
  @RequirePermission("attendance.record")
  teacherAttendanceSave(@Req() request: AuthenticatedRequest) {
    return this.school.saveTeacherAttendance(request.authUser, request.body, request);
  }

  @Get("teacher/attendance/student/")
  @RequirePermission("attendance.view")
  studentAttendanceLookup(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string>) {
    return this.school.studentAttendanceLookup(request.authUser, query);
  }

  @Post("teacher/attendance/student/")
  @HttpCode(200)
  @RequirePermission("attendance.record")
  studentAttendanceSave(@Req() request: AuthenticatedRequest) {
    return this.school.saveStudentAttendance(request.authUser, request.body, request);
  }

  @Post("attendance-continuity/batches/")
  @HttpCode(200)
  @RequirePermission("attendance.record")
  attendanceContinuitySave(@Req() request: AuthenticatedRequest) {
    return this.school.saveAttendanceContinuityBatch(request.authUser, request.body, request);
  }

  @Get("screens/principal/attendance/continuity/")
  attendanceContinuityWorkspace(@Req() request: AuthenticatedRequest, @Query("date") date?: string) {
    return this.school.attendanceContinuityWorkspace(request.authUser, date);
  }

  @Post("attendance-continuity/cases/:caseId/decision/")
  @HttpCode(200)
  attendanceContinuityDecision(@Req() request: AuthenticatedRequest, @Param("caseId") caseId: string) {
    return this.school.decideAttendanceReconciliation(request.authUser, caseId, request.body, request);
  }

  @Post("attendance-registers/:classSectionId/lock/")
  @HttpCode(200)
  attendanceRegisterLock(@Req() request: AuthenticatedRequest, @Param("classSectionId") classSectionId: string, @Query("date") date?: string) {
    return this.school.setAttendanceRegisterLock(request.authUser, classSectionId, true, { ...(request.body ?? {}), date }, request);
  }

  @Delete("attendance-registers/:classSectionId/lock/")
  @HttpCode(200)
  attendanceRegisterUnlock(@Req() request: AuthenticatedRequest, @Param("classSectionId") classSectionId: string, @Query("date") date?: string) {
    return this.school.setAttendanceRegisterLock(request.authUser, classSectionId, false, { ...(request.body ?? {}), date }, request);
  }

  @Get("attendance-registers/:classSectionId/history/")
  @RequirePermission("attendance.view")
  attendanceRegisterHistory(@Req() request: AuthenticatedRequest, @Param("classSectionId") classSectionId: string, @Query("date") date?: string) {
    return this.school.attendanceRegisterHistory(request.authUser, classSectionId, date ?? "");
  }

  @Get("events/stream/")
  eventStream(@Req() request: AuthenticatedRequest, @Res() reply: FastifyReply) {
    return this.events.openStream(request.authUser, reply, request);
  }

  @Get("screens/principal/home/")
  principalHome(@Req() request: AuthenticatedRequest, @Query("date") date?: string) {
    return this.school.principalHomeScreen(request.authUser, date);
  }

  @Get("screens/principal/timetable/")
  principalTimetable(@Req() request: AuthenticatedRequest, @Query("term_id") termId?: string) {
    return this.school.principalTimetableScreen(request.authUser, termId);
  }

  @Post("principal/timetable/slots/")
  principalTimetableCreate(@Req() request: AuthenticatedRequest) {
    return this.school.createTimetableSlot(request.authUser, request.body, request);
  }

  @Patch("principal/timetable/slots/:slotId/")
  principalTimetableUpdate(@Req() request: AuthenticatedRequest, @Param("slotId") slotId: string) {
    return this.school.updateTimetableSlot(request.authUser, slotId, request.body, request);
  }

  @Delete("principal/timetable/slots/:slotId/")
  @HttpCode(200)
  principalTimetableDelete(@Req() request: AuthenticatedRequest, @Param("slotId") slotId: string) {
    return this.school.deleteTimetableSlot(request.authUser, slotId, request);
  }

  @Post("principal/timetable/copy-day/")
  principalTimetableCopyDay(@Req() request: AuthenticatedRequest) {
    return this.school.copyTimetableDay(request.authUser, request.body, request);
  }

  @Post("principal/timetable/targets/")
  principalTimetableTarget(@Req() request: AuthenticatedRequest) {
    return this.school.setCurriculumSubjectTarget(request.authUser, request.body, request);
  }

  @Post("principal/calendar/closures/")
  principalCalendarClosureCreate(@Req() request: AuthenticatedRequest) {
    return this.school.createSchoolClosure(request.authUser, request.body, request);
  }

  @Delete("principal/calendar/closures/:date/")
  @HttpCode(200)
  principalCalendarClosureDelete(@Req() request: AuthenticatedRequest, @Param("date") date: string) {
    return this.school.deleteSchoolClosure(request.authUser, date, request.body, request);
  }
}
