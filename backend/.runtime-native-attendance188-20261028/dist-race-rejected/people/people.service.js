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
import { executionNow } from "../campus-model-core/execution-time.runtime.js";
import { institutionSchoolPermission } from "../roles/authorization.js";
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { createHash } from "node:crypto";
import { sql } from "kysely";
import { z } from "zod";
import { DatabaseService } from "../database/database.service.js";
import { SchoolEventService } from "../school/school-event.service.js";
import { HUMAN_AGENT_IDENTITY_PORT } from "../campus-model-core/human-agent-identity.port.js";
import { DOMAIN_COMMAND_GATEWAY_PORT } from "../campus-model-core/domain-command-gateway.port.js";
import { DOMAIN_EVENT_JOURNAL_PORT } from "../campus-model-core/domain-event-journal.port.js";
import { existingPersonReferenceSchema, lockAttachmentPerson, preparePersonAttachment, completePersonAttachment, prepareAttachmentBatch, registerCreatedPerson } from "./person-attachment.js";
import { AcademicParticipationBridge } from "../attendance/academic-participation-bridge.service.js";
import { lockSchedule } from "../day-plans/schedule.js";
const name = z.string().trim().min(1).max(150);
const guardianSchema = z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("existing"), id: z.string().uuid() }).strict(),
    z.object({ mode: z.literal("person"), person_id: z.string().uuid(), expected_revision: z.number().int().positive() }).strict(),
    z.object({ mode: z.literal("new"), first_name: name, last_name: z.string().trim().max(150),
        phone: z.string().trim().regex(/^\+?[0-9 ()-]{7,25}$/, "Enter a contact phone number."),
        email: z.union([z.email(), z.literal("")]).default("") }).strict(),
]);
const intakeSchema = z.object({ school_id: z.string().uuid(), person: existingPersonReferenceSchema.optional(), first_name: name.optional().default(""),
    last_name: z.string().trim().max(150).default(""), admission_number: z.string().trim().min(2).max(64).regex(/^[A-Za-z0-9/-]+$/).transform((v) => v.toUpperCase()),
    date_of_birth: z.iso.date().nullable().default(null), class_section_id: z.string().uuid(), term_id: z.string().uuid(),
    roll_number: z.number().int().min(1).max(32767), enrolled_on: z.iso.date(), guardian: guardianSchema.nullable().default(null),
    relationship: z.enum(["mother", "father", "guardian"]).default("guardian"), can_authorize_leave: z.boolean().default(false),
}).strict().refine(input => Boolean(input.person || input.first_name), "Choose an existing person or enter a name.")
    .refine(input => input.guardian?.mode !== 'person' || Boolean(input.person), "Choose the learner's existing person before attaching another person as guardian.")
    .refine(input => !input.person || input.guardian?.mode !== 'new', "Add the guardian to People first, then select that existing person.")
    .refine(input => !input.person || !input.can_authorize_leave, "Manage leave-signing authority separately after linking the guardian.")
    .refine(input => Boolean(input.guardian) || !input.can_authorize_leave, "Leave-signing authority needs a guardian relationship.");
const guardianLinkSchema = z.object({ school_id: z.string().uuid(), student_id: z.string().uuid(), person: existingPersonReferenceSchema,
    relationship: z.enum(["mother", "father", "guardian"]), is_primary: z.boolean().default(false), idempotency_key: z.string().uuid() }).strict();
const lifecycleCommon = z.object({
    school_id: z.string().uuid(), student_id: z.string().uuid(), expected_enrollment_id: z.string().uuid(),
    expected_revision: z.number().int().positive(), effective_on: z.iso.date(), reason: z.string().trim().min(3).max(500),
});
const lifecycleSchema = z.discriminatedUnion("action", [
    lifecycleCommon.extend({ action: z.literal("move_class"), target_class_section_id: z.string().uuid(), target_term_id: z.string().uuid(), roll_number: z.number().int().min(1).max(32767) }).strict(),
    lifecycleCommon.extend({ action: z.literal("withdraw") }).strict(),
    lifecycleCommon.extend({ action: z.literal("transfer_out") }).strict(),
]);
let PeopleService = class PeopleService {
    db;
    events;
    identity;
    gateway;
    journal;
    participation;
    constructor(db, events, identity, gateway, journal, participation) {
        this.db = db;
        this.events = events;
        this.identity = identity;
        this.gateway = gateway;
        this.journal = journal;
        this.participation = participation;
    }
    modelPorts() {
        return this.identity && this.gateway && this.journal ? { identity: this.identity, gateway: this.gateway, journal: this.journal } : undefined;
    }
    async requireAttachmentActor(db, user, schoolId) {
        const ports = this.modelPorts();
        if (!ports)
            throw new ConflictException('The reviewed person attachment path is unavailable.');
        const actor = await ports.identity.resolveAccountEndpoint(db, { school_id: schoolId, user_id: user.id, at: executionNow().toISOString() });
        if (!actor.acting)
            throw new ConflictException('Current campus app access is required.');
        return ports;
    }
    async guardianProfile(db, schoolId, person) {
        const existing = (await sql `SELECT guardian_id AS id FROM guardian_school_profiles
      WHERE school_id=${schoolId}::uuid AND person_id=${person.id}::uuid`.execute(db)).rows[0];
        if (existing)
            return existing.id;
        const parent = await db.insertInto('parents').values({ user_id: null }).returning('id').executeTakeFirstOrThrow();
        await db.insertInto('guardian_school_profiles').values({ school_id: schoolId, guardian_id: parent.id, person_id: person.id }).execute();
        return parent.id;
    }
    async authorize(db, user, schoolId, lock = false) {
        z.string().uuid().parse(schoolId);
        await institutionSchoolPermission(db, user, schoolId, "sis.manage", lock);
    }
    async options(user, schoolId) {
        await this.authorize(this.db, user, schoolId);
        const results = (await sql `SELECT c.id AS class_section_id,t.id AS term_id,concat('Class ',c.grade,c.section) AS class_name,
      t.name AS term_name,t.starts_on::text,t.ends_on::text,(now() AT TIME ZONE sc.timezone)::date::text AS today,
      COALESCE((SELECT max(e.roll_number)+1 FROM enrollments e WHERE e.class_section_id=c.id AND e.term_id=t.id),1)::int AS next_roll
      FROM class_sections c JOIN academic_terms t ON t.school_id=c.school_id AND t.academic_year=c.academic_year
      JOIN schools sc ON sc.id=c.school_id WHERE c.school_id=${schoolId}::uuid AND t.is_active
      ORDER BY c.grade,c.section,t.starts_on`.execute(this.db)).rows;
        return { results };
    }
    async guardians(user, query) {
        const input = z.object({ school_id: z.string().uuid(), search: z.string().trim().min(2).max(80) }).parse(query);
        await this.authorize(this.db, user, input.school_id);
        const pattern = `%${input.search.replace(/[\\%_]/g, "\\$&")}%`;
        return { results: (await sql `SELECT gp.guardian_id AS id,concat_ws(' ',p.first_name,p.last_name) AS name,p.contact_phone AS phone,
      (SELECT string_agg(s.admission_number,', ' ORDER BY s.admission_number) FROM guardian_relationships g JOIN students s ON s.id=g.student_id
        WHERE g.guardian_id=gp.guardian_id AND s.school_id=gp.school_id) AS linked_admissions
      FROM guardian_school_profiles gp JOIN school_people p ON p.id=gp.person_id
      WHERE gp.school_id=${input.school_id}::uuid AND (concat_ws(' ',p.first_name,p.last_name) ILIKE ${pattern}
        OR p.contact_phone ILIKE ${pattern} OR EXISTS(SELECT 1 FROM guardian_relationships g JOIN students s ON s.id=g.student_id
          WHERE g.guardian_id=gp.guardian_id AND s.school_id=gp.school_id AND s.admission_number ILIKE ${pattern}))
      ORDER BY p.first_name,p.last_name,gp.guardian_id LIMIT 25`.execute(this.db)).rows };
    }
    async list(user, query) {
        const input = z.object({ school_id: z.string().uuid(), search: z.string().trim().max(80).default(""), initial: z.string().trim().toUpperCase().regex(/^[A-Z]$/).optional(), cursor: z.string().uuid().optional() }).parse(query);
        return this.db.transaction().execute(async (db) => {
            await this.authorize(db, user, input.school_id);
            const pattern = `%${input.search.replace(/[\\%_]/g, "\\$&")}%`;
            const rows = (await sql `SELECT s.id,s.person_id,p.revision AS person_revision,s.admission_number,s.avatar_url,concat_ws(' ',p.first_name,p.last_name) AS name,
      s.date_of_birth::text,(s.user_id IS NOT NULL) AS has_account,
      enrollment.id AS enrollment_id,enrollment.class_section_id,enrollment.term_id,enrollment.term_name,enrollment.class_name,
      enrollment.roll_number,enrollment.enrolled_on,enrollment.revision AS enrollment_revision,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',g.id,'person_id',person.id,'person_revision',person.revision,'name',concat_ws(' ',person.first_name,person.last_name),'relationship',g.relationship,
        'phone',person.contact_phone,'avatar_url',person.avatar_url,'has_account',guardian.user_id IS NOT NULL) ORDER BY g.is_primary DESC)
        FROM guardian_relationships g JOIN parents guardian ON guardian.id=g.guardian_id
        JOIN guardian_school_profiles gp ON gp.guardian_id=g.guardian_id AND gp.school_id=s.school_id
        JOIN school_people person ON person.id=gp.person_id WHERE g.student_id=s.id),'[]'::jsonb) AS guardians
      FROM students s JOIN school_people p ON p.id=s.person_id
      LEFT JOIN LATERAL (SELECT e.id,e.class_section_id,e.term_id,t.name AS term_name,concat('Class ',c.grade,c.section) AS class_name,e.roll_number,e.enrolled_on::text,e.revision
        FROM enrollments e JOIN class_sections c ON c.id=e.class_section_id JOIN academic_terms t ON t.id=e.term_id
        WHERE e.student_id=s.id AND e.is_active ORDER BY t.starts_on DESC LIMIT 1) enrollment ON true
      WHERE s.school_id=${input.school_id}::uuid AND (${input.initial ?? null}::text IS NULL OR upper(left(p.first_name,1))=${input.initial ?? null})
        AND (${input.cursor ?? null}::uuid IS NULL OR (lower(p.first_name),lower(coalesce(p.last_name,'')),s.id)>
        (SELECT lower(cursor_person.first_name),lower(coalesce(cursor_person.last_name,'')),cursor.id FROM students cursor
          JOIN school_people cursor_person ON cursor_person.id=cursor.person_id
          WHERE cursor.id=${input.cursor ?? null}::uuid AND cursor.school_id=${input.school_id}::uuid))
        AND (s.admission_number ILIKE ${pattern} OR concat_ws(' ',p.first_name,p.last_name) ILIKE ${pattern})
      ORDER BY lower(p.first_name),lower(coalesce(p.last_name,'')),s.id LIMIT 26`.execute(db)).rows;
            const results = rows.slice(0, 25);
            if (this.identity) {
                const personIds = [...new Set(results.flatMap(row => [row.person_id, ...row.guardians.map(guardian => guardian.person_id)]))];
                const states = new Map();
                for (let offset = 0; offset < personIds.length; offset += 25)
                    for (const { person_id, ...state } of await this.identity.listPersonAccountStates(db, { school_id: input.school_id, person_ids: personIds.slice(offset, offset + 25), at: executionNow().toISOString(), viewer_user_id: user.id }))
                        states.set(person_id, state);
                for (const row of results) {
                    Object.assign(row, states.get(row.person_id));
                    for (const guardian of row.guardians)
                        Object.assign(guardian, states.get(guardian.person_id));
                }
            }
            return { results, next_cursor: rows.length > 25 ? rows[24].id : null };
        });
    }
    async lifecycle(user, studentIdValue, schoolIdValue) {
        const studentId = z.string().uuid().parse(studentIdValue);
        const schoolId = z.string().uuid().parse(schoolIdValue);
        await this.authorize(this.db, user, schoolId);
        const student = (await sql `SELECT s.id,(now() AT TIME ZONE school.timezone)::date::text AS today
      FROM students s JOIN schools school ON school.id=s.school_id
      WHERE s.id=${studentId}::uuid AND s.school_id=${schoolId}::uuid`.execute(this.db)).rows[0];
        if (!student)
            throw new NotFoundException("Student not found in this institution.");
        const history = (await sql `SELECT e.id,e.class_section_id,e.term_id,e.roll_number,e.enrolled_on::text,e.is_active,
      e.inactive_from::text,e.exit_kind,e.exit_reason,e.revision,concat('Class ',c.grade,c.section) AS class_name,t.name AS term_name,
      concat_ws(' ',actor.first_name,actor.last_name) AS ended_by_name,e.ended_at
      FROM enrollments e JOIN class_sections c ON c.id=e.class_section_id JOIN academic_terms t ON t.id=e.term_id
      LEFT JOIN users actor ON actor.id=e.ended_by WHERE e.student_id=${studentId}::uuid
      ORDER BY e.is_active DESC,e.enrolled_on DESC,e.id DESC`.execute(this.db)).rows;
        return { today: student.today, current: history.find((item) => item.is_active) ?? null, history };
    }
    async validateLifecycle(db, input, lock = false) {
        const current = (await sql `
      SELECT e.id,e.student_id,e.class_section_id,e.term_id,e.roll_number,e.revision,
        (now() AT TIME ZONE school.timezone)::date::text AS today,concat('Class ',c.grade,c.section) AS class_name,
        t.name AS term_name,t.starts_on::text,t.ends_on::text
      FROM enrollments e JOIN students s ON s.id=e.student_id JOIN schools school ON school.id=s.school_id
      JOIN class_sections c ON c.id=e.class_section_id JOIN academic_terms t ON t.id=e.term_id
      WHERE e.id=${input.expected_enrollment_id}::uuid AND e.student_id=${input.student_id}::uuid
        AND s.school_id=${input.school_id}::uuid AND e.is_active ${lock ? sql `FOR UPDATE OF e` : sql ``}`.execute(db)).rows[0];
        if (!current)
            throw new ConflictException("This student's current enrollment changed. Reload the profile and review again.");
        if (current.revision !== input.expected_revision)
            throw new ConflictException("This student's enrollment changed. Reload the profile and review again.");
        if (input.effective_on !== current.today)
            throw new BadRequestException("This first connected-student release applies changes today. Use class promotion for a future term.");
        let target = null;
        if (input.action === 'move_class') {
            if (input.target_term_id !== current.term_id)
                throw new BadRequestException("Use class promotion for a different term. Class movement here keeps the current term.");
            if (input.target_class_section_id === current.class_section_id)
                throw new BadRequestException("Choose a different class.");
            target = (await sql `SELECT c.id AS class_section_id,t.id AS term_id,
        concat('Class ',c.grade,c.section) AS class_name,t.name AS term_name FROM class_sections c
        JOIN academic_terms t ON t.school_id=c.school_id AND t.academic_year=c.academic_year
        WHERE c.id=${input.target_class_section_id}::uuid AND t.id=${input.target_term_id}::uuid
          AND c.school_id=${input.school_id}::uuid AND ${input.effective_on}::date BETWEEN t.starts_on AND t.ends_on
        ${lock ? sql `FOR SHARE OF c,t` : sql ``}`.execute(db)).rows[0] ?? null;
            if (!target)
                throw new BadRequestException("Choose another class in the student's current term.");
            const occupied = (await sql `SELECT id FROM enrollments WHERE class_section_id=${input.target_class_section_id}::uuid
        AND term_id=${input.target_term_id}::uuid AND roll_number=${input.roll_number} AND is_active
        ${lock ? sql `FOR UPDATE` : sql ``}`.execute(db)).rows[0];
            if (occupied)
                throw new ConflictException("That roll number is already assigned in the destination class.");
        }
        const classIds = input.action === 'move_class' ? [current.class_section_id, input.target_class_section_id] : [current.class_section_id];
        const dailyRegisters = (await sql `SELECT state FROM attendance_registers WHERE class_section_id=ANY(${classIds}::uuid[])
      AND term_id=${current.term_id}::uuid AND date>=${input.effective_on}::date ${lock ? sql `FOR UPDATE` : sql ``}`.execute(db)).rows;
        const sessionRegisters = (await sql `SELECT state FROM attendance_session_registers WHERE school_id=${input.school_id}::uuid
      AND class_section_id=ANY(${classIds}::uuid[]) AND term_id=${current.term_id}::uuid AND session_date>=${input.effective_on}::date
      ${lock ? sql `FOR UPDATE` : sql ``}`.execute(db)).rows;
        const registers = [...dailyRegisters, ...sessionRegisters];
        const locked = registers.filter(item => item.state === 'locked').length;
        if (locked)
            throw new ConflictException(`${locked} affected attendance register(s) are final. Reopen them before changing this enrollment.`);
        const impact = (await sql `SELECT
      (SELECT count(*)::text FROM assessments a JOIN assessment_cycles cycle ON cycle.id=a.cycle_id
        WHERE a.class_section_id=${current.class_section_id}::uuid AND cycle.term_id=${current.term_id}::uuid
          AND a.status NOT IN ('cancelled','published') AND (a.scheduled_at IS NULL OR a.scheduled_at::date>=${input.effective_on}::date)) AS assessments,
      (SELECT count(*)::text FROM transport_student_assignments WHERE school_id=${input.school_id}::uuid AND student_id=${input.student_id}::uuid AND status='active') AS transport_assignments,
      (SELECT count(*)::text FROM departure_plans WHERE school_id=${input.school_id}::uuid AND student_id=${input.student_id}::uuid
        AND service_date>=${input.effective_on}::date AND is_current AND state NOT IN ('completed','cancelled')) AS departure_plans`.execute(db)).rows[0];
        return { current, target, impact: { attendance_registers: registers.length, submitted_registers: registers.filter(item => item.state === 'submitted').length,
                assessments: Number(impact.assessments), transport_assignments: Number(impact.transport_assignments), departure_plans: Number(impact.departure_plans) } };
    }
    async previewLifecycle(req, studentIdValue, body) {
        const input = lifecycleSchema.parse({ ...body, student_id: studentIdValue });
        await this.authorize(this.db, req.authUser, input.school_id);
        const review = await this.validateLifecycle(this.db, input);
        const draft = await this.db.insertInto("student_enrollment_change_reviews").values({ school_id: input.school_id, student_id: input.student_id, created_by: req.authUser.id,
            expected_enrollment_id: input.expected_enrollment_id, expected_revision: input.expected_revision, action: input.action, input, impact: review.impact, result_enrollment_id: null }).returning(["id", "expires_at"]).executeTakeFirstOrThrow();
        return { ...draft, input, current: review.current, target: review.target, impact: review.impact };
    }
    async commitLifecycle(req, idValue) {
        const id = z.string().uuid().parse(idValue);
        return this.db.transaction().execute(async (db) => {
            const draft = (await sql `SELECT * FROM student_enrollment_change_reviews WHERE id=${id}::uuid AND created_by=${req.authUser.id}::uuid FOR UPDATE`.execute(db)).rows[0];
            if (!draft)
                throw new NotFoundException("Enrollment change review not found.");
            await this.authorize(db, req.authUser, draft.school_id, true);
            await lockSchedule(db, draft.school_id);
            const ports = await this.requireAttachmentActor(db, req.authUser, draft.school_id);
            if (draft.committed_at)
                return { student_id: draft.student_id, enrollment_id: draft.result_enrollment_id, action: draft.action };
            if (new Date(draft.expires_at).getTime() < executionNow().getTime())
                throw new ConflictException("This review expired. Review the impact again before saving.");
            const input = lifecycleSchema.parse(draft.input);
            await sql `SELECT pg_advisory_xact_lock(hashtextextended(${`student-enrollment:${input.student_id}`},0))`.execute(db);
            const checked = await this.validateLifecycle(db, input, true);
            const now = executionNow().toISOString();
            const target = { kind: "enrollment", domain: "people", domain_id: input.expected_enrollment_id,
                label: "Learner enrollment", lifecycle_state: "active", source_revision: checked.current.revision, metadata: {} };
            const prepared = await ports.gateway.prepareDomainCommand(db, { school_id: input.school_id, actor_user_id: req.authUser.id,
                command_type: `people.enrollment.${input.action}`, handler_key: "people.enrollment_lifecycle", handler_version: 1, source_domain: "people",
                target, current_revision: checked.current.revision, expected_revision: input.expected_revision,
                capability: "people:manage", purpose: "reviewed_enrollment_lifecycle", requested_at: now,
                correlation_id: id, causation_id: null, idempotency_key: `enrollment-lifecycle:${id}`, operating_rule_version_ref: null,
                configuration_refs: [], authority_attestation: { evaluator_domain: "people", decision: "allowed",
                    reason_codes: ["current_people_management_permission", "reviewed_current_enrollment"],
                    authority_source_refs: [{ school_id: input.school_id, permission: "sis.manage" }], operating_rule_refs: [], valid_until: null },
                safe_context: { review_id: id, student_id: input.student_id, effective_on: input.effective_on,
                    enrollment_roster_targets: (input.action === 'move_class' ? [checked.current.class_section_id, input.target_class_section_id] : [checked.current.class_section_id])
                        .map(class_id => ({ class_id, term_id: checked.current.term_id, effective_on: input.effective_on })),
                    expected_enrollment_id: input.expected_enrollment_id, request_hash: createHash("sha256").update(JSON.stringify(input)).digest("hex") } });
            if (prepared.status !== "ready")
                throw new ConflictException("This enrollment command already completed. Refresh its retained review.");
            if (!this.participation)
                throw new ConflictException("The canonical academic roster service is unavailable.");
            const rosterSource = { kind: "lifecycle", review_id: id, command_id: prepared.command_id };
            await this.participation.prepareEnrollmentRostersInTransaction(db, req.authUser, input.school_id, rosterSource);
            const exitKind = input.action === 'move_class' ? 'class_move' : input.action === 'withdraw' ? 'withdrawn' : 'transferred_out';
            await sql `UPDATE enrollments SET is_active=false,inactive_from=${input.effective_on}::date,exit_kind=${exitKind},exit_reason=${input.reason},
        ended_by=${req.authUser.id}::uuid,ended_at=now(),revision=revision+1 WHERE id=${input.expected_enrollment_id}::uuid`.execute(db);
            let resultEnrollmentId = null;
            if (input.action === 'move_class') {
                const created = await db.insertInto("enrollments").values({ student_id: input.student_id, class_section_id: input.target_class_section_id,
                    term_id: input.target_term_id, roll_number: input.roll_number, enrolled_on: input.effective_on }).returning("id").executeTakeFirstOrThrow();
                resultEnrollmentId = created.id;
                await sql `INSERT INTO subject_attendance(student_id,subject_id,term_id)
          SELECT DISTINCT ${input.student_id}::uuid,slot.subject_id,slot.term_id FROM timetable_slots slot
          WHERE slot.class_section_id=${input.target_class_section_id}::uuid AND slot.term_id=${input.target_term_id}::uuid
            AND slot.subject_id IS NOT NULL AND slot.slot_type='class' ON CONFLICT(student_id,subject_id,term_id) DO NOTHING`.execute(db);
            }
            const classIds = input.action === 'move_class' ? [checked.current.class_section_id, input.target_class_section_id] : [checked.current.class_section_id];
            await sql `UPDATE student_enrollment_change_reviews SET committed_at=now(),result_enrollment_id=${resultEnrollmentId}::uuid WHERE id=${id}::uuid`.execute(db);
            const reopened = await this.participation.reconcileEnrollmentRostersInTransaction(db, req.authUser, input.school_id, rosterSource, req);
            for (const register of reopened)
                await db.insertInto("audit_events").values({ school_id: input.school_id, actor_id: req.authUser.id,
                    action: "attendance.register.roster_changed", target_type: "attendance_register", target_id: register.id, request_id: req.requestId, ip_hash: null,
                    metadata: { review_id: id, student_id: input.student_id, action: input.action, revision: register.revision, state: "draft" } }).execute();
            await db.insertInto("audit_events").values({ school_id: input.school_id, actor_id: req.authUser.id, action: `people.student.${exitKind}`,
                target_type: "student", target_id: input.student_id, request_id: req.requestId, ip_hash: null, metadata: { review_id: id, previous_enrollment_id: input.expected_enrollment_id,
                    result_enrollment_id: resultEnrollmentId, effective_on: input.effective_on, reason: input.reason, impact: checked.impact } }).execute();
            const audience = (await sql `SELECT DISTINCT membership.user_id FROM school_memberships membership
        WHERE membership.school_id=${input.school_id}::uuid AND membership.is_active AND (membership.role='admin'
          OR (membership.role='guardian' AND EXISTS(SELECT 1 FROM guardian_relationships relationship JOIN parents parent ON parent.id=relationship.guardian_id
            WHERE relationship.student_id=${input.student_id}::uuid AND parent.user_id=membership.user_id))
          OR (membership.role='staff' AND EXISTS(SELECT 1 FROM timetable_slots slot WHERE slot.teacher_user_id=membership.user_id
            AND slot.class_section_id=ANY(${classIds}::uuid[]) AND slot.term_id=${checked.current.term_id}::uuid)))`.execute(db)).rows.map(row => row.user_id);
            await this.events.enqueueUserEvent(db, { schoolId: input.school_id, eventType: "people.updated", aggregateType: "student", aggregateId: input.student_id,
                audienceUserIds: audience, idempotencyKey: `enrollment-change:${id}`, payload: { student_id: input.student_id, action: input.action,
                    class_section_id: input.action === 'move_class' ? input.target_class_section_id : null, previous_class_section_id: checked.current.class_section_id,
                    term_id: checked.current.term_id, refresh: ["people", "teacher.home", "teacher.attendance", "principal.home", "principal.attendance", "parent.home", "transport", "departure"] } });
            const outbox = await db.insertInto("event_outbox").values({ school_id: input.school_id, event_type: "people.enrollment.changed",
                aggregate_type: "enrollment", aggregate_id: input.expected_enrollment_id, audience_user_ids: [],
                payload: { review_id: id, action: input.action, previous_enrollment_id: input.expected_enrollment_id,
                    result_enrollment_id: resultEnrollmentId, effective_on: input.effective_on, revision: checked.current.revision + 1 },
                idempotency_key: `enrollment-lifecycle:${id}:accepted` }).returning("id").executeTakeFirstOrThrow();
            const effective = (await sql `SELECT ${input.effective_on}::date::timestamp AT TIME ZONE timezone AS instant
        FROM schools WHERE id=${input.school_id}::uuid`.execute(db)).rows[0].instant.toISOString();
            const event = await ports.journal.recordAcceptedEvent(db, { school_id: input.school_id, source_outbox_event_id: outbox.id,
                event_type: "people.enrollment.changed", subject: { ...target, lifecycle_state: "inactive", source_revision: checked.current.revision + 1 },
                context: resultEnrollmentId ? { kind: "enrollment", domain: "people", domain_id: resultEnrollmentId, label: "Successor learner enrollment",
                    lifecycle_state: "active", source_revision: 1, metadata: {} } : null,
                actor_user_id: req.authUser.id, audience_user_ids: [], occurred_at: now, effective_from: effective, effective_until: null,
                source_domain: "people", source_record_id: input.expected_enrollment_id, source_revision: checked.current.revision + 1,
                correlation_id: id, causation_event_id: null, idempotency_key: `enrollment-lifecycle:${id}:model`,
                payload: { action: input.action, review_id: id, resulting_enrollment_id: resultEnrollmentId,
                    source_command_id: prepared.command_id, closure: "terminal_domain_decision" } });
            await ports.gateway.completeDomainCommand(db, { school_id: input.school_id, command_id: prepared.command_id,
                terminal_state: "accepted", code: `enrollment_${exitKind}`, explanation: "The reviewed enrollment change was accepted; connected domain records retain their own decisions.",
                resulting_revision: checked.current.revision + 1, domain_event_id: outbox.id,
                metadata: { review_id: id, model_event_id: event.event_id, resulting_enrollment_id: resultEnrollmentId,
                    closure: "terminal_domain_decision", authority_or_account_access_changed: false }, completed_at: now });
            return { student_id: input.student_id, enrollment_id: resultEnrollmentId, action: input.action };
        });
    }
    async validate(db, input, lock = false) {
        if (input.person) {
            const person = await lockAttachmentPerson(db, input.school_id, input.person, lock);
            input.first_name = person.first_name;
            input.last_name = person.last_name;
            if ((await sql `SELECT id FROM students WHERE school_id=${input.school_id}::uuid AND person_id=${person.id}::uuid`.execute(db)).rows.length)
                throw new ConflictException('This person already has a learner record. Open that record to manage enrollment.');
        }
        const section = (await sql `
      SELECT concat('Class ',c.grade,c.section) AS class_name,t.name AS term_name,t.starts_on::text,t.ends_on::text,
        (now() AT TIME ZONE s.timezone)::date::text AS today
      FROM class_sections c JOIN academic_terms t ON t.school_id=c.school_id AND t.academic_year=c.academic_year
      JOIN schools s ON s.id=c.school_id WHERE c.id=${input.class_section_id}::uuid AND t.id=${input.term_id}::uuid
        AND c.school_id=${input.school_id}::uuid AND t.is_active ${lock ? sql `FOR UPDATE OF c FOR SHARE OF t` : sql ``}`.execute(db)).rows[0];
        if (!section)
            throw new BadRequestException("Choose a class and active term belonging to this school.");
        if (input.enrolled_on < section.starts_on || input.enrolled_on > section.ends_on)
            throw new BadRequestException("Enrollment date must fall within the selected term.");
        if (input.date_of_birth && (input.date_of_birth >= input.enrolled_on || input.date_of_birth > section.today || input.date_of_birth < "1900-01-01"))
            throw new BadRequestException("Date of birth must precede enrollment and cannot be in the future.");
        if ((await sql `SELECT id FROM students WHERE school_id=${input.school_id}::uuid AND lower(admission_number)=lower(${input.admission_number})`.execute(db)).rows.length)
            throw new ConflictException("This admission number already exists in the school.");
        if ((await sql `SELECT id FROM enrollments WHERE class_section_id=${input.class_section_id}::uuid AND term_id=${input.term_id}::uuid AND roll_number=${input.roll_number}`.execute(db)).rows.length)
            throw new ConflictException("This roll number is already assigned. Choose another number.");
        let guardian = null;
        if (input.guardian?.mode === 'existing') {
            const found = (await sql `SELECT gp.guardian_id AS id,concat_ws(' ',p.first_name,p.last_name) AS name,p.contact_phone AS phone
        FROM guardian_school_profiles gp JOIN school_people p ON p.id=gp.person_id JOIN parents parent ON parent.id=gp.guardian_id
        WHERE gp.school_id=${input.school_id}::uuid AND gp.guardian_id=${input.guardian.id}::uuid ${lock ? sql `FOR SHARE OF gp,p FOR UPDATE OF parent` : sql ``}`.execute(db)).rows[0];
            if (!found)
                throw new BadRequestException("Select an existing guardian from this school.");
            guardian = found;
        }
        else if (input.guardian?.mode === 'person') {
            if (input.person?.id === input.guardian.person_id)
                throw new BadRequestException('A person cannot be their own guardian.');
            const person = await lockAttachmentPerson(db, input.school_id, { id: input.guardian.person_id, expected_revision: input.guardian.expected_revision }, lock);
            guardian = { id: '', name: `${person.first_name} ${person.last_name}`.trim(), phone: person.contact_phone };
        }
        else if (input.guardian)
            guardian = { id: "", name: `${input.guardian.first_name} ${input.guardian.last_name}`.trim(), phone: input.guardian.phone };
        const warnings = [];
        const dailyRegisters = (await sql `SELECT id,state FROM attendance_registers
      WHERE class_section_id=${input.class_section_id}::uuid AND term_id=${input.term_id}::uuid AND date>=${input.enrolled_on}::date
      ${lock ? sql `FOR UPDATE` : sql ``}`.execute(db)).rows;
        const sessionRegisters = (await sql `SELECT id,state FROM attendance_session_registers
      WHERE school_id=${input.school_id}::uuid AND class_section_id=${input.class_section_id}::uuid AND term_id=${input.term_id}::uuid AND session_date>=${input.enrolled_on}::date
      ${lock ? sql `FOR UPDATE` : sql ``}`.execute(db)).rows;
        const registers = [...dailyRegisters, ...sessionRegisters];
        if (registers.some(r => r.state === 'locked'))
            throw new ConflictException("An affected attendance register is locked. Reopen it or choose a later enrollment date.");
        const submitted = registers.filter(r => r.state === 'submitted').length;
        if (submitted)
            warnings.push(`${submitted} submitted attendance register(s) will return to draft because this enrollment changes the roster. Existing attendance marks will be preserved.`);
        if (input.guardian?.mode === 'new') {
            const match = (await sql `SELECT id FROM school_people WHERE school_id=${input.school_id}::uuid
        AND (regexp_replace(contact_phone,'[^0-9]','','g')=regexp_replace(${input.guardian.phone},'[^0-9]','','g')
          OR lower(concat_ws(' ',first_name,last_name))=lower(${guardian.name})) LIMIT 1`.execute(db)).rows[0];
            if (match)
                warnings.push("A name or phone matches an existing person. This will create a separate guardian; go back and select an existing guardian if they are the same person.");
        }
        return { class_name: section.class_name, term_name: section.term_name, guardian, warnings };
    }
    async preview(req, body) {
        const input = intakeSchema.parse(body);
        await this.authorize(this.db, req.authUser, input.school_id);
        const review = await this.validate(this.db, input);
        const draft = (await sql `INSERT INTO people_intakes(school_id,created_by,input,expires_at)
      VALUES(${input.school_id}::uuid,${req.authUser.id}::uuid,${JSON.stringify(input)}::jsonb,${executionNow().toISOString()}::timestamptz+interval '1 hour') RETURNING id,expires_at`.execute(this.db)).rows[0];
        return { ...draft, input, ...review };
    }
    async commit(req, idValue) {
        const id = z.string().uuid().parse(idValue);
        return this.db.transaction().execute(async (db) => {
            const draft = (await sql `SELECT * FROM people_intakes WHERE id=${id}::uuid AND created_by=${req.authUser.id}::uuid FOR UPDATE`.execute(db)).rows[0];
            if (!draft)
                throw new NotFoundException("Enrollment review not found.");
            await this.authorize(db, req.authUser, draft.school_id, true);
            await lockSchedule(db, draft.school_id);
            const ports = await this.requireAttachmentActor(db, req.authUser, draft.school_id);
            if (draft.committed_student_id) {
                const stored = await db.selectFrom('students').select('person_id').where('id', '=', draft.committed_student_id).executeTakeFirstOrThrow();
                return { student_id: draft.committed_student_id, person_id: stored.person_id };
            }
            if (new Date(draft.expires_at).getTime() < executionNow().getTime())
                throw new ConflictException("This review expired. Review the details again before saving.");
            const input = intakeSchema.parse(draft.input);
            // Serializes admission uniqueness across classes as well as concurrent commits.
            await sql `SELECT pg_advisory_xact_lock(hashtextextended(${`admission:${input.school_id}:${input.admission_number}`},0))`.execute(db);
            await this.validate(db, input, true);
            const existing = input.person ? await lockAttachmentPerson(db, input.school_id, input.person) : undefined;
            const prepared = existing ? await preparePersonAttachment(db, ports, { school_id: input.school_id, actor_id: req.authUser.id,
                person: existing, command_type: 'people.learner.attach', source_domain: 'people', idempotency_key: `person-enrollment:${id}`,
                correlation_id: id, permission: 'sis.manage', request_hash: createHash('sha256').update(JSON.stringify(input)).digest('hex'),
                source_ref: id, source_revision: existing.revision,
                roster_targets: [{ class_id: input.class_section_id, term_id: input.term_id, effective_on: input.enrolled_on }] }) : await prepareAttachmentBatch(db, ports, {
                school_id: input.school_id, actor_id: req.authUser.id, target_id: id, target_kind: 'people_intake', label: 'Reviewed learner intake', revision: 0,
                command_type: 'people.learner.intake', source_domain: 'people', key: `person-enrollment:${id}`, correlation_id: id,
                request_hash: createHash('sha256').update(JSON.stringify(input)).digest('hex'), permission: 'sis.manage',
                roster_targets: [{ class_id: input.class_section_id, term_id: input.term_id, effective_on: input.enrolled_on }]
            });
            if (!this.participation)
                throw new ConflictException("The canonical academic roster service is unavailable.");
            const rosterSource = { kind: "intake", review_id: id, command_id: prepared.command_id };
            await this.participation.prepareEnrollmentRostersInTransaction(db, req.authUser, input.school_id, rosterSource);
            const person = existing ?? await db.insertInto("school_people").values({ school_id: input.school_id, first_name: input.first_name, last_name: input.last_name }).returning("id").executeTakeFirstOrThrow();
            if (!existing && ports && prepared)
                await registerCreatedPerson(db, ports, { school_id: input.school_id, actor_id: req.authUser.id,
                    person: { id: person.id, first_name: input.first_name, last_name: input.last_name }, correlation_id: id, command_id: prepared.command_id, key: `intake:${id}:person:${person.id}` });
            const student = await db.insertInto("students").values({ person_id: person.id, user_id: null, school_id: input.school_id, admission_number: input.admission_number, date_of_birth: input.date_of_birth, blood_group: null, emergency_contact: null }).returning("id").executeTakeFirstOrThrow();
            let guardianId = null;
            if (input.guardian?.mode === 'existing')
                guardianId = input.guardian.id;
            else if (input.guardian?.mode === 'person') {
                const guardianPerson = await lockAttachmentPerson(db, input.school_id, { id: input.guardian.person_id, expected_revision: input.guardian.expected_revision });
                guardianId = await this.guardianProfile(db, input.school_id, guardianPerson);
                await sql `UPDATE school_people SET revision=revision+1 WHERE school_id=${input.school_id}::uuid AND id=${guardianPerson.id}::uuid`.execute(db);
                if (ports && prepared)
                    await registerCreatedPerson(db, ports, { school_id: input.school_id, actor_id: req.authUser.id,
                        person: { ...guardianPerson, revision: guardianPerson.revision + 1 }, correlation_id: id, command_id: prepared.command_id,
                        key: `person-enrollment:${id}:guardian:${guardianPerson.id}:registered` });
            }
            else if (input.guardian) {
                const person = await db.insertInto("school_people").values({ school_id: input.school_id, first_name: input.guardian.first_name, last_name: input.guardian.last_name, contact_phone: input.guardian.phone, contact_email: input.guardian.email }).returning("id").executeTakeFirstOrThrow();
                if (ports && prepared)
                    await registerCreatedPerson(db, ports, { school_id: input.school_id, actor_id: req.authUser.id,
                        person: { id: person.id, first_name: input.guardian.first_name, last_name: input.guardian.last_name }, correlation_id: id, command_id: prepared.command_id, key: `intake:${id}:person:${person.id}` });
                const guardian = await db.insertInto("parents").values({ user_id: null }).returning("id").executeTakeFirstOrThrow();
                guardianId = guardian.id;
                await db.insertInto("guardian_school_profiles").values({ school_id: input.school_id, guardian_id: guardianId, person_id: person.id }).execute();
            }
            if (guardianId)
                await db.insertInto("guardian_relationships").values({ student_id: student.id, guardian_id: guardianId, relationship: input.relationship, is_primary: true, can_authorize_leave: input.can_authorize_leave }).execute();
            await db.insertInto("enrollments").values({ student_id: student.id, class_section_id: input.class_section_id, term_id: input.term_id, roll_number: input.roll_number, enrolled_on: input.enrolled_on }).execute();
            await sql `UPDATE people_intakes SET committed_student_id=${student.id}::uuid,committed_at=now() WHERE id=${id}::uuid`.execute(db);
            const reopened = await this.participation.reconcileEnrollmentRostersInTransaction(db, req.authUser, input.school_id, rosterSource, req);
            for (const register of reopened)
                await db.insertInto("audit_events").values({ school_id: input.school_id, actor_id: req.authUser.id, action: "attendance.register.roster_changed", target_type: "attendance_register", target_id: register.id, request_id: req.requestId, ip_hash: null, metadata: { intake_id: id, student_id: student.id, revision: register.revision, state: "draft" } }).execute();
            await sql `INSERT INTO subject_attendance(student_id,subject_id,term_id)
        SELECT DISTINCT ${student.id}::uuid,t.subject_id,t.term_id FROM timetable_slots t
        WHERE t.class_section_id=${input.class_section_id}::uuid AND t.term_id=${input.term_id}::uuid AND t.subject_id IS NOT NULL AND t.slot_type='class'
        ON CONFLICT (student_id,subject_id,term_id) DO NOTHING`.execute(db);
            await sql `UPDATE people_intakes SET committed_student_id=${student.id}::uuid,committed_at=now(),input='{}'::jsonb WHERE id=${id}::uuid`.execute(db);
            await db.insertInto("audit_events").values({ school_id: input.school_id, actor_id: req.authUser.id, action: "people.student.enrolled", target_type: "student", target_id: student.id, request_id: req.requestId, ip_hash: null, metadata: { intake_id: id, guardian_id: guardianId, class_section_id: input.class_section_id, enrolled_on: input.enrolled_on } }).execute();
            const audience = (await sql `SELECT DISTINCT m.user_id FROM school_memberships m
        WHERE m.school_id=${input.school_id}::uuid AND m.is_active AND (m.role='admin' OR
          (m.role='staff' AND EXISTS(SELECT 1 FROM timetable_slots t WHERE t.class_section_id=${input.class_section_id}::uuid AND t.term_id=${input.term_id}::uuid AND t.teacher_user_id=m.user_id)) OR
          (m.role='guardian' AND EXISTS(SELECT 1 FROM parents p WHERE p.id=${guardianId}::uuid AND p.user_id=m.user_id)))`.execute(db)).rows.map(r => r.user_id);
            await this.events.enqueueUserEvent(db, { schoolId: input.school_id, eventType: "people.updated", aggregateType: "student", aggregateId: student.id,
                audienceUserIds: audience, idempotencyKey: `enrollment:${id}`, payload: { student_id: student.id, class_section_id: input.class_section_id, term_id: input.term_id,
                    refresh: ["people", "teacher.home", "teacher.attendance", "principal.home", "principal.attendance", "parent.home"] } });
            if (prepared && ports) {
                if (existing)
                    await sql `UPDATE school_people SET revision=revision+1 WHERE school_id=${input.school_id}::uuid AND id=${existing.id}::uuid`.execute(db);
                const outbox = await db.selectFrom('event_outbox').select('id').where('idempotency_key', '=', `enrollment:${id}`).executeTakeFirstOrThrow();
                const attachedPerson = existing ? { ...existing, revision: existing.revision + 1 }
                    : { id: person.id, first_name: input.first_name, last_name: input.last_name, revision: 1, contact_email: '', contact_phone: '' };
                await completePersonAttachment(db, ports, { school_id: input.school_id, actor_id: req.authUser.id, person: attachedPerson,
                    prepared, outbox_event_id: outbox.id, source_domain: 'people', source_record_id: student.id, correlation_id: id, idempotency_key: `person-enrollment:${id}:accepted` });
            }
            return { student_id: student.id, person_id: person.id };
        });
    }
    async linkGuardian(req, body) {
        const input = guardianLinkSchema.parse(body), hash = createHash('sha256').update(JSON.stringify({ action: 'guardian_link', ...input })).digest('hex');
        return this.db.transaction().execute(async (db) => {
            await this.authorize(db, req.authUser, input.school_id, true);
            const ports = await this.requireAttachmentActor(db, req.authUser, input.school_id);
            await sql `SELECT pg_advisory_xact_lock(hashtextextended(${`people:${input.school_id}:${req.authUser.id}:${input.idempotency_key}`},0))`.execute(db);
            const retained = (await sql `SELECT request_hash,result
        FROM people_participation_commands WHERE school_id=${input.school_id}::uuid AND actor_id=${req.authUser.id}::uuid AND idempotency_key=${input.idempotency_key}::uuid`.execute(db)).rows[0];
            if (retained) {
                if (retained.request_hash !== hash)
                    throw new ConflictException('This retry belongs to different guardian details.');
                return retained.result;
            }
            const student = (await sql `SELECT person_id FROM students WHERE school_id=${input.school_id}::uuid AND id=${input.student_id}::uuid FOR SHARE`.execute(db)).rows[0];
            if (!student)
                throw new NotFoundException('Choose a learner from this institution.');
            if (student.person_id === input.person.id)
                throw new BadRequestException('A person cannot be their own guardian.');
            const person = await lockAttachmentPerson(db, input.school_id, input.person);
            const prior = (await sql `SELECT relationship.id FROM guardian_relationships relationship JOIN guardian_school_profiles profile
        ON profile.guardian_id=relationship.guardian_id AND profile.school_id=relationship.school_id
        WHERE relationship.school_id=${input.school_id}::uuid AND relationship.student_id=${input.student_id}::uuid
          AND profile.person_id=${person.id}::uuid`.execute(db)).rows[0];
            if (prior)
                throw new ConflictException('This person is already linked. Open the existing guardian relationship.');
            const prepared = await preparePersonAttachment(db, ports, { school_id: input.school_id, actor_id: req.authUser.id, person,
                command_type: 'people.guardian.attach', source_domain: 'people', idempotency_key: `guardian-link:${req.authUser.id}:${input.idempotency_key}`,
                correlation_id: input.idempotency_key, permission: 'sis.manage', request_hash: hash, source_ref: input.student_id, source_revision: person.revision });
            const guardianId = await this.guardianProfile(db, input.school_id, person);
            if (input.is_primary)
                await db.updateTable('guardian_relationships').set({ is_primary: false }).where('student_id', '=', input.student_id).execute();
            const relationship = await db.insertInto('guardian_relationships').values({ student_id: input.student_id, guardian_id: guardianId,
                relationship: input.relationship, is_primary: input.is_primary, can_authorize_leave: false }).returning('id').executeTakeFirstOrThrow();
            await sql `UPDATE school_people SET revision=revision+1 WHERE school_id=${input.school_id}::uuid AND id=${person.id}::uuid`.execute(db);
            const eventKey = `guardian-link:${relationship.id}:accepted`;
            await this.events.enqueueUserEvent(db, { schoolId: input.school_id, eventType: 'people.updated', aggregateType: 'guardian_relationship',
                aggregateId: relationship.id, audienceUserIds: [req.authUser.id], idempotencyKey: eventKey,
                payload: { action: 'guardian_contact_linked', person_id: person.id, student_id: input.student_id, refresh: ['people', 'people.participants'] } });
            const outbox = await db.selectFrom('event_outbox').select('id').where('idempotency_key', '=', eventKey).executeTakeFirstOrThrow();
            await completePersonAttachment(db, ports, { school_id: input.school_id, actor_id: req.authUser.id, person: { ...person, revision: person.revision + 1 }, prepared,
                outbox_event_id: outbox.id, source_domain: 'people', source_record_id: relationship.id, correlation_id: input.idempotency_key, idempotency_key: eventKey });
            await db.insertInto('audit_events').values({ school_id: input.school_id, actor_id: req.authUser.id, action: 'people.guardian.contact_linked',
                target_type: 'guardian_relationship', target_id: relationship.id, request_id: req.requestId, ip_hash: null,
                metadata: { person_id: person.id, student_id: input.student_id, app_access_changed: false, leave_authority_granted: false } }).execute();
            const result = { id: relationship.id, person_id: person.id, student_id: input.student_id, guardian_id: guardianId };
            await sql `INSERT INTO people_participation_commands(school_id,actor_id,idempotency_key,request_hash,result)
        VALUES(${input.school_id}::uuid,${req.authUser.id}::uuid,${input.idempotency_key}::uuid,${hash},${JSON.stringify(result)}::jsonb)`.execute(db);
            return result;
        });
    }
};
PeopleService = __decorate([
    Injectable(),
    __param(2, Optional()),
    __param(2, Inject(HUMAN_AGENT_IDENTITY_PORT)),
    __param(3, Optional()),
    __param(3, Inject(DOMAIN_COMMAND_GATEWAY_PORT)),
    __param(4, Optional()),
    __param(4, Inject(DOMAIN_EVENT_JOURNAL_PORT)),
    __param(5, Optional()),
    __metadata("design:paramtypes", [DatabaseService, SchoolEventService, Object, Object, Object, AcademicParticipationBridge])
], PeopleService);
export { PeopleService };
//# sourceMappingURL=people.service.js.map