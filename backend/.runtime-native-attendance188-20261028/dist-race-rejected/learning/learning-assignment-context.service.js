var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { sql } from "kysely";
import { executionEnvironmentStorage, executionNow } from "../campus-model-core/execution-time.runtime.js";
import { LearningAssignmentModelService } from "./learning-assignment-model.service.js";
/** Typed class/term and canonical-person offering adapters. A title or portal never grants eligibility. */
let LearningAssignmentContextService = class LearningAssignmentContextService {
    model;
    constructor(model) {
        this.model = model;
    }
    async account(tx, user) {
        if (!user.active_school_id || !user.is_active)
            throw new ForbiddenException("Choose an active campus account.");
        const school = await tx.selectFrom("schools").innerJoin("school_memberships as member", "member.school_id", "schools.id")
            .innerJoin("users as account", "account.id", "member.user_id").select(["schools.id", "schools.timezone"])
            .where("schools.id", "=", user.active_school_id).where("member.user_id", "=", user.id)
            .where("member.is_active", "=", true).where("account.is_active", "=", true).executeTakeFirst();
        if (!school)
            throw new ForbiddenException("Your campus access is no longer active.");
        const selected = executionEnvironmentStorage.getStore();
        if (selected && selected.institution_id !== school.id)
            throw new ForbiddenException("The selected world does not match this campus.");
        const actor = await this.model.acting(tx, user, school.id);
        return { ...school, actor, today: new Intl.DateTimeFormat("en-CA", { timeZone: school.timezone }).format(executionNow()) };
    }
    async teacher(tx, user, classId, subjectId) {
        const school = await this.account(tx, user);
        const grants = (await sql `SELECT binding.source_id,binding.revision,binding.subject_id
      FROM staff_role_bindings binding JOIN staff_profiles staff ON staff.user_id=binding.user_id AND staff.school_id=binding.school_id AND staff.status='active'
      WHERE binding.school_id=${school.id}::uuid AND binding.user_id=${user.id}::uuid AND staff.person_id=${school.actor.person_id}::uuid
        AND binding.context_kind='class' AND binding.scope_id=${classId}::uuid AND binding.status='active' AND binding.role_active
        AND ${school.today}::date>=binding.starts_on AND (binding.ends_on IS NULL OR ${school.today}::date<=binding.ends_on)
        AND 'learning.assignments.manage'=ANY(binding.permissions)
        AND (${subjectId === undefined} OR binding.subject_id IS NULL OR binding.subject_id=${subjectId ?? null}::uuid)
      ORDER BY binding.source_id`.execute(tx)).rows;
        if (!grants.length)
            throw new ForbiddenException("Your current class assignment authority is unavailable. Ask your campus administrator to review it.");
        const section = await tx.selectFrom("class_sections").select(["id", "grade", "section", "academic_year"])
            .where("id", "=", classId).where("school_id", "=", school.id).executeTakeFirst();
        if (!section)
            throw new NotFoundException("This class is unavailable.");
        return { school, section, grants };
    }
    async family(tx, user, studentId, source, writing = false) {
        if (source?.context_kind === "learning_offering")
            return this.offeringLearner(tx, user, studentId, source, writing);
        const school = await this.account(tx, user);
        const row = (await sql `SELECT student.id,student.person_id,student.user_id,
      concat_ws(' ',person.first_name,person.last_name) AS name,
      student.user_id=${user.id}::uuid AND student.person_id=${school.actor.person_id}::uuid AND EXISTS(SELECT 1 FROM school_memberships member WHERE member.school_id=student.school_id
        AND member.user_id=${user.id}::uuid AND member.is_active AND member.role='student') AS self,
      EXISTS(SELECT 1 FROM guardian_relationships relationship JOIN parents parent ON parent.id=relationship.guardian_id
        JOIN school_memberships member ON member.school_id=relationship.school_id AND member.user_id=parent.user_id AND member.is_active AND member.role='guardian'
        JOIN guardian_school_profiles guardian_profile ON guardian_profile.school_id=relationship.school_id AND guardian_profile.guardian_id=parent.id
        WHERE relationship.school_id=student.school_id AND relationship.student_id=student.id AND parent.user_id=${user.id}::uuid
          AND guardian_profile.person_id=${school.actor.person_id}::uuid) AS guardian
      FROM students student JOIN school_people person ON person.id=student.person_id AND person.school_id=student.school_id
      WHERE student.school_id=${school.id}::uuid AND student.id=${studentId}::uuid`.execute(tx)).rows[0];
        if (!row || !row.self && !row.guardian)
            throw new ForbiddenException("This learner is not available through your current relationship.");
        if (source) {
            if (source.state !== "published" || !await tx.selectFrom("learning_assignment_audience").select("student_id")
                .where("school_id", "=", school.id).where("assignment_id", "=", source.id).where("student_id", "=", studentId).executeTakeFirst())
                throw new NotFoundException("This assignment is not part of this learner's published work.");
            // Read historical submitted work through the frozen audience; new writes require current class/term entitlement.
            if (writing && (!row.self || !(await this.currentEnrollment(tx, source, studentId, school.today))))
                throw new ForbiddenException(row.self ? "Your current class enrollment no longer allows changes. Previously submitted work remains available." : "Only the learner can save or submit their work. Guardians have read-only access to submitted work.");
        }
        return { school, student: row };
    }
    async currentEnrollment(tx, source, studentId, today) {
        return tx.selectFrom("enrollments").innerJoin("academic_terms", "academic_terms.id", "enrollments.term_id")
            .select("enrollments.id").where("enrollments.student_id", "=", studentId).where("enrollments.class_section_id", "=", source.class_section_id)
            .where("enrollments.term_id", "=", source.term_id).where("enrollments.is_active", "=", true).where("enrollments.enrolled_on", "<=", today)
            .where(eb => eb.or([eb("enrollments.inactive_from", "is", null), eb("enrollments.inactive_from", ">", today)]))
            .where("academic_terms.starts_on", "<=", today).where("academic_terms.ends_on", ">=", today).executeTakeFirst();
    }
    async reviewer(tx, user, source) {
        if (source.context_kind === "learning_offering") {
            const access = await this.offeringTeacher(tx, user, source.offering_id, "review");
            if (source.state !== "published" || source.reviewer_id !== user.id || source.reviewer_person_id !== access.school.actor.person_id)
                throw new ForbiddenException("Only the assignment's currently appointed reviewer can open submitted work.");
            return access;
        }
        const access = await this.teacher(tx, user, source.class_section_id, source.subject_id);
        if (source.state !== "published" || source.reviewer_id !== user.id)
            throw new ForbiddenException("Only this assignment's currently authorized reviewer can open submitted work.");
        return access;
    }
    async instructor(tx, user, source) {
        if (source.context_kind !== "learning_offering")
            return this.teacher(tx, user, source.class_section_id, source.subject_id);
        const access = await this.offeringTeacher(tx, user, source.offering_id, "publish");
        if (source.author_id === user.id && source.author_person_id !== access.school.actor.person_id)
            throw new ForbiddenException("The assignment author person link changed.");
        return access;
    }
    async setup(tx, user) {
        const school = await this.account(tx, user);
        const admin = await tx.selectFrom("school_memberships").select("id").where("school_id", "=", school.id)
            .where("user_id", "=", user.id).where("role", "=", "admin").where("is_active", "=", true).forShare().executeTakeFirst();
        if (!admin)
            throw new ForbiddenException("Current campus setup authority is required to appoint teaching responsibility.");
        return school;
    }
    async offeringTeacher(tx, user, offeringId, action) {
        const school = await this.account(tx, user);
        const offering = await tx.selectFrom("learning_offerings").selectAll().where("school_id", "=", school.id).where("id", "=", offeringId).forShare().executeTakeFirst();
        if (!offering || offering.state !== "active")
            throw new NotFoundException("This learning offering is unavailable.");
        const grants = await tx.selectFrom("learning_offering_teaching_assignments").select(["id as source_id", "revision"])
            .where("school_id", "=", school.id).where("offering_id", "=", offeringId).where("person_id", "=", school.actor.person_id)
            .where(action === "publish" ? "can_publish" : "can_review", "=", true).where("starts_on", "<=", school.today)
            .where(eb => eb.or([eb("ends_on", "is", null), eb("ends_on", ">", school.today)])).forShare().execute();
        if (!grants.length)
            throw new ForbiddenException("Your current teaching appointment is unavailable for this offering.");
        return { school, offering, grants: grants.map(grant => ({ ...grant, subject_id: null })) };
    }
    async personSelf(tx, user, personId) {
        const school = await this.account(tx, user);
        if (school.actor.person_id !== personId)
            throw new ForbiddenException("Open your own learning context.");
        const person = await tx.selectFrom("school_people").select(["id", "first_name", "last_name"]).where("school_id", "=", school.id).where("id", "=", personId).executeTakeFirst();
        if (!person)
            throw new NotFoundException("Learner unavailable.");
        return { school, student: { id: person.id, person_id: person.id, user_id: user.id, name: `${person.first_name} ${person.last_name}`.trim(), self: true, guardian: false } };
    }
    async offeringLearner(tx, user, personId, source, writing) {
        const access = await this.personSelf(tx, user, personId);
        const audience = await tx.selectFrom("learning_assignment_audience").select(["offering_enrollment_id", "learner_id"])
            .where("school_id", "=", source.school_id).where("assignment_id", "=", source.id).where("person_id", "=", personId).executeTakeFirst();
        if (source.state !== "published" || !audience)
            throw new NotFoundException("This assignment is not part of your published work.");
        if (writing) {
            // Match setup's offering -> registration lock order. Publication and writes
            // linearize before an exact registration end, without restoring old rights.
            const offering = await tx.selectFrom("learning_offerings").select("state").where("school_id", "=", source.school_id).where("id", "=", source.offering_id).forShare().executeTakeFirst();
            if (offering?.state !== "active")
                throw new ForbiddenException("This learning group no longer permits changes. Submitted history remains available.");
            const registration = await tx.selectFrom("learning_offering_enrollments").select("id").where("id", "=", audience.offering_enrollment_id)
                .where("school_id", "=", source.school_id).where("offering_id", "=", source.offering_id).where("person_id", "=", personId)
                .where("starts_on", "<=", access.school.today).where(eb => eb.or([eb("ends_on", "is", null), eb("ends_on", ">", access.school.today)])).forShare().executeTakeFirst();
            if (!registration)
                throw new ForbiddenException("The original offering enrollment no longer permits changes. Submitted history remains available; rejoining does not reopen this assignment.");
        }
        return access;
    }
    async source(tx, user, id, lock = false) {
        const school = await this.account(tx, user);
        let query = tx.selectFrom("learning_assignments").selectAll().where("school_id", "=", school.id).where("id", "=", id);
        if (lock)
            query = query.forUpdate();
        const source = await query.executeTakeFirst();
        if (!source)
            throw new NotFoundException("Assignment unavailable.");
        return source;
    }
};
LearningAssignmentContextService = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [LearningAssignmentModelService])
], LearningAssignmentContextService);
export { LearningAssignmentContextService };
//# sourceMappingURL=learning-assignment-context.service.js.map