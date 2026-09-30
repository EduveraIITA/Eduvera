import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { sql, type Kysely, type Transaction } from "kysely";
import { z } from "zod";
import { hashPassword, validatePassword, verifyPassword } from "../auth/password.js";
import type { AuthUser } from "../common/request.js";
import { DatabaseService } from "../database/database.service.js";
import type { Database } from "../database/types.js";
import { catalogMutationSchema, classSchema, enrollmentSchema, guardianSchema, invoiceSchema, parseStudentCsv, paymentSchema, personSchema, rolloverSchema, studentSchema, studentUpdateSchema, subjectSchema, termSchema, uuid } from "./schemas.js";

type Db = Kysely<Database> | Transaction<Database>;
type Permission = "sis.manage" | "fees.manage";
type MembershipRole = "student" | "guardian" | "staff" | "admin";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

@Injectable()
export class OperationsService {
  constructor(private readonly db: DatabaseService) {}

  async createSchool(user: AuthUser, body: unknown) {
    const data = z.object({ name: z.string().trim().min(2).max(180), code: z.string().trim().regex(/^[a-z0-9-]{2,32}$/) }).parse(body);
    // Bootstrap of the first operator remains an explicit deployment task.
    // Existing school administrators can provision another school they manage.
    const admin = await this.db.selectFrom("school_memberships").select("id").where("user_id", "=", user.id).where("role", "=", "admin").where("is_active", "=", true).executeTakeFirst();
    if (!admin) throw new ForbiddenException("An existing administrator must provision a school.");
    try {
      return await this.db.transaction().execute(async (db) => {
        const school = await db.insertInto("schools").values(data).returningAll().executeTakeFirstOrThrow();
        await db.insertInto("school_memberships").values({ user_id: user.id, school_id: school.id, role: "admin" }).execute();
        await this.audit(db, user, school.id, "school.created", school.id);
        return school;
      });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") throw new ConflictException("School code is already in use.");
      throw error;
    }
  }

  async authorize(user: AuthUser, schoolId: string, permission: Permission, db: Db = this.db, adminOnly = false) {
    uuid.parse(schoolId);
    const result = await sql<{ role: MembershipRole }>`
      SELECT m.role FROM school_memberships m WHERE m.school_id=${schoolId}::uuid AND m.user_id=${user.id}::uuid AND m.is_active
      AND (m.role='admin' OR (${!adminOnly} AND m.role='staff' AND EXISTS (
        SELECT 1 FROM school_permission_grants g WHERE g.school_id=m.school_id AND g.user_id=m.user_id AND g.permission=${permission}
      ))) ORDER BY (m.role='admin') DESC LIMIT 1`.execute(db);
    if (!result.rows[0]) throw new ForbiddenException(`School permission ${permission} is required.`);
    return result.rows[0];
  }

  private async audit(db: Db, user: AuthUser, schoolId: string, action: string, targetId?: string, metadata: Record<string, unknown> = {}) {
    await sql`INSERT INTO school_operations_audit(school_id,actor_id,action,target_id,metadata)
      VALUES (${schoolId}::uuid,${user.id}::uuid,${action},${targetId ?? null}::uuid,${JSON.stringify(metadata)}::jsonb)`.execute(db);
  }

  private async mutate<T>(
    user: AuthUser,
    schoolId: string,
    permission: Permission,
    action: string,
    work: (db: Transaction<Database>) => Promise<T>,
    auditDetails?: (result: T) => { targetId?: string; metadata?: Record<string, unknown> },
  ): Promise<T> {
    try {
      return await this.db.transaction().execute(async (db) => {
        // Serialize administrative and financial writes within one school. This
        // also makes preview/confirm imports and last-admin checks race-safe.
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${schoolId},0))`.execute(db);
        await this.authorize(user, schoolId, permission, db);
        const result = await work(db);
        const details = auditDetails?.(result);
        const inferredTargetId = typeof result === "object" && result !== null && "id" in result && typeof result.id === "string" ? result.id : undefined;
        await this.audit(db, user, schoolId, action, details?.targetId ?? inferredTargetId, details?.metadata);
        return result;
      });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") throw new ConflictException("A matching record already exists. Check email, admission number, roll number or reference.");
      throw error;
    }
  }

  async overview(user: AuthUser, schoolId: string) {
    await this.authorize(user, schoolId, "sis.manage");
    const [school, students, terms, classes, subjects, members, guardians, enrollments, audit, invitations, grants] = await Promise.all([
      this.db.selectFrom("schools").selectAll().where("id", "=", schoolId).executeTakeFirstOrThrow(),
      sql`SELECT s.id,s.admission_number,s.date_of_birth,p.first_name,p.last_name,
        COALESCE(u.email,p.contact_email) AS email,u.is_active,u.onboarding_pending
        FROM students s JOIN school_people p ON p.id=s.person_id AND p.school_id=s.school_id
        LEFT JOIN users u ON u.id=s.user_id WHERE s.school_id=${schoolId}::uuid ORDER BY s.admission_number`.execute(this.db),
      sql`SELECT term.*,
        (SELECT count(*)::int FROM enrollments enrollment WHERE enrollment.term_id=term.id) AS enrollment_count,
        (SELECT count(*)::int FROM timetable_slots slot WHERE slot.term_id=term.id) AS timetable_count,
        (SELECT count(*)::int FROM attendance_registers register WHERE register.term_id=term.id) AS register_count
        FROM academic_terms term WHERE term.school_id=${schoolId}::uuid ORDER BY term.starts_on DESC`.execute(this.db),
      sql`SELECT section.*,
        (SELECT count(*)::int FROM enrollments enrollment WHERE enrollment.class_section_id=section.id) AS enrollment_count,
        (SELECT count(*)::int FROM timetable_slots slot WHERE slot.class_section_id=section.id) AS timetable_count,
        (SELECT count(*)::int FROM class_section_staff_assignments assignment WHERE assignment.class_section_id=section.id) AS assignment_count
        FROM class_sections section WHERE section.school_id=${schoolId}::uuid ORDER BY section.grade,section.section`.execute(this.db),
      sql`SELECT subject.*,
        (SELECT count(*)::int FROM timetable_slots slot WHERE slot.subject_id=subject.id) AS timetable_count,
        (SELECT count(*)::int FROM subject_attendance attendance WHERE attendance.subject_id=subject.id) AS attendance_count,
        (SELECT count(*)::int FROM diary_items diary WHERE diary.subject_id=subject.id) AS diary_count,
        (SELECT count(*)::int FROM day_plan_periods plan_period WHERE plan_period.subject_id=subject.id) AS day_plan_count
        FROM subjects subject WHERE subject.school_id=${schoolId}::uuid ORDER BY subject.name`.execute(this.db),
      sql`SELECT m.id,m.user_id,m.role,m.is_active,u.first_name,u.last_name,u.email FROM school_memberships m JOIN users u ON u.id=m.user_id
        WHERE m.school_id=${schoolId}::uuid ORDER BY u.first_name`.execute(this.db),
      sql`SELECT gr.id,gr.student_id,gr.relationship,gr.is_primary,gr.can_authorize_leave,parent.phone,
        person.first_name,person.last_name,COALESCE(u.email,person.contact_email) AS email
        FROM guardian_relationships gr JOIN parents parent ON parent.id=gr.guardian_id
        JOIN students s ON s.id=gr.student_id
        JOIN guardian_school_profiles profile ON profile.guardian_id=parent.id AND profile.school_id=s.school_id
        JOIN school_people person ON person.id=profile.person_id AND person.school_id=s.school_id
        LEFT JOIN users u ON u.id=parent.user_id WHERE s.school_id=${schoolId}::uuid`.execute(this.db),
      sql`SELECT e.* FROM enrollments e JOIN students s ON s.id=e.student_id WHERE s.school_id=${schoolId}::uuid`.execute(this.db),
      sql`SELECT a.id,a.action,a.target_id,a.metadata,a.created_at,u.first_name,u.last_name FROM school_operations_audit a JOIN users u ON u.id=a.actor_id
        WHERE a.school_id=${schoolId}::uuid ORDER BY a.created_at DESC LIMIT 100`.execute(this.db),
      sql`SELECT id,email,role,expires_at,accepted_at,revoked_at FROM school_invitations WHERE school_id=${schoolId}::uuid ORDER BY created_at DESC LIMIT 100`.execute(this.db),
      sql`SELECT user_id,permission FROM school_permission_grants WHERE school_id=${schoolId}::uuid`.execute(this.db),
    ]);
    return { school, students: students.rows, terms: terms.rows, classes: classes.rows, subjects: subjects.rows, members: members.rows, guardians: guardians.rows, enrollments: enrollments.rows, audit: audit.rows, invitations: invitations.rows, grants: grants.rows };
  }

  private async catalogUsage(db: Db, kind: "terms" | "classes" | "subjects", id: string) {
    if (kind === "terms") {
      const result = await sql<{ enrollment_count: number; timetable_count: number; register_count: number }>`SELECT
        (SELECT count(*)::int FROM enrollments WHERE term_id=${id}::uuid) AS enrollment_count,
        (SELECT count(*)::int FROM timetable_slots WHERE term_id=${id}::uuid) AS timetable_count,
        (SELECT count(*)::int FROM attendance_registers WHERE term_id=${id}::uuid) AS register_count`.execute(db);
      const counts = result.rows[0]!;
      return { ...counts, total: counts.enrollment_count + counts.timetable_count + counts.register_count };
    }
    if (kind === "classes") {
      const result = await sql<{ enrollment_count: number; timetable_count: number; assignment_count: number }>`SELECT
        (SELECT count(*)::int FROM enrollments WHERE class_section_id=${id}::uuid) AS enrollment_count,
        (SELECT count(*)::int FROM timetable_slots WHERE class_section_id=${id}::uuid) AS timetable_count,
        (SELECT count(*)::int FROM class_section_staff_assignments WHERE class_section_id=${id}::uuid) AS assignment_count`.execute(db);
      const counts = result.rows[0]!;
      return { ...counts, total: counts.enrollment_count + counts.timetable_count + counts.assignment_count };
    }
    const result = await sql<{ timetable_count: number; attendance_count: number; diary_count: number; day_plan_count: number }>`SELECT
      (SELECT count(*)::int FROM timetable_slots WHERE subject_id=${id}::uuid) AS timetable_count,
      (SELECT count(*)::int FROM subject_attendance WHERE subject_id=${id}::uuid) AS attendance_count,
      (SELECT count(*)::int FROM diary_items WHERE subject_id=${id}::uuid) AS diary_count,
      (SELECT count(*)::int FROM day_plan_periods WHERE subject_id=${id}::uuid) AS day_plan_count`.execute(db);
    const counts = result.rows[0]!;
    return { ...counts, total: counts.timetable_count + counts.attendance_count + counts.diary_count + counts.day_plan_count };
  }

  private async enqueueCatalogUpdate(
    db: Transaction<Database>,
    schoolId: string,
    kind: "terms" | "classes" | "subjects",
    row: { id: string; revision: number },
    action: "created" | "updated",
  ) {
    const audience = await sql<{ user_id: string }>`SELECT DISTINCT membership.user_id
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

  async saveCatalog(user: AuthUser, schoolId: string, kind: string, body: unknown, id?: string) {
    if (id) uuid.parse(id);
    if (kind !== "terms" && kind !== "classes" && kind !== "subjects") throw new NotFoundException();
    const catalogKind = kind;
    const controls = catalogMutationSchema.parse(body);
    if (id && controls.expected_revision === undefined) throw new BadRequestException("Refresh this record before editing it.");
    let auditMetadata: Record<string, unknown> = { catalog_kind: catalogKind };
    return this.mutate(user, schoolId, "sis.manage", `${catalogKind}.${id ? "updated" : "created"}`, async (db) => {
      const requireReviewedImpact = (usage: { total: number }) => {
        if (!usage.total) return;
        if (!controls.confirmed) throw new BadRequestException(`This record is linked to ${usage.total} school records. Review the impact before saving.`);
        if (controls.change_reason.length < 8) throw new BadRequestException("Explain why this linked school record is changing.");
      };
      const comparable = (value: unknown) => {
        if (typeof value === "string") return value;
        if (typeof value === "number" || typeof value === "boolean") return value.toString();
        return "";
      };
      const changed = (current: Record<string, unknown>, values: Record<string, unknown>, fields: string[]) => fields.some((field) => comparable(current[field]) !== comparable(values[field]));

      if (kind === "terms") {
        const data = termSchema.parse(body);
        if (id) {
          const current = await db.selectFrom("academic_terms").selectAll().where("id", "=", id).where("school_id", "=", schoolId).executeTakeFirst();
          if (!current) throw new NotFoundException();
          if (current.revision !== controls.expected_revision) throw new ConflictException("This term changed after you opened it. Refresh and review the latest values.");
          if (current.academic_year !== data.academic_year) throw new BadRequestException("Create a new term to change the academic year.");
          const values = { ...data, attendance_threshold: data.attendance_threshold.toFixed(2) };
          if (!changed(current, values, ["name", "starts_on", "ends_on", "attendance_threshold", "is_active"])) throw new BadRequestException("No term changes were detected.");
          const usage = await this.catalogUsage(db, catalogKind, id); requireReviewedImpact(usage);
          const row = await db.updateTable("academic_terms").set({ ...values, updated_by: user.id }).where("id", "=", id).where("revision", "=", controls.expected_revision).returningAll().executeTakeFirst();
          if (!row) throw new ConflictException("This term changed while it was being saved. Refresh and try again.");
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
          if (!current) throw new NotFoundException();
          if (current.revision !== controls.expected_revision) throw new ConflictException("This class changed after you opened it. Refresh and review the latest values.");
          if (current.academic_year !== data.academic_year) throw new BadRequestException("Create a new class for the next academic year.");
          if (!changed(current, data, ["grade", "section", "board", "room_number"])) throw new BadRequestException("No class changes were detected.");
          const usage = await this.catalogUsage(db, catalogKind, id); requireReviewedImpact(usage);
          const row = await db.updateTable("class_sections").set({ ...data, updated_by: user.id }).where("id", "=", id).where("revision", "=", controls.expected_revision).returningAll().executeTakeFirst();
          if (!row) throw new ConflictException("This class changed while it was being saved. Refresh and try again.");
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
        if (!current) throw new NotFoundException();
        if (current.revision !== controls.expected_revision) throw new ConflictException("This subject changed after you opened it. Refresh and review the latest values.");
        if (!changed(current, data, ["code", "name", "short_name", "color", "icon"])) throw new BadRequestException("No subject changes were detected.");
        const usage = await this.catalogUsage(db, catalogKind, id); requireReviewedImpact(usage);
        const row = await db.updateTable("subjects").set({ ...data, updated_by: user.id }).where("id", "=", id).where("revision", "=", controls.expected_revision).returningAll().executeTakeFirst();
        if (!row) throw new ConflictException("This subject changed while it was being saved. Refresh and try again.");
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

  private async checkEnrollment(db: Db, schoolId: string, classId: string, termId: string) {
    const row = await sql`SELECT c.id FROM class_sections c JOIN academic_terms t ON t.school_id=c.school_id AND t.academic_year=c.academic_year
      WHERE c.id=${classId}::uuid AND t.id=${termId}::uuid AND c.school_id=${schoolId}::uuid AND t.is_active`.execute(db);
    if (!row.rows.length) throw new BadRequestException("Class and active term must belong to this school and academic year.");
  }

  private async schoolStudent(db: Db, schoolId: string, studentId: string) {
    uuid.parse(studentId);
    const student = await db.selectFrom("students").selectAll().where("id", "=", studentId).where("school_id", "=", schoolId).executeTakeFirst();
    if (!student) throw new NotFoundException("Student not found in this school.");
    return student;
  }

  private async createStudent(db: Transaction<Database>, schoolId: string, data: z.infer<typeof studentSchema>) {
    await this.checkEnrollment(db, schoolId, data.class_section_id, data.term_id);
    // An unguessable hash is deliberately not a usable initial password.
    const user = await sql<{ id: string }>`INSERT INTO users(username,email,password_hash,first_name,last_name,role,onboarding_pending)
      VALUES (${`student.${randomUUID()}`},${data.email},${digest(randomBytes(32).toString("hex"))},${data.first_name},${data.last_name},'student',true) RETURNING id`.execute(db);
    const userId = user.rows[0]!.id;
    const student = await db.insertInto("students").values({ user_id: userId, school_id: schoolId, admission_number: data.admission_number, date_of_birth: data.date_of_birth, blood_group: null, emergency_contact: null }).returningAll().executeTakeFirstOrThrow();
    await db.insertInto("school_memberships").values({ user_id: userId, school_id: schoolId, role: "student" }).execute();
    await db.insertInto("enrollments").values({ student_id: student.id, class_section_id: data.class_section_id, term_id: data.term_id, roll_number: data.roll_number }).execute();
    return student;
  }

  async student(user: AuthUser, schoolId: string, body: unknown, id?: string) {
    return this.mutate(user, schoolId, "sis.manage", `student.${id ? "updated" : "created"}`, async (db) => {
      if (!id) return this.createStudent(db, schoolId, studentSchema.parse(body));
      const student = await this.schoolStudent(db, schoolId, id);
      const data = studentUpdateSchema.parse(body);
      await db.updateTable("users").set({ first_name: data.first_name, last_name: data.last_name }).where("id", "=", student.user_id).execute();
      return db.updateTable("students").set({ admission_number: data.admission_number, date_of_birth: data.date_of_birth }).where("id", "=", student.id).returningAll().executeTakeFirstOrThrow();
    });
  }

  async importStudents(user: AuthUser, schoolId: string, body: unknown) {
    const { csv, confirm } = z.object({ csv: z.string().max(250_000), confirm: z.boolean().default(false) }).parse(body);
    await this.authorize(user, schoolId, "sis.manage");
    let records: Record<string, unknown>[];
    try { records = parseStudentCsv(csv); } catch (error) { throw new BadRequestException((error as Error).message); }
    const rows = records.map((record, index) => {
      const result = studentSchema.safeParse(record);
      if (!result.success) throw new BadRequestException(`CSV row ${index + 2}: ${result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
      return result.data;
    });
    return this.mutate(user, schoolId, "sis.manage", confirm ? "students.imported" : "students.import_preview", async (db) => {
      const seen = new Set<string>();
      for (const row of rows) {
        await this.checkEnrollment(db, schoolId, row.class_section_id, row.term_id);
        for (const key of [`email:${row.email}`, `admission:${row.admission_number}`, `roll:${row.class_section_id}:${row.term_id}:${row.roll_number}`]) {
          if (seen.has(key)) throw new ConflictException(`Duplicate ${key.split(":")[0]} in CSV.`);
          seen.add(key);
        }
        const conflict = await sql`SELECT 1 FROM users WHERE lower(email)=${row.email}
          UNION ALL SELECT 1 FROM students WHERE school_id=${schoolId}::uuid AND admission_number=${row.admission_number}
          UNION ALL SELECT 1 FROM enrollments WHERE class_section_id=${row.class_section_id}::uuid AND term_id=${row.term_id}::uuid AND roll_number=${row.roll_number}`.execute(db);
        if (conflict.rows.length) throw new ConflictException(`Existing email, admission or roll number for ${row.admission_number}. No students imported.`);
      }
      if (confirm) for (const row of rows) await this.createStudent(db, schoolId, row);
      return { confirmed: confirm, count: rows.length, students: rows.map(({ first_name, last_name, admission_number }) => ({ first_name, last_name, admission_number })) };
    });
  }

  async guardian(user: AuthUser, schoolId: string, body: unknown) {
    const data = guardianSchema.parse(body);
    return this.mutate(user, schoolId, "sis.manage", "guardian.linked", async (db) => {
      await this.schoolStudent(db, schoolId, data.student_id);
      let account = await db.selectFrom("users").select(["id", "role"]).where(sql<boolean>`lower(email)=${data.email}`).executeTakeFirst();
      if (account) {
        // Never let a school alter a global account owned by another school.
        const membership = await db.selectFrom("school_memberships").select("id").where("school_id", "=", schoolId).where("user_id", "=", account.id).where("role", "=", "guardian").where("is_active", "=", true).executeTakeFirst();
        if (!membership) throw new ConflictException("Invite this existing account as a guardian first; it must accept before linking.");
      } else {
        const result = await sql<{ id: string; role: "parent" }>`INSERT INTO users(username,email,password_hash,first_name,last_name,role,onboarding_pending)
          VALUES (${`guardian.${randomUUID()}`},${data.email},${digest(randomBytes(32).toString("hex"))},${data.first_name},${data.last_name},'parent',true) RETURNING id,role`.execute(db);
        account = result.rows[0]!;
      }
      const parent = await db.insertInto("parents").values({ user_id: account.id, phone: data.phone }).onConflict((oc) => oc.column("user_id").doNothing()).returning("id").executeTakeFirst()
        ?? await db.selectFrom("parents").select("id").where("user_id", "=", account.id).executeTakeFirstOrThrow();
      await db.insertInto("school_memberships").values({ user_id: account.id, school_id: schoolId, role: "guardian" }).onConflict((oc) => oc.columns(["user_id", "school_id", "role"]).doNothing()).execute();
      if (data.is_primary) await db.updateTable("guardian_relationships").set({ is_primary: false }).where("student_id", "=", data.student_id).execute();
      return db.insertInto("guardian_relationships").values({ guardian_id: parent.id, student_id: data.student_id, relationship: data.relationship, is_primary: data.is_primary, can_authorize_leave: data.can_authorize_leave })
        .onConflict((oc) => oc.columns(["guardian_id", "student_id"]).doUpdateSet({ relationship: data.relationship, is_primary: data.is_primary, can_authorize_leave: data.can_authorize_leave })).returningAll().executeTakeFirstOrThrow();
    });
  }

  async enroll(user: AuthUser, schoolId: string, body: unknown) {
    const data = enrollmentSchema.parse(body);
    return this.mutate(user, schoolId, "sis.manage", "student.enrolled", async (db) => {
      await this.schoolStudent(db, schoolId, data.student_id);
      await this.checkEnrollment(db, schoolId, data.class_section_id, data.term_id);
      return db.insertInto("enrollments").values(data).returningAll().executeTakeFirstOrThrow();
    });
  }

  async rollover(user: AuthUser, schoolId: string, body: unknown) {
    const data = rolloverSchema.parse(body);
    return this.mutate(user, schoolId, "sis.manage", data.confirm ? "term.promoted" : "term.promotion_preview", async (db) => {
      const source = await db.selectFrom("academic_terms").selectAll().where("id", "=", data.source_term_id).where("school_id", "=", schoolId).executeTakeFirst();
      const target = await db.selectFrom("academic_terms").selectAll().where("id", "=", data.target_term_id).where("school_id", "=", schoolId).where("is_active", "=", true).executeTakeFirst();
      if (!source || !target || target.starts_on <= source.ends_on) throw new BadRequestException("Target term must start after the source term ends.");
      const preview: Array<{ student_id: string; class_section_id: string; term_id: string; roll_number: number }> = [];
      for (const mapping of data.mappings) {
        const from = await db.selectFrom("class_sections").select("id").where("id", "=", mapping.from_class_id).where("school_id", "=", schoolId).where("academic_year", "=", source.academic_year).executeTakeFirst();
        if (!from) throw new BadRequestException("Source class must belong to the source school and year.");
        await this.checkEnrollment(db, schoolId, mapping.to_class_id, target.id);
        const students = await db.selectFrom("enrollments").select(["student_id", "roll_number"]).where("class_section_id", "=", from.id).where("term_id", "=", source.id).where("is_active", "=", true).orderBy("roll_number").execute();
        for (const student of students) preview.push({ ...student, class_section_id: mapping.to_class_id, term_id: target.id });
      }
      const rolls = new Set<string>();
      for (const row of preview) {
        const key = `${row.class_section_id}:${row.roll_number}`;
        if (rolls.has(key)) throw new ConflictException("Merged classes have overlapping roll numbers. Promote them separately after assigning distinct rolls.");
        rolls.add(key);
        const conflict = await db.selectFrom("enrollments").select("id").where("term_id", "=", target.id)
          .where((eb) => eb.or([eb("student_id", "=", row.student_id), eb.and([eb("class_section_id", "=", row.class_section_id), eb("roll_number", "=", row.roll_number)])])).executeTakeFirst();
        if (conflict) throw new ConflictException("Target enrollments already exist. No changes were made.");
      }
      if (data.confirm && preview.length) await db.insertInto("enrollments").values(preview).execute();
      // Historical enrollments remain intact; date-aware readers select the term.
      return { confirmed: data.confirm, count: preview.length, enrollments: preview };
    });
  }

  async invite(user: AuthUser, schoolId: string, body: unknown) {
    const data = z.object({ email: z.email().trim().toLowerCase(), role: z.enum(["student", "guardian", "staff", "admin"]) }).parse(body);
    await this.authorize(user, schoolId, "sis.manage", this.db, true);
    return this.mutate(user, schoolId, "sis.manage", "invitation.created", async (db) => {
      await this.authorize(user, schoolId, "sis.manage", db, true);
      const pendingElsewhere = await sql`SELECT 1 FROM users u WHERE lower(u.email)=${data.email} AND u.onboarding_pending
        AND NOT EXISTS (SELECT 1 FROM school_memberships m WHERE m.user_id=u.id AND m.school_id=${schoolId}::uuid AND m.is_active)`.execute(db);
      if (pendingElsewhere.rows.length) throw new ConflictException("This account must complete its original school onboarding before joining another school.");
      if (data.role === "student") {
        const found = await sql`SELECT 1 FROM students s JOIN users u ON u.id=s.user_id WHERE s.school_id=${schoolId}::uuid AND lower(u.email)=${data.email}`.execute(db);
        if (!found.rows.length) throw new BadRequestException("Create the student record before issuing its invitation.");
      }
      const token = randomBytes(32).toString("base64url");
      await sql`UPDATE school_invitations SET revoked_at=now() WHERE school_id=${schoolId}::uuid AND email=${data.email} AND accepted_at IS NULL AND revoked_at IS NULL`.execute(db);
      const result = await sql<{ id: string; expires_at: Date }>`INSERT INTO school_invitations(school_id,email,role,token_hash,created_by,expires_at)
        VALUES (${schoolId}::uuid,${data.email},${data.role},${digest(token)},${user.id}::uuid,now()+interval '72 hours') RETURNING id,expires_at`.execute(db);
      return { ...result.rows[0], token, delivery: "manual", message: "Share this single-use code privately with the recipient. It expires in 72 hours." };
    });
  }

  async acceptInvite(body: unknown) {
    const data = personSchema.extend({ token: z.string().min(40).max(100), password: z.string().min(1).max(128) }).parse(body);
    return this.db.transaction().execute(async (db) => {
      const candidate = await sql<{ school_id: string }>`SELECT school_id FROM school_invitations WHERE token_hash=${digest(data.token)}`.execute(db);
      if (!candidate.rows[0]) throw new BadRequestException("Invitation is invalid, expired or already used.");
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${candidate.rows[0].school_id},0))`.execute(db);
      const found = await sql<{ id: string; school_id: string; email: string; role: MembershipRole }>`SELECT id,school_id,email,role FROM school_invitations
        WHERE token_hash=${digest(data.token)} AND expires_at>now() AND accepted_at IS NULL AND revoked_at IS NULL FOR UPDATE`.execute(db);
      const invite = found.rows[0];
      if (!invite || invite.email !== data.email) throw new BadRequestException("Invitation is invalid, expired or already used.");
      const inviter = await sql`SELECT 1 FROM school_memberships m JOIN school_invitations i ON i.created_by=m.user_id AND i.school_id=m.school_id
        WHERE i.id=${invite.id}::uuid AND m.role='admin' AND m.is_active`.execute(db);
      if (!inviter.rows.length) throw new ForbiddenException("The inviter no longer has school administrator access.");
      let account = await sql<{ id: string; password_hash: string; onboarding_pending: boolean; is_active: boolean }>`SELECT id,password_hash,onboarding_pending,is_active FROM users WHERE lower(email)=${data.email} FOR UPDATE`.execute(db);
      let accountId = account.rows[0]?.id;
      if (account.rows[0] && !account.rows[0].is_active) throw new ForbiddenException("This account is inactive.");
      if (account.rows[0] && !account.rows[0].onboarding_pending) {
        if (!await verifyPassword(data.password, account.rows[0].password_hash)) throw new ForbiddenException("Enter your existing account password to accept this invitation.");
      } else {
        const errors = validatePassword(data.password, { email: data.email, firstName: data.first_name, lastName: data.last_name });
        if (errors.length) throw new BadRequestException(errors.join(" "));
        const password = await hashPassword(data.password);
        if (accountId) await sql`UPDATE users SET password_hash=${password},onboarding_pending=false WHERE id=${accountId}::uuid`.execute(db);
        else {
          const role = invite.role === "guardian" ? "parent" : invite.role;
          account = await sql<{ id: string; password_hash: string; onboarding_pending: boolean; is_active: boolean }>`INSERT INTO users(username,email,password_hash,first_name,last_name,role)
            VALUES (${`member.${randomUUID()}`},${data.email},${password},${data.first_name},${data.last_name},${role}) RETURNING id,password_hash,onboarding_pending,is_active`.execute(db);
          accountId = account.rows[0]!.id;
        }
      }
      await db.insertInto("school_memberships").values({ school_id: invite.school_id, user_id: accountId!, role: invite.role }).onConflict((oc) => oc.columns(["user_id", "school_id", "role"]).doUpdateSet({ is_active: true })).execute();
      await sql`UPDATE school_invitations SET accepted_at=now() WHERE id=${invite.id}::uuid`.execute(db);
      await sql`INSERT INTO school_operations_audit(school_id,actor_id,action,target_id) VALUES (${invite.school_id}::uuid,${accountId}::uuid,'invitation.accepted',${invite.id}::uuid)`.execute(db);
      return { accepted: true, message: "School access is ready. Sign in with your email and password." };
    });
  }

  async member(user: AuthUser, schoolId: string, id: string, body: unknown) {
    uuid.parse(id);
    const data = z.object({ is_active: z.boolean(), permissions: z.array(z.enum(["sis.manage", "fees.manage"])).max(2).default([]) }).parse(body);
    return this.mutate(user, schoolId, "sis.manage", "membership.updated", async (db) => {
      await this.authorize(user, schoolId, "sis.manage", db, true);
      const member = await db.selectFrom("school_memberships").selectAll().where("id", "=", id).where("school_id", "=", schoolId).executeTakeFirst();
      if (!member) throw new NotFoundException();
      if (member.role !== "staff" && data.permissions.length) throw new BadRequestException("Only staff can receive delegated permissions.");
      if (!data.is_active && member.role === "admin") {
        const remaining = await db.selectFrom("school_memberships").select("id").where("school_id", "=", schoolId).where("role", "=", "admin").where("is_active", "=", true).where("id", "!=", id).execute();
        if (!remaining.length) throw new ConflictException("The school must retain an active administrator.");
      }
      await db.updateTable("school_memberships").set({ is_active: data.is_active }).where("id", "=", id).execute();
      if (!data.is_active) await sql`UPDATE school_invitations SET revoked_at=now() WHERE school_id=${schoolId}::uuid
        AND email=(SELECT lower(email) FROM users WHERE id=${member.user_id}::uuid) AND accepted_at IS NULL AND revoked_at IS NULL`.execute(db);
      await sql`DELETE FROM school_permission_grants WHERE school_id=${schoolId}::uuid AND user_id=${member.user_id}::uuid`.execute(db);
      if (data.is_active) for (const permission of new Set(data.permissions)) await sql`INSERT INTO school_permission_grants(school_id,user_id,permission) VALUES (${schoolId}::uuid,${member.user_id}::uuid,${permission})`.execute(db);
      return { id: member.id, updated: true };
    });
  }

  async revokeInvitation(user: AuthUser, schoolId: string, id: string) {
    uuid.parse(id);
    return this.mutate(user, schoolId, "sis.manage", "invitation.revoked", async (db) => {
      await this.authorize(user, schoolId, "sis.manage", db, true);
      const result = await sql`UPDATE school_invitations SET revoked_at=now() WHERE id=${id}::uuid AND school_id=${schoolId}::uuid AND accepted_at IS NULL RETURNING id`.execute(db);
      if (!result.rows.length) throw new NotFoundException();
      return { revoked: true };
    });
  }

  async fees(user: AuthUser, schoolId: string, studentId?: string) {
    uuid.parse(schoolId);
    if (studentId) {
      await this.schoolStudent(this.db, schoolId, studentId);
      const family = await sql`SELECT 1 FROM students s WHERE s.id=${studentId}::uuid AND s.school_id=${schoolId}::uuid AND (
        (s.user_id=${user.id}::uuid AND EXISTS (SELECT 1 FROM school_memberships m WHERE m.user_id=${user.id}::uuid AND m.school_id=s.school_id AND m.role='student' AND m.is_active)) OR
        EXISTS (SELECT 1 FROM parents p JOIN guardian_relationships gr ON gr.guardian_id=p.id JOIN school_memberships m ON m.user_id=p.user_id AND m.school_id=s.school_id
          WHERE p.user_id=${user.id}::uuid AND gr.student_id=s.id AND m.role='guardian' AND m.is_active))`.execute(this.db);
      if (!family.rows.length) await this.authorize(user, schoolId, "fees.manage");
    } else await this.authorize(user, schoolId, "fees.manage");
    const invoices = await sql`SELECT invoice.*,person.first_name,person.last_name,student.admission_number,
      totals.paid_paise,totals.credited_paise,totals.refunded_paise,
      calculation.adjusted_amount_paise,calculation.net_paid_paise,
      calculation.balance_paise,calculation.refund_due_paise,
      CASE
        WHEN calculation.refund_due_paise>0 AND totals.refunded_paise>0 THEN 'partially_refunded'
        WHEN calculation.refund_due_paise>0 THEN 'refund_due'
        WHEN totals.credited_paise>0 AND totals.refunded_paise>0 THEN 'refunded'
        WHEN totals.credited_paise>0 THEN 'credited'
        WHEN calculation.balance_paise=0 THEN 'paid'
        ELSE 'collectible'
      END AS collection_state
      FROM fee_invoices invoice
      JOIN students student ON student.id=invoice.student_id AND student.school_id=invoice.school_id
      JOIN school_people person ON person.id=student.person_id AND person.school_id=student.school_id
      LEFT JOIN LATERAL (
        SELECT
          COALESCE((SELECT sum(payment.amount_paise) FROM fee_payments payment
            WHERE payment.school_id=invoice.school_id AND payment.invoice_id=invoice.id),0)::int AS paid_paise,
          COALESCE((SELECT sum(credit.amount_paise) FROM fee_invoice_credits credit
            WHERE credit.school_id=invoice.school_id AND credit.invoice_id=invoice.id),0)::int AS credited_paise,
          COALESCE((SELECT sum(refund.amount_paise) FROM fee_refunds refund
            WHERE refund.school_id=invoice.school_id AND refund.invoice_id=invoice.id),0)::int AS refunded_paise
      ) totals ON true
      LEFT JOIN LATERAL (
        SELECT GREATEST(invoice.amount_paise-totals.credited_paise,0)::int AS adjusted_amount_paise,
          GREATEST(totals.paid_paise-totals.refunded_paise,0)::int AS net_paid_paise
      ) base ON true
      LEFT JOIN LATERAL (
        SELECT GREATEST(base.adjusted_amount_paise-base.net_paid_paise,0)::int AS balance_paise,
          GREATEST(base.net_paid_paise-base.adjusted_amount_paise,0)::int AS refund_due_paise,
          base.adjusted_amount_paise,base.net_paid_paise
      ) calculation ON true
      WHERE invoice.school_id=${schoolId}::uuid
        AND (${studentId ?? null}::uuid IS NULL OR invoice.student_id=${studentId ?? null}::uuid)
      ORDER BY invoice.due_on,invoice.created_at`.execute(this.db);
    const payments = await sql`SELECT p.id,p.invoice_id,p.amount_paise,p.method,p.reference,p.created_at FROM fee_payments p JOIN fee_invoices i ON i.id=p.invoice_id
      WHERE p.school_id=${schoolId}::uuid AND (${studentId ?? null}::uuid IS NULL OR i.student_id=${studentId ?? null}::uuid) ORDER BY p.created_at DESC`.execute(this.db);
    return { currency: "INR", invoices: invoices.rows, payments: payments.rows, online_payments_enabled: false };
  }

  async feeStudents(user: AuthUser, schoolId: string) {
    await this.authorize(user, schoolId, "fees.manage");
    const result = await sql`SELECT s.id,s.admission_number,p.first_name,p.last_name FROM students s
      JOIN school_people p ON p.id=s.person_id AND p.school_id=s.school_id
      WHERE s.school_id=${schoolId}::uuid ORDER BY s.admission_number`.execute(this.db);
    return { results: result.rows };
  }

  async invoice(user: AuthUser, schoolId: string, body: unknown) {
    const data = invoiceSchema.parse(body);
    return this.mutate(user, schoolId, "fees.manage", "fee.invoice_posted", async (db) => {
      await this.schoolStudent(db, schoolId, data.student_id);
      const result = await sql`INSERT INTO fee_invoices(school_id,student_id,reference,description,amount_paise,due_on,created_by)
        VALUES (${schoolId}::uuid,${data.student_id}::uuid,${data.reference},${data.description},${data.amount_paise},${data.due_on}::date,${user.id}::uuid) RETURNING *`.execute(db);
      return result.rows[0];
    });
  }

  async payment(user: AuthUser, schoolId: string, invoiceId: string, body: unknown) {
    uuid.parse(invoiceId); const data = paymentSchema.parse(body);
    return this.mutate(user, schoolId, "fees.manage", "fee.payment_recorded", async (db) => {
      const previous = await sql<{ invoice_id: string; amount_paise: number; method: string; reference: string }>`SELECT * FROM fee_payments WHERE school_id=${schoolId}::uuid AND idempotency_key=${data.idempotency_key}::uuid`.execute(db);
      if (previous.rows[0]) {
        const row = previous.rows[0];
        if (row.invoice_id !== invoiceId || row.amount_paise !== data.amount_paise || row.method !== data.method || row.reference !== data.reference) throw new ConflictException("Idempotency key was already used with different payment details.");
        return row;
      }
      const invoice = await sql<{
        amount_paise: number;
        paid_paise: number;
        credited_paise: number;
        refunded_paise: number;
      }>`SELECT invoice.amount_paise,
          COALESCE((SELECT sum(payment.amount_paise) FROM fee_payments payment
            WHERE payment.school_id=invoice.school_id AND payment.invoice_id=invoice.id),0)::int AS paid_paise,
          COALESCE((SELECT sum(credit.amount_paise) FROM fee_invoice_credits credit
            WHERE credit.school_id=invoice.school_id AND credit.invoice_id=invoice.id),0)::int AS credited_paise,
          COALESCE((SELECT sum(refund.amount_paise) FROM fee_refunds refund
            WHERE refund.school_id=invoice.school_id AND refund.invoice_id=invoice.id),0)::int AS refunded_paise
        FROM fee_invoices invoice
        WHERE invoice.id=${invoiceId}::uuid AND invoice.school_id=${schoolId}::uuid
        FOR UPDATE OF invoice`.execute(db);
      const ledger = invoice.rows[0];
      if (!ledger) throw new NotFoundException();
      const adjusted = Math.max(ledger.amount_paise - ledger.credited_paise, 0);
      const netPaid = Math.max(ledger.paid_paise - ledger.refunded_paise, 0);
      const collectible = Math.max(adjusted - netPaid, 0);
      if (!collectible) {
        if (ledger.credited_paise) throw new ConflictException("This invoice has been credited and has no collectible balance.");
        throw new BadRequestException("This invoice has no outstanding balance.");
      }
      if (data.amount_paise > collectible) throw new BadRequestException("Payment exceeds the outstanding invoice balance.");
      const result = await sql`INSERT INTO fee_payments(school_id,invoice_id,amount_paise,method,reference,idempotency_key,recorded_by)
        VALUES (${schoolId}::uuid,${invoiceId}::uuid,${data.amount_paise},${data.method},${data.reference},${data.idempotency_key}::uuid,${user.id}::uuid) RETURNING *`.execute(db);
      return result.rows[0];
    });
  }
}
