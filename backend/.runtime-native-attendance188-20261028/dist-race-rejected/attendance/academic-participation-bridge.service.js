var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { sql } from "kysely";
import { DatabaseService } from "../database/database.service.js";
import { executionNow } from "../campus-model-core/execution-time.runtime.js";
import { lockSchedule } from "../day-plans/schedule.js";
import { attendanceDayPolicy } from "./attendance-workspace.js";
import { activityOccurrenceId } from "../schedule-planning/activity-occurrence.engine.js";
import { participationRosterFingerprint } from "./activity-attendance.contracts.js";
import { ActivityAttendanceService } from "./activity-attendance.service.js";
import { completeParticipationPhoto, validateParticipationPhoto } from "./participation-continuity.js";
/**
 * Owning academic adapter. Imports retain source evidence and signers; importing
 * never emits fresh attendance observations. A receipt is not a new decision.
 * Contexts remain inaccessible to new writes until the complete compatibility
 * projection and old-writer fence are activated in the same transaction.
 */
let AcademicParticipationBridge = class AcademicParticipationBridge {
    db;
    attendance;
    constructor(db, attendance) {
        this.db = db;
        this.attendance = attendance;
    }
    transitionInTransaction(tx, user, schoolId, registerId, operation, body, request) {
        return this.attendance.transition(user, schoolId, registerId, operation, body, request, tx);
    }
    async affectedEnrollmentRegisters(tx, schoolId, targets) {
        const daily = (await sql `SELECT register.id,register.class_section_id AS class_id,
        register.date::text,register.state,'daily_class'::text AS source_kind FROM attendance_registers register
      JOIN jsonb_to_recordset(${JSON.stringify(targets)}::jsonb) scope(class_id uuid,term_id uuid,effective_on date)
        ON scope.class_id=register.class_section_id AND scope.term_id=register.term_id AND register.date>=scope.effective_on
      WHERE register.school_id=${schoolId}::uuid ORDER BY register.class_section_id,register.date,register.id FOR UPDATE OF register`.execute(tx)).rows;
        const sessions = (await sql `SELECT register.id,register.class_section_id AS class_id,register.session_date::text AS date,
        register.state,'scheduled_session'::text AS source_kind FROM attendance_session_registers register
      JOIN jsonb_to_recordset(${JSON.stringify(targets)}::jsonb) scope(class_id uuid,term_id uuid,effective_on date)
        ON scope.class_id=register.class_section_id AND scope.term_id=register.term_id AND register.session_date>=scope.effective_on
      WHERE register.school_id=${schoolId}::uuid ORDER BY register.class_section_id,register.session_date,register.id FOR UPDATE OF register`.execute(tx)).rows;
        return [...daily, ...sessions].sort((left, right) => `${left.class_id}:${left.date}:${left.source_kind}:${left.id}`.localeCompare(`${right.class_id}:${right.date}:${right.source_kind}:${right.id}`));
    }
    /** Capture old expectations before People writes the enrollment; all affected
     * final/cancelled contexts are checked before any source mutation can commit. */
    async prepareEnrollmentRostersInTransaction(tx, user, schoolId, source) {
        await lockSchedule(tx, schoolId);
        const authorized = await this.attendance.authorizeEnrollmentRosterChangeInTransaction(tx, user, schoolId, source, "prepare");
        const registers = await this.affectedEnrollmentRegisters(tx, schoolId, authorized.targets);
        if (registers.some(register => register.state === "locked"))
            throw new ConflictException("An affected attendance register is locked. Reopen it before changing enrollment.");
        for (const register of registers) {
            await sql `SELECT pg_advisory_xact_lock(hashtextextended(${`${register.class_id}:${register.date}`},0))`.execute(tx);
            const context = register.source_kind === "daily_class" ? await this.dailyContext(tx, schoolId, register.class_id, register.date)
                : await this.sessionContext(tx, schoolId, register.id);
            const imported = await this.import(tx, user, context);
            await sql `UPDATE activity_attendance_registers SET context_state='active',context_activated_at=COALESCE(context_activated_at,${executionNow()})
        WHERE school_id=${schoolId}::uuid AND id=${imported.register_id}::uuid`.execute(tx);
            const occurrence = (await sql `SELECT occurrence.state FROM schedule_activity_occurrences occurrence
        JOIN activity_attendance_registers register ON register.occurrence_id=occurrence.id AND register.school_id=occurrence.school_id
        WHERE register.id=${imported.register_id}::uuid FOR UPDATE OF register,occurrence`.execute(tx)).rows[0];
            if (occurrence?.state !== "expected")
                throw new ConflictException("An affected attendance activity was cancelled. Review its retained context before changing enrollment.");
        }
    }
    async reconcileEnrollmentRostersInTransaction(tx, user, schoolId, source, request) {
        await lockSchedule(tx, schoolId);
        const authorized = await this.attendance.authorizeEnrollmentRosterChangeInTransaction(tx, user, schoolId, source);
        const registers = await this.affectedEnrollmentRegisters(tx, schoolId, authorized.targets);
        const changed = [];
        for (const register of registers) {
            const current = (await sql `SELECT canonical.id,canonical.revision,canonical.state
        FROM activity_attendance_source_contexts link JOIN activity_attendance_registers canonical
          ON canonical.id=link.register_id AND canonical.school_id=link.school_id
        WHERE link.school_id=${schoolId}::uuid AND link.source_kind=${register.source_kind} AND link.state='active'
          AND link.context_snapshot->'context'->>'legacy_register_id'=${register.id}
        FOR UPDATE OF canonical`.execute(tx)).rows[0];
            if (!current)
                throw new ConflictException("The previous academic expectation was not captured before this enrollment change.");
            await this.attendance.reconcileAcademicEnrollmentInTransaction(tx, user, schoolId, current.id, source, current.revision, { ...request, headers: { ...request.headers, "idempotency-key": `enrollment-roster:${source.review_id}:${current.id}` } });
            changed.push({ id: register.id, revision: current.revision + 1, previous_state: current.state });
        }
        return changed;
    }
    /** Accepted leave drives an administrative exemption through the one kernel,
     * never a new physical observation or a write to an archived/read projection. */
    async applyApprovedLeaveInTransaction(tx, user, schoolId, leaveId, request) {
        const identity = await this.attendance.readerContext(user, schoolId, tx);
        if (!identity.administrator)
            throw new ForbiddenException("An active school administrator must decide a leave request.");
        await lockSchedule(tx, schoolId);
        const leave = (await sql `
      SELECT leave.student_id,leave.term_id,enrollment.class_section_id AS class_id,leave.starts_on::text,leave.ends_on::text
      FROM leave_requests leave JOIN students student ON student.id=leave.student_id
      JOIN enrollments enrollment ON enrollment.student_id=student.id AND enrollment.term_id=leave.term_id AND enrollment.is_active
      WHERE leave.id=${leaveId}::uuid AND student.school_id=${schoolId}::uuid
        AND leave.status='school_approved' AND leave.decided_by=${user.id}::uuid AND leave.decided_at<=${executionNow()}
      FOR SHARE OF leave,student,enrollment`.execute(tx)).rows[0];
        if (!leave)
            throw new ForbiddenException("The approved leave and current deciding administrator do not match this institution and enrollment.");
        const days = (await sql `SELECT day::date::text AS date
      FROM generate_series(${leave.starts_on}::date,${leave.ends_on}::date,interval '1 day') day
      WHERE EXISTS(SELECT 1 FROM effective_school_schedule_v4(${schoolId}::uuid,day::date) slot
        WHERE slot.class_section_id=${leave.class_id}::uuid AND slot.term_id=${leave.term_id}::uuid
          AND NOT slot.cancelled AND slot.slot_type IN ('class','activity'))
      ORDER BY day`.execute(tx)).rows;
        const changed = [];
        for (const day of days) {
            await sql `SELECT pg_advisory_xact_lock(hashtextextended(${`${leave.class_id}:${day.date}`},0))`.execute(tx);
            const context = await this.dailyContext(tx, schoolId, leave.class_id, day.date);
            if (context.term_id !== leave.term_id)
                throw new ConflictException("The leave term and daily academic context changed.");
            const imported = await this.import(tx, user, context);
            await sql `UPDATE activity_attendance_registers SET context_state='active',context_activated_at=COALESCE(context_activated_at,${executionNow()})
        WHERE school_id=${schoolId}::uuid AND id=${imported.register_id}::uuid`.execute(tx);
            const register = (await sql `SELECT revision,state FROM activity_attendance_registers
        WHERE school_id=${schoolId}::uuid AND id=${imported.register_id}::uuid FOR UPDATE`.execute(tx)).rows[0];
            if (register.state === "locked")
                throw new ConflictException("Reopen the locked attendance register before approving leave for this date.");
            const current = (await sql `SELECT entry.status
        FROM activity_attendance_academic_roster person LEFT JOIN activity_attendance_entries entry
          ON entry.register_id=person.register_id AND entry.person_id=person.person_id
        WHERE person.school_id=${schoolId}::uuid AND person.register_id=${imported.register_id}::uuid
          AND person.student_id=${leave.student_id}::uuid`.execute(tx)).rows[0];
            if (!current)
                throw new ConflictException("The approved learner is not in this daily register's retained roster.");
            if (current.status && current.status !== "absent")
                continue;
            await this.attendance.applyApprovedLeaveInTransaction(tx, user, schoolId, imported.register_id, { leave_id: leaveId, student_id: leave.student_id, expected_revision: register.revision }, { ...request, headers: { ...request.headers, "idempotency-key": `approved-leave:${leaveId}:${day.date}` } });
            changed.push(day.date);
        }
        return changed;
    }
    /** Server adapter only: the caller retains capture/receipt locks in this transaction. */
    async saveDailyRecordsInTransaction(tx, user, schoolId, classId, date, input, request, single = false, capture) {
        await lockSchedule(tx, schoolId);
        await sql `SELECT pg_advisory_xact_lock(hashtextextended(${`${classId}:${date}`},0))`.execute(tx);
        const context = await this.dailyContext(tx, schoolId, classId, date);
        await this.authorize(tx, user, context, "record");
        return this.saveRecords(tx, user, context, input, request, single, capture);
    }
    async saveSessionRecordsInTransaction(tx, user, schoolId, sessionId, input, request) {
        await lockSchedule(tx, schoolId);
        await sql `SELECT pg_advisory_xact_lock(hashtextextended(${`attendance-session:${sessionId}`},0))`.execute(tx);
        const context = await this.sessionContext(tx, schoolId, sessionId);
        await this.authorize(tx, user, context, "record");
        return this.saveRecords(tx, user, context, input, request, false);
    }
    async saveRecords(tx, user, context, input, request, single, capture) {
        if (!context.instructional)
            throw new BadRequestException("Attendance is not required because this class has no scheduled lesson on the selected date.");
        const ready = (await sql `SELECT to_regclass(format('%I.%I',current_schema(),'activity_attendance_context_receipts')) IS NOT NULL AS ready`.execute(tx)).rows[0]?.ready;
        if (!ready)
            throw new ConflictException("The academic attendance migration has not been activated.");
        const imported = await this.import(tx, user, context);
        await sql `UPDATE activity_attendance_registers SET context_state='active',context_activated_at=COALESCE(context_activated_at,${executionNow()})
      WHERE school_id=${context.school_id}::uuid AND id=${imported.register_id}::uuid`.execute(tx);
        const canonical = context.kind === "daily_class" ? {
            ...(single ? { operation: "record_student" } : {}), class_section_id: context.class_id, date: context.date,
            expected_revision: input.expected_revision, photo_session_id: input.photo_session_id ?? null, reason: input.reason ?? "",
            records: [...input.records].sort((left, right) => left.student_id.localeCompare(right.student_id)),
        } : { sessionId: context.source_id, ...input, records: [...input.records].sort((left, right) => left.student_id.localeCompare(right.student_id)) };
        const requestHash = createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
        const rawKey = request.headers["idempotency-key"], key = Array.isArray(rawKey) ? rawKey[0] : rawKey;
        if (!key || !/^[A-Za-z0-9._:-]{8,128}$/.test(key))
            throw new BadRequestException("A valid Idempotency-Key header is required.");
        const replay = (await sql `SELECT id,request_hash,result_body
      FROM ${sql.table(context.kind === "daily_class" ? "attendance_submissions" : "attendance_session_submissions")}
      WHERE school_id=${context.school_id}::uuid AND submitted_by=${user.id}::uuid AND idempotency_key=${key}`.execute(tx)).rows[0];
        if (replay) {
            if (replay.request_hash !== requestHash)
                throw new ConflictException({
                    message: "This Idempotency-Key was used for different attendance data.", code: "idempotency_conflict"
                });
            return { result: replay.result_body, legacy_result: replay.result_body, command_id: replay.id,
                register_id: imported.register_id, context, request_hash: requestHash };
        }
        const people = (await sql `SELECT person.person_id,person.student_id,COALESCE(entry.remarks,'') AS remarks
      FROM activity_attendance_academic_roster person LEFT JOIN activity_attendance_entries entry
        ON entry.register_id=person.register_id AND entry.person_id=person.person_id
      WHERE person.school_id=${context.school_id}::uuid AND person.register_id=${imported.register_id}::uuid`.execute(tx)).rows;
        const peopleByStudent = new Map(people.map((person) => [person.student_id, person]));
        const captureSources = {};
        const records = input.records.map((record) => {
            const person = peopleByStudent.get(record.student_id);
            if (!person)
                throw new BadRequestException("Every attendance decision must belong to this register's retained academic roster.");
            if (capture)
                captureSources[person.person_id] = capture;
            return { person_id: person.person_id, status: record.status, remarks: record.remarks ?? person.remarks };
        });
        const photo = input.photo_session_id ? await validateParticipationPhoto(tx, { school_id: context.school_id,
            class_section_id: context.class_id, date: context.date, attendance_session_id: context.kind === "scheduled_session" ? context.source_id : null,
            photo_session_id: input.photo_session_id, actor_id: user.id, register_id: imported.register_id }) : null;
        if (photo)
            for (const record of input.records)
                if (record.status === "present" && photo.matched_student_ids.includes(record.student_id)) {
                    captureSources[peopleByStudent.get(record.student_id).person_id] = { capture_channel: "camera_assisted", observed_at: photo.observed_at, evidence_refs: [photo.evidence_ref] };
                }
        const body = { expected_revision: input.expected_revision, ...(input.reason ? { reason: input.reason } : {}), records };
        const result = single
            ? await this.attendance.marksInTransaction(tx, user, context.school_id, imported.register_id, body, request, captureSources)
            : await this.attendance.submitRecordsInTransaction(tx, user, context.school_id, imported.register_id, body, request, captureSources);
        const command = (await sql `SELECT id FROM activity_attendance_commands WHERE school_id=${context.school_id}::uuid
      AND actor_id=${user.id}::uuid AND idempotency_key=${key} AND register_id=${imported.register_id}::uuid`.execute(tx)).rows[0];
        if (!command)
            throw new ConflictException("The shared attendance acceptance receipt could not be retained.");
        if (photo)
            await completeParticipationPhoto(tx, photo.id, command.id, imported.register_id);
        return { result, command_id: command.id, register_id: imported.register_id, context, request_hash: requestHash };
    }
    async retainLegacyResult(tx, input) {
        const changed = (await sql `SELECT count(*)::int AS count FROM activity_attendance_entry_revisions revision
      JOIN activity_attendance_commands command ON command.register_id=revision.register_id AND command.register_revision=revision.register_revision
      WHERE command.id=${input.command_id}::uuid`.execute(tx)).rows[0].count;
        const retained = await sql `UPDATE activity_attendance_commands SET context_source_kind=${input.source_kind},
      context_source_id=${input.source_id},context_request_hash=${input.request_hash},context_result_body=${JSON.stringify(input.result_body)}::jsonb,
      context_records_count=${input.records_count},context_changed_count=${changed},
      context_capture_source=${input.capture ? input.capture.capture_channel === "offline_paper" ? "paper" : "live_app" : input.photo_session_id ? "camera_assisted" : "live_app"},
      context_photo_session_id=${input.photo_session_id ?? null}::uuid,context_observed_at=${input.capture?.observed_at ?? null},
      context_receipt_created_at=${executionNow()} WHERE id=${input.command_id}::uuid AND school_id=${input.school_id}::uuid
        AND context_source_kind IS NULL RETURNING id`.execute(tx);
        if (retained.rows.length !== 1)
            throw new ConflictException("The attendance presentation receipt could not be bound to its exact accepted command.");
    }
    async authorize(tx, user, context, action) {
        const identity = await this.attendance.readerContext(user, context.school_id, tx);
        const grant = (await sql `SELECT ${identity.administrator}
      OR staff_has_class_permission(${context.school_id}::uuid,${user.id}::uuid,${`attendance.${action}`},${context.class_id}::uuid,${context.date}::date)
      OR EXISTS(SELECT 1 FROM effective_school_schedule_v4(${context.school_id}::uuid,${context.date}::date) slot
        WHERE slot.class_section_id=${context.class_id}::uuid AND slot.term_id=${context.term_id}::uuid
          AND slot.teacher_user_id=${user.id}::uuid AND NOT slot.cancelled AND slot.coverage_status='accepted') AS allowed`.execute(tx)).rows[0].allowed;
        if (!grant)
            throw new ForbiddenException("The academic attendance context is outside your current responsibility.");
        if (action === "record" && context.kind === "daily_class") {
            const day = await attendanceDayPolicy(tx, context.school_id, context.class_id, context.term_id, context.date, { userId: user.id, role: identity.administrator ? "admin" : "staff" });
            if (!day?.completed)
                throw new BadRequestException("Attendance opens on the selected date.");
            if (!day.instructional)
                throw new BadRequestException("This class has no scheduled lesson on the selected date.");
            if (!day.actor_scheduled)
                throw new ForbiddenException("You have no scheduled or accepted cover period for this class on the selected date.");
        }
    }
    async dailyContext(tx, schoolId, classId, date) {
        const row = (await sql `
      SELECT term.id AS term_id,concat('Class ',section.grade,section.section,' daily attendance') AS title,school.timezone,
        (${date}::date::timestamp AT TIME ZONE school.timezone) AS starts_at,
        ((${date}::date+1)::timestamp AT TIME ZONE school.timezone) AS ends_at,
        EXISTS(SELECT 1 FROM effective_school_schedule_v4(school.id,${date}::date) slot WHERE slot.class_section_id=section.id
          AND slot.term_id=term.id AND NOT slot.cancelled AND slot.slot_type IN ('class','activity')) AS instructional
      FROM class_sections section JOIN schools school ON school.id=section.school_id
      JOIN academic_terms term ON term.school_id=section.school_id AND term.academic_year=section.academic_year
      WHERE section.school_id=${schoolId}::uuid AND section.id=${classId}::uuid
        AND ${date}::date BETWEEN term.starts_on AND term.ends_on ORDER BY term.starts_on DESC LIMIT 1`.execute(tx)).rows[0];
        if (!row)
            throw new NotFoundException("The class and date do not belong to an academic term in this institution.");
        const active = (await sql `SELECT 1 FROM activity_attendance_source_contexts WHERE school_id=${schoolId}::uuid
      AND source_kind='daily_class' AND source_id=${`${classId}:${row.term_id}:${date}`} AND state='active'`.execute(tx)).rows.length > 0;
        let register = (await sql `SELECT id FROM attendance_registers WHERE school_id=${schoolId}::uuid
      AND class_section_id=${classId}::uuid AND term_id=${row.term_id}::uuid AND date=${date}::date
      ${active ? sql `` : sql `FOR UPDATE`}`.execute(tx)).rows[0];
        if (!register) {
            const ready = (await sql `SELECT to_regclass(format('%I.%I',current_schema(),'activity_attendance_context_receipts')) IS NOT NULL AS ready`.execute(tx)).rows[0]?.ready;
            if (ready)
                register = (await sql `INSERT INTO attendance_registers(school_id,class_section_id,term_id,date)
        VALUES(${schoolId}::uuid,${classId}::uuid,${row.term_id}::uuid,${date}::date) RETURNING id`.execute(tx)).rows[0];
        }
        return { ...row, school_id: schoolId, class_id: classId, date, kind: "daily_class",
            source_id: `${classId}:${row.term_id}:${date}`, source_ref: `daily:${classId}:${row.term_id}`,
            legacy_register_id: register?.id ?? null, subject_id: null, period_id: null, period_number: null, scheduled_teacher_id: null };
    }
    async sessionContext(tx, schoolId, sessionId) {
        const active = (await sql `SELECT 1 FROM activity_attendance_source_contexts WHERE school_id=${schoolId}::uuid
      AND source_kind='scheduled_session' AND source_id=${sessionId} AND state='active'`.execute(tx)).rows.length > 0;
        const row = (await sql `
      SELECT session.class_section_id AS class_id,session.term_id,session.session_date::text AS date,session.title,school.timezone,
        ((session.session_date+session.starts_at) AT TIME ZONE school.timezone) AS starts_at,
        ((session.session_date+session.ends_at) AT TIME ZONE school.timezone) AS ends_at,session.subject_id,
        session.schedule_slot_id AS period_id,session.period_number,session.scheduled_teacher_id
      FROM attendance_session_registers session JOIN schools school ON school.id=session.school_id
      WHERE session.school_id=${schoolId}::uuid AND session.id=${sessionId}::uuid ${active ? sql `` : sql `FOR UPDATE OF session`}`.execute(tx)).rows[0];
        if (!row)
            throw new NotFoundException("The academic session was not found in this institution.");
        return { ...row, school_id: schoolId, kind: "scheduled_session", source_id: sessionId, source_ref: `session:${sessionId}`,
            legacy_register_id: sessionId, instructional: true };
    }
    async prepareDaily(user, schoolId, classId, date, activate = false) {
        return this.db.transaction().execute((tx) => this.prepareDailyInTransaction(tx, user, schoolId, classId, date, activate));
    }
    async prepareDailyInTransaction(tx, user, schoolId, classId, date, activate = false) {
        await lockSchedule(tx, schoolId);
        await sql `SELECT pg_advisory_xact_lock(hashtextextended(${`${classId}:${date}`},0))`.execute(tx);
        const context = await this.dailyContext(tx, schoolId, classId, date);
        await this.authorize(tx, user, context, "view");
        const imported = await this.import(tx, user, context);
        if (activate) {
            const ready = (await sql `SELECT to_regclass(format('%I.%I',current_schema(),'activity_attendance_context_receipts')) IS NOT NULL AS ready`.execute(tx)).rows[0]?.ready;
            if (!ready)
                throw new ConflictException("The academic attendance migration has not been activated.");
            await sql `UPDATE activity_attendance_registers SET context_state='active',context_activated_at=COALESCE(context_activated_at,${executionNow()})
        WHERE school_id=${schoolId}::uuid AND id=${imported.register_id}::uuid`.execute(tx);
        }
        return { ...imported, context };
    }
    async prepareSession(user, schoolId, sessionId) {
        return this.db.transaction().execute((tx) => this.prepareSessionInTransaction(tx, user, schoolId, sessionId));
    }
    async prepareSessionInTransaction(tx, user, schoolId, sessionId, activate = false) {
        await lockSchedule(tx, schoolId);
        await sql `SELECT pg_advisory_xact_lock(hashtextextended(${`attendance-session:${sessionId}`},0))`.execute(tx);
        const context = await this.sessionContext(tx, schoolId, sessionId);
        await this.authorize(tx, user, context, "view");
        const imported = await this.import(tx, user, context);
        if (activate) {
            const ready = (await sql `SELECT to_regclass(format('%I.%I',current_schema(),'activity_attendance_context_receipts')) IS NOT NULL AS ready`.execute(tx)).rows[0]?.ready;
            if (!ready)
                throw new ConflictException("The academic attendance migration has not been activated.");
            await sql `UPDATE activity_attendance_registers SET context_state='active',context_activated_at=COALESCE(context_activated_at,${executionNow()})
        WHERE school_id=${schoolId}::uuid AND id=${imported.register_id}::uuid`.execute(tx);
        }
        return { ...imported, context };
    }
    /** Exact own-participant ingress; never grants access to somebody else's roster. */
    async prepareSessionForParticipantInTransaction(tx, user, schoolId, sessionId, activate = true) {
        await lockSchedule(tx, schoolId);
        await sql `SELECT pg_advisory_xact_lock(hashtextextended(${`attendance-session:${sessionId}`},0))`.execute(tx);
        const context = await this.sessionContext(tx, schoolId, sessionId);
        const identity = await this.attendance.readerContext(user, schoolId, tx);
        const own = (await sql `SELECT 1 FROM students student JOIN enrollments enrollment ON enrollment.student_id=student.id
      WHERE student.school_id=${schoolId}::uuid AND student.user_id=${user.id}::uuid AND student.person_id=${identity.person_id}::uuid
        AND enrollment.class_section_id=${context.class_id}::uuid AND enrollment.term_id=${context.term_id}::uuid
        AND enrollment.is_active AND enrollment.enrolled_on<=${context.date}::date
        AND (enrollment.inactive_from IS NULL OR enrollment.inactive_from>${context.date}::date)`.execute(tx)).rows[0];
        if (!own)
            throw new ForbiddenException("This check-in is not for your current academic participation.");
        const imported = await this.import(tx, user, context);
        if (activate) {
            const ready = (await sql `SELECT to_regclass(format('%I.%I',current_schema(),'activity_attendance_context_receipts')) IS NOT NULL AS ready`.execute(tx)).rows[0]?.ready;
            if (!ready)
                throw new ConflictException("The academic attendance migration has not been activated.");
            await sql `UPDATE activity_attendance_registers SET context_state='active',context_activated_at=COALESCE(context_activated_at,${executionNow()})
        WHERE school_id=${schoolId}::uuid AND id=${imported.register_id}::uuid`.execute(tx);
        }
        return { register_id: imported.register_id, context };
    }
    async import(tx, user, context) {
        const linked = (await sql `SELECT register_id,state,source_fingerprint
      FROM activity_attendance_source_contexts WHERE school_id=${context.school_id}::uuid AND source_kind=${context.kind}
        AND source_id=${context.source_id} FOR UPDATE`.execute(tx)).rows[0];
        if (linked?.state === "active")
            return { register_id: linked.register_id, state: linked.state, source_kind: context.kind };
        const archived = (await sql `SELECT to_regclass(format('%I.%I',current_schema(),'attendance_records_legacy_source')) IS NOT NULL AS ready`.execute(tx)).rows[0]?.ready;
        const sourceTable = (name) => sql.table(archived ? `${name}_legacy_source` : name);
        const entries = context.kind === "daily_class"
            ? (await sql `SELECT id,student_id,status,remarks,revision,marked_by AS recorded_by,
          check_in_at AS observed_at,created_at,updated_at FROM ${sourceTable("attendance_records")}
          WHERE class_section_id=${context.class_id}::uuid AND date=${context.date}::date ORDER BY student_id FOR UPDATE`.execute(tx)).rows
            : (await sql `SELECT id,student_id,status,remarks,revision,recorded_by,observed_at,created_at,updated_at
          FROM ${sourceTable("attendance_session_entries")} WHERE school_id=${context.school_id}::uuid AND session_id=${context.source_id}::uuid
          ORDER BY student_id FOR UPDATE`.execute(tx)).rows;
        const people = (await sql `SELECT DISTINCT ON(student.id) student.id AS student_id,student.person_id,
        concat_ws(' ',person.first_name,NULLIF(person.last_name,'')) AS label,person.revision AS person_revision,
        enrollment.id AS enrollment_id,COALESCE(enrollment.revision,1) AS enrollment_revision
      FROM students student JOIN school_people person ON person.id=student.person_id AND person.school_id=student.school_id
      LEFT JOIN enrollments enrollment ON enrollment.student_id=student.id AND enrollment.class_section_id=${context.class_id}::uuid
        AND enrollment.term_id=${context.term_id}::uuid AND enrollment.enrolled_on<=${context.date}::date
        AND (enrollment.inactive_from IS NULL OR enrollment.inactive_from>${context.date}::date)
      WHERE student.school_id=${context.school_id}::uuid AND ((enrollment.is_active AND enrollment.id IS NOT NULL)
        OR student.id=ANY(${entries.map((entry) => entry.student_id)}::uuid[])
        OR EXISTS(SELECT 1 FROM ${sourceTable("attendance_session_evidence")} report WHERE ${context.kind}='scheduled_session'
          AND report.school_id=${context.school_id}::uuid AND report.session_id=${context.kind === "scheduled_session" ? context.source_id : null}::uuid
          AND report.student_id=student.id))
      ORDER BY student.id,enrollment.enrolled_on DESC,enrollment.id`.execute(tx)).rows;
        const register = context.legacy_register_id
            ? (await sql `SELECT * FROM ${sql.table(context.kind === "daily_class" ? "attendance_registers" : "attendance_session_registers")}
          WHERE id=${context.legacy_register_id}::uuid AND school_id=${context.school_id}::uuid FOR UPDATE`.execute(tx)).rows[0]
            : null;
        const revisions = context.kind === "daily_class"
            ? (await sql `SELECT id::text,attendance_record_id AS entry_id,student_id,previous_status,new_status,
          previous_remarks,new_remarks,reason,changed_by,request_id,register_revision,created_at FROM ${sourceTable("attendance_record_revisions")}
          WHERE school_id=${context.school_id}::uuid AND class_section_id=${context.class_id}::uuid AND date=${context.date}::date ORDER BY id`.execute(tx)).rows
            : (await sql `SELECT id::text,entry_id,student_id,previous_status,new_status,previous_remarks,new_remarks,
          reason,changed_by,request_id,register_revision,created_at FROM ${sourceTable("attendance_session_entry_revisions")}
          WHERE school_id=${context.school_id}::uuid AND session_id=${context.source_id}::uuid ORDER BY id`.execute(tx)).rows;
        const submissions = context.kind === "daily_class"
            ? (await sql `SELECT to_jsonb(source) AS snapshot FROM ${sourceTable("attendance_submissions")} source
          WHERE school_id=${context.school_id}::uuid AND class_section_id=${context.class_id}::uuid AND date=${context.date}::date
          ORDER BY created_at,id`.execute(tx)).rows.map((row) => row.snapshot)
            : (await sql `SELECT to_jsonb(source) AS snapshot FROM ${sourceTable("attendance_session_submissions")} source
          WHERE school_id=${context.school_id}::uuid AND session_id=${context.source_id}::uuid ORDER BY created_at,id`.execute(tx)).rows.map((row) => row.snapshot);
        const evidence = context.kind === "scheduled_session"
            ? (await sql `SELECT to_jsonb(source) AS snapshot
          FROM ${sourceTable("attendance_session_evidence")} source WHERE school_id=${context.school_id}::uuid
            AND session_id=${context.source_id}::uuid ORDER BY created_at,id`.execute(tx)).rows.map((row) => row.snapshot)
            : [];
        const lifecycle = context.kind === "scheduled_session"
            ? (await sql `SELECT to_jsonb(source) AS snapshot FROM attendance_session_audits source
          WHERE school_id=${context.school_id}::uuid AND session_id=${context.source_id}::uuid ORDER BY created_at,id`.execute(tx)).rows.map((row) => row.snapshot)
            : (await sql `SELECT to_jsonb(source) AS snapshot FROM audit_events source
          WHERE school_id=${context.school_id}::uuid AND action LIKE 'attendance.%'
            AND (target_id=${context.class_id}::uuid OR target_id=${context.legacy_register_id}::uuid)
            AND (metadata->>'date'=${context.date} OR target_id=${context.legacy_register_id}::uuid)
          ORDER BY created_at,id`.execute(tx)).rows.map((row) => row.snapshot);
        const hash = createHash("sha256").update(JSON.stringify({ import_contract: archived ? 166 : 162, context, register, entries, revisions, submissions, evidence, lifecycle,
            people: people.map((person) => ({ student_id: person.student_id, person_id: person.person_id, enrollment_id: person.enrollment_id,
                enrollment_revision: person.enrollment_revision })) })).digest("hex");
        if (linked) {
            if (linked.source_fingerprint !== hash)
                throw new ConflictException("The legacy register changed during its migration. Reconcile the import before activating it.");
            return { register_id: linked.register_id, state: linked.state, source_kind: context.kind };
        }
        const occurrenceId = activityOccurrenceId(context.school_id, "academic", context.source_ref, context.date);
        const id = randomUUID(), now = executionNow();
        const sourceRevision = Math.max(1, register?.revision ?? 0, ...entries.map((entry) => entry.revision));
        await sql `INSERT INTO schedule_activity_occurrences(id,school_id,activity_id,plan_version_id,period_id,source,source_ref,
      source_revision,title,purpose,local_date,starts_at,ends_at,timezone,attendance_mode,context_kind,context_ref,term_id,
      subject_id,scheduled_teacher_id,period_number,state,revision)
      VALUES(${occurrenceId}::uuid,${context.school_id}::uuid,${context.legacy_register_id ?? context.class_id}::uuid,NULL,
        ${context.period_id}::uuid,'academic',${context.source_ref},${sourceRevision},${context.title},'teaching',${context.date}::date,
        ${context.starts_at},${context.ends_at},${context.timezone},'roll_call','academic_class',${context.class_id}::uuid,${context.term_id}::uuid,
        ${context.subject_id}::uuid,${context.scheduled_teacher_id}::uuid,${context.period_number},'expected',1)`.execute(tx);
        const sourceRoster = people.map((person) => ({ person_id: person.person_id, label: person.label, participation_role: "participant",
            requirement: "required", source_kind: "class", source_ref: person.enrollment_id ?? `legacy_student:${person.student_id}`,
            source_revision: person.enrollment_revision }));
        const rosterHash = createHash("sha256").update(participationRosterFingerprint(sourceRoster)).digest("hex");
        await sql `INSERT INTO activity_attendance_registers(id,school_id,occurrence_id,state,revision,roster_fingerprint,roster_source_revision,
      policy_revision,policy_snapshot,submitted_by,submitted_at,locked_by,locked_at,reopened_by,reopened_at,reopen_reason,
      auto_finalize_at,finalization_source,created_at,updated_at)
      VALUES(${id}::uuid,${context.school_id}::uuid,${occurrenceId}::uuid,${register?.state ?? "draft"},${register?.revision ?? 0},${rosterHash},1,
        ${register?.finalization_policy_revision ?? 0},${JSON.stringify({ finalization_mode: "principal_review", auto_finalize_minutes: 0,
            configuration_state: "manual_fallback", approved_by: null, approved_at: null, migration_source: context.kind })}::jsonb,
        ${register?.submitted_by ?? null}::uuid,${register?.submitted_at ?? null},${register?.locked_by ?? null}::uuid,${register?.locked_at ?? null},
        ${register?.reopened_by ?? null}::uuid,${register?.reopened_at ?? null},${register?.reopen_reason ?? null},NULL,
        ${register?.locked_at ? register.finalization_source ?? "manual" : null},${register?.created_at ?? now},${register?.updated_at ?? now})`.execute(tx);
        for (let index = 0; index < people.length; index += 1) {
            const person = people[index], roster = sourceRoster[index];
            await sql `INSERT INTO schedule_activity_occurrence_people(occurrence_id,school_id,person_id,label,participation_role,source_kind,source_ref,source_revision,requirement)
        VALUES(${occurrenceId}::uuid,${context.school_id}::uuid,${person.person_id}::uuid,${person.label},'participant','class',${roster.source_ref},${roster.source_revision},'required')`.execute(tx);
            await sql `INSERT INTO activity_attendance_roster(school_id,register_id,person_id,label,participation_role,requirement,source_kind,source_ref,source_revision,
        academic_student_id,academic_enrollment_id,academic_source_revision)
        VALUES(${context.school_id}::uuid,${id}::uuid,${person.person_id}::uuid,${person.label},'participant','required','class',${roster.source_ref},${roster.source_revision},
          ${person.student_id}::uuid,${person.enrollment_id}::uuid,${person.enrollment_revision})`.execute(tx);
        }
        const personByStudent = new Map(people.map((person) => [person.student_id, person]));
        const recordPrefix = context.kind === "daily_class" ? "attendance_records" : "attendance_session_entries";
        for (const entry of entries) {
            const person = personByStudent.get(entry.student_id);
            if (!person)
                throw new ConflictException("A retained attendance decision could not resolve its original campus person.");
            await sql `INSERT INTO activity_attendance_entries(id,school_id,register_id,person_id,status,remarks,capture_channel,observed_at,
        recorded_by,revision,created_at,updated_at,legacy_source_ref)
        VALUES(${entry.id}::uuid,${context.school_id}::uuid,${id}::uuid,${person.person_id}::uuid,${entry.status},${entry.remarks},'legacy_import',
          ${entry.observed_at},${entry.recorded_by}::uuid,${entry.revision},${entry.created_at},${entry.updated_at},${`${recordPrefix}:${entry.id}`})`.execute(tx);
        }
        const revisionPrefix = context.kind === "daily_class" ? "attendance_record_revisions" : "attendance_session_entry_revisions";
        for (const revision of revisions) {
            const person = personByStudent.get(revision.student_id);
            if (!person)
                throw new ConflictException("A retained correction could not resolve its original campus person.");
            await sql `INSERT INTO activity_attendance_entry_revisions(school_id,register_id,entry_id,person_id,previous_status,new_status,
        previous_remarks,new_remarks,capture_channel,observed_at,reason,changed_by,request_id,register_revision,created_at,legacy_source_ref)
        VALUES(${context.school_id}::uuid,${id}::uuid,${revision.entry_id}::uuid,${person.person_id}::uuid,${revision.previous_status},${revision.new_status},
          ${revision.previous_remarks},${revision.new_remarks},'legacy_import',NULL,${revision.reason},${revision.changed_by}::uuid,
          ${revision.request_id}::uuid,${revision.register_revision},${revision.created_at},${`${revisionPrefix}:${revision.id}`})`.execute(tx);
        }
        if (archived)
            for (const retained of evidence) {
                const person = personByStudent.get(retained.student_id);
                if (!person)
                    throw new ConflictException("Retained attendance evidence could not resolve its original campus person.");
                const channel = retained.capture_channel === "student_qr" ? "self_check_in"
                    : retained.capture_channel === "biometric_device" ? "registered_device" : "camera_assisted";
                await sql `INSERT INTO activity_attendance_evidence(id,school_id,register_id,person_id,claimed_status,capture_channel,state,
        observed_at,received_at,submitted_by,source_reference,note,decided_by,decided_at,decision_note,created_at,legacy_source_ref,legacy_snapshot)
        VALUES(${retained.id}::uuid,${context.school_id}::uuid,${id}::uuid,${person.person_id}::uuid,'present',${channel},${retained.state},
          ${new Date(retained.observed_at)},${new Date(retained.created_at)},${retained.submitted_by}::uuid,${retained.provider_reference},
          'Retained source report; original provenance is preserved.',${retained.decided_by}::uuid,
          ${retained.decided_at ? new Date(retained.decided_at) : null},${retained.decision_note.trim().length >= 3 ? retained.decision_note : null},
          ${new Date(retained.created_at)},${`attendance_session_evidence:${retained.id}`},${JSON.stringify(retained)}::jsonb)`.execute(tx);
            }
        const sourceRefs = { context, original_register: register, entry_table: recordPrefix, revision_table: revisionPrefix,
            entry_ids: entries.map((entry) => entry.id), revision_ids: revisions.map((revision) => revision.id),
            original_submissions: submissions, original_evidence: evidence, original_lifecycle: lifecycle,
            automation_due: register?.auto_finalize_at ?? null, attribution: "retained_legacy_source_not_a_new_observation" };
        await sql `UPDATE activity_attendance_registers SET context_source_kind=${context.kind},context_source_id=${context.source_id},
      context_imported_revision=${register?.revision ?? 0},context_imported_at=${now},context_state='imported',
      context_snapshot=${JSON.stringify(sourceRefs)}::jsonb,context_source_fingerprint=${hash}
      WHERE id=${id}::uuid AND school_id=${context.school_id}::uuid`.execute(tx);
        await sql `INSERT INTO activity_attendance_import_receipts(school_id,register_id,source_kind,source_id,source_revision,
      source_fingerprint,source_refs,counts,requested_by)
      VALUES(${context.school_id}::uuid,${id}::uuid,${context.kind},${context.source_id},${register?.revision ?? 0},${hash},
        ${JSON.stringify(sourceRefs)}::jsonb,${JSON.stringify({ people: people.length, entries: entries.length, revisions: revisions.length,
            submissions: submissions.length, evidence: evidence.length, lifecycle: lifecycle.length })}::jsonb,${user.id}::uuid)`.execute(tx);
        return { register_id: id, state: "imported", source_kind: context.kind };
    }
    async source(user, schoolId, registerId) {
        return this.db.transaction().execute(async (tx) => {
            const source = (await sql `
      SELECT source_kind,source_id,state,context_snapshot FROM activity_attendance_source_contexts
      WHERE school_id=${schoolId}::uuid AND register_id=${registerId}::uuid`.execute(tx)).rows[0];
            if (!source)
                throw new NotFoundException("This register has no academic migration source.");
            await this.authorize(tx, user, source.context_snapshot.context, "view");
            return source;
        });
    }
};
AcademicParticipationBridge = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [DatabaseService, ActivityAttendanceService])
], AcademicParticipationBridge);
export { AcademicParticipationBridge };
//# sourceMappingURL=academic-participation-bridge.service.js.map