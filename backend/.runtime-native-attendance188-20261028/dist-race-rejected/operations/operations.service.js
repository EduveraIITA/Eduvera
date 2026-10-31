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
import { invitationCodeHash, issueInvitationCode } from '../common/invitation-code.js';
import { enqueueInvitation } from "../common/invitation-queue.js";
import { BadRequestException, ConflictException, ForbiddenException, HttpException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { sql } from "kysely";
import { z } from "zod";
import { hashPassword, validatePassword, verifyPassword } from "../auth/password.js";
import { DatabaseService } from "../database/database.service.js";
import { institutionSchoolPermissionForUser } from "../roles/authorization.js";
import { operationalFeeAccess } from "./operational-fee-access.js";
import { STAFF_COVERAGE_RECONCILIATION_PORT, } from "../staff-operations/staff-coverage-reconciliation.service.js";
import { catalogMutationSchema, classSchema, enrollmentSchema, invoiceSchema, parseStudentCsv, paymentSchema, personSchema, rolloverSchema, studentSchema, studentUpdateSchema, subjectSchema, termSchema, uuid } from "./schemas.js";
import { PersonAccountInvitationsService, assertLiveAppAccountControl, invitationWorkContext } from "./person-account-invitations.service.js";
import { LegacyPeopleModelService } from "./legacy-people-model.service.js";
import { FeeLedgerService } from "./fee-ledger.service.js";
import { feeLedgerProjections, feeLedgerQuerySchema } from "./fee-ledger-read.js";
import { config } from "../config.js";
import { sendTransactionalEmail } from "../common/email-transport.js";
import { invitationRecipientProofHash, invitationRecipientProofMatches } from "./invitation-recipient-proof.js";
const digest = (value) => createHash("sha256").update(value).digest("hex");
let OperationsService = class OperationsService {
    db;
    coverage;
    personInvitations;
    legacyPeopleModel;
    feeLedger;
    constructor(db, coverage, personInvitations, legacyPeopleModel, feeLedger) {
        this.db = db;
        this.coverage = coverage;
        this.personInvitations = personInvitations;
        this.legacyPeopleModel = legacyPeopleModel;
        this.feeLedger = feeLedger;
    }
    createSchool() {
        throw new ForbiddenException("Company operators provision institutions through the company console.");
    }
    async authorize(user, schoolId, permission, db = this.db, adminOnly = false) {
        uuid.parse(schoolId);
        const membership = (await sql `SELECT membership.role FROM school_memberships membership
      JOIN users account ON account.id=membership.user_id WHERE membership.school_id=${schoolId}::uuid
        AND membership.user_id=${user.id}::uuid AND membership.is_active AND account.is_active
      ORDER BY (membership.role='admin') DESC LIMIT 1`.execute(db)).rows[0];
        if (!membership || (adminOnly && membership.role !== "admin"))
            throw new ForbiddenException(`School permission ${permission} is required.`);
        if (permission === "fees.manage")
            await operationalFeeAccess(db, user.id, schoolId, db !== this.db);
        else if (membership.role !== "admin")
            await institutionSchoolPermissionForUser(db, user.id, schoolId, permission);
        return membership;
    }
    async audit(db, user, schoolId, action, targetId, metadata = {}) {
        await sql `INSERT INTO school_operations_audit(school_id,actor_id,action,target_id,metadata)
      VALUES (${schoolId}::uuid,${user.id}::uuid,${action},${targetId ?? null}::uuid,${JSON.stringify(metadata)}::jsonb)`.execute(db);
    }
    async enqueuePanelUpdate(db, input) {
        const audience = await sql `SELECT DISTINCT membership.user_id
      FROM school_memberships membership
      JOIN users account ON account.id=membership.user_id AND account.is_active
      WHERE membership.school_id=${input.schoolId}::uuid AND membership.is_active
        AND event_user_is_authorized(
          ${input.schoolId}::uuid,
          ${input.eventType},
          ${JSON.stringify(input.payload)}::jsonb,
          membership.user_id
        )`.execute(db);
        await db.insertInto("event_outbox").values({
            school_id: input.schoolId,
            event_type: input.eventType,
            aggregate_type: input.aggregateType,
            aggregate_id: input.aggregateId,
            audience_user_ids: audience.rows.map((row) => row.user_id),
            payload: input.payload,
            idempotency_key: input.idempotencyKey,
            notification_user_ids: [],
            notification_payload: null,
        }).onConflict((conflict) => conflict.column("idempotency_key").doNothing()).execute();
    }
    async enqueueAccessUpdate(db, input) {
        const admins = await sql `SELECT DISTINCT membership.user_id
      FROM school_memberships membership
      JOIN users account ON account.id=membership.user_id AND account.is_active
      WHERE membership.school_id=${input.schoolId}::uuid AND membership.role='admin' AND membership.is_active`.execute(db);
        await db.insertInto("event_outbox").values({
            school_id: input.schoolId,
            event_type: "staff.access.updated",
            aggregate_type: "school_membership",
            aggregate_id: input.membershipId,
            audience_user_ids: [...new Set([input.affectedUserId, ...admins.rows.map((row) => row.user_id)])],
            payload: {
                school_id: input.schoolId,
                action: input.action,
                affected_user_id: input.affectedUserId,
                refresh: ["staff.access"],
            },
            idempotency_key: `membership-access:${input.membershipId}:${input.mutationId}`,
            notification_user_ids: [],
            notification_payload: null,
        }).execute();
    }
    async enqueuePeopleUpdate(db, input) {
        await this.enqueuePanelUpdate(db, {
            schoolId: input.schoolId,
            eventType: "people.updated",
            aggregateType: input.aggregateType,
            aggregateId: input.aggregateId,
            payload: {
                action: input.action,
                ...(input.studentId ? { student_id: input.studentId } : {}),
                ...(input.classSectionId ? { class_section_id: input.classSectionId } : {}),
                ...input.extra,
                refresh: ["people", "principal.administration", "principal.home", "teacher.home", "parent.home"],
            },
            idempotencyKey: input.idempotencyKey,
        });
    }
    async mutate(user, schoolId, permission, action, work, auditDetails) {
        try {
            return await this.db.transaction().execute(async (db) => {
                // Serialize administrative and financial writes within one school. This
                // also makes preview/confirm imports and last-admin checks race-safe.
                await sql `SELECT pg_advisory_xact_lock(hashtextextended(${schoolId},0))`.execute(db);
                await this.authorize(user, schoolId, permission, db);
                const result = await work(db);
                const details = auditDetails?.(result);
                const inferredTargetId = typeof result === "object" && result !== null && "id" in result && typeof result.id === "string" ? result.id : undefined;
                await this.audit(db, user, schoolId, action, details?.targetId ?? inferredTargetId, details?.metadata);
                return result;
            });
        }
        catch (error) {
            if (error.code === "23505")
                throw new ConflictException("A matching record already exists. Check email, admission number, roll number or reference.");
            throw error;
        }
    }
    async overview(user, schoolId) {
        await this.authorize(user, schoolId, "sis.manage");
        const [school, students, terms, classes, subjects, members, guardians, enrollments, audit, invitations, grants] = await Promise.all([
            this.db.selectFrom("schools").selectAll().where("id", "=", schoolId).executeTakeFirstOrThrow(),
            sql `SELECT s.id,s.admission_number,s.date_of_birth,p.first_name,p.last_name,
        COALESCE(u.email,p.contact_email) AS email,u.is_active,u.onboarding_pending
        FROM students s JOIN school_people p ON p.id=s.person_id AND p.school_id=s.school_id
        LEFT JOIN users u ON u.id=s.user_id WHERE s.school_id=${schoolId}::uuid ORDER BY s.admission_number`.execute(this.db),
            sql `SELECT term.*,
        (SELECT count(*)::int FROM enrollments enrollment WHERE enrollment.term_id=term.id) AS enrollment_count,
        (SELECT count(*)::int FROM timetable_slots slot WHERE slot.term_id=term.id) AS timetable_count,
        (SELECT count(*)::int FROM attendance_registers register WHERE register.term_id=term.id) AS register_count
        FROM academic_terms term WHERE term.school_id=${schoolId}::uuid ORDER BY term.starts_on DESC`.execute(this.db),
            sql `SELECT section.*,
        (SELECT count(*)::int FROM enrollments enrollment WHERE enrollment.class_section_id=section.id) AS enrollment_count,
        (SELECT count(*)::int FROM timetable_slots slot WHERE slot.class_section_id=section.id) AS timetable_count,
        (SELECT count(*)::int FROM class_section_staff_assignments assignment WHERE assignment.class_section_id=section.id) AS assignment_count
        FROM class_sections section WHERE section.school_id=${schoolId}::uuid ORDER BY section.grade,section.section`.execute(this.db),
            sql `SELECT subject.*,
        (SELECT count(*)::int FROM timetable_slots slot WHERE slot.subject_id=subject.id) AS timetable_count,
        (SELECT count(*)::int FROM subject_attendance attendance WHERE attendance.subject_id=subject.id) AS attendance_count,
        (SELECT count(*)::int FROM diary_items diary WHERE diary.subject_id=subject.id) AS diary_count,
        (SELECT count(*)::int FROM day_plan_periods plan_period WHERE plan_period.subject_id=subject.id) AS day_plan_count
        FROM subjects subject WHERE subject.school_id=${schoolId}::uuid ORDER BY subject.name`.execute(this.db),
            sql `SELECT m.id,m.user_id,m.role,m.is_active,u.first_name,u.last_name,u.email FROM school_memberships m JOIN users u ON u.id=m.user_id
        WHERE m.school_id=${schoolId}::uuid ORDER BY u.first_name`.execute(this.db),
            sql `SELECT gr.id,gr.student_id,gr.relationship,gr.is_primary,gr.can_authorize_leave,person.contact_phone AS phone,
        person.first_name,person.last_name,COALESCE(u.email,person.contact_email) AS email
        FROM guardian_relationships gr JOIN parents parent ON parent.id=gr.guardian_id
        JOIN students s ON s.id=gr.student_id
        JOIN guardian_school_profiles profile ON profile.guardian_id=parent.id AND profile.school_id=s.school_id
        JOIN school_people person ON person.id=profile.person_id AND person.school_id=s.school_id
        LEFT JOIN users u ON u.id=parent.user_id WHERE s.school_id=${schoolId}::uuid`.execute(this.db),
            sql `SELECT e.* FROM enrollments e JOIN students s ON s.id=e.student_id WHERE s.school_id=${schoolId}::uuid`.execute(this.db),
            sql `SELECT a.id,a.action,a.target_id,a.metadata,a.created_at,u.first_name,u.last_name FROM school_operations_audit a JOIN users u ON u.id=a.actor_id
        WHERE a.school_id=${schoolId}::uuid ORDER BY a.created_at DESC LIMIT 100`.execute(this.db),
            sql `SELECT id,email,role,expires_at,accepted_at,revoked_at FROM school_invitations WHERE school_id=${schoolId}::uuid ORDER BY created_at DESC LIMIT 100`.execute(this.db),
            sql `SELECT user_id,permission FROM school_access_exceptions WHERE school_id=${schoolId}::uuid
        AND status='active' AND campus_permission_date(${schoolId}::uuid) BETWEEN valid_from AND valid_until`.execute(this.db),
        ]);
        return { school, students: students.rows, terms: terms.rows, classes: classes.rows, subjects: subjects.rows, members: members.rows, guardians: guardians.rows, enrollments: enrollments.rows, audit: audit.rows, invitations: invitations.rows, grants: grants.rows };
    }
    async catalogUsage(db, kind, id) {
        if (kind === "terms") {
            const result = await sql `SELECT
        (SELECT count(*)::int FROM enrollments WHERE term_id=${id}::uuid) AS enrollment_count,
        (SELECT count(*)::int FROM timetable_slots WHERE term_id=${id}::uuid) AS timetable_count,
        (SELECT count(*)::int FROM attendance_registers WHERE term_id=${id}::uuid) AS register_count`.execute(db);
            const counts = result.rows[0];
            return { ...counts, total: counts.enrollment_count + counts.timetable_count + counts.register_count };
        }
        if (kind === "classes") {
            const result = await sql `SELECT
        (SELECT count(*)::int FROM enrollments WHERE class_section_id=${id}::uuid) AS enrollment_count,
        (SELECT count(*)::int FROM timetable_slots WHERE class_section_id=${id}::uuid) AS timetable_count,
        (SELECT count(*)::int FROM class_section_staff_assignments WHERE class_section_id=${id}::uuid) AS assignment_count`.execute(db);
            const counts = result.rows[0];
            return { ...counts, total: counts.enrollment_count + counts.timetable_count + counts.assignment_count };
        }
        const result = await sql `SELECT
      (SELECT count(*)::int FROM timetable_slots WHERE subject_id=${id}::uuid) AS timetable_count,
      (SELECT count(*)::int FROM subject_attendance WHERE subject_id=${id}::uuid) AS attendance_count,
      (SELECT count(*)::int FROM diary_items WHERE subject_id=${id}::uuid) AS diary_count,
      (SELECT count(*)::int FROM day_plan_periods WHERE subject_id=${id}::uuid) AS day_plan_count`.execute(db);
        const counts = result.rows[0];
        return { ...counts, total: counts.timetable_count + counts.attendance_count + counts.diary_count + counts.day_plan_count };
    }
    async enqueueCatalogUpdate(db, schoolId, kind, row, action) {
        const audience = await sql `SELECT DISTINCT membership.user_id
      FROM school_memberships membership
      JOIN users account ON account.id=membership.user_id AND account.is_active
      WHERE membership.school_id=${schoolId}::uuid AND membership.is_active`.execute(db);
        const aggregateType = { terms: "term", classes: "class", subjects: "subject" }[kind];
        await db.insertInto("event_outbox").values({
            school_id: schoolId,
            event_type: "administration.updated",
            aggregate_type: aggregateType,
            aggregate_id: row.id,
            audience_user_ids: audience.rows.map((item) => item.user_id),
            payload: {
                school_id: schoolId,
                catalog_kind: kind,
                action,
                revision: row.revision,
                refresh: ["principal.administration", "principal.timetable", "principal.home", "teacher.home", "student.home", "student.timetable", "parent.home", "parent.timetable"],
            },
            idempotency_key: `administration:${kind}:${row.id}:${row.revision}:${action}`,
            notification_user_ids: [],
            notification_payload: null,
        }).onConflict((conflict) => conflict.column("idempotency_key").doNothing()).execute();
    }
    async saveCatalog(user, schoolId, kind, body, id) {
        if (id)
            uuid.parse(id);
        if (kind !== "terms" && kind !== "classes" && kind !== "subjects")
            throw new NotFoundException();
        const catalogKind = kind;
        const controls = catalogMutationSchema.parse(body);
        if (id && controls.expected_revision === undefined)
            throw new BadRequestException("Refresh this record before editing it.");
        let auditMetadata = { catalog_kind: catalogKind };
        return this.mutate(user, schoolId, "sis.manage", `${catalogKind}.${id ? "updated" : "created"}`, async (db) => {
            const requireReviewedImpact = (usage) => {
                if (!usage.total)
                    return;
                if (!controls.confirmed)
                    throw new BadRequestException(`This record is linked to ${usage.total} school records. Review the impact before saving.`);
                if (controls.change_reason.length < 8)
                    throw new BadRequestException("Explain why this linked school record is changing.");
            };
            const comparable = (value) => {
                if (typeof value === "string")
                    return value;
                if (typeof value === "number" || typeof value === "boolean")
                    return value.toString();
                return "";
            };
            const changed = (current, values, fields) => fields.some((field) => comparable(current[field]) !== comparable(values[field]));
            if (kind === "terms") {
                const data = termSchema.parse(body);
                if (id) {
                    const current = await db.selectFrom("academic_terms").selectAll().where("id", "=", id).where("school_id", "=", schoolId).executeTakeFirst();
                    if (!current)
                        throw new NotFoundException();
                    if (current.revision !== controls.expected_revision)
                        throw new ConflictException("This term changed after you opened it. Refresh and review the latest values.");
                    if (current.academic_year !== data.academic_year)
                        throw new BadRequestException("Create a new term to change the academic year.");
                    const values = { ...data, attendance_threshold: data.attendance_threshold.toFixed(2) };
                    if (!changed(current, values, ["name", "starts_on", "ends_on", "attendance_threshold", "is_active"]))
                        throw new BadRequestException("No term changes were detected.");
                    const usage = await this.catalogUsage(db, catalogKind, id);
                    requireReviewedImpact(usage);
                    const row = await db.updateTable("academic_terms").set({ ...values, updated_by: user.id }).where("id", "=", id).where("revision", "=", controls.expected_revision).returningAll().executeTakeFirst();
                    if (!row)
                        throw new ConflictException("This term changed while it was being saved. Refresh and try again.");
                    auditMetadata = { catalog_kind: catalogKind, revision: row.revision, reason: controls.change_reason, usage };
                    await this.enqueueCatalogUpdate(db, schoolId, catalogKind, row, "updated");
                    return { ...row, ...usage };
                }
                const row = await db.insertInto("academic_terms").values({ ...data, school_id: schoolId, attendance_threshold: data.attendance_threshold.toFixed(2), updated_by: user.id }).returningAll().executeTakeFirstOrThrow();
                auditMetadata = { catalog_kind: catalogKind, revision: row.revision };
                await this.enqueueCatalogUpdate(db, schoolId, catalogKind, row, "created");
                return { ...row, enrollment_count: 0, timetable_count: 0, register_count: 0, total: 0 };
            }
            if (kind === "classes") {
                const data = classSchema.parse(body);
                if (id) {
                    const current = await db.selectFrom("class_sections").selectAll().where("id", "=", id).where("school_id", "=", schoolId).executeTakeFirst();
                    if (!current)
                        throw new NotFoundException();
                    if (current.revision !== controls.expected_revision)
                        throw new ConflictException("This class changed after you opened it. Refresh and review the latest values.");
                    if (current.academic_year !== data.academic_year)
                        throw new BadRequestException("Create a new class for the next academic year.");
                    if (!changed(current, data, ["grade", "section", "board", "room_number"]))
                        throw new BadRequestException("No class changes were detected.");
                    const usage = await this.catalogUsage(db, catalogKind, id);
                    requireReviewedImpact(usage);
                    const row = await db.updateTable("class_sections").set({ ...data, updated_by: user.id }).where("id", "=", id).where("revision", "=", controls.expected_revision).returningAll().executeTakeFirst();
                    if (!row)
                        throw new ConflictException("This class changed while it was being saved. Refresh and try again.");
                    auditMetadata = { catalog_kind: catalogKind, revision: row.revision, reason: controls.change_reason, usage };
                    await this.enqueueCatalogUpdate(db, schoolId, catalogKind, row, "updated");
                    return { ...row, ...usage };
                }
                const row = await db.insertInto("class_sections").values({ ...data, school_id: schoolId, updated_by: user.id }).returningAll().executeTakeFirstOrThrow();
                auditMetadata = { catalog_kind: catalogKind, revision: row.revision };
                await this.enqueueCatalogUpdate(db, schoolId, catalogKind, row, "created");
                return { ...row, enrollment_count: 0, timetable_count: 0, assignment_count: 0, total: 0 };
            }
            const data = subjectSchema.parse(body);
            if (id) {
                const current = await db.selectFrom("subjects").selectAll().where("id", "=", id).where("school_id", "=", schoolId).executeTakeFirst();
                if (!current)
                    throw new NotFoundException();
                if (current.revision !== controls.expected_revision)
                    throw new ConflictException("This subject changed after you opened it. Refresh and review the latest values.");
                if (!changed(current, data, ["code", "name", "short_name", "color", "icon"]))
                    throw new BadRequestException("No subject changes were detected.");
                const usage = await this.catalogUsage(db, catalogKind, id);
                requireReviewedImpact(usage);
                const row = await db.updateTable("subjects").set({ ...data, updated_by: user.id }).where("id", "=", id).where("revision", "=", controls.expected_revision).returningAll().executeTakeFirst();
                if (!row)
                    throw new ConflictException("This subject changed while it was being saved. Refresh and try again.");
                auditMetadata = { catalog_kind: catalogKind, revision: row.revision, reason: controls.change_reason, usage };
                await this.enqueueCatalogUpdate(db, schoolId, catalogKind, row, "updated");
                return { ...row, ...usage };
            }
            const row = await db.insertInto("subjects").values({ ...data, school_id: schoolId, updated_by: user.id }).returningAll().executeTakeFirstOrThrow();
            auditMetadata = { catalog_kind: catalogKind, revision: row.revision };
            await this.enqueueCatalogUpdate(db, schoolId, catalogKind, row, "created");
            return { ...row, timetable_count: 0, attendance_count: 0, diary_count: 0, day_plan_count: 0, total: 0 };
        }, (result) => {
            const targetId = typeof result === "object" && result !== null && "id" in result && typeof result.id === "string" ? result.id : undefined;
            return { ...(targetId ? { targetId } : {}), metadata: auditMetadata };
        });
    }
    async checkEnrollment(db, schoolId, classId, termId) {
        const row = await sql `SELECT c.id FROM class_sections c JOIN academic_terms t ON t.school_id=c.school_id AND t.academic_year=c.academic_year
      WHERE c.id=${classId}::uuid AND t.id=${termId}::uuid AND c.school_id=${schoolId}::uuid AND t.is_active`.execute(db);
        if (!row.rows.length)
            throw new BadRequestException("Class and active term must belong to this school and academic year.");
    }
    async schoolStudent(db, schoolId, studentId) {
        uuid.parse(studentId);
        const student = await db.selectFrom("students").selectAll().where("id", "=", studentId).where("school_id", "=", schoolId).executeTakeFirst();
        if (!student)
            throw new NotFoundException("Student not found in this school.");
        return student;
    }
    async createStudent(db, schoolId, data, id = randomUUID()) {
        await this.checkEnrollment(db, schoolId, data.class_section_id, data.term_id);
        // An unguessable hash is deliberately not a usable initial password.
        const user = await sql `INSERT INTO users(username,email,password_hash,first_name,last_name,role,onboarding_pending)
      VALUES (${`student.${randomUUID()}`},${data.email},${digest(randomBytes(32).toString("hex"))},${data.first_name},${data.last_name},'student',true) RETURNING id`.execute(db);
        const userId = user.rows[0].id;
        const student = await db.insertInto("students").values({ id, user_id: userId, school_id: schoolId, admission_number: data.admission_number, date_of_birth: data.date_of_birth, blood_group: null, emergency_contact: null }).returningAll().executeTakeFirstOrThrow();
        await db.insertInto("school_memberships").values({ user_id: userId, school_id: schoolId, role: "student" }).execute();
        await db.insertInto("enrollments").values({ student_id: student.id, class_section_id: data.class_section_id, term_id: data.term_id, roll_number: data.roll_number }).execute();
        return student;
    }
    async student(user, schoolId, body, id) {
        return this.mutate(user, schoolId, "sis.manage", `student.${id ? "updated" : "created"}`, async (db) => {
            if (!id) {
                const data = studentSchema.parse(body);
                if (!this.legacyPeopleModel)
                    throw new ConflictException("The reviewed People identity path is unavailable.");
                const targetId = randomUUID();
                const model = await this.legacyPeopleModel.prepare(db, { schoolId, actorId: user.id, kind: "student", targetId,
                    label: `${data.first_name} ${data.last_name}`, currentRevision: 0, operation: "people.legacy_student.create", payload: data });
                const created = await this.createStudent(db, schoolId, data, targetId);
                await this.enqueuePeopleUpdate(db, {
                    schoolId, aggregateType: "student", aggregateId: created.id, action: "student_created",
                    studentId: created.id, classSectionId: data.class_section_id,
                    extra: { term_id: data.term_id }, idempotencyKey: `student:${created.id}:created`,
                });
                await this.legacyPeopleModel.complete(db, model, [{ id: created.person_id, first_name: data.first_name, last_name: data.last_name }], `student:${created.id}:created`);
                return created;
            }
            const student = await this.schoolStudent(db, schoolId, id);
            const data = studentUpdateSchema.parse(body);
            // This compatibility route owns enrollment details, never the campus person
            // or a linked global account. Name corrections have one revision-checked,
            // reasoned command in People, including for people without app accounts.
            const person = await db.selectFrom("school_people").select(["first_name", "last_name"])
                .where("id", "=", student.person_id).where("school_id", "=", schoolId).executeTakeFirstOrThrow();
            if (data.first_name !== undefined && data.first_name !== person.first_name
                || data.last_name !== undefined && data.last_name !== (person.last_name ?? "")) {
                throw new ConflictException("Correct this person's name from their People profile with its current revision and a reason. Admission number and birth date can be updated here.");
            }
            const updated = await db.updateTable("students").set({ admission_number: data.admission_number, date_of_birth: data.date_of_birth }).where("id", "=", student.id).returningAll().executeTakeFirstOrThrow();
            await this.enqueuePeopleUpdate(db, {
                schoolId, aggregateType: "student", aggregateId: updated.id, action: "student_updated",
                studentId: updated.id, idempotencyKey: `student:${updated.id}:updated:${randomUUID()}`,
            });
            return updated;
        });
    }
    async importStudents(user, schoolId, body) {
        const { csv, confirm } = z.object({ csv: z.string().max(250_000), confirm: z.boolean().default(false) }).parse(body);
        await this.authorize(user, schoolId, "sis.manage");
        let records;
        try {
            records = parseStudentCsv(csv);
        }
        catch (error) {
            throw new BadRequestException(error.message);
        }
        const rows = records.map((record, index) => {
            const result = studentSchema.safeParse(record);
            if (!result.success)
                throw new BadRequestException(`CSV row ${index + 2}: ${result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
            return result.data;
        });
        return this.mutate(user, schoolId, "sis.manage", confirm ? "students.imported" : "students.import_preview", async (db) => {
            const seen = new Set();
            for (const row of rows) {
                await this.checkEnrollment(db, schoolId, row.class_section_id, row.term_id);
                for (const key of [`email:${row.email}`, `admission:${row.admission_number}`, `roll:${row.class_section_id}:${row.term_id}:${row.roll_number}`]) {
                    if (seen.has(key))
                        throw new ConflictException(`Duplicate ${key.split(":")[0]} in CSV.`);
                    seen.add(key);
                }
                const conflict = await sql `SELECT 1 FROM users WHERE lower(email)=${row.email}
          UNION ALL SELECT 1 FROM students WHERE school_id=${schoolId}::uuid AND admission_number=${row.admission_number}
          UNION ALL SELECT 1 FROM enrollments WHERE class_section_id=${row.class_section_id}::uuid AND term_id=${row.term_id}::uuid AND roll_number=${row.roll_number}`.execute(db);
                if (conflict.rows.length)
                    throw new ConflictException(`Existing email, admission or roll number for ${row.admission_number}. No students imported.`);
            }
            if (confirm) {
                if (!this.legacyPeopleModel)
                    throw new ConflictException("The reviewed People identity path is unavailable.");
                const importId = randomUUID();
                const model = await this.legacyPeopleModel.prepare(db, { schoolId, actorId: user.id, kind: "people_import", targetId: importId,
                    label: "Reviewed compatibility enrollment import", currentRevision: 0, operation: "people.legacy_student.import", payload: rows });
                const created = [];
                const people = [];
                for (const row of rows) {
                    const student = await this.createStudent(db, schoolId, row);
                    created.push(student.id);
                    people.push({ id: student.person_id, first_name: row.first_name, last_name: row.last_name });
                }
                await this.enqueuePeopleUpdate(db, {
                    schoolId, aggregateType: "people_import", aggregateId: importId, action: "students_imported",
                    extra: { count: created.length }, idempotencyKey: `students-imported:${schoolId}:${importId}`,
                });
                await this.legacyPeopleModel.complete(db, model, people, `students-imported:${schoolId}:${importId}`);
            }
            return { confirmed: confirm, count: rows.length, students: rows.map(({ first_name, last_name, admission_number }) => ({ first_name, last_name, admission_number })) };
        });
    }
    async enroll(user, schoolId, body) {
        const data = enrollmentSchema.parse(body);
        return this.mutate(user, schoolId, "sis.manage", "student.enrolled", async (db) => {
            await this.schoolStudent(db, schoolId, data.student_id);
            await this.checkEnrollment(db, schoolId, data.class_section_id, data.term_id);
            const enrollment = await db.insertInto("enrollments").values(data).returningAll().executeTakeFirstOrThrow();
            await this.enqueuePeopleUpdate(db, {
                schoolId, aggregateType: "enrollment", aggregateId: enrollment.id, action: "student_enrolled",
                studentId: data.student_id, classSectionId: data.class_section_id,
                extra: { term_id: data.term_id, enrollment_revision: enrollment.revision },
                idempotencyKey: `enrollment:${enrollment.id}:${enrollment.revision}:created`,
            });
            return enrollment;
        });
    }
    async rollover(user, schoolId, body) {
        const data = rolloverSchema.parse(body);
        return this.mutate(user, schoolId, "sis.manage", data.confirm ? "term.promoted" : "term.promotion_preview", async (db) => {
            const source = await db.selectFrom("academic_terms").selectAll().where("id", "=", data.source_term_id).where("school_id", "=", schoolId).executeTakeFirst();
            const target = await db.selectFrom("academic_terms").selectAll().where("id", "=", data.target_term_id).where("school_id", "=", schoolId).where("is_active", "=", true).executeTakeFirst();
            if (!source || !target || target.starts_on <= source.ends_on)
                throw new BadRequestException("Target term must start after the source term ends.");
            const preview = [];
            for (const mapping of data.mappings) {
                const from = await db.selectFrom("class_sections").select("id").where("id", "=", mapping.from_class_id).where("school_id", "=", schoolId).where("academic_year", "=", source.academic_year).executeTakeFirst();
                if (!from)
                    throw new BadRequestException("Source class must belong to the source school and year.");
                await this.checkEnrollment(db, schoolId, mapping.to_class_id, target.id);
                const students = await db.selectFrom("enrollments").select(["student_id", "roll_number"]).where("class_section_id", "=", from.id).where("term_id", "=", source.id).where("is_active", "=", true).orderBy("roll_number").execute();
                for (const student of students)
                    preview.push({ ...student, class_section_id: mapping.to_class_id, term_id: target.id });
            }
            const rolls = new Set();
            for (const row of preview) {
                const key = `${row.class_section_id}:${row.roll_number}`;
                if (rolls.has(key))
                    throw new ConflictException("Merged classes have overlapping roll numbers. Promote them separately after assigning distinct rolls.");
                rolls.add(key);
                const conflict = await db.selectFrom("enrollments").select("id").where("term_id", "=", target.id)
                    .where((eb) => eb.or([eb("student_id", "=", row.student_id), eb.and([eb("class_section_id", "=", row.class_section_id), eb("roll_number", "=", row.roll_number)])])).executeTakeFirst();
                if (conflict)
                    throw new ConflictException("Target enrollments already exist. No changes were made.");
            }
            if (data.confirm && preview.length) {
                await db.insertInto("enrollments").values(preview).execute();
                await this.enqueuePeopleUpdate(db, {
                    schoolId, aggregateType: "academic_term", aggregateId: target.id, action: "term_rollover_completed",
                    extra: { source_term_id: source.id, target_term_id: target.id, enrollment_count: preview.length },
                    idempotencyKey: `term-rollover:${source.id}:${target.id}:${randomUUID()}`,
                });
            }
            // Historical enrollments remain intact; date-aware readers select the term.
            return { confirmed: data.confirm, count: preview.length, enrollments: preview };
        });
    }
    async invitationWorkspace(user, schoolId) {
        const authority = await this.authorize(user, schoolId, "members.invite");
        const invitations = await sql `SELECT id,email,role,expires_at,accepted_at,revoked_at,
      (SELECT id FROM invitation_email_jobs j WHERE j.invitation_id=school_invitations.id AND j.token_hash=school_invitations.token_hash) AS delivery_job_id,
      (SELECT delivery_state FROM invitation_email_jobs j WHERE j.invitation_id=school_invitations.id AND j.token_hash=school_invitations.token_hash) AS delivery FROM school_invitations
      WHERE school_id=${schoolId}::uuid AND (${authority.role}='admin' OR (role<>'admin' AND source='school')) ORDER BY created_at DESC LIMIT 100`.execute(this.db);
        const students = await sql `SELECT s.id,s.admission_number,concat_ws(' ',p.first_name,p.last_name) AS name,coalesce(u.email,p.contact_email) AS email
      FROM students s JOIN school_people p ON p.id=s.person_id LEFT JOIN users u ON u.id=s.user_id WHERE s.school_id=${schoolId}::uuid ORDER BY p.first_name`.execute(this.db);
        const guardians = await sql `SELECT g.guardian_id AS id,concat_ws(' ',p.first_name,p.last_name) AS name,coalesce(u.email,p.contact_email) AS email
      FROM guardian_school_profiles g JOIN school_people p ON p.id=g.person_id JOIN parents parent ON parent.id=g.guardian_id
      LEFT JOIN users u ON u.id=parent.user_id WHERE g.school_id=${schoolId}::uuid ORDER BY p.first_name`.execute(this.db);
        const staff = await sql `SELECT person.id,trim(concat_ws(' ',person.first_name,person.last_name)) AS name,
      person.contact_email AS email,profile.status,profile.staff_code,profile.designation
      FROM staff_profiles profile JOIN school_people person ON person.school_id=profile.school_id AND person.id=profile.person_id
      WHERE profile.school_id=${schoolId}::uuid AND profile.status IN ('onboarding','active') AND person.retired_at IS NULL
        AND profile.user_id IS NULL AND person.account_user_id IS NULL
      ORDER BY person.first_name,person.last_name,person.id`.execute(this.db);
        const unlinked = this.personInvitations ? await this.db.transaction().execute(tx => this.personInvitations.unlinkedPersonIdsInTransaction(tx, schoolId, staff.rows.map(person => person.id))) : [];
        return { invitations: invitations.rows, students: students.rows, guardians: guardians.rows, staff: staff.rows.filter(person => unlinked.includes(person.id)), roles: [], can_invite_admin: authority.role === 'admin' };
    }
    async invite(user, schoolId, body) {
        if (typeof body === "object" && body !== null && "role" in body && body.role === "member") {
            if (!this.personInvitations)
                throw new ConflictException("Person app invitations are unavailable.");
            return this.personInvitations.create(user, schoolId, body);
        }
        assertLiveAppAccountControl();
        const data = z.object({ email: z.email().trim().toLowerCase(), role: z.enum(["student", "guardian", "staff", "admin"]), student_id: uuid.optional(), guardian_id: uuid.optional(), person_id: uuid.optional() }).strict().parse(body);
        const invitation = await this.mutate(user, schoolId, "members.invite", "invitation.created", async (db) => {
            const authority = await this.authorize(user, schoolId, "members.invite", db);
            if (data.role === 'admin' && authority.role !== 'admin')
                throw new ForbiddenException('Only institution administrators can invite administrators.');
            if ((data.student_id && data.role !== 'student') || (data.guardian_id && data.role !== 'guardian') || (data.person_id && data.role !== 'staff'))
                throw new BadRequestException('Invitation target does not match its account type.');
            if (data.role === 'staff') {
                if (!data.person_id)
                    throw new ConflictException({ code: 'staff_invitation_person_required',
                        message: 'Choose the staff person before inviting app access. Add their work profile in People if it is not listed.' });
                await this.requireUnlinkedStaffInvitationTarget(db, schoolId, data.person_id);
            }
            const pendingElsewhere = await sql `SELECT 1 FROM users u WHERE lower(u.email)=${data.email} AND u.onboarding_pending
        AND NOT EXISTS (SELECT 1 FROM school_memberships m WHERE m.user_id=u.id AND m.school_id=${schoolId}::uuid AND m.is_active)`.execute(db);
            if (pendingElsewhere.rows.length)
                throw new ConflictException("This account must complete its original school onboarding before joining another school.");
            let studentId = data.student_id;
            if (data.role === 'student') {
                const found = await sql `SELECT s.id FROM students s LEFT JOIN users u ON u.id=s.user_id WHERE s.school_id=${schoolId}::uuid
          AND (${studentId ?? null}::uuid IS NULL OR s.id=${studentId ?? null}::uuid) AND (lower(u.email)=${data.email} OR (${studentId ?? null}::uuid IS NOT NULL AND s.user_id IS NULL))`.execute(db);
                if (!found.rows.length)
                    throw new BadRequestException('Select a student record from this institution before issuing its invitation.');
                studentId = found.rows[0].id;
            }
            if (data.guardian_id && !(await sql `SELECT 1 FROM guardian_school_profiles g JOIN parents p ON p.id=g.guardian_id LEFT JOIN users u ON u.id=p.user_id WHERE g.school_id=${schoolId}::uuid AND g.guardian_id=${data.guardian_id}::uuid AND (p.user_id IS NULL OR lower(u.email)=${data.email})`.execute(db)).rows.length)
                throw new BadRequestException('Guardian record must belong to this institution and email.');
            const { token, tokenHash } = await issueInvitationCode(db, data.email);
            await sql `UPDATE school_invitations SET revoked_at=now() WHERE school_id=${schoolId}::uuid AND email=${data.email} AND accepted_at IS NULL AND revoked_at IS NULL AND (${authority.role}='admin' OR role<>'admin')`.execute(db);
            const result = await sql `INSERT INTO school_invitations(school_id,email,role,token_hash,created_by,expires_at,student_id,guardian_id,person_id)
        VALUES(${schoolId}::uuid,${data.email},${data.role},${tokenHash},${user.id}::uuid,now()+interval '30 minutes',${studentId ?? null}::uuid,${data.guardian_id ?? null}::uuid,${data.person_id ?? null}::uuid) RETURNING id,expires_at`.execute(db);
            const ready = await enqueueInvitation(db, { ...result.rows[0], email: data.email, token });
            await this.enqueuePanelUpdate(db, {
                schoolId,
                eventType: "administration.updated",
                aggregateType: "school_invitation",
                aggregateId: result.rows[0].id,
                payload: { action: "invitation_created", refresh: ["principal.administration"] },
                idempotencyKey: `invitation:${result.rows[0].id}:created`,
            });
            return ready;
        });
        return invitation;
    }
    async requireUnlinkedStaffInvitationTarget(db, schoolId, personId) {
        const staff = (await sql `SELECT profile.id FROM staff_profiles profile
      JOIN school_people person ON person.school_id=profile.school_id AND person.id=profile.person_id
      WHERE profile.school_id=${schoolId}::uuid AND profile.person_id=${personId}::uuid
        AND profile.status IN ('onboarding','active') AND person.retired_at IS NULL
        AND profile.user_id IS NULL AND person.account_user_id IS NULL
      FOR SHARE OF profile,person`.execute(db)).rows[0];
        if (!staff)
            throw new ConflictException('Choose a current staff person without app access from this institution. Manage existing access in People.');
        if (!this.personInvitations || !(await this.personInvitations.unlinkedPersonIdsInTransaction(db, schoolId, [personId])).includes(personId))
            throw new ConflictException('This person has retained app access. Review its People profile instead of replacing that identity.');
    }
    async resendInvitation(user, schoolId, id) {
        uuid.parse(id);
        const scoped = await this.personInvitations?.resendWork(user, schoolId, id);
        if (scoped)
            return scoped;
        const invitation = await this.mutate(user, schoolId, "members.invite", "invitation.email_resent", async (db) => {
            const authority = await this.authorize(user, schoolId, "members.invite", db);
            const found = (await sql `
        SELECT id,email,role,source,created_at,created_by,person_id,custom_role_id,
          CASE WHEN role='member' THEN coalesce((SELECT max(audit.created_at) FROM school_operations_audit audit
            WHERE audit.school_id=school_invitations.school_id AND audit.target_id=school_invitations.id
              AND audit.action='invitation.email_resent'),created_at) ELSE created_at END AS last_sent_at
        FROM school_invitations
        WHERE id=${id}::uuid AND school_id=${schoolId}::uuid AND accepted_at IS NULL AND revoked_at IS NULL
        FOR UPDATE`.execute(db)).rows[0];
            if (!found)
                throw new NotFoundException('This invitation was accepted or revoked. Refresh the invitation list.');
            if (found.role === 'member') {
                assertLiveAppAccountControl();
                if (!this.personInvitations)
                    throw new ConflictException("Person app invitations are unavailable.");
                await this.personInvitations.assertInviterIdentity(db, schoolId, user.id);
                await this.personInvitations.assertResendable(db, { ...found, school_id: schoolId });
            }
            if (authority.role !== 'admin' && (found.role === 'admin' || found.source !== 'school')) {
                throw new ForbiddenException('Only institution administrators can resend this invitation.');
            }
            if (found.role === 'staff' && !found.custom_role_id) {
                assertLiveAppAccountControl();
                if (!found.person_id)
                    throw new ConflictException({ code: 'staff_invitation_person_review_required',
                        message: 'This older work invitation has no confirmed campus person. Reissue app access from the People profile.' });
                await this.requireUnlinkedStaffInvitationTarget(db, schoolId, found.person_id);
            }
            if (executionNow().getTime() - new Date(found.last_sent_at).getTime() < 60_000) {
                throw new ConflictException('Please wait one minute before sending this invitation again.');
            }
            const { token, tokenHash } = await issueInvitationCode(db, found.email);
            const row = (await sql `UPDATE school_invitations
        SET token_hash=${tokenHash},expires_at=now()+interval '30 minutes',created_at=CASE WHEN role='member' THEN created_at ELSE now() END,
          recipient_proof_hash=NULL,recipient_proof_expires_at=NULL,recipient_proof_sent_at=NULL
        WHERE id=${id}::uuid AND school_id=${schoolId}::uuid RETURNING id,expires_at`.execute(db)).rows[0];
            const ready = await enqueueInvitation(db, { ...row, email: found.email, token });
            await this.enqueuePanelUpdate(db, {
                schoolId,
                eventType: "administration.updated",
                aggregateType: "school_invitation",
                aggregateId: row.id,
                payload: { action: "invitation_resent", refresh: ["principal.administration"] },
                idempotencyKey: `invitation:${row.id}:resent:${tokenHash}`,
            });
            return ready;
        });
        return invitation;
    }
    async currentInvitationIssuer(db, invite) {
        if (invitationWorkContext(invite)) {
            if (!this.personInvitations || invite.role !== 'member' || !invite.person_id)
                throw new ForbiddenException('The assigned-work invitation needs its exact campus person.');
            await this.personInvitations.assertWorkIssuer(db, { ...invite, person_id: invite.person_id });
            return;
        }
        if (invite.source === 'company') {
            if (!(await sql `SELECT 1 FROM company_operators operator JOIN users account ON account.id=operator.user_id
        WHERE operator.user_id=${invite.created_by}::uuid AND operator.is_active AND account.is_active
        FOR SHARE OF operator,account`.execute(db)).rows.length)
                throw new ForbiddenException('The company inviter no longer has operator access.');
            return;
        }
        const inviter = (await sql `SELECT membership.role FROM school_memberships membership
      JOIN users account ON account.id=membership.user_id WHERE membership.user_id=${invite.created_by}::uuid
        AND membership.school_id=${invite.school_id}::uuid AND membership.is_active AND account.is_active
      ORDER BY (membership.role='admin') DESC LIMIT 1 FOR SHARE OF membership,account`.execute(db)).rows[0];
        if (!inviter)
            throw new ForbiddenException('The inviter no longer has permission for this invitation.');
        if (inviter.role !== 'admin')
            await institutionSchoolPermissionForUser(db, invite.created_by, invite.school_id, 'members.invite');
        if ((invite.role === 'admin' || invite.custom_role_id) && inviter.role !== 'admin')
            throw new ForbiddenException('Only administrators can assign staff roles or invite administrators.');
        if (invite.role === 'member') {
            if (!this.personInvitations)
                throw new ConflictException('Person app invitations are unavailable.');
            await this.personInvitations.assertInviterIdentity(db, invite.school_id, invite.created_by);
        }
    }
    /** Independent mailbox proof for neutral joining only; never a credential-bearing preview. */
    async recipientProof(body) {
        assertLiveAppAccountControl();
        const data = z.object({ email: z.email().trim().toLowerCase().max(254),
            token: z.string().trim().regex(/^(?:\d{6}|[A-Za-z0-9_-]{40,100})$/) }).strict().parse(body);
        // Independent durable bucket: failed lookups or rolled-back mail state cannot reset it.
        const bucketKey = digest(`invitation-recipient-proof:${data.email}`);
        const attempts = (await sql `INSERT INTO api_rate_limit_buckets(bucket_key,hits,expires_at)
      VALUES(${bucketKey},1,now()+interval '15 minutes') ON CONFLICT(bucket_key) DO UPDATE SET
      hits=CASE WHEN api_rate_limit_buckets.expires_at<=now() THEN 1 ELSE api_rate_limit_buckets.hits+1 END,
      expires_at=CASE WHEN api_rate_limit_buckets.expires_at<=now() THEN excluded.expires_at ELSE api_rate_limit_buckets.expires_at END
      RETURNING hits`.execute(this.db)).rows[0];
        if (attempts.hits > 10)
            throw new HttpException('Too many confirmation requests. Wait 15 minutes before trying again.', 429);
        const tokenHash = invitationCodeHash(data.email, data.token);
        const prepared = await this.db.transaction().execute(async (db) => {
            const candidate = (await sql `SELECT school_id FROM school_invitations WHERE token_hash=${tokenHash}`.execute(db)).rows[0];
            if (!candidate)
                throw new BadRequestException('Invitation is invalid, expired or already used.');
            await sql `SELECT pg_advisory_xact_lock(hashtextextended(${candidate.school_id},0))`.execute(db);
            const invite = (await sql `
        SELECT id,school_id,email,role,source,created_by,custom_role_id,person_id,expires_at,
          recipient_proof_hash,recipient_proof_expires_at,recipient_proof_sent_at,access_scope,work_source_kind,work_source_id,work_access_id,work_visit_access_id FROM school_invitations
        WHERE token_hash=${tokenHash} AND email=${data.email} AND expires_at>now()
          AND accepted_at IS NULL AND revoked_at IS NULL FOR UPDATE`.execute(db)).rows[0];
            if (!invite)
                throw new BadRequestException('Invitation is invalid, expired or already used.');
            await this.currentInvitationIssuer(db, invite);
            const campus = await db.selectFrom('schools').select(['id', 'name']).where('id', '=', invite.school_id).executeTakeFirstOrThrow();
            const sourceContext = invitationWorkContext(invite) ? { invitation_id: invite.id } : {};
            if (invite.role !== 'member')
                return { response: { campus, verification_required: false, delivery: 'not_required' } };
            await this.personInvitations.assertResendable(db, invite);
            const account = await db.selectFrom('users').select('email_verified_at')
                .where(sql `lower(email)`, '=', data.email).executeTakeFirst();
            if (account?.email_verified_at)
                return { response: { campus, ...sourceContext, verification_required: false, delivery: 'not_required' } };
            if (!config().INVITATION_EMAIL_ENABLED)
                return { response: { campus, ...sourceContext, verification_required: true, delivery: 'unavailable' } };
            const now = executionNow();
            if (invite.recipient_proof_sent_at && now.getTime() - invite.recipient_proof_sent_at.getTime() < 60_000) {
                const retry = Math.max(1, Math.ceil((invite.recipient_proof_sent_at.getTime() + 60_000 - now.getTime()) / 1000));
                const available = invite.recipient_proof_hash && invite.recipient_proof_expires_at && invite.recipient_proof_expires_at > now;
                return { response: { campus, ...sourceContext, verification_required: true, delivery: available ? 'cooldown' : 'unavailable', retry_after_seconds: retry } };
            }
            let code;
            do {
                code = String(randomInt(0, 1_000_000)).padStart(6, '0');
            } while (code === data.token);
            const hash = invitationRecipientProofHash(invite.id, tokenHash, code);
            const expiresAt = new Date(Math.min(now.getTime() + 10 * 60_000, invite.expires_at.getTime()));
            await sql `UPDATE school_invitations SET recipient_proof_hash=${hash},recipient_proof_expires_at=${expiresAt},recipient_proof_sent_at=${now}
        WHERE id=${invite.id}::uuid`.execute(db);
            return { response: { campus, ...sourceContext, verification_required: true, delivery: 'email_accepted', retry_after_seconds: 60 },
                mail: { id: invite.id, hash, code, expiresAt } };
        });
        if (!prepared.mail)
            return prepared.response;
        try {
            await sendTransactionalEmail({ to: data.email, senderName: 'ThatCampus', subject: 'Confirm your campus invitation',
                text: `Your confirmation code is: ${prepared.mail.code}\n\nEnter it in the ThatCampus invitation you are accepting for ${prepared.response.campus.name}. It expires at ${prepared.mail.expiresAt.toISOString()}.\n\nDo not share this code. If you did not request it, ignore this message.` });
            return prepared.response;
        }
        catch {
            // An uncertain send never becomes mailbox proof. Preserve the send cooldown, not the code.
            await sql `UPDATE school_invitations SET recipient_proof_hash=NULL,recipient_proof_expires_at=NULL
        WHERE id=${prepared.mail.id}::uuid AND token_hash=${tokenHash} AND recipient_proof_hash=${prepared.mail.hash}`.execute(this.db);
            return { ...prepared.response, delivery: 'unavailable', retry_after_seconds: 60 };
        }
    }
    async acceptInvite(body) {
        // Account possession, credentials and membership are a Live control-plane
        // ceremony, never a run-local provider effect or borrowed Live secret.
        assertLiveAppAccountControl();
        const data = personSchema.extend({ last_name: z.string().trim().max(150).default(''),
            token: z.string().trim().regex(/^(?:\d{6}|[A-Za-z0-9_-]{40,100})$/), password: z.string().min(1).max(128), recipient_proof: z.string().trim().regex(/^\d{6}$/).optional(),
            confirm_admin_person: z.boolean().default(false), recover_accepted: z.boolean().default(false) }).parse(body);
        // Commit attempts independently so failed acceptance cannot undo the limit.
        const bucketKey = digest('invitation-email:' + data.email);
        const attempts = (await sql `INSERT INTO api_rate_limit_buckets(bucket_key,hits,expires_at)
      VALUES(${bucketKey},1,now()+interval '15 minutes') ON CONFLICT(bucket_key) DO UPDATE SET
      hits=CASE WHEN api_rate_limit_buckets.expires_at<=now() THEN 1 ELSE api_rate_limit_buckets.hits+1 END,
      expires_at=CASE WHEN api_rate_limit_buckets.expires_at<=now() THEN excluded.expires_at ELSE api_rate_limit_buckets.expires_at END
      RETURNING hits`.execute(this.db)).rows[0];
        if (attempts.hits > 5)
            throw new HttpException('Too many invitation attempts. Wait 15 minutes before trying again.', 429);
        const tokenHash = invitationCodeHash(data.email, data.token);
        return this.db.transaction().execute(async (db) => {
            const candidate = await sql `SELECT school_id FROM school_invitations WHERE token_hash=${tokenHash}`.execute(db);
            if (!candidate.rows[0])
                throw new BadRequestException("Invitation is invalid, expired or already used.");
            await sql `SELECT pg_advisory_xact_lock(hashtextextended(${candidate.rows[0].school_id},0))`.execute(db);
            const found = await sql `SELECT id,school_id,email,role,source,created_by,student_id,guardian_id,custom_role_id,person_id,recipient_proof_hash,recipient_proof_expires_at,accepted_at,accepted_by_user_id,
          access_scope,work_source_kind,work_source_id,work_access_id,work_visit_access_id FROM school_invitations
        WHERE token_hash=${tokenHash} AND expires_at>now() AND revoked_at IS NULL
          AND (accepted_at IS NULL OR ${data.recover_accepted} AND role='member') FOR UPDATE`.execute(db);
            const invite = found.rows[0];
            if (!invite || invite.email !== data.email)
                throw new BadRequestException("Invitation is invalid, expired or already used.");
            if (invite.role === 'staff' && invite.source === 'school' && !invite.person_id && !invite.custom_role_id)
                throw new ConflictException({ code: 'staff_invitation_person_review_required',
                    message: 'This older work invitation has no confirmed campus person. Ask the administrator to reissue app access from the People profile.' });
            if (invite.role === 'student' && !invite.student_id)
                throw new ConflictException('Choose the exact learner record before accepting student app access. Ask the administrator to reissue this invitation.');
            if (invite.role === "member") {
                if (!this.personInvitations)
                    throw new ConflictException("Person app invitations are unavailable.");
                this.personInvitations.assertLive();
            }
            // An accepted visit locator follows its still-current exact sharing root,
            // not the former coordinator's job. Pending joining still needs its issuer.
            const acceptedVisitRecovery = Boolean(invite.accepted_at && data.recover_accepted
                && invitationWorkContext(invite)?.kind === 'visit_arrangement');
            if (!acceptedVisitRecovery)
                await this.currentInvitationIssuer(db, invite);
            if (data.recover_accepted && !invite.accepted_at)
                throw new ConflictException({ code: 'invitation_acceptance_not_confirmed',
                    message: 'Joining has not been confirmed. Review the invitation before accepting it.' });
            if (invite.accepted_at) {
                if (!data.recover_accepted || invite.role !== 'member' || !invite.person_id || !invite.accepted_by_user_id || !this.personInvitations)
                    throw new BadRequestException('Invitation is invalid, expired or already used.');
                const accepted = (await sql `SELECT account.id,account.password_hash
          FROM users account JOIN school_people person ON person.account_user_id=account.id
            AND person.school_id=${invite.school_id}::uuid AND person.id=${invite.person_id}::uuid AND person.retired_at IS NULL
          JOIN school_memberships membership ON membership.school_id=person.school_id AND membership.user_id=account.id
            AND membership.role='member' AND membership.is_active
          WHERE account.id=${invite.accepted_by_user_id}::uuid AND lower(account.email)=${data.email}
            AND account.is_active AND account.email_verified_at IS NOT NULL
          FOR SHARE OF account,person,membership`.execute(db)).rows[0];
                if (!accepted || !await verifyPassword(data.password, accepted.password_hash))
                    throw new ForbiddenException('The accepted invitation could not be confirmed. Sign in or ask the campus to review access.');
                await this.personInvitations.assertActiveAcceptedRecipient(db, { school_id: invite.school_id, person_id: invite.person_id, user_id: accepted.id });
                const continuation = await this.personInvitations.acceptedContinuation(db, invite, accepted.id);
                return { accepted: true, accepted_user_id: accepted.id, school_id: invite.school_id, role: invite.role,
                    ...(continuation ? { continuation } : {}),
                    message: 'School access is ready. Sign in with your email and password.' };
            }
            let account = await sql `SELECT id,password_hash,onboarding_pending,is_active,email_verified_at FROM users WHERE lower(email)=${data.email} FOR UPDATE`.execute(db);
            let accountId = account.rows[0]?.id;
            if (account.rows[0] && !account.rows[0].is_active)
                throw new ForbiddenException("This account is inactive.");
            if (invite.role === "member" && account.rows[0]?.onboarding_pending)
                throw new ConflictException("Finish or recover the original account before accepting this invitation.");
            if (invite.role === "member" && accountId && (await sql `SELECT 1 FROM school_memberships
        WHERE school_id=${invite.school_id}::uuid AND user_id=${accountId}::uuid`.execute(db)).rows.length)
                throw new ConflictException("This email already has campus access. Ask the administrator to review its existing person.");
            if (invite.role === 'member' && !account.rows[0]?.email_verified_at) {
                if (!data.recipient_proof)
                    throw new ForbiddenException({ code: 'recipient_verification_required', message: 'Confirm this invitation with the separate code sent to your email.' });
                if (!invite.recipient_proof_expires_at || invite.recipient_proof_expires_at <= executionNow()
                    || !invitationRecipientProofMatches(invite.recipient_proof_hash, invite.id, tokenHash, data.recipient_proof))
                    throw new ForbiddenException({ code: 'recipient_verification_failed', message: 'The email confirmation code is invalid or expired. Request another code.' });
            }
            if (account.rows[0] && !account.rows[0].onboarding_pending) {
                if (!await verifyPassword(data.password, account.rows[0].password_hash))
                    throw new ForbiddenException("Enter your existing account password to accept this invitation.");
            }
            else {
                const errors = validatePassword(data.password, { email: data.email, firstName: data.first_name, lastName: data.last_name });
                if (errors.length)
                    throw new BadRequestException(errors.join(" "));
                const password = await hashPassword(data.password);
                if (accountId)
                    await sql `UPDATE users SET password_hash=${password},onboarding_pending=false WHERE id=${accountId}::uuid`.execute(db);
                else {
                    const role = invite.role === "guardian" ? "parent" : invite.role;
                    account = await sql `INSERT INTO users(username,email,password_hash,first_name,last_name,role)
            VALUES (${`member.${randomUUID()}`},${data.email},${password},${data.first_name},${data.last_name},${role}) RETURNING id,password_hash,onboarding_pending,is_active`.execute(db);
                    accountId = account.rows[0].id;
                }
            }
            if (invite.student_id) {
                if (!this.personInvitations)
                    throw new ConflictException('The reviewed app identity path is unavailable.');
                const linked = await sql `UPDATE students SET user_id=${accountId}::uuid WHERE id=${invite.student_id}::uuid AND school_id=${invite.school_id}::uuid AND (user_id IS NULL OR user_id=${accountId}::uuid) RETURNING id`.execute(db);
                if (!linked.rows.length)
                    throw new ConflictException('Student account linkage changed. Request a new invitation.');
            }
            if (invite.guardian_id) {
                if (!this.personInvitations)
                    throw new ConflictException('The reviewed app identity path is unavailable.');
                const guardianPerson = await db.selectFrom('guardian_school_profiles').select('person_id').where('school_id', '=', invite.school_id)
                    .where('guardian_id', '=', invite.guardian_id).executeTakeFirstOrThrow();
                await this.personInvitations.assertExactProfileAccountTargetInTransaction(db, { school_id: invite.school_id, person_id: guardianPerson.person_id, user_id: accountId });
                const linked = await sql `UPDATE parents p SET user_id=${accountId}::uuid WHERE p.id=${invite.guardian_id}::uuid AND (p.user_id IS NULL OR p.user_id=${accountId}::uuid)
          AND EXISTS(SELECT 1 FROM guardian_school_profiles g WHERE g.guardian_id=p.id AND g.school_id=${invite.school_id}::uuid) RETURNING id`.execute(db);
                if (!linked.rows.length)
                    throw new ConflictException('Guardian account linkage changed. Request a new invitation.');
            }
            if (invite.custom_role_id) {
                if ((await sql `SELECT 1 FROM school_memberships WHERE school_id=${invite.school_id}::uuid AND user_id=${accountId}::uuid AND role='admin' AND is_active`.execute(db)).rows.length)
                    throw new ForbiddenException('Admin access is protected from staff role assignment.');
                if (!(await sql `SELECT 1 FROM school_custom_roles WHERE school_id=${invite.school_id}::uuid AND id=${invite.custom_role_id}::uuid`.execute(db)).rows.length)
                    throw new ConflictException('The invited role is no longer available.');
                await sql `DELETE FROM school_custom_role_assignments WHERE school_id=${invite.school_id}::uuid AND user_id=${accountId}::uuid`.execute(db);
                await sql `INSERT INTO school_custom_role_assignments(school_id,user_id,role_id,assigned_by,is_primary,valid_from)
          VALUES(${invite.school_id}::uuid,${accountId}::uuid,${invite.custom_role_id}::uuid,${invite.created_by}::uuid,true,campus_permission_date(${invite.school_id}::uuid))
          ON CONFLICT(school_id,user_id,role_id) DO UPDATE SET assigned_by=excluded.assigned_by,assigned_at=now(),is_primary=true,valid_until=NULL`.execute(db);
            }
            if (invite.role === 'staff' && invite.person_id) {
                if (!this.personInvitations)
                    throw new ConflictException('The reviewed app identity path is unavailable.');
                await this.personInvitations.assertExactProfileAccountTargetInTransaction(db, { school_id: invite.school_id, person_id: invite.person_id, user_id: accountId });
            }
            await db.insertInto("school_memberships").values({ school_id: invite.school_id, user_id: accountId, role: invite.role,
                access_scope: invite.access_scope ?? 'campus' }).onConflict((oc) => oc.columns(["user_id", "school_id", "role"]).doUpdateSet({ is_active: true })).execute();
            // Neutral member joining uses independent mailbox proof (or a verified account password).
            // Legacy role-specific invitation ceremonies retain their existing verification contract.
            await sql `UPDATE users SET email_verified_at=COALESCE(email_verified_at,now()),updated_at=now() WHERE id=${accountId}::uuid AND lower(email)=${invite.email}`.execute(db);
            if (invite.source === "company" && invite.role === "admin") {
                if (!this.personInvitations)
                    throw new ConflictException("Administrator person confirmation is unavailable.");
                await this.personInvitations.confirmCompanyAdministratorInTransaction(db, invite, accountId, {
                    confirmed: data.confirm_admin_person, first_name: data.first_name, last_name: data.last_name,
                });
            }
            if (invite.role === "staff") {
                if (invite.person_id) {
                    const linked = await sql `UPDATE staff_profiles SET user_id=${accountId}::uuid,updated_by=${accountId}::uuid,updated_at=now()
            WHERE school_id=${invite.school_id}::uuid AND person_id=${invite.person_id}::uuid AND (user_id IS NULL OR user_id=${accountId}::uuid)
            RETURNING id`.execute(db);
                    if (!linked.rows.length)
                        throw new ConflictException('The intended work record changed. Ask the administrator to review its app access.');
                }
                await sql `UPDATE staff_onboarding_items item SET completed_at=now(),completed_by=${accountId}::uuid,updated_at=now()
          FROM staff_profiles profile WHERE item.staff_profile_id=profile.id AND profile.school_id=${invite.school_id}::uuid
          AND profile.user_id=${accountId}::uuid AND item.item_key='account_access'`.execute(db);
                await sql `UPDATE staff_profiles profile SET status=CASE WHEN NOT EXISTS (
            SELECT 1 FROM staff_onboarding_items item WHERE item.staff_profile_id=profile.id AND item.required AND item.completed_at IS NULL
          ) THEN 'active' ELSE 'onboarding' END,updated_by=${accountId}::uuid,updated_at=now()
          WHERE profile.school_id=${invite.school_id}::uuid AND profile.user_id=${accountId}::uuid`.execute(db);
            }
            if (invite.role === "member")
                await this.personInvitations.acceptInTransaction(db, invite, accountId);
            else
                await sql `UPDATE school_invitations SET accepted_at=now(),accepted_by_user_id=${accountId}::uuid WHERE id=${invite.id}::uuid`.execute(db);
            if (invite.role === 'staff' && invite.person_id) {
                if (!this.personInvitations)
                    throw new ConflictException('The reviewed app identity path is unavailable.');
                await this.personInvitations.linkAcceptedStaffEndpointInTransaction(db, { school_id: invite.school_id, person_id: invite.person_id, user_id: accountId });
            }
            if (invite.role === 'guardian' && invite.guardian_id) {
                if (!this.personInvitations)
                    throw new ConflictException('The reviewed app identity path is unavailable.');
                await this.personInvitations.linkAcceptedGuardianEndpointInTransaction(db, { school_id: invite.school_id, guardian_id: invite.guardian_id,
                    user_id: accountId, invitation_id: invite.id });
            }
            if (invite.role === 'student' && invite.student_id) {
                if (!this.personInvitations)
                    throw new ConflictException('The reviewed app identity path is unavailable.');
                await this.personInvitations.linkAcceptedStudentEndpointInTransaction(db, { school_id: invite.school_id, student_id: invite.student_id,
                    user_id: accountId, invitation_id: invite.id });
            }
            await sql `INSERT INTO school_operations_audit(school_id,actor_id,action,target_id) VALUES (${invite.school_id}::uuid,${accountId}::uuid,'invitation.accepted',${invite.id}::uuid)`.execute(db);
            if (invite.source === 'company')
                await sql `INSERT INTO company_audit(actor_id,school_id,action,metadata) VALUES(${accountId}::uuid,${invite.school_id}::uuid,'company.admin_joined',${JSON.stringify({ invitation_id: invite.id })}::jsonb)`.execute(db);
            await this.enqueuePanelUpdate(db, {
                schoolId: invite.school_id,
                eventType: "administration.updated",
                aggregateType: "school_invitation",
                aggregateId: invite.id,
                payload: { action: "invitation_accepted", refresh: ["principal.administration", "people", "principal.home"] },
                idempotencyKey: `invitation:${invite.id}:accepted`,
            });
            await sql `UPDATE school_invitations SET recipient_proof_hash=NULL,recipient_proof_expires_at=NULL
        WHERE id=${invite.id}::uuid`.execute(db);
            const continuation = this.personInvitations ? await this.personInvitations.acceptedContinuation(db, invite, accountId) : null;
            return { accepted: true, accepted_user_id: accountId, school_id: invite.school_id, role: invite.role,
                ...(continuation ? { continuation } : {}), message: "School access is ready. Sign in with your email and password." };
        });
    }
    invitationDetail(user, schoolId, id) {
        if (!this.personInvitations)
            throw new ConflictException("App invitation details are unavailable.");
        return this.personInvitations.detail(user, schoolId, id);
    }
    invitationContinuation(user, schoolId, id) {
        if (!this.personInvitations)
            throw new ConflictException('Assigned-work continuation is unavailable.');
        return this.personInvitations.continuation(user, schoolId, id);
    }
    async member(user, schoolId, id, body, correlationId) {
        uuid.parse(id);
        const data = z.object({ is_active: z.boolean() }).strict().parse(body);
        return this.mutate(user, schoolId, "sis.manage", "membership.updated", async (db) => {
            await this.authorize(user, schoolId, "sis.manage", db, true);
            const member = await db.selectFrom("school_memberships").selectAll().where("id", "=", id).where("school_id", "=", schoolId).executeTakeFirst();
            if (!member)
                throw new NotFoundException();
            if (!data.is_active && member.role === "admin") {
                const remaining = await db.selectFrom("school_memberships").select("id").where("school_id", "=", schoolId).where("role", "=", "admin").where("is_active", "=", true).where("id", "!=", id).execute();
                if (!remaining.length)
                    throw new ConflictException("The school must retain an active administrator.");
            }
            let coverageReconciliationInput = null;
            let coveragePreparation = null;
            if (!data.is_active && member.role === "staff") {
                const range = (await sql `SELECT
            (now() AT TIME ZONE school.timezone)::date::text AS today,
            GREATEST(
              (now() AT TIME ZONE school.timezone)::date,
              COALESCE((SELECT max(substitution.duty_date)
                FROM staff_timetable_substitutions substitution
                WHERE substitution.school_id=school.id AND substitution.state='effective'),
                (now() AT TIME ZONE school.timezone)::date)
            )::text AS last_date
          FROM schools school WHERE school.id=${schoolId}::uuid`.execute(db)).rows[0];
                coverageReconciliationInput = {
                    school_id: schoolId,
                    from: range.today,
                    to: range.last_date,
                    actor_user_id: user.id,
                    correlation_id: correlationId,
                    cause: {
                        kind: "staff_membership_deactivated",
                        source_domain: "administration",
                        source_record_id: member.id,
                        source_revision: 1,
                    },
                };
                // Retained accepted cover must be projected while the membership is
                // still eligible; the authoritative mutation follows under the same
                // schedule-locked transaction.
                coveragePreparation = await this.coverage.prepareEffectiveCoverageProjection(db, coverageReconciliationInput);
            }
            await db.updateTable("school_memberships").set({ is_active: data.is_active }).where("id", "=", id).execute();
            if (!data.is_active)
                await sql `UPDATE school_invitations SET revoked_at=now() WHERE school_id=${schoolId}::uuid
        AND email=(SELECT lower(email) FROM users WHERE id=${member.user_id}::uuid) AND accepted_at IS NULL AND revoked_at IS NULL`.execute(db);
            if (!data.is_active)
                await sql `UPDATE school_access_exceptions SET status='revoked',revoked_by=${user.id}::uuid,revoked_at=now(),
        revocation_reason='Institution membership deactivated',revision=revision+1,updated_at=now()
        WHERE school_id=${schoolId}::uuid AND user_id=${member.user_id}::uuid AND status='active'`.execute(db);
            const coverageReceipt = coverageReconciliationInput
                ? await this.coverage.reconcileEffectiveCoverage(db, coverageReconciliationInput)
                : null;
            const mutationId = randomUUID();
            await this.enqueuePanelUpdate(db, {
                schoolId,
                eventType: "administration.updated",
                aggregateType: "school_membership",
                aggregateId: member.id,
                payload: {
                    action: data.is_active ? "membership_activated" : "membership_deactivated",
                    refresh: ["principal.administration", "people", "principal.home", "teacher.home"],
                },
                idempotencyKey: `membership:${member.id}:${data.is_active ? "active" : "inactive"}:${mutationId}`,
            });
            await this.enqueueAccessUpdate(db, {
                schoolId,
                membershipId: member.id,
                affectedUserId: member.user_id,
                action: data.is_active ? "membership_activated" : "membership_deactivated",
                mutationId,
            });
            return {
                id: member.id,
                updated: true,
                coverage_preparation: coveragePreparation,
                coverage_reconciliation: coverageReceipt,
            };
        });
    }
    async revokeInvitation(user, schoolId, id) {
        uuid.parse(id);
        const scoped = await this.personInvitations?.revokeWork(user, schoolId, id);
        if (scoped)
            return scoped;
        return this.mutate(user, schoolId, 'members.invite', 'invitation.revoked', async (db) => {
            const authority = await this.authorize(user, schoolId, 'members.invite', db);
            const current = (await sql `SELECT role FROM school_invitations
        WHERE id=${id}::uuid AND school_id=${schoolId}::uuid FOR UPDATE`.execute(db)).rows[0];
            if (current?.role === 'member') {
                assertLiveAppAccountControl();
                if (!this.personInvitations)
                    throw new ConflictException("Person app invitations are unavailable.");
                await this.personInvitations.assertInviterIdentity(db, schoolId, user.id);
            }
            const result = await sql `UPDATE school_invitations SET revoked_at=now() WHERE id=${id}::uuid AND school_id=${schoolId}::uuid AND accepted_at IS NULL
        AND (${authority.role}='admin' OR (role<>'admin' AND source='school')) RETURNING id`.execute(db);
            if (!result.rows.length)
                throw new NotFoundException('Invitation not found or cannot be managed by this role.');
            await this.enqueuePanelUpdate(db, {
                schoolId,
                eventType: "administration.updated",
                aggregateType: "school_invitation",
                aggregateId: id,
                payload: { action: "invitation_revoked", refresh: ["principal.administration"] },
                idempotencyKey: `invitation:${id}:revoked`,
            });
            return { revoked: true };
        });
    }
    async fees(user, schoolId, studentId, personId, invoiceId, rawQuery = {}) {
        const input = feeLedgerQuerySchema.parse(rawQuery);
        return this.db.transaction().setIsolationLevel("repeatable read").execute(async (db) => {
            uuid.parse(schoolId);
            if (personId)
                uuid.parse(personId);
            if (invoiceId)
                uuid.parse(invoiceId);
            if (personId && studentId)
                throw new BadRequestException("Choose one exact fee account.");
            const exactInvoice = async (table, id) => (await sql `
      SELECT invoice.id AS invoice_id FROM ${sql.table(table)} evidence JOIN fee_invoices invoice
        ON invoice.school_id=evidence.school_id AND invoice.id=evidence.invoice_id
      WHERE evidence.school_id=${schoolId}::uuid AND evidence.id=${id}::uuid
        AND (${studentId ?? null}::uuid IS NULL OR invoice.student_id=${studentId ?? null}::uuid)
        AND (${personId ?? null}::uuid IS NULL OR invoice.person_id=${personId ?? null}::uuid)
        AND event_user_is_authorized(invoice.school_id,'fees.updated',CASE WHEN invoice.person_id IS NULL
          THEN jsonb_build_object('invoice_id',invoice.id,'student_id',invoice.student_id)
          ELSE jsonb_build_object('invoice_id',invoice.id,'person_id',invoice.person_id) END,${user.id}::uuid)
    `.execute(db)).rows[0];
            if (input.receipt_id) {
                const receipt = await exactInvoice("fee_payments", input.receipt_id);
                if (!receipt || invoiceId && invoiceId !== receipt.invoice_id)
                    throw new NotFoundException("This receipt is unavailable in the selected fee account.");
                invoiceId = receipt.invoice_id;
            }
            if (input.review_id) {
                const review = await exactInvoice("fee_native_review_requests", input.review_id);
                if (!review || invoiceId && invoiceId !== review.invoice_id)
                    throw new NotFoundException("This review is unavailable in the selected fee account.");
                invoiceId = review.invoice_id;
            }
            let context;
            if (personId) {
                if (!this.feeLedger)
                    throw new ForbiddenException("Person fee accounts are unavailable.");
                context = await this.feeLedger.accountContext(db, user, schoolId, personId, invoiceId);
            }
            else if (studentId) {
                await this.schoolStudent(db, schoolId, studentId);
                const family = await sql `SELECT 1 FROM students s WHERE s.id=${studentId}::uuid AND s.school_id=${schoolId}::uuid AND (
        (s.user_id=${user.id}::uuid AND EXISTS (SELECT 1 FROM school_memberships m WHERE m.user_id=${user.id}::uuid AND m.school_id=s.school_id AND m.role='student' AND m.is_active)) OR
        EXISTS (SELECT 1 FROM parents p JOIN guardian_relationships gr ON gr.guardian_id=p.id JOIN school_memberships m ON m.user_id=p.user_id AND m.school_id=s.school_id
          WHERE p.user_id=${user.id}::uuid AND gr.student_id=s.id AND m.role='guardian' AND m.is_active))`.execute(db);
                if (!family.rows.length)
                    await this.authorize(user, schoolId, "fees.manage", db);
            }
            else
                await this.authorize(user, schoolId, "fees.manage", db);
            // Retained school-only readers keep their compatibility boundary. A mixed/native
            // staff ledger additionally needs the current acting-person endpoint.
            if (!personId && !studentId && await db.selectFrom("fee_invoices").select("id").where("school_id", "=", schoolId).where("person_id", "is not", null).executeTakeFirst()) {
                if (!this.feeLedger)
                    throw new ForbiddenException("Person fee accounts require current linked Finance access.");
                context = await this.feeLedger.accountContext(db, user, schoolId);
            }
            if (!context) {
                const school = (await sql `SELECT timezone,(${executionNow()}::timestamptz AT TIME ZONE timezone)::date::text AS today FROM schools WHERE id=${schoolId}::uuid`.execute(db)).rows[0];
                let canIssue = true;
                try {
                    await this.authorize(user, schoolId, "fees.manage", db);
                }
                catch (error) {
                    if (error instanceof ForbiddenException)
                        canIssue = false;
                    else
                        throw error;
                }
                context = { school_id: schoolId, ...school, can_issue: canIssue };
            }
            let canCorrect = false;
            if (this.feeLedger) {
                try {
                    canCorrect = (await this.feeLedger.accountContext(db, user, schoolId)).can_issue;
                }
                catch (error) {
                    if (!(error instanceof ForbiddenException))
                        throw error;
                }
            }
            // A recorded collection is Finance's operating context, not shared liability
            // or permission to disclose its size to one person's account reader.
            const canReadChargeBatch = canCorrect && !studentId && !personId && !invoiceId;
            if (input.batch_id && !canCorrect)
                throw new ForbiddenException("Current institution Finance access is required for a collection.");
            const pattern = `%${input.search.replace(/[\\%_]/g, "\\$&")}%`;
            const limit = input.batch_id ? 500 : invoiceId ? 1 : input.limit;
            const grouped = input.group_collections && canReadChargeBatch && !input.search && !input.batch_id;
            const invoices = await sql `WITH visible AS (SELECT invoice.*,person.first_name,person.last_name,student.admission_number,
      CASE WHEN recorded_collection.id IS NULL THEN NULL ELSE jsonb_build_object('id',recorded_collection.id,
        'reference',recorded_collection.reference,'description',recorded_collection.description,'person_count',recorded_collection.person_count) END AS charge_batch,
      effective.amount_paise AS effective_amount_paise,effective.description AS effective_description,effective.due_on::text AS effective_due_on,
      effective.charge_state,effective.correction_revision,
      (${canCorrect} AND NOT EXISTS(SELECT 1 FROM campus_event_participants event_person WHERE event_person.school_id=invoice.school_id AND event_person.fee_invoice_id=invoice.id)) AS can_correct,
      jsonb_build_object('kind',CASE WHEN invoice.person_id IS NULL THEN 'student' ELSE 'person' END,
        'person_id',coalesce(invoice.person_id,student.person_id),'student_id',invoice.student_id,'name',trim(concat_ws(' ',person.first_name,person.last_name))) AS beneficiary,
      totals.paid_paise,totals.credited_paise,totals.refunded_paise,
      calculation.adjusted_amount_paise,calculation.net_paid_paise,
      calculation.balance_paise,calculation.refund_due_paise,
      CASE
        WHEN calculation.refund_due_paise>0 AND totals.refunded_paise>0 THEN 'partially_refunded'
        WHEN calculation.refund_due_paise>0 THEN 'refund_due'
        WHEN totals.credited_paise>0 AND totals.refunded_paise>0 THEN 'refunded'
        WHEN totals.credited_paise>0 THEN 'credited'
        WHEN effective.charge_state='cancelled' THEN 'cancelled'
        WHEN calculation.balance_paise=0 THEN 'paid'
        ELSE 'collectible'
      END AS collection_state
      FROM fee_invoices invoice
      JOIN fee_effective_invoices effective ON effective.school_id=invoice.school_id AND effective.id=invoice.id
      LEFT JOIN fee_charge_batch_items recorded_item ON ${canReadChargeBatch} AND recorded_item.school_id=invoice.school_id AND recorded_item.invoice_id=invoice.id
      LEFT JOIN fee_charge_batches recorded_collection ON recorded_collection.school_id=recorded_item.school_id AND recorded_collection.id=recorded_item.batch_id
      LEFT JOIN students student ON student.id=invoice.student_id AND student.school_id=invoice.school_id
      JOIN school_people person ON person.id=coalesce(invoice.person_id,student.person_id) AND person.school_id=invoice.school_id
      LEFT JOIN LATERAL (
        SELECT
          COALESCE((SELECT sum(payment.amount_paise) FROM fee_effective_payments payment
            WHERE payment.school_id=invoice.school_id AND payment.invoice_id=invoice.id),0)::int AS paid_paise,
          COALESCE((SELECT sum(credit.amount_paise) FROM fee_invoice_credits credit
            WHERE credit.school_id=invoice.school_id AND credit.invoice_id=invoice.id),0)::int AS credited_paise,
          COALESCE((SELECT sum(refund.amount_paise) FROM fee_refunds refund
            WHERE refund.school_id=invoice.school_id AND refund.invoice_id=invoice.id),0)::int AS refunded_paise
      ) totals ON true
      LEFT JOIN LATERAL (
        SELECT GREATEST(effective.amount_paise-totals.credited_paise,0)::int AS adjusted_amount_paise,
          GREATEST(totals.paid_paise-totals.refunded_paise,0)::int AS net_paid_paise
      ) base ON true
      LEFT JOIN LATERAL (
        SELECT GREATEST(base.adjusted_amount_paise-base.net_paid_paise,0)::int AS balance_paise,
          GREATEST(base.net_paid_paise-base.adjusted_amount_paise,0)::int AS refund_due_paise,
          base.adjusted_amount_paise,base.net_paid_paise
      ) calculation ON true
      WHERE invoice.school_id=${schoolId}::uuid
        AND (${studentId ?? null}::uuid IS NULL OR invoice.student_id=${studentId ?? null}::uuid)
        AND (${personId ?? null}::uuid IS NULL OR invoice.person_id=${personId ?? null}::uuid)
        AND (${invoiceId ?? null}::uuid IS NULL OR invoice.id=${invoiceId ?? null}::uuid)
        AND (${input.batch_id ?? null}::uuid IS NULL OR EXISTS(SELECT 1 FROM fee_charge_batch_items selected_batch
          WHERE selected_batch.school_id=invoice.school_id AND selected_batch.invoice_id=invoice.id AND selected_batch.batch_id=${input.batch_id ?? null}::uuid))
        AND (${input.search}='' OR invoice.reference ILIKE ${pattern} OR effective.description ILIKE ${pattern}
          OR concat_ws(' ',person.first_name,person.last_name) ILIKE ${pattern} OR student.admission_number ILIKE ${pattern})
        AND (${personId ?? null}::uuid IS NULL OR ${context.can_issue} OR EXISTS(SELECT 1 FROM fee_invoice_self_payer_entitlements e
          WHERE e.school_id=invoice.school_id AND e.invoice_id=invoice.id AND e.person_id=invoice.person_id AND e.user_id=${user.id}::uuid
            AND ${context.today}::date BETWEEN e.valid_from AND e.valid_until AND NOT EXISTS(SELECT 1 FROM fee_invoice_self_payer_revocations r WHERE r.school_id=e.school_id AND r.entitlement_id=e.id)))
      ), totals AS (SELECT coalesce(sum(adjusted_amount_paise),0)::bigint AS billed,coalesce(sum(paid_paise),0)::bigint AS received,
        coalesce(sum(balance_paise),0)::bigint AS outstanding,coalesce(sum(refund_due_paise),0)::bigint AS refunds,
        count(*) FILTER(WHERE collection_state='collectible' AND balance_paise>0)::int AS open,count(*)::int AS invoices FROM visible),
      heads AS (SELECT DISTINCT ON(group_key) id FROM (
        SELECT id,CASE WHEN ${grouped} THEN coalesce(charge_batch->>'id',id::text) ELSE id::text END AS group_key FROM visible
      ) grouped_heads ORDER BY group_key,id)
      SELECT visible.*,CASE WHEN ${grouped} AND visible.charge_batch IS NOT NULL THEN visible.charge_batch || jsonb_build_object('summary',
        (SELECT jsonb_build_object('complete',count(*)=(visible.charge_batch->>'person_count')::int,
          'outstanding',coalesce(sum(grouped_item.balance_paise),0),'cancelled',count(*) FILTER(WHERE grouped_item.charge_state='cancelled'))
          FROM visible grouped_item WHERE grouped_item.charge_batch->>'id'=visible.charge_batch->>'id'))
        ELSE visible.charge_batch END AS charge_batch,to_jsonb(totals) AS ledger_totals
      FROM visible JOIN heads ON heads.id=visible.id CROSS JOIN totals
      WHERE (${input.cursor ?? null}::uuid IS NULL OR visible.id>${input.cursor ?? null}::uuid)
      ORDER BY visible.id LIMIT ${limit + 1}`.execute(db);
            const payments = await sql `SELECT p.id,p.invoice_id,p.amount_paise,p.method,p.reference,p.created_at,
      i.reference AS invoice_reference,payment_invoice.description AS invoice_description,
      CASE WHEN reversal.id IS NULL THEN 'active' WHEN reversal.replacement_payment_id IS NULL THEN 'reversed' ELSE 'replaced' END AS status,
      CASE WHEN reversal.id IS NULL THEN 'active' WHEN reversal.replacement_payment_id IS NULL THEN 'reversed' ELSE 'replaced' END AS receipt_state,
      predecessor.payment_id AS replaces_payment_id,reversal.id AS reversal_id,reversal.replacement_payment_id,
      reversal.reason AS correction_reason,reversal.created_at AS corrected_at,reversal.actor_name AS corrected_by_label,
      (${canCorrect} AND reversal.id IS NULL AND p.method IN('cash','bank_transfer','cheque')
        AND NOT EXISTS(SELECT 1 FROM fee_gateway_orders g WHERE g.school_id=p.school_id AND g.payment_id=p.id)
        AND NOT EXISTS(SELECT 1 FROM campus_event_participants e WHERE e.school_id=p.school_id AND e.fee_invoice_id=p.invoice_id)) AS can_reverse,
      (${canCorrect} AND reversal.id IS NULL AND p.method IN('cash','bank_transfer','cheque')
        AND NOT EXISTS(SELECT 1 FROM fee_gateway_orders g WHERE g.school_id=p.school_id AND g.payment_id=p.id)
        AND NOT EXISTS(SELECT 1 FROM campus_event_participants e WHERE e.school_id=p.school_id AND e.fee_invoice_id=p.invoice_id)
        AND NOT EXISTS(SELECT 1 FROM fee_native_review_decisions d JOIN fee_native_review_requests r ON r.school_id=d.school_id AND r.id=d.review_id
          WHERE d.school_id=p.school_id AND d.payment_id=coalesce(predecessor.root_payment_id,p.id)
            AND(r.submitted_by=${user.id}::uuid OR campus_model_account_person_is_active(r.school_id,${user.id}::uuid,r.submitter_person_id,${executionNow()}::timestamptz)))
        AND NOT EXISTS(SELECT 1 FROM fee_native_review_decisions d JOIN fee_native_review_requests r ON r.school_id=d.school_id AND r.id=d.review_id
          WHERE d.school_id=p.school_id AND d.payment_id=coalesce(predecessor.root_payment_id,p.id) AND r.submitter_person_id IS NULL)) AS can_replace
      FROM fee_payments p JOIN fee_invoices i ON i.id=p.invoice_id AND i.school_id=p.school_id
      JOIN fee_effective_invoices payment_invoice ON payment_invoice.id=i.id AND payment_invoice.school_id=i.school_id
      LEFT JOIN students payment_student ON payment_student.school_id=i.school_id AND payment_student.id=i.student_id
      JOIN school_people payment_person ON payment_person.school_id=i.school_id AND payment_person.id=coalesce(i.person_id,payment_student.person_id)
      LEFT JOIN fee_payment_corrections reversal ON reversal.school_id=p.school_id AND reversal.payment_id=p.id
      LEFT JOIN fee_payment_corrections predecessor ON predecessor.school_id=p.school_id AND predecessor.replacement_payment_id=p.id
      WHERE p.school_id=${schoolId}::uuid AND (${studentId ?? null}::uuid IS NULL OR i.student_id=${studentId ?? null}::uuid)
        AND (${personId ?? null}::uuid IS NULL OR i.person_id=${personId ?? null}::uuid)
        AND (${invoiceId ?? null}::uuid IS NULL OR i.id=${invoiceId ?? null}::uuid)
        AND (${input.batch_id ?? null}::uuid IS NULL OR EXISTS(SELECT 1 FROM fee_charge_batch_items selected_batch
          WHERE selected_batch.school_id=i.school_id AND selected_batch.invoice_id=i.id AND selected_batch.batch_id=${input.batch_id ?? null}::uuid))
        AND (${input.receipt_id ?? null}::uuid IS NULL OR p.id=${input.receipt_id ?? null}::uuid)
        AND (${input.receipt_id ? null : input.payment_cursor ?? null}::uuid IS NULL OR p.id>${input.receipt_id ? null : input.payment_cursor ?? null}::uuid)
        AND (${input.search}='' OR p.reference ILIKE ${pattern} OR i.reference ILIKE ${pattern} OR payment_invoice.description ILIKE ${pattern}
          OR concat_ws(' ',payment_person.first_name,payment_person.last_name) ILIKE ${pattern} OR payment_student.admission_number ILIKE ${pattern})
        AND (${personId ?? null}::uuid IS NULL OR ${context.can_issue} OR EXISTS(SELECT 1 FROM fee_invoice_self_payer_entitlements e
          WHERE e.school_id=i.school_id AND e.invoice_id=i.id AND e.person_id=i.person_id AND e.user_id=${user.id}::uuid
            AND ${context.today}::date BETWEEN e.valid_from AND e.valid_until AND NOT EXISTS(SELECT 1 FROM fee_invoice_self_payer_revocations r WHERE r.school_id=e.school_id AND r.entitlement_id=e.id)))
      ORDER BY p.id LIMIT ${input.limit + 1}`.execute(db);
            if (input.cursor && !invoices.rows.length)
                throw new ConflictException("This ledger page is no longer available. Return to its first page and review the current records.");
            if (input.batch_id && invoices.rows.length > 500)
                throw new ConflictException("This collection exceeds its supported size. Review its retained record.");
            const page = invoices.rows.slice(0, limit);
            const projections = await feeLedgerProjections(db, schoolId, page.map(invoice => invoice.id), context.today);
            const projectedInvoices = page.map(invoice => ({ ...invoice, ledger_totals: undefined, ...projections.get(invoice.id) }));
            return { ...context, can_correct: canCorrect, currency: "INR", invoices: projectedInvoices, payments: payments.rows.slice(0, input.limit), online_payments_enabled: false,
                totals: invoices.rows[0]?.ledger_totals ?? { billed: 0, received: 0, outstanding: 0, refunds: 0, open: 0, invoices: 0 },
                pagination: { limit, payment_limit: input.limit, next_cursor: invoices.rows.length > limit ? page.at(-1).id : null,
                    next_payment_cursor: payments.rows.length > input.limit ? payments.rows[input.limit - 1].id : null,
                    search: input.search, exact: Boolean(invoiceId || input.batch_id), grouped } };
        });
    }
    async feeStudents(user, schoolId, rawQuery = {}) {
        await this.authorize(user, schoolId, "fees.manage");
        const input = z.object({ cursor: z.uuid().optional(), search: z.string().trim().max(80).default("") }).parse(rawQuery);
        const pattern = `%${input.search.replace(/[\\%_]/g, "\\$&")}%`;
        const result = await sql `SELECT s.id,s.admission_number,p.first_name,p.last_name FROM students s
      JOIN school_people p ON p.id=s.person_id AND p.school_id=s.school_id
      WHERE s.school_id=${schoolId}::uuid AND (${input.cursor ?? null}::uuid IS NULL OR s.id>${input.cursor ?? null}::uuid)
        AND (${input.search}='' OR s.admission_number ILIKE ${pattern} OR concat_ws(' ',p.first_name,p.last_name) ILIKE ${pattern})
      ORDER BY s.id LIMIT 26`.execute(this.db);
        return { results: result.rows.slice(0, 25), next_cursor: result.rows.length > 25 ? String(result.rows[24].id) : null };
    }
    async invoice(user, schoolId, body) {
        if (body && typeof body === "object" && "beneficiary" in body) {
            if (!this.feeLedger)
                throw new ForbiddenException("Person charges are unavailable.");
            return this.feeLedger.issue(user, schoolId, body);
        }
        const data = invoiceSchema.parse(body);
        return this.mutate(user, schoolId, "fees.manage", "fee.invoice_posted", async (db) => {
            await this.schoolStudent(db, schoolId, data.student_id);
            const result = await sql `INSERT INTO fee_invoices(school_id,student_id,reference,description,amount_paise,due_on,created_by)
        VALUES (${schoolId}::uuid,${data.student_id}::uuid,${data.reference},${data.description},${data.amount_paise},${data.due_on}::date,${user.id}::uuid) RETURNING *`.execute(db);
            const invoice = result.rows[0];
            await this.enqueuePanelUpdate(db, {
                schoolId,
                eventType: "fees.updated",
                aggregateType: "fee_invoice",
                aggregateId: invoice.id,
                payload: {
                    student_id: invoice.student_id,
                    invoice_id: invoice.id,
                    action: "invoice_posted",
                    refresh: ["fees", "parent.home", "principal.home"],
                },
                idempotencyKey: `fee-invoice:${invoice.id}:posted`,
            });
            return result.rows[0];
        });
    }
    async payment(user, schoolId, invoiceId, body) {
        uuid.parse(invoiceId);
        const data = paymentSchema.parse(body);
        return this.mutate(user, schoolId, "fees.manage", "fee.payment_recorded", async (db) => {
            const previous = await sql `SELECT * FROM fee_payments WHERE school_id=${schoolId}::uuid AND idempotency_key=${data.idempotency_key}::uuid`.execute(db);
            if (previous.rows[0]) {
                const row = previous.rows[0];
                if (row.invoice_id !== invoiceId || row.amount_paise !== data.amount_paise || row.method !== data.method || row.reference !== data.reference)
                    throw new ConflictException("Idempotency key was already used with different payment details.");
                return row;
            }
            const invoice = await sql `SELECT invoice.student_id,invoice.person_id,effective.amount_paise,
          COALESCE((SELECT sum(payment.amount_paise) FROM fee_effective_payments payment
            WHERE payment.school_id=invoice.school_id AND payment.invoice_id=invoice.id),0)::int AS paid_paise,
          COALESCE((SELECT sum(credit.amount_paise) FROM fee_invoice_credits credit
            WHERE credit.school_id=invoice.school_id AND credit.invoice_id=invoice.id),0)::int AS credited_paise,
          COALESCE((SELECT sum(refund.amount_paise) FROM fee_refunds refund
            WHERE refund.school_id=invoice.school_id AND refund.invoice_id=invoice.id),0)::int AS refunded_paise
        FROM fee_invoices invoice
        JOIN fee_effective_invoices effective ON effective.school_id=invoice.school_id AND effective.id=invoice.id
        WHERE invoice.id=${invoiceId}::uuid AND invoice.school_id=${schoolId}::uuid
        FOR UPDATE OF invoice`.execute(db);
            const ledger = invoice.rows[0];
            if (!ledger)
                throw new NotFoundException();
            if (ledger.person_id)
                throw new ForbiddenException("Use this charge’s payment review and independent verification.");
            const adjusted = Math.max(ledger.amount_paise - ledger.credited_paise, 0);
            const netPaid = Math.max(ledger.paid_paise - ledger.refunded_paise, 0);
            const collectible = Math.max(adjusted - netPaid, 0);
            if (!collectible) {
                if (ledger.credited_paise)
                    throw new ConflictException("This invoice has been credited and has no collectible balance.");
                throw new BadRequestException("This invoice has no outstanding balance.");
            }
            if (data.amount_paise > collectible)
                throw new BadRequestException("Payment exceeds the outstanding invoice balance.");
            const result = await sql `INSERT INTO fee_payments(school_id,invoice_id,amount_paise,method,reference,idempotency_key,recorded_by)
        VALUES (${schoolId}::uuid,${invoiceId}::uuid,${data.amount_paise},${data.method},${data.reference},${data.idempotency_key}::uuid,${user.id}::uuid) RETURNING *`.execute(db);
            const payment = result.rows[0];
            await this.enqueuePanelUpdate(db, {
                schoolId,
                eventType: "fees.updated",
                aggregateType: "fee_payment",
                aggregateId: payment.id,
                payload: {
                    student_id: ledger.student_id,
                    invoice_id: invoiceId,
                    payment_id: payment.id,
                    action: "payment_recorded",
                    refresh: ["fees", "parent.home", "principal.home"],
                },
                idempotencyKey: `fee-payment:${payment.id}:recorded`,
            });
            return result.rows[0];
        });
    }
};
OperationsService = __decorate([
    Injectable(),
    __param(1, Inject(STAFF_COVERAGE_RECONCILIATION_PORT)),
    __param(2, Optional()),
    __param(3, Optional()),
    __param(4, Optional()),
    __metadata("design:paramtypes", [DatabaseService, Object, PersonAccountInvitationsService,
        LegacyPeopleModelService,
        FeeLedgerService])
], OperationsService);
export { OperationsService };
//# sourceMappingURL=operations.service.js.map