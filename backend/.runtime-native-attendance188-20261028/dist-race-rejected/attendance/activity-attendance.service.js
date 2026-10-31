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
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { sql } from "kysely";
import { z } from "zod";
import { DOMAIN_COMMAND_GATEWAY_PORT, PREPARED_DOMAIN_COMMAND_VERIFICATION_PORT } from "../campus-model-core/domain-command-gateway.port.js";
import { CONFIGURED_COMMAND_PORT } from "../campus-model-core/configured-command.port.js";
import { DOMAIN_EVENT_JOURNAL_PORT } from "../campus-model-core/domain-event-journal.port.js";
import { HUMAN_AGENT_IDENTITY_PORT } from "../campus-model-core/human-agent-identity.port.js";
import { OBSERVATION_INGRESS_PORT } from "../campus-model-core/observation-ingress.port.js";
import { executionNow } from "../campus-model-core/execution-time.runtime.js";
import { DatabaseService } from "../database/database.service.js";
import { recordParticipationSelfCheckIn } from "./participation-self-check-in.js";
import { ParticipationContextAuthorityRegistry } from "./participation-context-authority.js";
import { attendanceDayPolicy } from "./attendance-workspace.js";
import { attendanceHistoryScope, readAttendanceActivities } from "./activity-attendance-history.js";
import { automaticParticipationPolicyMatches, readParticipationFinalization } from "./participation-finalization.js";
import { authorizedEnrollmentRosterSource } from "./academic-enrollment-roster.source.js";
import { lockSchedule } from "../day-plans/schedule.js";
import { attendanceHistorySchema, participationCounts, participationEvidenceDecisionSchema, participationEvidenceSchema, participationMarksSchema, participationRosterFingerprint, participationTransitionSchema, } from "./activity-attendance.contracts.js";
const iso = (value) => value === null ? null : new Date(value).toISOString();
const fingerprint = (rows) => createHash("sha256").update(participationRosterFingerprint(rows)).digest("hex");
/**
 * Attendance owns participation decisions, not the person's affiliation or the
 * validity of a timetable. Every context uses this lifecycle and evidence path.
 */
let ActivityAttendanceService = class ActivityAttendanceService {
    db;
    commands;
    journal;
    observations;
    identities;
    configuredCommands;
    contextAuthorities;
    preparedCommands;
    academicEffects;
    constructor(db, commands, journal, observations, identities, configuredCommands, contextAuthorities, preparedCommands) {
        this.db = db;
        this.commands = commands;
        this.journal = journal;
        this.observations = observations;
        this.identities = identities;
        this.configuredCommands = configuredCommands;
        this.contextAuthorities = contextAuthorities;
        this.preparedCommands = preparedCommands;
    }
    registerAcademicEffects(handler) {
        if (this.academicEffects)
            throw new ConflictException("The academic participation effects adapter is already registered.");
        this.academicEffects = handler;
    }
    applyAcademicEffects(tx, input) {
        if (!this.academicEffects)
            throw new ConflictException("The academic participation effects adapter is unavailable.");
        return this.academicEffects(tx, input);
    }
    async member(db, user, schoolId) {
        if (user.active_school_id !== schoolId)
            throw new ForbiddenException("Choose this institution before opening its attendance.");
        const row = (await sql `SELECT bool_or(membership.role='admin') AS administrator
      FROM school_memberships membership JOIN users account ON account.id=membership.user_id AND account.is_active
      WHERE membership.school_id=${schoolId}::uuid AND membership.user_id=${user.id}::uuid AND membership.is_active
      HAVING count(*)>0`.execute(db)).rows[0];
        if (!row)
            throw new ForbiddenException("An active institution membership is required.");
        return row;
    }
    /** Internal read-composition boundary; it does not grant recording authority. */
    async readerContext(user, schoolId, transaction) {
        const read = async (tx) => {
            const member = await this.member(tx, user, schoolId);
            const identity = await this.identities.resolveAccountEndpoint(tx, { school_id: schoolId, user_id: user.id, at: executionNow().toISOString() });
            if (!identity.acting)
                throw new ForbiddenException("Your account is not linked to an active campus person.");
            return { person_id: identity.person_id, administrator: member.administrator };
        };
        return transaction ? read(transaction) : this.db.transaction().execute(read);
    }
    /** Source-owned unresolved obligations, not a notification or an authority grant.
     * No recent-day horizon: an older submitted register still needs its reviewer.
     * Match access()'s current appointment/permission gates; detail and mutation
     * recheck them again when the person follows the exact source link.
     */
    async pendingActivityReviews(user, schoolId) {
        return this.db.transaction().execute(async (tx) => {
            const actor = await this.readerContext(user, schoolId, tx);
            const reviews = (await sql `SELECT register.id AS register_id,
        occurrence.id AS occurrence_id,occurrence.plan_version_id,occurrence.title,
        occurrence.local_date::text,occurrence.timezone,occurrence.starts_at,
        register.submitted_at,register.revision,appointment.source_revision AS appointment_revision
        FROM activity_attendance_registers register
        JOIN schedule_activity_occurrences occurrence ON occurrence.id=register.occurrence_id
          AND occurrence.school_id=register.school_id
        JOIN schedule_versions version ON version.id=occurrence.plan_version_id
          AND version.school_id=occurrence.school_id
        JOIN schedule_activity_occurrence_recorders appointment ON appointment.occurrence_id=occurrence.id
          AND appointment.school_id=occurrence.school_id
        WHERE register.school_id=${schoolId}::uuid AND register.state='submitted'
          AND occurrence.source='activity' AND occurrence.state='expected'
          AND appointment.person_id=${actor.person_id}::uuid AND appointment.action='review'
          AND (version.state='published' OR (version.state='cancelled' AND occurrence.starts_at<version.cancelled_at))
          AND (${actor.administrator} OR staff_has_resource_permission(${schoolId}::uuid,${user.id}::uuid,
            'attendance.review','institution',${schoolId}::uuid,
            (${executionNow()}::timestamptz AT TIME ZONE occurrence.timezone)::date))
        ORDER BY register.submitted_at,register.id`.execute(tx)).rows;
            const finalization = await readParticipationFinalization(tx, this.identities, schoolId, reviews.map(item => item.register_id), executionNow().toISOString());
            return reviews.filter(item => finalization.get(item.register_id)?.state !== "automatic_pending")
                .map(item => ({ ...item, ...(finalization.get(item.register_id) ? { finalization: finalization.get(item.register_id) } : {}) }));
        });
    }
    /** Internal queue composition; callers have already selected authorized records. */
    async finalizationStates(schoolId, registerIds, transaction) {
        const read = (tx) => readParticipationFinalization(tx, this.identities, schoolId, registerIds, executionNow().toISOString());
        return transaction ? read(transaction) : this.db.transaction().execute(read);
    }
    async access(tx, user, register) {
        const membership = await this.member(tx, user, register.school_id);
        const legacy = (await sql `SELECT state FROM activity_attendance_source_contexts
      WHERE school_id=${register.school_id}::uuid AND register_id=${register.id}::uuid`.execute(tx)).rows[0];
        if (legacy && legacy.state !== "active")
            throw new ConflictException("This academic register is still being reconciled. Continue using its current attendance screen.");
        const identity = await this.identities.resolveAccountEndpoint(tx, {
            school_id: register.school_id, user_id: user.id, at: executionNow().toISOString(),
        });
        if (!identity.acting)
            throw new ForbiddenException("Your account is not linked to an active campus person.");
        if (register.source === "event" || register.source === "examination") {
            if (!this.contextAuthorities)
                throw new ConflictException("The owning participation authority adapter is unavailable.");
            const owning = await this.contextAuthorities.evaluate(register.source, tx, user, register);
            return { person_id: identity.person_id, can_view: owning.can_view, can_record: owning.can_record,
                can_review: owning.can_review, source_refs: owning.source_refs, owning };
        }
        const mandates = (await sql `
      SELECT appointment.action,appointment.source_ref,appointment.source_revision,appointment.appointed_by
      FROM schedule_activity_occurrence_recorders appointment
      JOIN schedule_activity_occurrences occurrence ON occurrence.id=appointment.occurrence_id AND occurrence.school_id=appointment.school_id
      LEFT JOIN schedule_versions version ON version.id=occurrence.plan_version_id AND version.school_id=occurrence.school_id
      WHERE appointment.school_id=${register.school_id}::uuid AND appointment.occurrence_id=${register.occurrence_id}::uuid
        AND appointment.person_id=${identity.person_id}::uuid AND occurrence.state='expected'
        AND (occurrence.source='academic' OR version.state='published'
          OR (version.state='cancelled' AND occurrence.starts_at<version.cancelled_at))
      FOR SHARE OF appointment`.execute(tx)).rows;
        const institution = (await sql `SELECT
      ${membership.administrator} OR staff_has_resource_permission(${register.school_id}::uuid,${user.id}::uuid,
        'attendance.record','institution',${register.school_id}::uuid,(${executionNow()}::timestamptz AT TIME ZONE ${register.timezone})::date) AS record,
      ${membership.administrator} OR staff_has_resource_permission(${register.school_id}::uuid,${user.id}::uuid,
        'attendance.review','institution',${register.school_id}::uuid,(${executionNow()}::timestamptz AT TIME ZONE ${register.timezone})::date) AS review`.execute(tx)).rows[0];
        let canRecord = institution.record && mandates.some((mandate) => mandate.action === "record");
        let canReview = institution.review && mandates.some((mandate) => mandate.action === "review");
        const sourceRefs = mandates.map((mandate) => ({
            kind: "published_occurrence_appointment", ...mandate, occurrence_id: register.occurrence_id,
        }));
        if (canRecord || canReview)
            sourceRefs.push({ kind: "current_institution_attendance_authority", school_id: register.school_id,
                administrator: membership.administrator, recording: institution.record, review: institution.review });
        let academicView = false;
        if (register.source === "academic" && register.context_ref) {
            const academic = (await sql `SELECT
        staff_has_resource_permission(${register.school_id}::uuid,${user.id}::uuid,'attendance.view','class',${register.context_ref}::uuid,${register.local_date}::date)
          OR staff_has_resource_permission(${register.school_id}::uuid,${user.id}::uuid,'attendance.view','institution',${register.school_id}::uuid,${register.local_date}::date) AS view,
        staff_has_resource_permission(${register.school_id}::uuid,${user.id}::uuid,'attendance.record','class',${register.context_ref}::uuid,${register.local_date}::date)
          OR staff_has_resource_permission(${register.school_id}::uuid,${user.id}::uuid,'attendance.record','institution',${register.school_id}::uuid,${register.local_date}::date)
          OR EXISTS(SELECT 1 FROM effective_school_schedule_v4(${register.school_id}::uuid,${register.local_date}::date) slot
            WHERE slot.class_section_id=${register.context_ref}::uuid AND slot.term_id=${register.term_id}::uuid
              AND slot.teacher_user_id=${user.id}::uuid AND NOT slot.cancelled AND slot.coverage_status='accepted') AS record,
        staff_has_resource_permission(${register.school_id}::uuid,${user.id}::uuid,'attendance.review','class',${register.context_ref}::uuid,${register.local_date}::date)
          OR staff_has_resource_permission(${register.school_id}::uuid,${user.id}::uuid,'attendance.review','institution',${register.school_id}::uuid,${register.local_date}::date) AS review`.execute(tx)).rows[0];
            // The compatibility adapter preserves the pre-existing academic admin
            // responsibility; it never grants that authority to operational contexts.
            const retainedAdministrator = legacy?.state === "active" && membership.administrator;
            academicView = Boolean(academic?.view) || retainedAdministrator;
            canRecord ||= Boolean(academic?.record) || retainedAdministrator;
            canReview ||= Boolean(academic?.review) || retainedAdministrator;
            if (academic?.record || academic?.review || retainedAdministrator)
                sourceRefs.push({ kind: "current_academic_scope", class_section_id: register.context_ref, date: register.local_date,
                    retained_academic_administrator: retainedAdministrator });
            if (register.source_ref.startsWith('daily:') && register.term_id) {
                const day = await attendanceDayPolicy(tx, register.school_id, register.context_ref, register.term_id, register.local_date, { userId: user.id, role: membership.administrator ? 'admin' : 'staff' });
                canRecord &&= Boolean(day?.completed && day.instructional && day.actor_scheduled);
            }
        }
        return { person_id: identity.person_id, can_view: membership.administrator || canRecord || canReview || academicView,
            can_record: canRecord, can_review: canReview, can_review_evidence: canReview || (register.source === "academic" && legacy?.state === "active" && canRecord), source_refs: sourceRefs };
    }
    async register(db, schoolId, id, lock = false) {
        const row = (await sql `SELECT register.*,occurrence.title,occurrence.purpose,occurrence.starts_at,occurrence.ends_at,
        occurrence.timezone,occurrence.local_date::text,occurrence.state AS occurrence_state,
        occurrence.revision AS occurrence_revision,occurrence.source,occurrence.source_ref,occurrence.source_revision,
        occurrence.context_ref,occurrence.term_id,occurrence.scheduled_teacher_id,occurrence.plan_version_id,space.name AS space_label,
        EXISTS(SELECT 1 FROM information_schema.columns column_definition WHERE column_definition.table_schema=current_schema()
          AND column_definition.table_name='activity_attendance_entries' AND column_definition.column_name='recorded_by_agent_id') AS software_actor_schema
      FROM activity_attendance_registers register
      JOIN schedule_activity_occurrences occurrence ON occurrence.id=register.occurrence_id AND occurrence.school_id=register.school_id
      LEFT JOIN campus_spaces space ON space.id=occurrence.space_id AND space.school_id=occurrence.school_id
      WHERE register.id=${id}::uuid AND register.school_id=${schoolId}::uuid
      ${lock ? sql `FOR UPDATE OF register` : sql ``}`.execute(db)).rows[0];
        if (!row)
            throw new NotFoundException("Attendance register not found.");
        return row;
    }
    async sourceRoster(db, schoolId, occurrenceId) {
        return (await sql `SELECT person_id,label,participation_role,requirement,source_kind,source_ref,source_revision
      FROM schedule_activity_occurrence_people WHERE school_id=${schoolId}::uuid AND occurrence_id=${occurrenceId}::uuid
      AND attendance_expected
      ORDER BY person_id`.execute(db)).rows;
    }
    async participationPolicy(db, schoolId) {
        const policy = (await sql `SELECT revision,attendance_finalization_mode,
        attendance_auto_finalize_minutes,updated_by,updated_at FROM institution_operating_rules WHERE school_id=${schoolId}::uuid`.execute(db)).rows[0];
        const configured = Boolean(policy && policy.revision > 0 && policy.updated_by);
        return { revision: configured ? policy.revision : 0,
            snapshot: { finalization_mode: configured ? policy.attendance_finalization_mode : "principal_review",
                auto_finalize_minutes: configured ? policy.attendance_auto_finalize_minutes : 0,
                configuration_state: configured ? "configured" : "manual_fallback",
                approved_by: configured ? policy.updated_by : null, approved_at: configured ? iso(policy.updated_at) : null } };
    }
    async ensureRegister(schoolId, occurrenceId, transaction) {
        const execute = async (tx) => {
            const occurrence = (await sql `SELECT id,revision,attendance_mode
        FROM schedule_activity_occurrences WHERE school_id=${schoolId}::uuid AND id=${occurrenceId}::uuid FOR SHARE`.execute(tx)).rows[0];
            if (!occurrence)
                throw new NotFoundException("The scheduled activity could not be found.");
            if (occurrence.attendance_mode === "none")
                throw new ConflictException("Attendance is not required for this activity.");
            const roster = await this.sourceRoster(tx, schoolId, occurrenceId);
            const policy = await this.participationPolicy(tx, schoolId);
            const inserted = (await sql `INSERT INTO activity_attendance_registers(school_id,occurrence_id,
          roster_fingerprint,roster_source_revision,policy_revision,policy_snapshot)
        VALUES(${schoolId}::uuid,${occurrenceId}::uuid,${fingerprint(roster)},${occurrence.revision},${policy.revision},${JSON.stringify(policy.snapshot)}::jsonb)
        ON CONFLICT(school_id,occurrence_id) DO NOTHING RETURNING id`.execute(tx)).rows[0];
            const id = inserted?.id ?? (await sql `SELECT id FROM activity_attendance_registers
        WHERE school_id=${schoolId}::uuid AND occurrence_id=${occurrenceId}::uuid`.execute(tx)).rows[0].id;
            if (inserted)
                for (const row of roster)
                    await sql `INSERT INTO activity_attendance_roster(
        school_id,register_id,person_id,label,participation_role,requirement,source_kind,source_ref,source_revision)
        VALUES(${schoolId}::uuid,${id}::uuid,${row.person_id}::uuid,${row.label},${row.participation_role},${row.requirement},
          ${row.source_kind},${row.source_ref},${row.source_revision})`.execute(tx);
            return id;
        };
        return transaction ? execute(transaction) : this.db.transaction().execute(execute);
    }
    openReason(register, access) {
        if (register.occurrence_state !== "expected")
            return "This activity was cancelled. Its attendance history is retained.";
        if (register.state === "locked")
            return "This register is final. An appointed reviewer must reopen it to make a correction.";
        if (executionNow().getTime() < new Date(access.owning?.record_not_before ?? register.starts_at).getTime())
            return "Attendance opens when this activity starts.";
        if (access.owning)
            return "Use the owning activity's attendance action so its safety and eligibility checks remain intact.";
        if (!access.can_record)
            return "You can view this register, but recording is assigned to another person.";
        return null;
    }
    allowedStatuses(register) {
        return register.source === "academic" && register.source_ref.startsWith("daily:")
            ? ["present", "absent", "late", "excused", "half_day"] : ["present", "absent", "late", "excused"];
    }
    async screen(tx, user, register, permission) {
        const access = permission ?? await this.access(tx, user, register);
        if (!access.can_view)
            throw new ForbiddenException("This attendance register is outside your current responsibilities.");
        const rows = (await sql `SELECT roster.person_id,roster.label AS name,
        roster.participation_role,roster.requirement,entry.status,COALESCE(entry.remarks,'') AS remarks,entry.observed_at,
        COALESCE(entry.revision,0) AS revision
      FROM activity_attendance_roster roster LEFT JOIN activity_attendance_entries entry
        ON entry.register_id=roster.register_id AND entry.person_id=roster.person_id AND entry.school_id=roster.school_id
      WHERE roster.register_id=${register.id}::uuid AND roster.school_id=${register.school_id}::uuid
      ORDER BY roster.label,roster.person_id`.execute(tx)).rows;
        const roster = rows.map((row) => ({ ...row, roles: [row.participation_role], observed_at: iso(row.observed_at) }));
        const counts = participationCounts(roster);
        const availabilityReason = this.openReason(register, access);
        const pendingEvidence = (await sql `
      SELECT evidence.id,evidence.person_id,roster.label AS name,evidence.claimed_status,evidence.capture_channel,
        evidence.observed_at,evidence.received_at,evidence.note,evidence.source_reference
      FROM activity_attendance_evidence evidence JOIN activity_attendance_roster roster
        ON roster.register_id=evidence.register_id AND roster.person_id=evidence.person_id
      WHERE evidence.register_id=${register.id}::uuid AND evidence.school_id=${register.school_id}::uuid AND evidence.state='pending'
      ORDER BY evidence.received_at,evidence.id`.execute(tx)).rows.map((row) => ({ ...row,
            observed_at: iso(row.observed_at), received_at: iso(row.received_at) }));
        const canRecord = availabilityReason === null;
        const finalization = (await this.finalizationStates(register.school_id, [register.id], tx)).get(register.id);
        return {
            register: { id: register.id, occurrence_id: register.occurrence_id, title: register.title, kind: register.purpose,
                starts_at: iso(register.starts_at), ends_at: iso(register.ends_at), time_zone: register.timezone,
                place_label: register.space_label ?? "", state: register.state, revision: register.revision,
                submitted_at: iso(register.submitted_at), finalized_at: iso(register.locked_at), auto_finalize_at: iso(register.auto_finalize_at),
                policy_revision: register.policy_revision, policy: register.policy_snapshot,
                ...(finalization ? { finalization } : {}),
                source_kind: register.source === "academic" ? register.source_ref.startsWith("daily:") ? "daily_class" : "scheduled_session" : register.source,
                ...(access.owning ? { source: access.owning.source } : {}) },
            roster, counts,
            capabilities: { can_record: canRecord, can_submit: canRecord && counts.participants > 0,
                can_finalize: access.can_review && register.state === "submitted" && register.occurrence_state === "expected" && pendingEvidence.length === 0,
                can_reopen: access.can_review && register.state === "locked", can_review: access.can_review, can_review_evidence: (access.can_review_evidence ?? access.can_review) && register.state !== "locked" },
            allowed_statuses: access.owning?.allowed_statuses ?? this.allowedStatuses(register),
            availability_reason: availabilityReason, pending_evidence: pendingEvidence,
        };
    }
    async detail(user, schoolValue, idValue, transaction) {
        const schoolId = z.string().uuid().parse(schoolValue), id = z.string().uuid().parse(idValue);
        if (transaction)
            return this.screen(transaction, user, await this.register(transaction, schoolId, id));
        return this.db.transaction().execute(async (tx) => this.screen(tx, user, await this.register(tx, schoolId, id)));
    }
    /** Owning-domain queue projection: no roster PII or generic mutation grant. */
    async owningSummary(user, schoolId, id) {
        return this.db.transaction().execute(async (tx) => {
            const register = await this.register(tx, schoolId, id);
            if (register.source !== 'event' && register.source !== 'examination')
                throw new BadRequestException("This register has no owning participation editor.");
            let access;
            try {
                access = await this.access(tx, user, register);
            }
            catch (error) {
                if (error instanceof ForbiddenException || error instanceof NotFoundException)
                    return null;
                throw error;
            }
            if (!access.can_view || !access.owning)
                return null;
            const counts = (await sql `SELECT count(*)::int AS participant_count,
        count(entry.status)::int AS recorded_count FROM activity_attendance_roster roster LEFT JOIN activity_attendance_entries entry
          ON entry.register_id=roster.register_id AND entry.person_id=roster.person_id
        WHERE roster.school_id=${schoolId}::uuid AND roster.register_id=${id}::uuid`.execute(tx)).rows[0];
            return { id, occurrence_id: register.occurrence_id, title: register.title, kind: register.purpose, starts_at: iso(register.starts_at),
                ends_at: iso(register.ends_at), time_zone: register.timezone, place_label: register.space_label ?? '', state: register.state,
                revision: register.revision, ...counts, can_record: false, can_review: access.can_review, occurrence_state: register.occurrence_state,
                availability_reason: this.openReason(register, access), source_kind: register.source, entry_mode: 'owning_domain', source: access.owning.source };
        });
    }
    target(register, revision = register.revision) {
        return { kind: "attendance_register", domain: "attendance", domain_id: register.id, label: register.title,
            lifecycle_state: "active", source_revision: Math.max(1, revision), metadata: {} };
    }
    async audience(tx, register, actorId) {
        const people = (await sql `SELECT DISTINCT person_id,action FROM schedule_activity_occurrence_recorders
      WHERE school_id=${register.school_id}::uuid AND occurrence_id=${register.occurrence_id}::uuid`.execute(tx)).rows;
        const users = new Set(actorId ? [actorId] : []);
        for (const person of people) {
            const identity = await this.identities.resolvePersonAgent(tx, { school_id: register.school_id,
                person_id: person.person_id, at: executionNow().toISOString() });
            if (identity.acting) {
                const allowed = (await sql `SELECT EXISTS(SELECT 1 FROM school_memberships membership
          WHERE membership.school_id=${register.school_id}::uuid AND membership.user_id=${identity.user_id}::uuid AND membership.is_active
            AND (membership.role='admin' OR staff_has_resource_permission(membership.school_id,membership.user_id,
              ${`attendance.${person.action}`},'institution',membership.school_id,
              (${executionNow()}::timestamptz AT TIME ZONE ${register.timezone})::date))) AS allowed`.execute(tx)).rows[0]?.allowed;
                if (allowed)
                    users.add(identity.user_id);
            }
        }
        return [...users].sort();
    }
    async assertRoster(tx, register) {
        const source = await this.sourceRoster(tx, register.school_id, register.occurrence_id);
        if (fingerprint(source) !== register.roster_fingerprint || register.occurrence_revision !== register.roster_source_revision) {
            throw new ConflictException({ code: "roster_changed", message: "The activity or expected people changed. Review the updated schedule before recording attendance." });
        }
    }
    async lockAcademicMutationSchedule(tx, schoolId, registerId) {
        const source = (await sql `SELECT occurrence.source FROM activity_attendance_registers register
      JOIN schedule_activity_occurrences occurrence ON occurrence.id=register.occurrence_id AND occurrence.school_id=register.school_id
      WHERE register.school_id=${schoolId}::uuid AND register.id=${registerId}::uuid`.execute(tx)).rows[0];
        if (source?.source === "academic")
            await lockSchedule(tx, schoolId);
    }
    async approvedLeaveSource(tx, user, register, input) {
        const source = z.object({ leave_id: z.string().uuid(), student_id: z.string().uuid(),
            expected_revision: z.number().int().nonnegative(), reason: z.literal("School-approved leave") }).strict().parse(input);
        if (register.source !== "academic" || !register.source_ref.startsWith("daily:") || !register.term_id || !register.context_ref) {
            throw new ForbiddenException("An approved student leave can excuse only its exact daily academic participation.");
        }
        const approved = (await sql `SELECT student.person_id,leave.decided_at
      FROM leave_requests leave JOIN students student ON student.id=leave.student_id
      JOIN enrollments enrollment ON enrollment.student_id=student.id AND enrollment.term_id=leave.term_id
        AND enrollment.class_section_id=${register.context_ref}::uuid AND enrollment.is_active
        AND enrollment.enrolled_on<=${register.local_date}::date
        AND (enrollment.inactive_from IS NULL OR enrollment.inactive_from>${register.local_date}::date)
      JOIN activity_attendance_roster roster ON roster.school_id=student.school_id
        AND roster.register_id=${register.id}::uuid AND roster.person_id=student.person_id
      JOIN activity_attendance_source_contexts link ON link.school_id=student.school_id AND link.register_id=roster.register_id
        AND link.source_kind='daily_class' AND link.state='active'
      WHERE leave.id=${source.leave_id}::uuid AND leave.student_id=${source.student_id}::uuid
        AND student.school_id=${register.school_id}::uuid AND leave.term_id=${register.term_id}::uuid
        AND leave.status='school_approved' AND leave.decided_by=${user.id}::uuid AND leave.decided_at<=${executionNow()}
        AND ${register.local_date}::date BETWEEN leave.starts_on AND leave.ends_on
        AND EXISTS(SELECT 1 FROM school_memberships membership WHERE membership.school_id=student.school_id
          AND membership.user_id=${user.id}::uuid AND membership.role='admin' AND membership.is_active)
        AND EXISTS(SELECT 1 FROM effective_school_schedule_v4(student.school_id,${register.local_date}::date) slot
          WHERE slot.class_section_id=enrollment.class_section_id AND slot.term_id=leave.term_id
            AND NOT slot.cancelled AND slot.slot_type IN ('class','activity'))
      FOR SHARE OF leave,student,enrollment`.execute(tx)).rows[0];
        if (!approved)
            throw new ForbiddenException("The current school-approved leave, deciding administrator and exact enrolled participant do not authorize this exemption.");
        return { kind: "school_approved_leave", school_id: register.school_id, leave_id: source.leave_id,
            student_id: source.student_id, person_id: approved.person_id, term_id: register.term_id, local_date: register.local_date,
            decided_by: user.id, decided_at: approved.decided_at.toISOString(), evidence_scope: "administrative_exemption_not_physical_attendance" };
    }
    /** Legacy context/FK rows are a one-way projection, never another writer. */
    async syncAcademicProjection(tx, schoolId, registerId) {
        const source = (await sql `SELECT source_kind,
      context_snapshot->'context'->>'legacy_register_id' AS legacy_id FROM activity_attendance_source_contexts
      WHERE school_id=${schoolId}::uuid AND register_id=${registerId}::uuid AND state='active'
        AND source_kind IN ('daily_class','scheduled_session')`.execute(tx)).rows[0];
        if (!source?.legacy_id)
            return;
        await sql `UPDATE ${sql.table(source.source_kind === "daily_class" ? "attendance_registers" : "attendance_session_registers")} projection
      SET state=register.state,revision=register.revision,submitted_by=register.submitted_by,submitted_at=register.submitted_at,
        locked_by=register.locked_by,locked_at=register.locked_at,reopened_by=register.reopened_by,reopened_at=register.reopened_at,
        reopen_reason=register.reopen_reason,auto_finalize_at=register.auto_finalize_at,finalization_policy_revision=register.policy_revision,
        finalization_source=register.finalization_source,updated_at=register.updated_at
      FROM activity_attendance_registers register WHERE register.id=${registerId}::uuid AND register.school_id=${schoolId}::uuid
        AND projection.id=${source.legacy_id}::uuid AND projection.school_id=register.school_id`.execute(tx);
    }
    async mutate(user, schoolValue, idValue, operation, input, request, execute, transaction, adapter) {
        const schoolId = z.string().uuid().parse(schoolValue), id = z.string().uuid().parse(idValue);
        const rawKey = request.headers["idempotency-key"], key = Array.isArray(rawKey) ? rawKey[0] : rawKey;
        if (!key || !/^[A-Za-z0-9._:-]{8,128}$/.test(key))
            throw new BadRequestException("A valid Idempotency-Key header is required.");
        const requestHash = createHash("sha256").update(JSON.stringify({ id, operation, input })).digest("hex");
        const executeCommand = async (tx) => {
            // Academic source adapters and People take this lock before any class,
            // projection or canonical row. Direct kernel entry must use that order too.
            await this.lockAcademicMutationSchedule(tx, schoolId, id);
            await sql `SELECT pg_advisory_xact_lock(hashtextextended(${`participation:${schoolId}:${user.id}:${key}`},0))`.execute(tx);
            const register = await this.register(tx, schoolId, id, true);
            if ((register.source === "event" || register.source === "examination") && adapter?.owning_adapter !== register.source) {
                throw new ForbiddenException("Use the owning domain attendance action for this context.");
            }
            const access = await this.access(tx, user, register);
            const approvedLeave = operation === "approved_leave" ? await this.approvedLeaveSource(tx, user, register, input) : null;
            if (approvedLeave)
                access.source_refs.push(approvedLeave);
            const rosterChange = operation === "roster_change" ? await this.authorizeEnrollmentRosterChangeInTransaction(tx, user, schoolId, input.enrollment_source) : null;
            if (rosterChange) {
                if (register.source !== "academic" || !/^(?:daily|session):/u.test(register.source_ref)
                    || !rosterChange.targets.some(target => target.class_id === register.context_ref && target.term_id === register.term_id
                        && target.effective_on <= register.local_date))
                    throw new ForbiddenException("The reviewed enrollment does not affect this exact academic register.");
                access.source_refs.push(rosterChange.decision_source);
            }
            if (register.source === 'academic' && !this.academicEffects)
                throw new ConflictException("The academic participation effects adapter is unavailable.");
            const review = operation === "finalize" || operation === "reopen" || operation === "evidence_review";
            const reviewAllowed = operation === "evidence_review" ? access.can_review_evidence ?? access.can_review : access.can_review;
            if (!approvedLeave && !rosterChange && (review ? !reviewAllowed : !access.can_record))
                throw new ForbiddenException(review
                    ? "Reviewing this register is not part of your current appointment."
                    : "Recording this register is not part of your current appointment.");
            const previous = (await sql `SELECT request_hash,result_body FROM activity_attendance_commands
        WHERE school_id=${schoolId}::uuid AND actor_id=${user.id}::uuid AND idempotency_key=${key}`.execute(tx)).rows[0];
            if (previous) {
                if (previous.request_hash !== requestHash)
                    throw new ConflictException("This Idempotency-Key was used for a different attendance action.");
                return previous.result_body;
            }
            if (register.revision !== input.expected_revision)
                throw new ConflictException({ code: "revision_conflict", message: "This register changed. Refresh before saving.", current_revision: register.revision });
            if (operation !== "reopen" && register.state === "locked")
                throw new ForbiddenException("This register is final. Ask its reviewer to reopen it.");
            if (operation !== "reopen" && register.occurrence_state !== "expected")
                throw new ConflictException("The activity was cancelled; its existing evidence is retained.");
            if (!["reopen", "evidence_review"].includes(operation) && !approvedLeave && !rosterChange && executionNow().getTime() < new Date(access.owning?.record_not_before ?? register.starts_at).getTime())
                throw new BadRequestException("Attendance opens when this activity starts.");
            await this.assertRoster(tx, register);
            const now = executionNow(), revision = register.revision + 1;
            const prepared = await this.commands.prepareDomainCommand(tx, {
                school_id: schoolId, actor_user_id: user.id, command_type: `attendance.participation.${operation}`,
                handler_key: `attendance.participation_${operation}`, handler_version: 1, source_domain: "attendance",
                target: this.target(register), current_revision: register.revision, expected_revision: input.expected_revision,
                capability: rosterChange ? "attendance:reconcile_enrollment_roster" : approvedLeave ? "attendance:excuse_approved_leave" : review ? "attendance:review" : "attendance:record", purpose: `participation_${operation}`,
                requested_at: now.toISOString(), correlation_id: request.requestId, causation_id: null,
                idempotency_key: `participation:${user.id}:${key}`, operating_rule_version_ref: `attendance-policy:${register.policy_revision}`,
                configuration_refs: [{ kind: "operating_rule", ref: "participation_attendance", version: String(register.policy_revision) }],
                authority_attestation: { evaluator_domain: "attendance", decision: "allowed", reason_codes: [rosterChange ? "current_reviewed_enrollment_decision" : approvedLeave ? "current_school_approved_leave_decision" : review ? "current_review_mandate" : "current_recording_mandate"],
                    authority_source_refs: access.source_refs, operating_rule_refs: [{ revision: register.policy_revision }], valid_until: null },
                safe_context: { occurrence_id: register.occurrence_id, operation, correction: Boolean(input.reason),
                    ...(rosterChange ? { decision_source: rosterChange.decision_source } : approvedLeave ? { decision_source: approvedLeave } : {}) },
            });
            if (prepared.status !== "ready")
                throw new ConflictException("This command already completed. Refresh its retained result.");
            const changes = await execute(tx, register, access, revision);
            await sql `UPDATE activity_attendance_registers SET revision=${revision},updated_at=${now} WHERE id=${id}::uuid`.execute(tx);
            await this.syncAcademicProjection(tx, schoolId, id);
            await sql `INSERT INTO activity_attendance_audits(school_id,register_id,action,actor_id,reason,register_revision,request_id,source_refs)
        VALUES(${schoolId}::uuid,${id}::uuid,${operation},${user.id}::uuid,${input.reason ?? null},${revision},${request.requestId}::uuid,${JSON.stringify(access.source_refs)}::jsonb)`.execute(tx);
            const outboxId = randomUUID();
            const audience = await this.audience(tx, register, user.id);
            await sql `INSERT INTO event_outbox(id,school_id,event_type,aggregate_type,aggregate_id,audience_user_ids,payload,idempotency_key)
        VALUES(${outboxId}::uuid,${schoolId}::uuid,'attendance.participation.updated','attendance_register',${id}::uuid,
          ${audience}::uuid[],${JSON.stringify({ operation, register_id: id, occurrence_id: register.occurrence_id, revision,
                refresh: ["attendance", "activities", "workspace", "today"] })}::jsonb,${`participation:${outboxId}`})`.execute(tx);
            const event = await this.journal.recordAcceptedEvent(tx, {
                school_id: schoolId, source_outbox_event_id: outboxId, event_type: "attendance.participation.updated",
                subject: this.target(register, revision), context: null, actor_user_id: user.id, audience_user_ids: audience,
                occurred_at: now.toISOString(), effective_from: now.toISOString(), effective_until: null,
                source_domain: "attendance", source_record_id: id, source_revision: revision,
                correlation_id: request.requestId, causation_event_id: null, idempotency_key: `participation-event:${outboxId}`,
                payload: { operation, occurrence_id: register.occurrence_id, changed_count: changes.length, register_revision: revision,
                    ...(rosterChange ? { decision_source: rosterChange.decision_source } : approvedLeave ? { decision_source: approvedLeave } : {}) },
            });
            for (const change of changes)
                if (change.status !== null && change.observed_at !== null && !approvedLeave)
                    await this.recordObservation(tx, register, user.id, change.person_id, change.status, change.revision_id, change.observed_at, change.capture_channel, "accepted", outboxId, now, change.evidence_refs ?? []);
            if (register.source === 'academic')
                await this.applyAcademicEffects(tx, { register_id: id, school_id: schoolId,
                    register_revision: revision, operation, actor_user_id: user.id, request_id: request.requestId });
            await this.commands.completeDomainCommand(tx, {
                school_id: schoolId, command_id: prepared.command_id, terminal_state: "accepted", code: `participation_${operation}_accepted`,
                explanation: "The authorized attendance action was recorded with its source and correction history.",
                resulting_revision: revision, domain_event_id: outboxId, metadata: { register_id: id, changed_count: changes.length, model_event_id: event.event_id },
                completed_at: now.toISOString(),
            });
            const result = await this.screen(tx, user, await this.register(tx, schoolId, id));
            await sql `INSERT INTO activity_attendance_commands(school_id,register_id,actor_id,operation,idempotency_key,request_hash,
        request_id,register_revision,result_body) VALUES(${schoolId}::uuid,${id}::uuid,${user.id}::uuid,${operation},${key},${requestHash},
          ${request.requestId}::uuid,${revision},${JSON.stringify(result)}::jsonb)`.execute(tx);
            return result;
        };
        return transaction ? executeCommand(transaction) : this.db.transaction().execute(executeCommand);
    }
    async recordObservation(tx, register, actorId, personId, status, sourceId, observedAt, channel, state, eventId, now, evidenceRefs = [], software) {
        const person = (await sql `SELECT first_name,last_name,revision
      FROM school_people WHERE id=${personId}::uuid AND school_id=${register.school_id}::uuid`.execute(tx)).rows[0];
        if (!person)
            throw new ConflictException("The participation evidence could not resolve its campus person.");
        return this.observations.recordObservations(tx, [{
                school_id: register.school_id, ...(software ? { captured_by: { kind: "configured_software", ...software, source_domain: "attendance" } } : { actor_user_id: actorId }), kind: "attendance.participation_observed",
                subject: { kind: "person", domain: "people", domain_id: personId, label: `${person.first_name} ${person.last_name}`.trim(),
                    lifecycle_state: "active", source_revision: person.revision, metadata: {} },
                context: this.target(register, register.revision + 1), source_type: "attendance.participation", source_ref: sourceId,
                source_record_id: sourceId, observed_at: observedAt.toISOString(), received_at: now.toISOString(),
                evidence_refs: [`activity_attendance:${sourceId}`, ...evidenceRefs], state, domain_event_id: eventId, schema_version: 1,
                idempotency_key: `participation-observation:${state}:${sourceId}`,
                payload: { ...(state === "accepted" ? { attendance_status: status } : { claimed_attendance_status: status }),
                    occurrence_id: register.occurrence_id, register_id: register.id, capture_channel: channel,
                    evidence_scope: "attendance_participation_only", decision_provenance: software ? "approved_configured_software_decision" : state === "accepted" ? "authorized_domain_decision" : "human_report_pending_review" },
                contract_refs: {
                    subject_type: { namespace: "thatcampus.people", type_key: "person", version: 1 },
                    context_type: { namespace: "thatcampus.attendance", type_key: "attendance_register", version: 1 },
                    observation_schema: { namespace: "thatcampus.attendance", schema_key: "attendance.participation_observed", version: 1 },
                    capability_manifest: { namespace: "thatcampus.attendance", capability_key: "participation_attendance", version: 1 },
                },
            }]);
    }
    async saveEntry(tx, register, user, record, revision, requestId, reason, channel = "human_roll_call", observedAt = executionNow(), force = false) {
        const before = (await sql `SELECT id,status,remarks FROM activity_attendance_entries
      WHERE register_id=${register.id}::uuid AND person_id=${record.person_id}::uuid FOR UPDATE`.execute(tx)).rows[0];
        if (!force && before?.status === record.status && before.remarks === record.remarks)
            return null;
        if (before?.status && !reason)
            throw new BadRequestException("Add a reason when correcting recorded participation.");
        if (record.status === null && register.state !== "draft" && register.source !== "event")
            throw new BadRequestException("A submitted decision cannot be erased. Record an explained correction instead.");
        if (before?.status) {
            const priorRevision = (await sql `SELECT id::text,legacy_source_ref FROM activity_attendance_entry_revisions
        WHERE register_id=${register.id}::uuid AND person_id=${record.person_id}::uuid
        ORDER BY register_revision DESC,created_at DESC,id DESC LIMIT 1`.execute(tx)).rows[0];
            if (priorRevision)
                await this.observations.transitionObservations(tx, {
                    school_id: register.school_id, source_type: "attendance.participation", source_ref: priorRevision.id, state: "superseded",
                });
            if (priorRevision?.legacy_source_ref) {
                const [sourceTable, originalId] = priorRevision.legacy_source_ref.split(':');
                if (sourceTable === 'attendance_record_revisions' && originalId) {
                    const retained = (await sql `SELECT attendance_submission_id::text AS source_ref
            FROM attendance_record_revisions_legacy_source WHERE school_id=${register.school_id}::uuid AND id=${originalId}::bigint`.execute(tx)).rows[0];
                    if (retained?.source_ref)
                        await this.observations.transitionObservations(tx, { school_id: register.school_id,
                            source_type: 'attendance.daily', source_ref: retained.source_ref, source_record_id: originalId, state: 'superseded' });
                }
                else if (sourceTable === 'attendance_session_entry_revisions' && originalId) {
                    const retained = (await sql `SELECT history.submission_id::text AS source_ref,
              (SELECT audit.metadata->>'evidence_id' FROM attendance_session_audits audit WHERE audit.school_id=history.school_id
                AND audit.session_id=history.session_id AND audit.metadata->>'request_id'=history.request_id::text
                AND audit.action IN ('qr.accepted','qr.review_accepted') ORDER BY audit.created_at DESC,audit.id DESC LIMIT 1) AS evidence_ref
            FROM attendance_session_entry_revisions_legacy_source history WHERE history.school_id=${register.school_id}::uuid
              AND history.id=${originalId}::bigint`.execute(tx)).rows[0];
                    if (retained?.source_ref || retained?.evidence_ref)
                        await this.observations.transitionObservations(tx, { school_id: register.school_id,
                            source_type: retained.source_ref ? 'attendance.session' : 'attendance.self_check_in',
                            source_ref: (retained.source_ref ?? retained.evidence_ref), source_record_id: originalId, state: 'superseded' });
                }
            }
        }
        const entry = (await sql `INSERT INTO activity_attendance_entries(school_id,register_id,person_id,status,remarks,
        capture_channel,observed_at,recorded_by,revision,updated_at)
      VALUES(${register.school_id}::uuid,${register.id}::uuid,${record.person_id}::uuid,${record.status},${record.remarks},
        ${channel},${observedAt},${user.id}::uuid,${revision},${executionNow()})
      ON CONFLICT(register_id,person_id) DO UPDATE SET status=excluded.status,remarks=excluded.remarks,capture_channel=excluded.capture_channel,
        observed_at=excluded.observed_at,recorded_by=excluded.recorded_by,revision=excluded.revision,updated_at=excluded.updated_at
        ${register.software_actor_schema ? sql `,recorded_by_agent_id=NULL` : sql ``} RETURNING id`.execute(tx)).rows[0];
        const history = (await sql `INSERT INTO activity_attendance_entry_revisions(school_id,register_id,entry_id,person_id,
      previous_status,new_status,previous_remarks,new_remarks,capture_channel,observed_at,reason,changed_by,request_id,register_revision)
      VALUES(${register.school_id}::uuid,${register.id}::uuid,${entry.id}::uuid,${record.person_id}::uuid,${before?.status ?? null},
        ${record.status},${before?.remarks ?? null},${record.remarks},${channel},${observedAt},${reason ?? "Initial participation decision"},
        ${user.id}::uuid,${requestId}::uuid,${revision}) RETURNING id::text`.execute(tx)).rows[0];
        return { person_id: record.person_id, status: record.status, revision_id: history.id, observed_at: observedAt, capture_channel: channel };
    }
    async applyMarks(tx, register, user, input, revision, requestId, capture = {}, owning, force = false) {
        if (input.records.some((record) => record.status !== null && !(owning?.allowed_statuses ?? this.allowedStatuses(register)).includes(record.status))) {
            throw new BadRequestException("This participation decision is not supported for the selected activity context.");
        }
        const roster = (await sql `SELECT person_id FROM activity_attendance_roster
    WHERE register_id=${register.id}::uuid AND school_id=${register.school_id}::uuid`.execute(tx)).rows;
        const allowed = new Set(roster.map((row) => row.person_id));
        if (input.records.some((record) => !allowed.has(record.person_id)))
            throw new BadRequestException("Every decision must belong to this register's reviewed participants.");
        const changes = [];
        for (const record of input.records) {
            const source = capture[record.person_id];
            if (source && (!Number.isFinite(source.observed_at.getTime()) || source.observed_at > executionNow()
                || source.observed_at < new Date(owning?.capture_window?.from ?? register.starts_at) || source.observed_at >= new Date(owning?.capture_window?.until ?? register.ends_at)
                || source.evidence_refs.length > 19 || source.evidence_refs.some((ref) => ref.length < 1 || ref.length > 240))) {
                throw new BadRequestException("The capture source does not provide valid time or evidence for this participation context.");
            }
            if (source?.capture_channel === "camera_assisted" && record.status !== "present")
                throw new BadRequestException("Camera assistance cannot establish absence or another participation decision.");
            const change = await this.saveEntry(tx, register, user, record, revision, requestId, input.reason, source?.capture_channel, source?.observed_at, force);
            if (change)
                changes.push({ ...change, evidence_refs: source?.evidence_refs ?? [] });
        }
        return changes;
    }
    async marks(user, schoolId, id, body, request) {
        const input = participationMarksSchema.parse(body);
        input.records.sort((left, right) => left.person_id.localeCompare(right.person_id));
        return this.mutate(user, schoolId, id, "marks", input, request, (tx, register, _access, revision) => this.applyMarks(tx, register, user, input, revision, request.requestId));
    }
    /** Owning academic adapter only. Every source/actor/target check is repeated
     * inside the kernel; future exemption is not a physical-recording trust flag. */
    async applyApprovedLeaveInTransaction(tx, user, schoolId, registerId, source, request) {
        const input = { ...source, reason: "School-approved leave" };
        return this.mutate(user, schoolId, registerId, "approved_leave", input, request, async (transaction, register, _access, revision) => {
            const approved = await this.approvedLeaveSource(transaction, user, register, input);
            const current = (await sql `SELECT status FROM activity_attendance_entries
        WHERE register_id=${register.id}::uuid AND person_id=${approved.person_id}::uuid FOR UPDATE`.execute(transaction)).rows[0];
            if (current?.status && current.status !== "absent")
                return [];
            const change = await this.saveEntry(transaction, register, user, { person_id: approved.person_id, status: "excused",
                remarks: `Approved leave ${source.leave_id}` }, revision, request.requestId, input.reason, "approved_leave", null);
            return change ? [change] : [];
        }, tx);
    }
    authorizeEnrollmentRosterChangeInTransaction(tx, user, schoolId, source, phase = "accepted") {
        if (!this.preparedCommands)
            throw new ConflictException("The prepared enrollment command verifier is unavailable.");
        return authorizedEnrollmentRosterSource(tx, this.identities, this.preparedCommands, user, schoolId, source, phase);
    }
    /** Enrollment changes expectations, never attendance observations. Retained
     * participants/decisions remain optional history; new people have no mark. */
    reconcileAcademicEnrollmentInTransaction(tx, user, schoolId, registerId, source, expectedRevision, request) {
        return this.mutate(user, schoolId, registerId, "roster_change", { expected_revision: expectedRevision,
            reason: "Reviewed enrollment changed the expected class roster", enrollment_source: source }, request, async (transaction, register, access) => {
            const previous = await this.sourceRoster(transaction, schoolId, register.occurrence_id);
            const people = (await sql `
        SELECT student.person_id,student.id AS student_id,concat_ws(' ',person.first_name,NULLIF(person.last_name,'')) AS label,
          enrollment.id AS enrollment_id,enrollment.revision AS source_revision
        FROM enrollments enrollment JOIN students student ON student.id=enrollment.student_id AND student.school_id=${schoolId}::uuid
        JOIN school_people person ON person.id=student.person_id AND person.school_id=student.school_id
        WHERE enrollment.class_section_id=${register.context_ref}::uuid AND enrollment.term_id=${register.term_id}::uuid
          AND enrollment.is_active AND enrollment.enrolled_on<=${register.local_date}::date
          AND (enrollment.inactive_from IS NULL OR enrollment.inactive_from>${register.local_date}::date)
        ORDER BY student.person_id FOR SHARE OF enrollment,student,person`.execute(transaction)).rows;
            const expected = people.map(person => person.person_id);
            await sql `UPDATE schedule_activity_occurrence_people SET requirement='optional'
        WHERE school_id=${schoolId}::uuid AND occurrence_id=${register.occurrence_id}::uuid
          AND NOT(person_id=ANY(${expected}::uuid[]))`.execute(transaction);
            await sql `UPDATE activity_attendance_roster SET requirement='optional'
        WHERE school_id=${schoolId}::uuid AND register_id=${register.id}::uuid
          AND NOT(person_id=ANY(${expected}::uuid[]))`.execute(transaction);
            for (const person of people) {
                await sql `INSERT INTO schedule_activity_occurrence_people(occurrence_id,school_id,person_id,label,participation_role,
            source_kind,source_ref,source_revision,requirement,attendance_expected)
          VALUES(${register.occurrence_id}::uuid,${schoolId}::uuid,${person.person_id}::uuid,${person.label},'participant','class',
            ${person.enrollment_id},${person.source_revision},'required',true)
          ON CONFLICT(occurrence_id,person_id) DO UPDATE SET source_ref=excluded.source_ref,source_revision=excluded.source_revision,
            requirement='required',attendance_expected=true`.execute(transaction);
                await sql `INSERT INTO activity_attendance_roster(school_id,register_id,person_id,label,participation_role,requirement,source_kind,source_ref,source_revision,
          academic_student_id,academic_enrollment_id,academic_source_revision)
          VALUES(${schoolId}::uuid,${register.id}::uuid,${person.person_id}::uuid,${person.label},'participant','required','class',${person.enrollment_id},${person.source_revision},
            ${person.student_id}::uuid,${person.enrollment_id}::uuid,${person.source_revision})
          ON CONFLICT(register_id,person_id) DO UPDATE SET source_ref=excluded.source_ref,source_revision=excluded.source_revision,requirement='required',
            academic_student_id=excluded.academic_student_id,academic_enrollment_id=excluded.academic_enrollment_id,
            academic_source_revision=excluded.academic_source_revision`.execute(transaction);
            }
            const next = await this.sourceRoster(transaction, schoolId, register.occurrence_id);
            const occurrence = (await sql `UPDATE schedule_activity_occurrences SET revision=revision+1,source_revision=source_revision+1
        WHERE id=${register.occurrence_id}::uuid AND school_id=${schoolId}::uuid RETURNING revision`.execute(transaction)).rows[0];
            await sql `UPDATE activity_attendance_registers SET state='draft',submitted_by=NULL,submitted_at=NULL,auto_finalize_at=NULL,
          finalization_source=NULL,roster_fingerprint=${fingerprint(next)},roster_source_revision=${occurrence.revision}
        WHERE id=${register.id}::uuid AND school_id=${schoolId}::uuid`.execute(transaction);
            const snapshot = (rows) => rows.map(row => ({ person_id: row.person_id, requirement: row.requirement,
                participation_role: row.participation_role, source_kind: row.source_kind, source_ref: row.source_ref, source_revision: row.source_revision }));
            access.source_refs.push({ kind: "academic_roster_revision", previous_fingerprint: register.roster_fingerprint, next_fingerprint: fingerprint(next),
                previous_roster_revision: register.roster_source_revision, next_roster_revision: occurrence.revision,
                previous_roster: snapshot(previous), next_roster: snapshot(next) });
            return [];
        }, tx);
    }
    async applyTransition(tx, register, user, operation, input) {
        const now = executionNow();
        if (operation === "submit") {
            const counts = (await sql `SELECT count(*)::int AS participants,
      count(*) FILTER(WHERE entry.status IS NULL AND roster.requirement='required')::int AS unrecorded
      FROM activity_attendance_roster roster LEFT JOIN activity_attendance_entries entry ON entry.register_id=roster.register_id AND entry.person_id=roster.person_id
      WHERE roster.register_id=${register.id}::uuid`.execute(tx)).rows[0];
            if (!counts.participants || counts.unrecorded)
                throw new BadRequestException("Review and record every required participant before submitting.");
            const policy = register.source === "event" || register.source === "examination"
                ? { revision: 0, snapshot: { finalization_mode: "principal_review", auto_finalize_minutes: 0,
                        configuration_state: "manual_fallback", approved_by: null, approved_at: null } }
                : await this.participationPolicy(tx, register.school_id);
            const autoAt = policy.snapshot.configuration_state === "configured" && policy.snapshot.finalization_mode === "automatic"
                ? new Date(now.getTime() + policy.snapshot.auto_finalize_minutes * 60_000) : null;
            await sql `UPDATE activity_attendance_registers SET state='submitted',submitted_by=${user.id}::uuid,submitted_at=${now},
      auto_finalize_at=${autoAt},policy_revision=${policy.revision},policy_snapshot=${JSON.stringify(policy.snapshot)}::jsonb
      WHERE id=${register.id}::uuid`.execute(tx);
        }
        else if (operation === "finalize") {
            if (register.state !== "submitted")
                throw new ConflictException("Submit the register before finalizing it.");
            const pending = (await sql `SELECT count(*)::int AS count FROM activity_attendance_evidence
      WHERE register_id=${register.id}::uuid AND school_id=${register.school_id}::uuid AND state='pending'`.execute(tx)).rows[0].count;
            if (pending)
                throw new ConflictException("Review the pending participation evidence before finalizing this register.");
            await sql `UPDATE activity_attendance_registers SET state='locked',locked_by=${user.id}::uuid,locked_at=${now},
      auto_finalize_at=NULL,finalization_source='manual' WHERE id=${register.id}::uuid`.execute(tx);
        }
        else {
            if (register.state !== "locked")
                throw new ConflictException("Only a final register can be reopened.");
            if (!input.reason)
                throw new BadRequestException("Add a reason for reopening the final register.");
            await sql `UPDATE activity_attendance_registers SET state='submitted',locked_by=NULL,locked_at=NULL,
      finalization_source=NULL,auto_finalize_at=NULL,reopened_by=${user.id}::uuid,reopened_at=${now},reopen_reason=${input.reason}
      WHERE id=${register.id}::uuid`.execute(tx);
        }
    }
    /** A complete reviewed roster and submission commit together, in one command. */
    async submitRecords(user, schoolId, id, body, request) {
        return this.submitRecordsWithSource(user, schoolId, id, body, request);
    }
    async submitRecordsWithSource(user, schoolId, id, body, request, transaction, capture = {}, adapter) {
        const input = participationMarksSchema.parse(body);
        input.records.sort((left, right) => left.person_id.localeCompare(right.person_id));
        return this.mutate(user, schoolId, id, "submit", { ...input, source_adapter: capture, ...(adapter ? { owning_adapter: adapter } : {}) }, request, async (tx, register, access, revision) => {
            const changes = await this.applyMarks(tx, register, user, input, revision, request.requestId, capture, access.owning, adapter?.force_revisions);
            await this.applyTransition(tx, register, user, "submit", input);
            return changes;
        }, transaction, adapter);
    }
    /** Reviewed adapters keep artifact/capture acceptance in the same transaction. */
    async submitRecordsInTransaction(transaction, user, schoolId, id, body, request, capture = {}, adapter) {
        return this.submitRecordsWithSource(user, schoolId, id, body, request, transaction, capture, adapter);
    }
    async marksInTransaction(transaction, user, schoolId, id, body, request, capture = {}, adapter) {
        const input = participationMarksSchema.parse(body);
        input.records.sort((left, right) => left.person_id.localeCompare(right.person_id));
        return this.mutate(user, schoolId, id, "marks", { ...input, source_adapter: capture, ...(adapter ? { owning_adapter: adapter } : {}) }, request, (tx, register, access, revision) => this.applyMarks(tx, register, user, input, revision, request.requestId, capture, access.owning, adapter?.force_revisions), transaction, adapter);
    }
    async transition(user, schoolId, id, operation, body, request, transaction, adapter) {
        const input = participationTransitionSchema.parse(body);
        return this.mutate(user, schoolId, id, operation, { ...input, ...(adapter ? { owning_adapter: adapter } : {}) }, request, async (tx, register) => {
            await this.applyTransition(tx, register, user, operation, input);
            return [];
        }, transaction, adapter);
    }
    async evidence(user, schoolId, id, body, request, transaction) {
        const input = participationEvidenceSchema.parse(body);
        return this.mutate(user, schoolId, id, "evidence", input, request, async (tx, register, access) => {
            if (!this.allowedStatuses(register).includes(input.claimed_status))
                throw new BadRequestException("This claimed decision is not supported for the selected activity context.");
            if (input.capture_channel === "self_check_in" && input.person_id !== access.person_id)
                throw new ForbiddenException("A self check-in can only report your own participation.");
            const observedAt = new Date(input.observed_at), now = executionNow();
            if (observedAt.getTime() > now.getTime())
                throw new BadRequestException("An observation cannot come from the future.");
            if (observedAt < new Date(register.starts_at) || observedAt >= new Date(register.ends_at))
                throw new BadRequestException("The reported observation is outside this activity's interval.");
            const evidence = (await sql `INSERT INTO activity_attendance_evidence(school_id,register_id,person_id,claimed_status,
        capture_channel,observed_at,received_at,submitted_by,source_reference,note)
        VALUES(${register.school_id}::uuid,${register.id}::uuid,${input.person_id}::uuid,${input.claimed_status},${input.capture_channel},
          ${observedAt},${now},${user.id}::uuid,${input.source_reference},${input.note}) RETURNING id`.execute(tx)).rows[0];
            const observations = await this.recordObservation(tx, register, user.id, input.person_id, input.claimed_status, evidence.id, observedAt, input.capture_channel, "pending", null, now);
            await sql `UPDATE activity_attendance_evidence SET observation_id=${observations[0] ?? null}::uuid WHERE id=${evidence.id}::uuid`.execute(tx);
            return [];
        }, transaction);
    }
    async decideEvidence(user, schoolId, id, evidenceValue, body, request, transaction) {
        const evidenceId = z.string().uuid().parse(evidenceValue), input = participationEvidenceDecisionSchema.parse(body);
        return this.mutate(user, schoolId, id, "evidence_review", { ...input, evidence_id: evidenceId }, request, async (tx, register, _access, revision) => {
            const evidence = (await sql `
        SELECT id,person_id,claimed_status,capture_channel,observed_at,state,observation_id,legacy_source_ref FROM activity_attendance_evidence
        WHERE id=${evidenceId}::uuid AND register_id=${register.id}::uuid AND school_id=${register.school_id}::uuid FOR UPDATE`.execute(tx)).rows[0];
            if (!evidence)
                throw new NotFoundException("The participation evidence could not be found.");
            if (evidence.state !== "pending")
                throw new ConflictException("This evidence was already reviewed.");
            const changes = [];
            if (input.decision === "accepted") {
                const current = (await sql `SELECT remarks FROM activity_attendance_entries
          WHERE register_id=${register.id}::uuid AND person_id=${evidence.person_id}::uuid`.execute(tx)).rows[0];
                const changed = await this.saveEntry(tx, register, user, { person_id: evidence.person_id, status: evidence.claimed_status,
                    remarks: current?.remarks ?? "" }, revision, request.requestId, input.reason, evidence.capture_channel, new Date(evidence.observed_at));
                if (changed)
                    changes.push(changed);
            }
            await sql `UPDATE activity_attendance_evidence SET state=${input.decision},decided_by=${user.id}::uuid,
        decided_at=${executionNow()},decision_note=${input.reason} WHERE id=${evidenceId}::uuid`.execute(tx);
            if (evidence.observation_id)
                await this.observations.transitionObservations(tx, {
                    school_id: register.school_id, source_type: "attendance.participation", source_ref: evidence.id, state: input.decision,
                });
            if (evidence.legacy_source_ref?.startsWith('attendance_session_evidence:'))
                await this.observations.transitionObservations(tx, {
                    school_id: register.school_id, source_type: 'attendance.self_check_in', source_ref: evidence.id, state: input.decision,
                });
            return changes;
        }, transaction);
    }
    async history(user, schoolValue, idValue, query) {
        const schoolId = z.string().uuid().parse(schoolValue), id = z.string().uuid().parse(idValue), input = attendanceHistorySchema.parse(query);
        return this.db.transaction().execute(async (tx) => {
            const register = await this.register(tx, schoolId, id), access = await this.access(tx, user, register);
            if (!access.can_view)
                throw new ForbiddenException("This register is outside your current responsibilities.");
            if (input.view || input.batch)
                return readAttendanceActivities(tx, this.configuredCommands, attendanceHistoryScope(user.id, schoolId, id), input, register.software_actor_schema);
            // A missing display name is not evidence of automation. Historical human
            // attribution remains human; software needs an explicit retained actor.
            const humanName = sql `COALESCE(NULLIF(trim(concat_ws(' ',actor.first_name,actor.last_name)),''),NULLIF(trim(actor.username),''),'Recorded account')`;
            const result = (await sql `
        SELECT history.*,count(*) OVER()::int AS total FROM (
          SELECT 'decision:'||revision.id::text AS id,'decision'::text AS action,revision.person_id,roster.label AS name,
            revision.previous_status,revision.new_status AS status,revision.new_remarks AS remarks,revision.reason,
            ${humanName} AS actor_name,revision.changed_by AS human_actor_id,
            ${register.software_actor_schema ? sql `ARRAY[revision.changed_by_agent_id::text]` : sql `ARRAY[]::text[]`} AS software_agent_ids,
            revision.created_at AS recorded_at,revision.register_revision
          FROM activity_attendance_entry_revisions revision JOIN activity_attendance_roster roster
            ON roster.register_id=revision.register_id AND roster.person_id=revision.person_id
          LEFT JOIN users actor ON actor.id=revision.changed_by
          WHERE revision.register_id=${id}::uuid AND revision.school_id=${schoolId}::uuid
          UNION ALL SELECT 'action:'||audit.id::text,audit.action,NULL,NULL,NULL,NULL,NULL,audit.reason,
            ${humanName},audit.actor_id,
            ARRAY(SELECT reference->>'actor_agent_id' FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof(audit.source_refs)='array' THEN audit.source_refs ELSE '[]'::jsonb END) reference),
            audit.created_at,audit.register_revision
          FROM activity_attendance_audits audit LEFT JOIN users actor ON actor.id=audit.actor_id
          WHERE audit.register_id=${id}::uuid AND audit.school_id=${schoolId}::uuid
        ) history ORDER BY recorded_at DESC,id DESC LIMIT ${input.page_size} OFFSET ${(input.page - 1) * input.page_size}`.execute(tx)).rows;
            const total = result[0]?.total ?? 0;
            const candidates = [...new Set(result.filter(row => row.human_actor_id === null).flatMap(row => row.software_agent_ids)
                    .filter((agentId) => z.string().uuid().safeParse(agentId).success))];
            const software = new Set();
            for (let start = 0; start < candidates.length; start += 2000) {
                const actors = await this.configuredCommands.listRecordedSoftwareActors(tx, { school_id: schoolId, agent_ids: candidates.slice(start, start + 2000) });
                for (const actor of actors)
                    software.add(actor.agent_id);
            }
            return { page: input.page, page_size: input.page_size, total, total_pages: Math.max(1, Math.ceil(total / input.page_size)),
                history: result.map((row) => ({ id: row.id, action: row.action, person_id: row.person_id, name: row.name,
                    previous_status: row.previous_status, status: row.status, remarks: row.remarks, reason: row.reason,
                    actor_name: row.human_actor_id !== null ? row.actor_name
                        : row.software_agent_ids.some(agentId => software.has(agentId)) ? 'Configured automatic decision' : 'Unknown recorded actor',
                    recorded_at: iso(row.recorded_at), register_revision: row.register_revision })) };
        });
    }
    /**
     * Native worker input, not a fabricated human review. The execution clock and
     * selected data plane apply to this query. A typed software-actor command must
     * execute the returned policy before these registers can become final.
     */
    async dueForFinalization(schoolId, limit = 100) {
        return (await sql `
      SELECT id,school_id,occurrence_id,revision,policy_revision,policy_snapshot,auto_finalize_at
      FROM activity_attendance_registers WHERE state='submitted' AND auto_finalize_at IS NOT NULL
        AND auto_finalize_at<=${executionNow()} AND (${schoolId ?? null}::uuid IS NULL OR school_id=${schoolId ?? null}::uuid)
      ORDER BY auto_finalize_at,id LIMIT ${Math.max(1, Math.min(500, Math.trunc(limit)))}`.execute(this.db)).rows;
    }
    /** A source adapter checks its challenge; the kernel keeps one evidence and
     * decision lifecycle, including actual software attribution when configured. */
    async selfCheckInInTransaction(tx, user, schoolId, registerId, input, request) {
        await this.lockAcademicMutationSchedule(tx, schoolId, registerId);
        await this.member(tx, user, schoolId);
        return recordParticipationSelfCheckIn(tx, {
            commands: this.commands, journal: this.journal, configured: this.configuredCommands, identities: this.identities, observations: this.observations,
            register: () => this.register(tx, schoolId, registerId, true), assertRoster: register => this.assertRoster(tx, register),
            target: (register, revision) => this.target(register, revision), audience: (register, actorId) => this.audience(tx, register, actorId),
            observe: (register, personId, sourceId, state, eventId, now, evidenceRefs, software) => this.recordObservation(tx, register, user.id, personId, "present", sourceId, now, "self_check_in", state, eventId, now, evidenceRefs, software),
            synchronize: () => this.syncAcademicProjection(tx, schoolId, registerId),
            effects: (revision, operation, actorId) => this.applyAcademicEffects(tx, { register_id: registerId, school_id: schoolId,
                register_revision: revision, operation, actor_user_id: actorId, request_id: request.requestId }),
        }, user, schoolId, input, request);
    }
    /** The same register transition, executed by a genuinely configured software actor. */
    async finalizeDue(schoolId, limit = 100) {
        return this.db.transaction().execute(async (tx) => {
            const candidates = (await sql `SELECT register.id,register.school_id,occurrence.source
        FROM activity_attendance_registers register JOIN schedule_activity_occurrences occurrence
          ON occurrence.id=register.occurrence_id AND occurrence.school_id=register.school_id
        WHERE register.state='submitted' AND register.auto_finalize_at IS NOT NULL AND register.auto_finalize_at<=${executionNow()}
          AND (${schoolId ?? null}::uuid IS NULL OR register.school_id=${schoolId ?? null}::uuid)
        ORDER BY register.auto_finalize_at,register.id LIMIT ${Math.max(1, Math.min(500, Math.trunc(limit)))}`.execute(tx)).rows;
            for (const tenant of [...new Set(candidates.filter(candidate => candidate.source === "academic").map(candidate => candidate.school_id))].sort()) {
                await lockSchedule(tx, tenant);
            }
            const due = (await sql `SELECT id,school_id FROM activity_attendance_registers
        WHERE id=ANY(${candidates.map(candidate => candidate.id)}::uuid[]) AND state='submitted'
          AND auto_finalize_at IS NOT NULL AND auto_finalize_at<=${executionNow()}
        ORDER BY auto_finalize_at,id FOR UPDATE SKIP LOCKED`.execute(tx)).rows;
            let finalized = 0;
            for (const candidate of due) {
                const register = await this.register(tx, candidate.school_id, candidate.id);
                const current = await this.participationPolicy(tx, candidate.school_id);
                const source = register.policy_snapshot;
                // A revoked/replaced rule or missing approval never borrows a hidden
                // automatic default. It remains submitted for its explicit reviewer.
                if (!automaticParticipationPolicyMatches(register.policy_revision, source, current) || register.occurrence_state !== "expected")
                    continue;
                const invalid = (await sql `SELECT
          (SELECT count(*)::int FROM activity_attendance_roster roster LEFT JOIN activity_attendance_entries entry
            ON entry.register_id=roster.register_id AND entry.person_id=roster.person_id
            WHERE roster.register_id=${register.id}::uuid AND roster.requirement='required' AND entry.status IS NULL) AS unrecorded,
          (SELECT count(*)::int FROM activity_attendance_evidence WHERE register_id=${register.id}::uuid AND state='pending') AS pending`.execute(tx)).rows[0];
                if (invalid.unrecorded || invalid.pending)
                    continue;
                await this.assertRoster(tx, register);
                const now = executionNow(), revision = register.revision + 1, requestId = randomUUID();
                const ruleRef = `institution_operating_rules:${register.school_id}:${register.policy_revision}`;
                const configurationHash = createHash("sha256").update(JSON.stringify({ revision: register.policy_revision,
                    mode: source.finalization_mode, minutes: source.auto_finalize_minutes, approved_by: source.approved_by,
                    approved_at: source.approved_at })).digest("hex");
                const actor = await this.configuredCommands.configureSoftwareActor(tx, {
                    school_id: register.school_id, approved_by_user_id: source.approved_by, source_domain: "attendance",
                    source_record_id: register.school_id, source_revision: register.policy_revision, configuration_hash: configurationHash,
                    operating_rule_ref: ruleRef, allowed_commands: ["attendance.participation.automatic_finalize"],
                    approved_at: source.approved_at, effective_from: source.approved_at, label: "Configured attendance finalization",
                });
                const command = await this.configuredCommands.prepareSoftwareCommand(tx, {
                    school_id: register.school_id, actor_agent_id: actor.agent_id, behaviour_version_id: actor.behaviour_version_id,
                    command_type: "attendance.participation.automatic_finalize", handler_key: "attendance.participation_finalize",
                    handler_version: 1, source_domain: "attendance", target: this.target(register),
                    current_revision: register.revision, expected_revision: register.revision, capability: "attendance:review",
                    purpose: "configured_participation_finalization", requested_at: now.toISOString(), correlation_id: requestId, causation_id: null,
                    idempotency_key: `participation-auto:${register.id}:${register.revision}`, operating_rule_version_ref: ruleRef,
                    configuration_refs: [{ kind: "behaviour", ref: actor.behaviour_version_id, version: String(register.policy_revision) }],
                    authority_attestation: { evaluator_domain: "attendance", decision: "allowed", reason_codes: ["explicit_current_finalization_policy"],
                        authority_source_refs: [{ source_domain: "operating_rules", school_id: register.school_id,
                                revision: register.policy_revision, approved_by: source.approved_by, approved_at: source.approved_at }],
                        operating_rule_refs: [{ ref: ruleRef, revision: register.policy_revision }], valid_until: null },
                    safe_context: { occurrence_id: register.occurrence_id, automation_executor: "participation_auto_finalize",
                        scheduled_at: iso(register.auto_finalize_at), configuration_hash: configurationHash },
                });
                if (command.status !== "ready")
                    continue;
                await sql `UPDATE activity_attendance_registers SET state='locked',revision=${revision},locked_by=NULL,locked_at=${now},
          auto_finalize_at=NULL,finalization_source='automatic',updated_at=${now} WHERE id=${register.id}::uuid`.execute(tx);
                await this.syncAcademicProjection(tx, register.school_id, register.id);
                await sql `INSERT INTO activity_attendance_audits(school_id,register_id,action,actor_id,reason,register_revision,request_id,source_refs)
          VALUES(${register.school_id}::uuid,${register.id}::uuid,'automatic_finalize',NULL,'Explicit configured policy became due',
            ${revision},${requestId}::uuid,${JSON.stringify([{ actor_agent_id: actor.agent_id, behaviour_version_id: actor.behaviour_version_id,
                        operating_rule_ref: ruleRef, scheduled_at: iso(register.auto_finalize_at) }])}::jsonb)`.execute(tx);
                const outboxId = randomUUID();
                const audience = await this.audience(tx, register);
                await sql `INSERT INTO event_outbox(id,school_id,event_type,aggregate_type,aggregate_id,audience_user_ids,payload,idempotency_key)
          VALUES(${outboxId}::uuid,${register.school_id}::uuid,'attendance.participation.updated','attendance_register',${register.id}::uuid,
            ${audience}::uuid[],${JSON.stringify({ operation: "automatic_finalize", register_id: register.id, occurrence_id: register.occurrence_id, revision,
                    refresh: ["attendance", "activities", "workspace", "today"], automation_executor: "participation_auto_finalize" })}::jsonb,
            ${`participation-auto-event:${register.id}:${revision}`})`.execute(tx);
                const event = await this.configuredCommands.recordSoftwareEvent(tx, {
                    school_id: register.school_id, actor_agent_id: actor.agent_id, behaviour_version_id: actor.behaviour_version_id,
                    source_outbox_event_id: outboxId, event_type: "attendance.participation.updated", subject: this.target(register, revision),
                    context: null, audience_user_ids: audience, occurred_at: now.toISOString(), effective_from: now.toISOString(), effective_until: null,
                    source_domain: "attendance", source_record_id: register.id, source_revision: revision,
                    correlation_id: requestId, causation_event_id: null, idempotency_key: `participation-auto-model:${register.id}:${revision}`,
                    payload: { operation: "automatic_finalize", occurrence_id: register.occurrence_id, register_revision: revision,
                        operating_rule_ref: ruleRef, scheduled_at: iso(register.auto_finalize_at), configured_actor: actor.agent_id },
                });
                if (register.source === 'academic')
                    await this.applyAcademicEffects(tx, { register_id: register.id, school_id: register.school_id,
                        register_revision: revision, operation: 'automatic_finalize', actor_user_id: null, request_id: requestId });
                await this.commands.completeDomainCommand(tx, {
                    school_id: register.school_id, command_id: command.command_id, terminal_state: "accepted", code: "participation_finalized_automatically",
                    explanation: "The explicitly approved institution policy finalized the submitted register after its configured delay.",
                    resulting_revision: revision, domain_event_id: outboxId, metadata: { model_event_id: event.event_id,
                        actor_agent_id: actor.agent_id, behaviour_version_id: actor.behaviour_version_id, operating_rule_ref: ruleRef },
                    completed_at: now.toISOString(),
                });
                finalized += 1;
            }
            return finalized;
        });
    }
};
ActivityAttendanceService = __decorate([
    Injectable(),
    __param(1, Inject(DOMAIN_COMMAND_GATEWAY_PORT)),
    __param(2, Inject(DOMAIN_EVENT_JOURNAL_PORT)),
    __param(3, Inject(OBSERVATION_INGRESS_PORT)),
    __param(4, Inject(HUMAN_AGENT_IDENTITY_PORT)),
    __param(5, Inject(CONFIGURED_COMMAND_PORT)),
    __param(6, Optional()),
    __param(7, Optional()),
    __param(7, Inject(PREPARED_DOMAIN_COMMAND_VERIFICATION_PORT)),
    __metadata("design:paramtypes", [DatabaseService, Object, Object, Object, Object, Object, ParticipationContextAuthorityRegistry, Object])
], ActivityAttendanceService);
export { ActivityAttendanceService };
//# sourceMappingURL=activity-attendance.service.js.map