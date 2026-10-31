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
import { BadRequestException, ForbiddenException, Injectable, Optional } from "@nestjs/common";
import { sql } from "kysely";
import { z } from "zod";
import { DatabaseService } from "../database/database.service.js";
import { executionNow } from "../campus-model-core/execution-time.runtime.js";
import { ActivityPlanningService } from "../schedule-planning/activity-planning.service.js";
import { AttendanceModelService } from "../attendance-model/attendance-model.service.js";
import { ResponsibilityAttendanceRepository } from "./responsibility-attendance.repository.js";
import { ActivityAttendanceService } from "./activity-attendance.service.js";
import { AcademicParticipationBridge } from "./academic-participation-bridge.service.js";
import { attendanceQueueSchema } from "./activity-attendance.contracts.js";
import { composeAttendanceQueue } from "./activity-attendance-queue.js";
const iso = (value) => new Date(value).toISOString();
/** Read composition only; accepted participation commands live in the kernel. */
let ActivityAttendanceWorkspaceService = class ActivityAttendanceWorkspaceService {
    db;
    planning;
    attendance;
    legacyAttendance;
    legacyRegisters;
    academic;
    constructor(db, planning, attendance, legacyAttendance, legacyRegisters, academic) {
        this.db = db;
        this.planning = planning;
        this.attendance = attendance;
        this.legacyAttendance = legacyAttendance;
        this.legacyRegisters = legacyRegisters;
        this.academic = academic;
    }
    async member(user, schoolId) {
        if (user.active_school_id !== schoolId)
            throw new ForbiddenException("Choose this institution before opening its attendance.");
        const member = (await sql `SELECT membership.user_id FROM school_memberships membership JOIN users account ON account.id=membership.user_id AND account.is_active
      WHERE membership.school_id=${schoolId}::uuid AND membership.user_id=${user.id}::uuid AND membership.is_active LIMIT 1`.execute(this.db)).rows[0];
        if (!member)
            throw new ForbiddenException("An active institution membership is required.");
    }
    async openOccurrence(user, schoolValue, occurrenceValue) {
        const schoolId = z.string().uuid().parse(schoolValue), occurrenceId = z.string().uuid().parse(occurrenceValue);
        await this.member(user, schoolId);
        const existing = (await sql `SELECT register.id FROM activity_attendance_registers register
      JOIN activity_attendance_source_contexts link ON link.register_id=register.id AND link.school_id=register.school_id AND link.state='active'
      WHERE register.school_id=${schoolId}::uuid AND register.occurrence_id=${occurrenceId}::uuid`.execute(this.db)).rows[0];
        if (existing)
            return this.attendance.detail(user, schoolId, existing.id);
        const actor = await this.attendance.readerContext(user, schoolId);
        const permitted = (await sql `SELECT ${actor.administrator} OR EXISTS(
      SELECT 1 FROM schedule_activity_occurrence_recorders appointment WHERE appointment.school_id=occurrence.school_id
        AND appointment.occurrence_id=occurrence.id AND appointment.person_id=${actor.person_id}::uuid
        AND staff_has_resource_permission(occurrence.school_id,${user.id}::uuid,'attendance.'||appointment.action,
          'institution',occurrence.school_id,(${executionNow()}::timestamptz AT TIME ZONE occurrence.timezone)::date)) AS allowed
      FROM schedule_activity_occurrences occurrence WHERE occurrence.school_id=${schoolId}::uuid
        AND occurrence.id=${occurrenceId}::uuid AND occurrence.source='activity' AND occurrence.attendance_mode='roll_call'`.execute(this.db)).rows[0];
        if (!permitted?.allowed)
            throw new ForbiddenException("This attendance occurrence is outside your current responsibilities.");
        const registerId = await this.attendance.ensureRegister(schoolId, occurrenceId);
        return this.attendance.detail(user, schoolId, registerId);
    }
    async list(user, schoolValue, query) {
        const schoolId = z.string().uuid().parse(schoolValue), input = attendanceQueueSchema.parse(query);
        await this.member(user, schoolId);
        const date = input.date ?? (await sql `SELECT (${executionNow()}::timestamptz AT TIME ZONE timezone)::date::text AS date
      FROM schools WHERE id=${schoolId}::uuid`.execute(this.db)).rows[0].date;
        // Include the preceding day so one overnight occurrence remains discoverable
        // after midnight rather than creating another register for the same duty.
        const from = new Date(Date.parse(`${date}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
        await this.planning.ensureOccurrences(schoolId, from, date);
        const actor = await this.attendance.readerContext(user, schoolId);
        const candidates = (await sql `SELECT occurrence.id AS occurrence_id,register.id,occurrence.title,occurrence.purpose AS kind,
      occurrence.starts_at,occurrence.ends_at,occurrence.timezone AS time_zone,COALESCE(space.name,'') AS place_label,
      COALESCE(register.state,'draft') AS state,COALESCE(register.revision,0) AS revision,occurrence.state AS occurrence_state,
      CASE WHEN register.id IS NULL THEN (SELECT count(*)::int FROM schedule_activity_occurrence_people expected WHERE expected.occurrence_id=occurrence.id AND expected.attendance_expected)
        ELSE (SELECT count(*)::int FROM activity_attendance_roster expected WHERE expected.register_id=register.id) END AS participant_count,
      (SELECT count(*)::int FROM activity_attendance_entries entry WHERE entry.register_id=register.id AND entry.status IS NOT NULL) AS recorded_count,
      (EXISTS(SELECT 1 FROM schedule_activity_occurrence_recorders mandate WHERE mandate.occurrence_id=occurrence.id
        AND mandate.person_id=${actor.person_id}::uuid AND mandate.action='record') AND (${actor.administrator}
        OR staff_has_resource_permission(${schoolId}::uuid,${user.id}::uuid,'attendance.record','institution',${schoolId}::uuid,
          (${executionNow()}::timestamptz AT TIME ZONE occurrence.timezone)::date))) AS can_record,
      (EXISTS(SELECT 1 FROM schedule_activity_occurrence_recorders mandate WHERE mandate.occurrence_id=occurrence.id
        AND mandate.person_id=${actor.person_id}::uuid AND mandate.action='review') AND (${actor.administrator}
        OR staff_has_resource_permission(${schoolId}::uuid,${user.id}::uuid,'attendance.review','institution',${schoolId}::uuid,
          (${executionNow()}::timestamptz AT TIME ZONE occurrence.timezone)::date))) AS can_review
      FROM schedule_activity_occurrences occurrence
      JOIN schedule_versions version ON version.id=occurrence.plan_version_id AND version.school_id=occurrence.school_id
      LEFT JOIN activity_attendance_registers register ON register.occurrence_id=occurrence.id AND register.school_id=occurrence.school_id
      LEFT JOIN campus_spaces space ON space.id=occurrence.space_id AND space.school_id=occurrence.school_id
      WHERE occurrence.school_id=${schoolId}::uuid AND occurrence.source='activity' AND occurrence.attendance_mode='roll_call'
        AND occurrence.ends_at>(${date}::date::timestamp AT TIME ZONE occurrence.timezone)
        AND occurrence.starts_at<((${date}::date+1)::timestamp AT TIME ZONE occurrence.timezone)
        AND (${actor.administrator} OR (occurrence.state='expected'
          AND (version.state='published' OR (version.state='cancelled' AND occurrence.starts_at<version.cancelled_at))
          AND EXISTS(SELECT 1 FROM schedule_activity_occurrence_recorders mandate
            WHERE mandate.school_id=occurrence.school_id AND mandate.occurrence_id=occurrence.id AND mandate.person_id=${actor.person_id}::uuid
              AND staff_has_resource_permission(occurrence.school_id,${user.id}::uuid,'attendance.'||mandate.action,
                'institution',occurrence.school_id,(${executionNow()}::timestamptz AT TIME ZONE occurrence.timezone)::date))))
      ORDER BY occurrence.starts_at,occurrence.id`.execute(this.db)).rows;
        const finalization = await this.attendance.finalizationStates(schoolId, candidates.filter(row => row.state === "submitted" && row.id).map(row => row.id));
        const summaries = candidates.map((row) => {
            const reason = row.occurrence_state !== "expected" ? "This activity was cancelled. Its attendance history is retained."
                : row.state === "locked" ? "This register is final. Its reviewer can reopen it."
                    : new Date(row.starts_at).getTime() > executionNow().getTime() ? "Attendance opens when this activity starts."
                        : !row.can_record ? "Recording is assigned to another person." : null;
            return { ...row, id: row.id ?? row.occurrence_id, starts_at: iso(row.starts_at), ends_at: iso(row.ends_at),
                ...(row.id && finalization.has(row.id) ? { finalization: finalization.get(row.id) } : {}),
                source_kind: "activity", entry_mode: "participation", can_record: reason === null && row.can_record, availability_reason: reason };
        });
        summaries.push(...await this.academicCompatibilityQueue(user, schoolId, date));
        const owned = (await sql `SELECT register.id FROM activity_attendance_registers register
      JOIN schedule_activity_occurrences occurrence ON occurrence.id=register.occurrence_id AND occurrence.school_id=register.school_id
      JOIN activity_attendance_source_contexts link ON link.register_id=register.id AND link.school_id=register.school_id AND link.state='active'
      WHERE register.school_id=${schoolId}::uuid AND occurrence.source IN ('event','examination')
        AND occurrence.starts_at<((${date}::date+1)::timestamp AT TIME ZONE occurrence.timezone)
        AND occurrence.ends_at>(${date}::date::timestamp AT TIME ZONE occurrence.timezone)
      ORDER BY occurrence.starts_at,register.id`.execute(this.db)).rows;
        for (const item of owned) {
            const summary = await this.attendance.owningSummary(user, schoolId, item.id);
            if (summary)
                summaries.push(summary);
        }
        const composed = composeAttendanceQueue(summaries, input, executionNow());
        const total = composed.items.length, totalPages = Math.max(1, Math.ceil(total / input.page_size));
        if (input.page > totalPages)
            throw new BadRequestException("This attendance page no longer exists. Return to the first page.");
        const page = composed.items.slice((input.page - 1) * input.page_size, input.page * input.page_size);
        // Materialize only the bounded visible page. Loading a queue must not create
        // thousands of empty registers or issue per-person/detail queries off-screen.
        for (const item of page)
            if (item.source_kind === "activity") {
                const id = await this.attendance.ensureRegister(schoolId, item.occurrence_id);
                item.id = id;
            }
        const ready = this.academic && (await sql `SELECT to_regclass(format('%I.%I',current_schema(),'activity_attendance_context_receipts')) IS NOT NULL AS ready`.execute(this.db)).rows[0]?.ready;
        if (ready)
            for (const item of page)
                if (item.source_kind === 'daily_class' || item.source_kind === 'scheduled_session') {
                    const prepared = item.source_kind === 'daily_class'
                        ? await this.academic.prepareDaily(user, schoolId, item.id.slice('legacy:daily_class:'.length).split(':')[0], date, true)
                        : await this.db.transaction().execute((tx) => this.academic.prepareSessionInTransaction(tx, user, schoolId, item.id.slice('legacy:scheduled_session:'.length), true));
                    const detail = await this.attendance.detail(user, schoolId, prepared.register_id);
                    item.id = prepared.register_id;
                    item.occurrence_id = detail.register.occurrence_id;
                    item.entry_mode = 'participation';
                    item.title = detail.register.title;
                    item.starts_at = detail.register.starts_at;
                    item.ends_at = detail.register.ends_at;
                    item.time_zone = detail.register.time_zone;
                    item.state = detail.register.state;
                    item.revision = detail.register.revision;
                    item.participant_count = detail.counts.participants;
                    item.recorded_count = detail.counts.recorded;
                    item.can_record = detail.capabilities.can_record;
                    item.can_review = detail.capabilities.can_review;
                    item.availability_reason = detail.availability_reason;
                }
        return { date, page: input.page, page_size: input.page_size, total, total_pages: totalPages, registers: page,
            counts: composed.counts, available_kinds: composed.available_kinds, unfiltered_total: composed.unfiltered_total };
    }
    /**
     * Retained academic records are never shadowed by an empty new register.
     * Until the lossless cutover is verified, this common queue links the exact
     * authoritative academic editor. Its historical rules remain intact.
     */
    async academicCompatibilityQueue(user, schoolId, date) {
        const memberships = (await sql `SELECT role FROM school_memberships
      WHERE school_id=${schoolId}::uuid AND user_id=${user.id}::uuid AND is_active AND role IN ('admin','staff')`.execute(this.db)).rows;
        if (!memberships.length)
            return [];
        const model = await this.legacyAttendance.workspace(user, date);
        if (model.mode === "none")
            return [];
        const administrator = memberships.some((membership) => membership.role === "admin");
        const visible = (await sql `SELECT section.id,
      staff_has_class_permission(${schoolId}::uuid,${user.id}::uuid,'attendance.record',section.id,${date}::date) AS can_record
      FROM class_sections section WHERE section.school_id=${schoolId}::uuid AND (
        ${administrator} OR staff_has_class_permission(${schoolId}::uuid,${user.id}::uuid,'attendance.view',section.id,${date}::date)
        OR staff_has_class_permission(${schoolId}::uuid,${user.id}::uuid,'attendance.record',section.id,${date}::date))`.execute(this.db)).rows;
        const currentDate = (await sql `SELECT (${executionNow()}::timestamptz AT TIME ZONE timezone)::date::text AS date FROM schools WHERE id=${schoolId}::uuid`.execute(this.db)).rows[0].date;
        const academicRows = model.mode === "daily_class"
            ? await this.legacyRegisters.dailyRegisters({ school_id: schoolId, date, current_local_date: currentDate,
                access: { view_all: administrator, record_all: administrator, view_class_ids: visible.map((row) => row.id),
                    record_class_ids: visible.filter((row) => row.can_record).map((row) => row.id) } })
            : model.registers;
        const results = [];
        const timesByIndex = new Map((await sql `SELECT source.index,
        ((${date}::date+source.starts_at::time) AT TIME ZONE school.timezone) AS starts_at,
        (((${date}::date+source.end_day_offset)+source.ends_at::time) AT TIME ZONE school.timezone) AS ends_at,school.timezone
      FROM jsonb_to_recordset(${JSON.stringify(academicRows.map((row, index) => ({ index,
            starts_at: model.mode === 'daily_class' ? '00:00' : row.starts_at ?? '00:00',
            ends_at: model.mode === 'daily_class' ? '00:00' : row.ends_at ?? '23:59:59',
            end_day_offset: model.mode === 'daily_class' ? 1 : 0 })))}::jsonb)
        AS source(index int,starts_at text,ends_at text,end_day_offset int) CROSS JOIN schools school WHERE school.id=${schoolId}::uuid`.execute(this.db)).rows.map((row) => [row.index, row]));
        for (const [index, row] of academicRows.entries()) {
            if (model.mode === "daily_class" && !row.instructional)
                continue;
            const times = timesByIndex.get(index);
            const sessionId = "session_id" in row ? String(row.session_id) : null;
            const sourceKind = sessionId ? "scheduled_session" : "daily_class";
            const sourceId = sessionId ?? `${row.class_section_id}:${date}`;
            const href = `/areas/attendance/registers?date=${date}&${sessionId ? `session_id=${sessionId}` : `class_section_id=${row.class_section_id}`}`;
            results.push({ id: `legacy:${sourceKind}:${sourceId}`, occurrence_id: `legacy:${sourceId}`,
                title: sessionId ? "subject_name" in row ? `${String(row.subject_name)} · ${row.class_name}` : row.class_name : `${row.class_name} daily attendance`,
                kind: "teaching", starts_at: iso(times.starts_at), ends_at: iso(times.ends_at), time_zone: times.timezone,
                place_label: row.room_number ?? "", state: ["submitted", "locked"].includes(row.submission_status)
                    ? row.submission_status : "draft", revision: "revision" in row ? Number(row.revision) : 0,
                participant_count: Number(row.student_count), recorded_count: Number(row.marked_count),
                can_record: Boolean(row.can_mark), can_review: administrator, availability_reason: row.availability_reason,
                source_kind: sourceKind, entry_mode: "legacy", source: { domain: "attendance", href, label: sessionId ? "Lesson attendance" : "Daily attendance" } });
        }
        return results;
    }
};
ActivityAttendanceWorkspaceService = __decorate([
    Injectable(),
    __param(5, Optional()),
    __metadata("design:paramtypes", [DatabaseService, ActivityPlanningService,
        ActivityAttendanceService, AttendanceModelService,
        ResponsibilityAttendanceRepository,
        AcademicParticipationBridge])
], ActivityAttendanceWorkspaceService);
export { ActivityAttendanceWorkspaceService };
//# sourceMappingURL=activity-attendance-workspace.service.js.map