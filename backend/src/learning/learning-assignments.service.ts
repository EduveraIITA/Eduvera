import { createHash } from "node:crypto";
import { basename, join } from "node:path";
import { Readable } from "node:stream";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import type { AuthUser } from "../common/request.js";
import { DatabaseService } from "../database/database.service.js";
import type { Database } from "../database/types.js";
import { executionNow } from "../campus-model-core/execution-time.runtime.js";
import { mkdir, writeFile, readEnvironmentStoredFile } from "../common/environment-files.js";
import { config } from "../config.js";
import { assignmentCommand, learningAssignmentDraft, assignmentId, assignmentLimits, assignmentPublication, assignmentReceipts, offeringAssignmentReceipts, assignmentReview, assignmentSubmit, assignmentUpload, learnerDraft, type AssignmentUpload } from "./learning-assignment.contracts.js";
import { LearningAssignmentContextService, type AssignmentSource } from "./learning-assignment-context.service.js";
import { assignmentHash, LearningAssignmentModelService, type AssignmentRoute } from "./learning-assignment-model.service.js";
import { assignmentHandoverReferences, currentAssignmentAttempt } from "./learning-assignment-handover-state.js";
import { readAssignmentsReadiness } from "./learning-assignment-readiness.js";
import { retainAssignmentsContinuation } from "../institution-onboarding/operating-resume.js";

const pageOf = (value?: string) => { const page = Number(value ?? 1); if (!Number.isInteger(page) || page < 1 || page > 10000) throw new BadRequestException("Choose a valid page."); return page; };
export const assignmentHref = (source: Pick<AssignmentSource, "id" | "class_section_id" | "context_kind" | "offering_id">, studentId?: string, family?: "self" | "dependent") =>
  `/areas/messages/assignments?${new URLSearchParams(source.context_kind === "learning_offering"
    ? family ? { scope: "person", person_id: studentId!, assignment: source.id } : { scope: "offering", offering_id: source.offering_id!, assignment: source.id, ...(studentId ? { learner: studentId } : {}) }
    : family ? { scope: family, student_id: studentId!, assignment: source.id } : { scope: "class", class_section_id: source.class_section_id!, assignment: source.id, ...(studentId ? { learner: studentId } : {}) }).toString()}`;
const learnerRef = (source: Pick<AssignmentSource, "context_kind">, id: string) => source.context_kind === "learning_offering" ? { person_id: id } : { student_id: id };
const workReceipts = (source: Pick<AssignmentSource, "context_kind">) => source.context_kind === "learning_offering" ? offeringAssignmentReceipts : assignmentReceipts;
const learnerValues = (source: Pick<AssignmentSource, "context_kind">, id: string) => ({ learner_id: id, student_id: source.context_kind === "learning_offering" ? null : id });

export interface LearningAssignmentWorkItem {
  id: string; assignment_id: string; student_id: string; attempt_id: string | null; action: "submit" | "revise" | "review";
  stream: "needs_me" | "waiting"; state: "action_required" | "waiting_for_review" | "needs_reassignment" | "route_unavailable";
  title: string; student_label: string; reviewer_label: string; owner_user_id: string | null; message_id: string | null;
  source_revision: number; href: string; created_at: string; due_at: string | null;
}

@Injectable()
export class LearningAssignmentsService {
  constructor(private readonly db: DatabaseService, private readonly context: LearningAssignmentContextService, private readonly model: LearningAssignmentModelService) {}

  readiness(user: AuthUser) { return readAssignmentsReadiness(this.db, this.model.identityPort(), user, user.active_school_id ?? "00000000-0000-0000-0000-000000000000"); }

  private async offeringList(tx: Transaction<Database>, user: AuthUser, query: { offering_id?: string; person_id?: string }, page: number) {
    if (query.offering_id && query.person_id) throw new BadRequestException("Choose one learning context.");
    if (query.person_id) {
      const access = await this.context.personSelf(tx, user, assignmentId.parse(query.person_id));
      const items = await tx.selectFrom("learning_assignments as assignment").innerJoin("learning_assignment_audience as audience", join =>
        join.onRef("audience.school_id", "=", "assignment.school_id").onRef("audience.assignment_id", "=", "assignment.id"))
        .selectAll("assignment").where("assignment.school_id", "=", access.school.id).where("assignment.context_kind", "=", "learning_offering")
        .where("audience.person_id", "=", query.person_id).where("assignment.state", "=", "published").orderBy("assignment.published_at", "desc").orderBy("assignment.id").limit(11).offset((page - 1) * 10).execute();
      return { context: "learner" as const, student: null, learner: { id: access.student.id, person_id: access.student.person_id, name: access.student.name }, can_create: false,
        timezone: access.school.timezone, items: items.slice(0, 10), page, has_more: items.length > 10 };
    }
    const offeringId = assignmentId.parse(query.offering_id), school = await this.context.account(tx, user);
    const grants = await tx.selectFrom("learning_offering_teaching_assignments").select(["can_publish", "can_review"])
      .where("school_id", "=", school.id).where("offering_id", "=", offeringId).where("person_id", "=", school.actor.person_id).where("starts_on", "<=", school.today)
      .where(eb => eb.or([eb("ends_on", "is", null), eb("ends_on", ">", school.today)])).execute();
    if (!grants.length) throw new ForbiddenException("Your current teaching appointment is unavailable for this offering.");
    const offering = await tx.selectFrom("learning_offerings").select(["id", "name", "revision"]).where("school_id", "=", school.id).where("id", "=", offeringId).where("state", "=", "active").executeTakeFirst();
    if (!offering) throw new NotFoundException("Learning group unavailable.");
    const items = await tx.selectFrom("learning_assignments").selectAll().where("school_id", "=", school.id).where("offering_id", "=", offeringId)
      .where(eb => eb.or([eb.and([eb("author_id", "=", user.id), eb("author_person_id", "=", school.actor.person_id), eb.val(grants.some(item => item.can_publish))]),
        eb.and([eb("reviewer_id", "=", user.id), eb("reviewer_person_id", "=", school.actor.person_id), eb("state", "=", "published"), eb.val(grants.some(item => item.can_review))])]))
      .orderBy("updated_at", "desc").orderBy("id").limit(11).offset((page - 1) * 10).execute();
    const eligible = (await sql<{ person_id: string; name: string }>`SELECT person.id AS person_id,concat_ws(' ',person.first_name,person.last_name) AS name
      FROM learning_offering_teaching_assignments appointment JOIN school_people person ON person.id=appointment.person_id AND person.school_id=appointment.school_id
      WHERE appointment.school_id=${school.id}::uuid AND appointment.offering_id=${offeringId}::uuid
        AND appointment.can_review AND appointment.starts_on<=${school.today}::date AND(appointment.ends_on IS NULL OR appointment.ends_on>${school.today}::date)
      ORDER BY name,person.id`.execute(tx)).rows;
    const reviewers: Array<{ id: string; person_id: string; name: string; subject_id: null }> = [];
    for (const candidate of eligible) {
      const actor = await this.model.identityPort().resolvePersonAgent(tx, { school_id: school.id, person_id: candidate.person_id, at: executionNow().toISOString() });
      if (actor.acting) reviewers.push({ ...candidate, id: actor.user_id, subject_id: null });
    }
    return { context: "offering" as const, offering, timezone: school.timezone, can_create: grants.some(item => item.can_publish), can_general: true, terms: [], subjects: [], reviewers,
      items: items.slice(0, 10), page, has_more: items.length > 10 };
  }

  async list(user: AuthUser, query: { class_section_id?: string; student_id?: string; offering_id?: string; person_id?: string; page?: string }) {
    const page = pageOf(query.page);
    return this.db.transaction().execute(async tx => {
      if (query.offering_id || query.person_id) return this.offeringList(tx, user, query, page);
      if (query.student_id) {
        assignmentId.parse(query.student_id);
        const access = await this.context.family(tx, user, query.student_id);
        const items = await tx.selectFrom("learning_assignments as assignment").innerJoin("learning_assignment_audience as audience", join =>
          join.onRef("audience.school_id", "=", "assignment.school_id").onRef("audience.assignment_id", "=", "assignment.id"))
          .selectAll("assignment").where("assignment.school_id", "=", access.school.id).where("audience.student_id", "=", query.student_id)
          .where("assignment.state", "=", "published").orderBy("assignment.published_at", "desc").orderBy("assignment.id").limit(11).offset((page - 1) * 10).execute();
        return { context: "learner" as const, student: { id: access.student.id, name: access.student.name }, can_create: false,
          timezone: access.school.timezone, items: items.slice(0, 10), page, has_more: items.length > 10 };
      }
      const classId = assignmentId.parse(query.class_section_id), access = await this.context.teacher(tx, user, classId);
      const items = await tx.selectFrom("learning_assignments").selectAll().where("school_id", "=", access.school.id).where("class_section_id", "=", classId)
        .where(eb => eb.or([eb("author_id", "=", user.id), eb.and([eb("reviewer_id", "=", user.id), eb("state", "=", "published")])]))
        .where(eb => eb.or(access.grants.map(grant => grant.subject_id ? eb("subject_id", "=", grant.subject_id) : eb.val(true))))
        .orderBy("updated_at", "desc").orderBy("id").limit(11).offset((page - 1) * 10).execute();
      const terms = await tx.selectFrom("academic_terms").select(["id", "name"]).where("school_id", "=", access.school.id)
        .where("academic_year", "=", access.section.academic_year).where("starts_on", "<=", access.school.today).where("ends_on", ">=", access.school.today).orderBy("starts_on", "desc").execute();
      const subjects = await tx.selectFrom("subjects").select(["id", "name"]).where("school_id", "=", access.school.id).orderBy("name").execute();
      const reviewers = (await sql<{ id: string; name: string; subject_id: string | null }>`SELECT DISTINCT account.id,concat_ws(' ',person.first_name,person.last_name) AS name,binding.subject_id
        FROM staff_role_bindings binding JOIN users account ON account.id=binding.user_id AND account.is_active
        JOIN staff_profiles staff ON staff.user_id=account.id AND staff.school_id=binding.school_id AND staff.status='active'
        JOIN school_people person ON person.id=staff.person_id AND person.school_id=staff.school_id
        JOIN school_memberships member ON member.school_id=binding.school_id AND member.user_id=account.id AND member.is_active
        WHERE binding.school_id=${access.school.id}::uuid AND binding.context_kind='class' AND binding.scope_id=${classId}::uuid
          AND binding.status='active' AND binding.role_active AND 'learning.assignments.manage'=ANY(binding.permissions)
          AND ${access.school.today}::date>=binding.starts_on AND (binding.ends_on IS NULL OR ${access.school.today}::date<=binding.ends_on)
          AND campus_model_account_person_is_active(binding.school_id,account.id,person.id,${executionNow()}::timestamptz)
        ORDER BY name,account.id`.execute(tx)).rows;
      return { context: "class" as const, class_section: { id: classId, label: `Class ${access.section.grade}${access.section.section}` },
        timezone: access.school.timezone, can_create: true, can_general: access.grants.some(grant => !grant.subject_id), terms,
        subjects: subjects.filter(subject => access.grants.some(grant => !grant.subject_id || grant.subject_id === subject.id)), reviewers,
        items: items.slice(0, 10), page, has_more: items.length > 10 };
    });
  }

  async save(user: AuthUser, raw: unknown) {
    const data = learningAssignmentDraft.parse(raw), offering = "offering_id" in data;
    return this.db.transaction().execute(async tx => {
      const access = offering ? await this.context.offeringTeacher(tx, user, data.offering_id, "publish") : await this.context.teacher(tx, user, data.class_section_id, data.subject_id);
      // Serializes creation before the first row exists, including lost-response retries.
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`assignment-source:${data.assignment_id}`},0))`.execute(tx);
      const current = await tx.selectFrom("learning_assignments").selectAll().where("id", "=", data.assignment_id).forUpdate().executeTakeFirst();
      if (current && (current.school_id !== access.school.id || current.author_id !== user.id)) throw new ForbiddenException("Only this assignment's author can edit the draft.");
      if (current?.context_kind === "learning_offering" && current.author_person_id !== access.school.actor.person_id) throw new ForbiddenException("This draft belongs to the original author person. Ask the campus to review the account link.");
      if (current && (current.context_kind === "learning_offering" ? !offering || current.offering_id !== data.offering_id : offering)) throw new ConflictException("Keep the assignment's original learning context.");
      const source = current ?? { id: data.assignment_id, school_id: access.school.id, revision: 0, class_section_id: offering ? null : data.class_section_id, title: data.title, context_kind: offering ? "learning_offering" : "class_term" };
      const prepared = await this.model.prepare(tx, user, source, "draft.save", data, data, access.grants);
      if (prepared.status === "completed") return { ...assignmentReceipts.saved.parse(prepared.metadata), replayed: true };
      if (current?.state === "published") this.model.obsoleteState(source, data, "instructions_published");
      if (!offering) {
        const section = await tx.selectFrom("class_sections").select("academic_year").where("id", "=", data.class_section_id).where("school_id", "=", access.school.id).executeTakeFirstOrThrow();
        const term = await tx.selectFrom("academic_terms").select("id").where("id", "=", data.term_id).where("school_id", "=", access.school.id)
          .where("academic_year", "=", section.academic_year).where("starts_on", "<=", access.school.today).where("ends_on", ">=", access.school.today).executeTakeFirst();
        if (!term) throw new BadRequestException("Choose the class's current term.");
      }
      const reviewAccess = offering ? await this.context.offeringTeacher(tx, { ...user, id: data.reviewer_id }, data.offering_id, "review") : null;
      if (data.cutoff_at && data.due_at && Date.parse(data.cutoff_at) < Date.parse(data.due_at)) throw new BadRequestException("The submission cutoff cannot be before the due time.");
      const now = executionNow(), values = { context_kind: offering ? "learning_offering" as const : "class_term" as const,
        offering_id: offering ? data.offering_id : null, class_section_id: offering ? null : data.class_section_id, term_id: offering ? null : data.term_id, subject_id: offering ? null : data.subject_id,
        author_person_id: offering ? access.school.actor.person_id : null, reviewer_person_id: reviewAccess?.school.actor.person_id ?? null,
        reviewer_id: data.reviewer_id, title: data.title, instructions: data.instructions, due_at: data.due_at, cutoff_at: data.cutoff_at,
        submission_mode: data.submission_mode, max_attempts: data.max_attempts, policy_version: data.policy_version, resubmission_mode: data.resubmission_mode,
        revision: source.revision + 1, updated_at: now };
      const saved = current ? await tx.updateTable("learning_assignments").set(values).where("id", "=", current.id).returningAll().executeTakeFirstOrThrow()
        : await tx.insertInto("learning_assignments").values({ ...values, id: data.assignment_id, school_id: access.school.id, author_id: user.id, state: "draft",
          published_at: null, review_route_version_id: null, review_subscription_id: null, revision_route_version_id: null, revision_subscription_id: null, created_at: now }).returningAll().executeTakeFirstOrThrow();
      const result = { id: saved.id, revision: saved.revision };
      const event = await this.model.event(tx, user, saved, "draft_saved", prepared.command_id, [user.id]);
      await this.model.finish(tx, saved, prepared.command_id, result, event.event_id);
      await retainAssignmentsContinuation(tx, user, saved.school_id, saved);
      return { ...result, replayed: false };
    });
  }

  async publish(user: AuthUser, id: string, raw: unknown) {
    const data = assignmentPublication.parse(raw);
    return this.db.transaction().execute(async tx => {
      const source = await this.context.source(tx, user, assignmentId.parse(id), true);
      const access = await this.context.instructor(tx, user, source);
      if (source.author_id !== user.id) throw new ForbiddenException("Only the assignment author can publish it.");
      const prepared = await this.model.prepare(tx, user, source, "publish", data, { id, ...data }, access.grants);
      if (prepared.status === "completed") return { ...assignmentReceipts.published.parse(prepared.metadata), replayed: true };
      if (source.state !== "draft") this.model.obsoleteState(source, data, "instructions_published");
      if (source.cutoff_at && source.cutoff_at.getTime() <= executionNow().getTime()) throw new BadRequestException("The submission cutoff has already passed.");
      if (source.context_kind === "learning_offering") {
        const reviewer = await this.context.offeringTeacher(tx, { ...user, id: source.reviewer_id }, source.offering_id!, "review");
        if (reviewer.school.actor.person_id !== source.reviewer_person_id) throw new ConflictException("The selected reviewer's person link changed. Save and review the instructor selection before publication.");
      }
      else await this.context.teacher(tx, { ...user, id: source.reviewer_id }, source.class_section_id!, source.subject_id);
      const roster = await this.publicationRoster(tx, source, access.school.today);
      if (!roster.length || roster.length > (source.context_kind === "learning_offering" ? 100 : 1000)) throw new BadRequestException("Publish to a current audience within this context's supported learner limit.");
      if (assignmentHash(roster) !== data.audience_hash) throw new ConflictException("The class audience changed. Review the current people before publishing.");
      const next = { ...source, revision: source.revision + 1 };
      const route = await this.model.route(tx, user, next, "review", source.reviewer_id, data.command_id);
      await tx.insertInto("learning_assignment_audience").values(roster.map(row => ({ school_id: source.school_id, assignment_id: id,
        learner_id: row.learner_id, person_id: row.person_id, student_id: row.student_id, enrollment_id: row.enrollment_id,
        offering_enrollment_id: row.offering_enrollment_id, enrollment_revision: row.revision, created_at: executionNow() }))).execute();
      const saved = await tx.updateTable("learning_assignments").set({ state: "published", published_at: executionNow(), revision: next.revision,
        updated_at: executionNow(), review_route_version_id: route.behaviour_version_id, review_subscription_id: route.subscription_id }).where("id", "=", id).returningAll().executeTakeFirstOrThrow();
      const result = { id, revision: saved.revision, audience_count: roster.length };
      const event = await this.model.event(tx, user, saved, "published", prepared.command_id, [user.id, source.reviewer_id]);
      await this.model.finish(tx, saved, prepared.command_id, result, event.event_id);
      await retainAssignmentsContinuation(tx, user, saved.school_id, saved);
      return { ...result, replayed: false };
    });
  }

  async detail(user: AuthUser, id: string, studentId?: string, pageValue?: string) {
    return this.db.transaction().execute(async tx => {
      const source = await this.context.source(tx, user, assignmentId.parse(id));
      if (studentId) return this.workDetail(tx, user, source, assignmentId.parse(studentId));
      const access = source.reviewer_id === user.id && source.author_id !== user.id ? await this.context.reviewer(tx, user, source) : await this.context.instructor(tx, user, source);
      if (source.author_id !== user.id && source.reviewer_id !== user.id) throw new ForbiddenException("This assignment is not assigned to you.");
      const page = pageOf(pageValue), roster = source.state === "published" ? (await sql<{ id: string; name: string; total: number; status: string; submitted: number; needs_review: number }>`WITH people AS (
        SELECT audience.learner_id AS id,concat_ws(' ',person.first_name,person.last_name) AS name,
          CASE WHEN attempt.id IS NULL THEN 'not_started' WHEN review.decision='reviewed' THEN 'reviewed' WHEN review.decision='request_changes' THEN 'changes_requested' ELSE 'submitted' END AS status
        FROM learning_assignment_audience audience JOIN school_people person ON person.id=audience.person_id AND person.school_id=audience.school_id
        LEFT JOIN LATERAL(SELECT candidate.id FROM learning_assignment_attempts candidate WHERE candidate.school_id=audience.school_id
          AND candidate.assignment_id=audience.assignment_id AND candidate.learner_id=audience.learner_id ORDER BY candidate.attempt_number DESC LIMIT 1) attempt ON true
        LEFT JOIN learning_assignment_reviews review ON review.school_id=audience.school_id AND review.attempt_id=attempt.id
        WHERE audience.school_id=${source.school_id}::uuid AND audience.assignment_id=${source.id}::uuid)
        SELECT *,count(*) OVER()::int AS total,count(*) FILTER(WHERE status<>'not_started') OVER()::int AS submitted,
          count(*) FILTER(WHERE status='submitted') OVER()::int AS needs_review FROM people ORDER BY name,id LIMIT 10 OFFSET ${(page - 1) * 10}`.execute(tx)).rows : [];
      if (page > 1 && !roster.length) throw new BadRequestException("This page is unavailable. Return to the first page.");
      const publicationRoster = source.state === "draft" ? await this.publicationRoster(tx, source, access.school.today) : undefined;
      return { item: source, context: source.context_kind === "learning_offering" ? "offering" as const : "class" as const, can_review: source.reviewer_id === user.id,
        can_edit: source.state === "draft" && source.author_id === user.id, timezone: access.school.timezone,
        publication_preview: publicationRoster ? { count: publicationRoster.length, audience_hash: assignmentHash(publicationRoster) } : null,
        progress: { items: roster.map(({ id, name, status }) => ({ id, name, status })), total: roster[0]?.total ?? 0,
          submitted: roster[0]?.submitted ?? 0, needs_review: roster[0]?.needs_review ?? 0, page, has_more: page * 10 < (roster[0]?.total ?? 0) } };
    });
  }

  private async publicationRoster(tx: Transaction<Database>, source: AssignmentSource, today: string) {
    if (source.context_kind === "learning_offering") return (await tx.selectFrom("learning_offering_enrollments").select(["person_id", "id as offering_enrollment_id", "revision"])
      .where("school_id", "=", source.school_id).where("offering_id", "=", source.offering_id!).where("starts_on", "<=", today)
      .where(eb => eb.or([eb("ends_on", "is", null), eb("ends_on", ">", today)])).orderBy("person_id").orderBy("id").limit(101).execute())
      .map(row => ({ ...row, learner_id: row.person_id, student_id: null, enrollment_id: null }));
    return (await sql<{ student_id: string; person_id: string; enrollment_id: string; revision: number }>`SELECT DISTINCT ON (student.id) student.id AS student_id,student.person_id,enrollment.id AS enrollment_id,enrollment.revision
      FROM students student JOIN enrollments enrollment ON enrollment.student_id=student.id JOIN academic_terms term ON term.id=enrollment.term_id AND term.school_id=student.school_id
      WHERE student.school_id=${source.school_id}::uuid AND enrollment.class_section_id=${source.class_section_id}::uuid AND enrollment.term_id=${source.term_id}::uuid
        AND enrollment.is_active AND enrollment.enrolled_on<=${today}::date AND (enrollment.inactive_from IS NULL OR enrollment.inactive_from>${today}::date)
        AND ${today}::date BETWEEN term.starts_on AND term.ends_on ORDER BY student.id,enrollment.id LIMIT 1001`.execute(tx)).rows.map(row => ({ ...row, learner_id: row.student_id, offering_enrollment_id: null }));
  }

  private async workDetail(tx: Transaction<Database>, user: AuthUser, source: AssignmentSource, studentId: string) {
    const reviewer = source.reviewer_id === user.id;
    const access = reviewer ? await this.context.reviewer(tx, user, source) : await this.context.family(tx, user, studentId, source);
    const audience = await tx.selectFrom("learning_assignment_audience").select(["student_id", "person_id"]).where("school_id", "=", source.school_id)
      .where("assignment_id", "=", source.id).where("learner_id", "=", studentId).executeTakeFirst();
    if (!audience) throw new NotFoundException("Learner unavailable in this assignment.");
    const self = !reviewer && "student" in access && access.student.self;
    const student = await this.learnerIdentity(tx, source, studentId);
    const attempts = await tx.selectFrom("learning_assignment_attempts").selectAll().where("school_id", "=", source.school_id).where("assignment_id", "=", source.id)
      .where("learner_id", "=", studentId).orderBy("attempt_number", "desc").execute();
    const reviews = attempts.length ? await tx.selectFrom("learning_assignment_reviews").selectAll().where("school_id", "=", source.school_id).where("attempt_id", "in", attempts.map(item => item.id)).execute() : [];
    const manifests = attempts.length ? await tx.selectFrom("learning_assignment_attempt_files as manifest").innerJoin("learning_assignment_files as file", "file.id", "manifest.file_id")
      .select(["manifest.attempt_id", "file.id", "file.original_name", "file.content_type", "file.size_bytes", "file.sha256"])
      .where("manifest.school_id", "=", source.school_id).where("manifest.attempt_id", "in", attempts.map(item => item.id)).orderBy("manifest.ordinal").execute() : [];
    const draft = self ? await tx.selectFrom("learning_assignment_drafts").select(["body", "revision", "updated_at"]).where("school_id", "=", source.school_id)
      .where("assignment_id", "=", source.id).where("learner_id", "=", studentId).executeTakeFirst() : undefined;
    const files = self ? await tx.selectFrom("learning_assignment_files").select(["id", "original_name", "content_type", "size_bytes", "sha256"])
      .where("school_id", "=", source.school_id).where("assignment_id", "=", source.id).where("learner_id", "=", studentId).where("draft_attached", "=", true).orderBy("created_at").orderBy("id").execute() : [];
    const last = await currentAssignmentAttempt(tx, source.school_id, source.id, attempts[0]), lastReview = last ? reviews.find(review => review.attempt_id === last.id) : undefined;
    let canWrite = false;
    if (self) try { await this.context.family(tx, user, studentId, source, true); canWrite = true; }
    catch (cause) { if (!(cause instanceof ForbiddenException || cause instanceof NotFoundException)) throw cause; /* Historical reads do not restore enrollment. */ }
    const state = !last ? draft ? "draft" : "not_started" : lastReview?.decision === "request_changes" ? "changes_requested" : lastReview?.decision === "reviewed" ? "reviewed" : "submitted";
    const editable = canWrite && (!last || lastReview?.decision === "request_changes");
    const handoffOpen = last ? await this.model.handoffOpen(tx, source, last.id,
      lastReview?.decision === "request_changes" ? "changes_requested" : "submitted",
      lastReview?.decision === "request_changes" ? last.revision_message_id : last.review_message_id) : true;
    let reviewerCurrent = reviewer;
    if (!reviewer) try { await this.context.reviewer(tx, { ...user, id: source.reviewer_id }, source); reviewerCurrent = true; }
    catch (cause) { if (!(cause instanceof ForbiddenException || cause instanceof NotFoundException)) throw cause; }
    const blocked = !reviewerCurrent ? "The assigned reviewer is unavailable. Your saved work is retained; ask the campus to review this assignment."
      : last && !lastReview || lastReview?.decision === "request_changes" ? !handoffOpen ? "The review handoff is unavailable. Your work is retained; contact the assigned reviewer." : null : null;
    const submissionBlocked = blocked ?? (source.cutoff_at && executionNow() > source.cutoff_at ? "Submissions are closed. Your saved draft is retained."
      : source.max_attempts !== null && (last?.attempt_number ?? 0) >= source.max_attempts ? "The published attempt limit has been reached." : null);
    let learnerCurrent = self && canWrite;
    if (reviewer && student.user_id) try { await this.context.family(tx, { ...user, id: student.user_id }, studentId, source, true); learnerCurrent = true; }
    catch (cause) { if (!(cause instanceof ForbiddenException || cause instanceof NotFoundException)) throw cause; }
    return { item: source, context: reviewer ? "reviewer" as const : "learner" as const, timezone: access.school.timezone,
      student: source.context_kind === "class_term" ? { id: student.id, name: student.name } : null,
      learner: { id: student.id, person_id: audience.person_id, name: student.name }, state, can_write: editable,
      can_submit: editable && !submissionBlocked, submission_blocked_reason: state === "reviewed" ? null : submissionBlocked,
      can_review: reviewer && Boolean(last && !lastReview) && handoffOpen,
      can_request_changes: reviewer && Boolean(last && !lastReview) && handoffOpen && learnerCurrent && !submissionBlocked,
      draft: self ? draft ?? { body: "", revision: 0, updated_at: null } : null,
      files, attempts: attempts.map(attempt => ({ id: attempt.id, attempt_number: attempt.attempt_number, body: attempt.body,
        submitted_at: attempt.submitted_at, manifest_hash: attempt.manifest_hash, late: Boolean(source.due_at && attempt.submitted_at > source.due_at),
        files: manifests.filter(file => file.attempt_id === attempt.id), review: reviews.find(review => review.attempt_id === attempt.id) ?? null })) };
  }

  private async learnerIdentity(tx: Transaction<Database>, source: AssignmentSource, id: string) {
    const row = (await sql<{ id: string; person_id: string; name: string; user_id: string | null }>`SELECT audience.learner_id AS id,audience.person_id,
      concat_ws(' ',p.first_name,p.last_name) AS name,CASE WHEN a.context_kind='class_term' THEN student.user_id ELSE p.account_user_id END AS user_id
      FROM learning_assignment_audience audience JOIN learning_assignments a ON a.school_id=audience.school_id AND a.id=audience.assignment_id
      JOIN school_people p ON p.school_id=audience.school_id AND p.id=audience.person_id LEFT JOIN students student ON student.id=audience.student_id AND student.school_id=audience.school_id
      WHERE audience.school_id=${source.school_id}::uuid AND audience.assignment_id=${source.id}::uuid AND audience.learner_id=${id}::uuid`.execute(tx)).rows[0];
    if (!row) throw new NotFoundException("Learner unavailable in this assignment.");
    if (source.context_kind === "learning_offering") {
      const actor = await this.model.identityPort().resolvePersonAgent(tx, { school_id: source.school_id, person_id: row.person_id, at: executionNow().toISOString() });
      return { ...row, user_id: actor.acting ? actor.user_id : null };
    }
    return row;
  }

  private async lockWork(tx: Transaction<Database>, user: AuthUser, id: string, studentId: string) {
    const source = await this.context.source(tx, user, assignmentId.parse(id), "share");
    const access = await this.context.family(tx, user, assignmentId.parse(studentId), source, true);
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`assignment-work:${id}:${studentId}`},0))`.execute(tx);
    const draft = await tx.selectFrom("learning_assignment_drafts").selectAll().where("school_id", "=", source.school_id).where("assignment_id", "=", id).where("learner_id", "=", studentId).forUpdate().executeTakeFirst();
    const last = await currentAssignmentAttempt(tx, source.school_id, id, await tx.selectFrom("learning_assignment_attempts").selectAll().where("school_id", "=", source.school_id).where("assignment_id", "=", id).where("learner_id", "=", studentId).orderBy("attempt_number", "desc").executeTakeFirst());
    const review = last ? await tx.selectFrom("learning_assignment_reviews").selectAll().where("school_id", "=", source.school_id).where("attempt_id", "=", last.id).executeTakeFirst() : undefined;
    return { source, access, draft, last, review };
  }

  private editable(work: Awaited<ReturnType<LearningAssignmentsService["lockWork"]>>) {
    if (work.last && work.review?.decision !== "request_changes") throw new ConflictException("Submitted work stays unchanged. Wait for a request for changes before another attempt.");
  }

  async saveWork(user: AuthUser, id: string, studentId: string, raw: unknown) {
    const data = learnerDraft.parse(raw);
    return this.db.transaction().execute(async tx => {
      const work = await this.lockWork(tx, user, id, studentId), source = { ...work.source, revision: work.draft?.revision ?? 0 };
      const prepared = await this.model.prepare(tx, user, source, "work.save", data, { id, studentId, ...data }, [learnerRef(source, studentId)], true);
      if (prepared.status === "completed") return { ...workReceipts(source).work.parse(prepared.metadata), replayed: true };
      this.editable(work);
      if (work.source.submission_mode === "files" && data.body.trim()) throw new BadRequestException("This assignment accepts files only. Keep the text response empty.");
      const saved = await tx.insertInto("learning_assignment_drafts").values({ school_id: source.school_id, assignment_id: id, ...learnerValues(source, studentId),
        body: data.body, revision: source.revision + 1, updated_by: user.id, updated_at: executionNow() }).onConflict(oc => oc.columns(["school_id", "assignment_id", "learner_id"])
        .doUpdateSet({ body: data.body, revision: source.revision + 1, updated_by: user.id, updated_at: executionNow() })).returning(["revision", "updated_at"]).executeTakeFirstOrThrow();
      const result = { id, ...learnerRef(source, studentId), revision: saved.revision };
      await this.model.finish(tx, { ...source, revision: saved.revision }, prepared.command_id, result);
      return { ...result, replayed: false };
    });
  }

  async upload(user: AuthUser, id: string, studentId: string, raw: unknown, upload: AssignmentUpload) {
    const data = assignmentUpload.parse(raw), contentType = this.fileType(upload), hash = createHash("sha256").update(upload.data).digest("hex");
    return this.db.transaction().execute(async tx => {
      const work = await this.lockWork(tx, user, id, studentId), source = { ...work.source, revision: work.draft?.revision ?? 0 };
      const prepared = await this.model.prepare(tx, user, source, "file.add", data, { id, studentId, ...data, sha256: hash, filename: basename(upload.filename), content_type: contentType }, [learnerRef(source, studentId)], true);
      if (prepared.status === "completed") return { ...workReceipts(source).upload.parse(prepared.metadata), replayed: true };
      this.editable(work);
      if (!work.draft) throw new BadRequestException("Save your draft before attaching a file.");
      if (work.source.submission_mode === "text") throw new BadRequestException("This assignment accepts text only.");
      const count = await tx.selectFrom("learning_assignment_files").select(tx.fn.countAll<number>().as("count")).where("school_id", "=", source.school_id)
        .where("assignment_id", "=", id).where("learner_id", "=", studentId).where("draft_attached", "=", true).executeTakeFirstOrThrow();
      if (Number(count.count) >= assignmentLimits.files) throw new BadRequestException("Keep up to three files in this submission.");
      const total = await tx.selectFrom("learning_assignment_files").select(tx.fn.countAll<number>().as("count")).where("school_id", "=", source.school_id)
        .where("assignment_id", "=", id).where("learner_id", "=", studentId).executeTakeFirstOrThrow();
      if (Number(total.count) >= 20) throw new BadRequestException("This assignment has reached its 20-upload storage limit. Existing submissions remain available; contact your teacher.");
      if (await tx.selectFrom("learning_assignment_files").select("id").where("id", "=", data.file_id).executeTakeFirst()) throw new ConflictException("This attachment identity is already used. Choose the file again.");
      const directory = join(config().uploadDir, "learning", source.school_id, id, studentId), path = join(directory, data.file_id);
      await mkdir(directory, { recursive: true, mode: 0o750 });
      // Never delete uncertain bytes: immutable UUID/hash permits exact retry after DB response loss.
      try { await writeFile(path, upload.data, { flag: "wx", mode: 0o640 }); }
      catch (cause) {
        const found = await readEnvironmentStoredFile(path, contentType, "attachment");
        const chunks: Buffer[] = []; for await (const chunk of found.stream) chunks.push(Buffer.from(chunk));
        if (found.source_content_omitted || createHash("sha256").update(Buffer.concat(chunks)).digest("hex") !== hash) throw cause;
      }
      await tx.insertInto("learning_assignment_files").values({ id: data.file_id, school_id: source.school_id, assignment_id: id, ...learnerValues(source, studentId),
        storage_key: data.file_id, original_name: basename(upload.filename).replace(/[\r\n\0]/gu, "_").slice(0, 200) || "attachment", content_type: contentType,
        size_bytes: upload.data.length, sha256: hash, draft_attached: true, uploaded_by: user.id, created_at: executionNow() }).execute();
      await tx.updateTable("learning_assignment_drafts").set({ revision: source.revision + 1, updated_at: executionNow(), updated_by: user.id })
        .where("school_id", "=", source.school_id).where("assignment_id", "=", id).where("learner_id", "=", studentId).execute();
      const result = { id, ...learnerRef(source, studentId), file_id: data.file_id, revision: source.revision + 1 };
      await this.model.finish(tx, { ...source, revision: result.revision }, prepared.command_id, result);
      return { ...result, replayed: false };
    });
  }

  private fileType(upload: AssignmentUpload) {
    if (!upload.data.length || upload.data.length > assignmentLimits.file_bytes) throw new BadRequestException("Choose a non-empty file up to 5 MiB.");
    const type = upload.mimetype.split(";", 1)[0]!.toLowerCase(), bytes = upload.data;
    if (type === "application/pdf" && bytes.subarray(0, 5).toString() === "%PDF-") return type;
    if (type === "image/png" && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return type;
    if (type === "image/jpeg" && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return type;
    if (["text/plain", "application/octet-stream", "application/javascript", "text/javascript", "text/x-python", "text/markdown", "text/csv"].includes(type) && /\.(?:txt|csv|md|py|js|ts|java|c|cpp|html|css)$/iu.test(upload.filename)) {
      try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); if (!bytes.includes(0)) return "text/plain"; } catch { /* Reject non-UTF-8 text. */ }
    }
    throw new BadRequestException("Use a PDF, PNG, JPEG or UTF-8 text/code file. Files download as attachments.");
  }

  async detach(user: AuthUser, id: string, studentId: string, fileId: string, raw: unknown) {
    const data = assignmentCommand.parse(raw); assignmentId.parse(fileId);
    return this.db.transaction().execute(async tx => {
      const work = await this.lockWork(tx, user, id, studentId), source = { ...work.source, revision: work.draft?.revision ?? 0 };
      const prepared = await this.model.prepare(tx, user, source, "file.detach", data, { id, studentId, fileId, ...data }, [learnerRef(source, studentId)], true);
      if (prepared.status === "completed") return { ...workReceipts(source).work.parse(prepared.metadata), replayed: true };
      this.editable(work);
      const file = await tx.updateTable("learning_assignment_files").set({ draft_attached: false }).where("id", "=", fileId).where("school_id", "=", source.school_id)
        .where("assignment_id", "=", id).where("learner_id", "=", studentId).where("draft_attached", "=", true).returning("id").executeTakeFirst();
      if (!file) throw new NotFoundException("This file is not in the current draft.");
      await tx.updateTable("learning_assignment_drafts").set({ revision: source.revision + 1, updated_at: executionNow(), updated_by: user.id }).where("school_id", "=", source.school_id).where("assignment_id", "=", id).where("learner_id", "=", studentId).execute();
      const result = { id, ...learnerRef(source, studentId), revision: source.revision + 1 };
      await this.model.finish(tx, { ...source, revision: result.revision }, prepared.command_id, result); return { ...result, replayed: false };
    });
  }

  async submit(user: AuthUser, id: string, studentId: string, raw: unknown) {
    const data = assignmentSubmit.parse(raw);
    return this.db.transaction().execute(async tx => {
      const work = await this.lockWork(tx, user, id, studentId), source = { ...work.source, revision: work.draft?.revision ?? 0 };
      const prepared = await this.model.prepare(tx, user, source, "submit", data, { id, studentId, ...data }, [learnerRef(source, studentId)], true);
      if (prepared.status === "completed") return { ...workReceipts(source).submitted.parse(prepared.metadata), replayed: true };
      this.editable(work);
      if (!work.draft) throw new BadRequestException("Save a draft before submitting.");
      if (work.last && !await this.model.handoffOpen(tx, work.source, work.last.id, "changes_requested", work.last.revision_message_id))
        throw new ConflictException("The revision handoff is unavailable. Your saved draft is retained; contact your reviewer.");
      if (work.source.cutoff_at && executionNow() > work.source.cutoff_at) throw new ConflictException("The submission cutoff has passed. Your saved draft is retained; contact your teacher.");
      if (work.source.max_attempts !== null && (work.last?.attempt_number ?? 0) >= work.source.max_attempts) throw new ConflictException("This assignment's attempt limit has been reached. Your saved work remains available.");
      await this.context.reviewer(tx, { ...user, id: work.source.reviewer_id }, work.source);
      const files = await tx.selectFrom("learning_assignment_files").selectAll().where("school_id", "=", source.school_id).where("assignment_id", "=", id).where("learner_id", "=", studentId).where("draft_attached", "=", true).orderBy("created_at").orderBy("id").execute();
      if (work.source.submission_mode === "text" && (!work.draft.body.trim() || files.length)) throw new BadRequestException("This assignment requires a text response without files.");
      if (work.source.submission_mode === "files" && (!files.length || work.draft.body.trim())) throw new BadRequestException("This assignment requires files without a text response.");
      if (!work.draft.body.trim() && !files.length) throw new BadRequestException("Add your response or a file before submitting.");
      for (const file of files) {
        const bytes = await readEnvironmentStoredFile(join(config().uploadDir, "learning", source.school_id, id, studentId, file.storage_key), file.content_type, file.original_name);
        if (bytes.source_content_omitted) { bytes.stream.destroy(); throw new ConflictException("A captured source file is omitted in Simulation. Replace it with a run-local upload before submitting this attempt."); }
        const chunks: Buffer[] = []; for await (const chunk of bytes.stream) chunks.push(Buffer.from(chunk));
        const content = Buffer.concat(chunks);
        if (content.length !== file.size_bytes || createHash("sha256").update(content).digest("hex") !== file.sha256) throw new ConflictException("An attachment could not be verified. Replace it before submitting.");
      }
      const revisionRoute: AssignmentRoute = work.last ? { behaviour_version_id: work.last.revision_route_version_id, subscription_id: work.last.revision_subscription_id, selector_key: work.last.revision_selector_key }
        : await this.model.route(tx, user, { ...work.source, revision: source.revision }, "revision", user.id, data.command_id);
      const attempt = await tx.insertInto("learning_assignment_attempts").values({ id: data.attempt_id, school_id: source.school_id, assignment_id: id, ...learnerValues(source, studentId),
        attempt_number: (work.last?.attempt_number ?? 0) + 1, body: work.draft.body, manifest_hash: assignmentHash({ body: work.draft.body, files: files.map(file => ({ id: file.id, sha256: file.sha256, size_bytes: file.size_bytes })) }),
        submitted_by: user.id, submitted_at: executionNow(), draft_revision: work.draft.revision, review_message_id: null, revision_message_id: null,
        revision_route_version_id: revisionRoute.behaviour_version_id, revision_subscription_id: revisionRoute.subscription_id, revision_selector_key: revisionRoute.selector_key }).returningAll().executeTakeFirstOrThrow();
      if (files.length) await tx.insertInto("learning_assignment_attempt_files").values(files.map((file, ordinal) => ({ school_id: source.school_id, assignment_id: id, ...learnerValues(source, studentId), attempt_id: attempt.id, file_id: file.id, ordinal }))).execute();
      // Submission is a monotonic draft boundary too. A delayed pre-submit write
      // must never become applicable when a later request for changes opens work.
      await tx.updateTable("learning_assignment_drafts").set({ revision: work.draft.revision + 1, updated_at: executionNow(), updated_by: user.id })
        .where("school_id", "=", source.school_id).where("assignment_id", "=", id).where("learner_id", "=", studentId).execute();
      const reviewRoute = { behaviour_version_id: work.source.review_route_version_id!, subscription_id: work.source.review_subscription_id!, selector_key: `assignment_review_${assignmentHash([id, "review", work.source.reviewer_id]).slice(0, 32)}` };
      const event = await this.model.event(tx, user, work.source, "submitted", prepared.command_id, [user.id, work.source.reviewer_id], { ...learnerRef(source, studentId), attempt_id: attempt.id },
        { route: reviewRoute, recipient: work.source.reviewer_id, href: assignmentHref(work.source, studentId) });
      if (work.last?.revision_message_id) await this.model.respond(tx, user, work.source, work.last.revision_message_id, "resubmitted", data.command_id, work.last.id, "changes_requested", event.event_id);
      await tx.updateTable("learning_assignment_attempts").set({ review_message_id: event.message_id }).where("id", "=", attempt.id).execute();
      const result = { id, ...learnerRef(source, studentId), attempt_id: attempt.id, attempt_number: attempt.attempt_number, submitted_at: attempt.submitted_at.toISOString(), manifest_hash: attempt.manifest_hash, revision: work.draft.revision + 1 };
      await this.model.finish(tx, { ...source, revision: result.revision }, prepared.command_id, result, event.event_id); return { ...result, replayed: false };
    });
  }

  async review(user: AuthUser, id: string, studentId: string, raw: unknown) {
    const data = assignmentReview.parse(raw);
    return this.db.transaction().execute(async tx => {
      const source = await this.context.source(tx, user, assignmentId.parse(id), "share");
      const access = await this.context.reviewer(tx, user, source); assignmentId.parse(studentId);
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`assignment-work:${id}:${studentId}`},0))`.execute(tx);
      const attempt = await currentAssignmentAttempt(tx, source.school_id, id, await tx.selectFrom("learning_assignment_attempts").selectAll().where("school_id", "=", source.school_id).where("assignment_id", "=", id).where("learner_id", "=", studentId).orderBy("attempt_number", "desc").executeTakeFirst());
      if (!attempt) throw new NotFoundException("No submitted attempt is available.");
      const prepared = await this.model.prepare(tx, user, { ...source, revision: attempt.attempt_number }, "review", data, { id, studentId, ...data }, access.grants);
      if (prepared.status === "completed") return { ...workReceipts(source).reviewed.parse(prepared.metadata), replayed: true };
      if (attempt.id !== data.attempt_id) throw new ConflictException("A newer attempt is available. Refresh before reviewing.");
      if (await tx.selectFrom("learning_assignment_reviews").select("id").where("school_id", "=", source.school_id).where("attempt_id", "=", attempt.id).executeTakeFirst()) this.model.obsoleteState({ ...source, revision: attempt.attempt_number }, data, "attempt_reviewed");
      if (!await this.model.handoffOpen(tx, source, attempt.id, "submitted", attempt.review_message_id)) throw new ConflictException("The review handoff is unavailable. This submitted work is retained; ask the campus to review its routing.");
      const learner = await this.learnerIdentity(tx, source, studentId);
      if (data.decision === "request_changes") {
        if (!learner.user_id) throw new ConflictException("The learner's account is unavailable. This submission remains pending review.");
        await this.context.family(tx, { ...user, id: learner.user_id }, studentId, source, true);
        if (source.max_attempts !== null && attempt.attempt_number >= source.max_attempts) throw new ConflictException("The learner has reached the published attempt limit. Review this attempt; a new assignment is required for further work.");
        if (source.cutoff_at && source.cutoff_at < executionNow()) throw new ConflictException("The published submission cutoff has passed. Review this attempt; a new assignment is required for further work.");
      }
      await tx.insertInto("learning_assignment_reviews").values({ id: data.review_id, school_id: source.school_id, assignment_id: id, ...learnerValues(source, studentId),
        attempt_id: attempt.id, decision: data.decision, feedback: data.feedback, reviewed_by: user.id, reviewed_at: executionNow() }).execute();
      const event = await this.model.event(tx, user, source, data.decision === "request_changes" ? "changes_requested" : "reviewed", prepared.command_id,
        [user.id, ...(learner.user_id ? [learner.user_id] : [])], { ...learnerRef(source, studentId), attempt_id: attempt.id }, data.decision === "request_changes" ? {
          route: { behaviour_version_id: attempt.revision_route_version_id, subscription_id: attempt.revision_subscription_id, selector_key: attempt.revision_selector_key },
          recipient: learner.user_id!, href: assignmentHref(source, studentId, "self") } : undefined);
      await this.model.respond(tx, user, source, attempt.review_message_id, data.decision, data.command_id, attempt.id, "submitted", event.event_id);
      if (data.decision === "request_changes") await tx.updateTable("learning_assignment_attempts").set({ revision_message_id: event.message_id }).where("id", "=", attempt.id).execute();
      const result = { id, ...learnerRef(source, studentId), attempt_id: attempt.id, decision: data.decision };
      await this.model.finish(tx, { ...source, revision: attempt.attempt_number }, prepared.command_id, result, event.event_id); return { ...result, replayed: false };
    });
  }

  async file(user: AuthUser, id: string, studentId: string, fileId: string) {
    const record = await this.db.transaction().execute(async tx => {
      const source = await this.context.source(tx, user, assignmentId.parse(id)); assignmentId.parse(fileId); assignmentId.parse(studentId);
      const reviewer = source.reviewer_id === user.id;
      const access = reviewer ? await this.context.reviewer(tx, user, source) : await this.context.family(tx, user, studentId, source);
      const file = await tx.selectFrom("learning_assignment_files").selectAll().where("school_id", "=", source.school_id).where("assignment_id", "=", id).where("learner_id", "=", studentId).where("id", "=", fileId).executeTakeFirst();
      if (!file) throw new NotFoundException("File unavailable.");
      const submitted = await tx.selectFrom("learning_assignment_attempt_files").select("file_id").where("school_id", "=", source.school_id).where("assignment_id", "=", id).where("learner_id", "=", studentId).where("file_id", "=", fileId).executeTakeFirst();
      if (!submitted && (reviewer || !("student" in access && access.student.self))) throw new ForbiddenException("Saved drafts are private to the learner.");
      return file;
    });
    const found = await readEnvironmentStoredFile(join(config().uploadDir, "learning", record.school_id, record.assignment_id, record.learner_id, record.storage_key), record.content_type, record.original_name);
    if (found.source_content_omitted) return { record, ...found };
    const chunks: Buffer[] = []; let size = 0;
    try {
      for await (const chunk of found.stream) {
        const bytes = Buffer.from(chunk); size += bytes.length;
        if (size > assignmentLimits.file_bytes) { found.stream.destroy(); throw new ConflictException("This attachment exceeds its retained manifest. Contact the reviewer."); }
        chunks.push(bytes);
      }
    } catch (cause) {
      if (cause instanceof ConflictException) throw cause;
      throw new NotFoundException("The attachment is unavailable. The submitted receipt remains saved; contact the reviewer.");
    }
    const bytes = Buffer.concat(chunks);
    if (bytes.length !== record.size_bytes || createHash("sha256").update(bytes).digest("hex") !== record.sha256)
      throw new ConflictException("This attachment does not match its retained manifest. Contact the reviewer.");
    return { record, ...found, stream: Readable.from([bytes]), size_bytes: bytes.length };
  }

  /** Exact native obligations. No generic completion flag, guessed owner or private prose. */
  async projectWork(user: AuthUser): Promise<LearningAssignmentWorkItem[]> {
    return this.db.transaction().setIsolationLevel("repeatable read").execute(async tx => {
      let school: Awaited<ReturnType<LearningAssignmentContextService["account"]>>;
      try { school = await this.context.account(tx, user); }
      catch (cause) { if (cause instanceof ForbiddenException) return []; throw cause; }
      const rows = (await sql<{ assignment: AssignmentSource; student_id: string; person_id: string; learner_user_id: string | null; student_label: string;
        reviewer_label: string; attempt_id: string | null; attempt_number: number | null; submitted_at: Date | null;
        review_message_id: string | null; revision_message_id: string | null; decision: "reviewed" | "request_changes" | null; reviewed_at: Date | null }>`
        SELECT to_jsonb(assignment) AS assignment,audience.learner_id AS student_id,audience.person_id,CASE WHEN assignment.context_kind='class_term' THEN student.user_id ELSE person.account_user_id END AS learner_user_id,
          trim(concat_ws(' ',person.first_name,person.last_name)) AS student_label,
          trim(CASE WHEN assignment.context_kind='class_term' THEN concat_ws(' ',reviewer.first_name,reviewer.last_name) ELSE concat_ws(' ',reviewer_person.first_name,reviewer_person.last_name) END) AS reviewer_label,
          attempt.id AS attempt_id,attempt.attempt_number,attempt.submitted_at,attempt.review_message_id,attempt.revision_message_id,
          review.decision,review.reviewed_at
        FROM learning_assignments assignment JOIN learning_assignment_audience audience ON audience.school_id=assignment.school_id AND audience.assignment_id=assignment.id
        JOIN school_people person ON person.id=audience.person_id AND person.school_id=audience.school_id
        LEFT JOIN students student ON student.id=audience.student_id AND student.school_id=audience.school_id
        JOIN users reviewer ON reviewer.id=assignment.reviewer_id
        LEFT JOIN school_people reviewer_person ON reviewer_person.school_id=assignment.school_id AND reviewer_person.id=assignment.reviewer_person_id
        LEFT JOIN LATERAL(SELECT item.* FROM learning_assignment_attempts item WHERE item.school_id=audience.school_id
          AND item.assignment_id=audience.assignment_id AND item.learner_id=audience.learner_id ORDER BY item.attempt_number DESC LIMIT 1) attempt ON true
        LEFT JOIN learning_assignment_reviews review ON review.school_id=audience.school_id AND review.attempt_id=attempt.id
        WHERE assignment.school_id=${school.id}::uuid AND assignment.state='published'
          AND (student.user_id=${user.id}::uuid OR audience.person_id=${school.actor.person_id}::uuid OR assignment.reviewer_id=${user.id}::uuid)
          AND review.decision IS DISTINCT FROM 'reviewed' ORDER BY assignment.created_at,assignment.id,audience.learner_id`.execute(tx)).rows;
      const result: LearningAssignmentWorkItem[] = [], reviewerAccess = new Map<string, boolean>();
      const handoverMessages = await assignmentHandoverReferences(tx, school.id, rows.flatMap(row => row.attempt_id ? [row.attempt_id] : []));
      for (const row of rows) {
        if (row.assignment.context_kind === "learning_offering") {
          const learner = await this.model.identityPort().resolvePersonAgent(tx, { school_id: school.id, person_id: row.person_id, at: executionNow().toISOString() });
          row.learner_user_id = learner.acting ? learner.user_id : null;
        }
        // JSON PostgreSQL instants are strings; only explicit source instants are converted.
        const source = { ...row.assignment, due_at: row.assignment.due_at ? new Date(row.assignment.due_at) : null,
          cutoff_at: row.assignment.cutoff_at ? new Date(row.assignment.cutoff_at) : null, published_at: row.assignment.published_at ? new Date(row.assignment.published_at) : null,
          created_at: new Date(row.assignment.created_at), updated_at: new Date(row.assignment.updated_at) };
        const accessKey = `${source.context_kind}:${source.offering_id ?? source.class_section_id}:${source.subject_id ?? "general"}:${source.reviewer_id}`;
        if (!reviewerAccess.has(accessKey)) {
          try { await this.context.reviewer(tx, { ...user, id: source.reviewer_id }, source); reviewerAccess.set(accessKey, true); }
          catch (cause) { if (cause instanceof ForbiddenException || cause instanceof NotFoundException) reviewerAccess.set(accessKey, false); else throw cause; }
        }
        const currentAttempt = row.attempt_id ? await currentAssignmentAttempt(tx, source.school_id, source.id, { id: row.attempt_id, review_message_id: row.review_message_id, revision_message_id: row.revision_message_id }, handoverMessages) : undefined;
        if (currentAttempt) { row.review_message_id = currentAttempt.review_message_id; row.revision_message_id = currentAttempt.revision_message_id; }
        const reviewerCurrent = reviewerAccess.get(accessKey)!;
        const action = row.attempt_id ? row.decision === "request_changes" ? "revise" as const : "review" as const : "submit" as const;
        const routeOpen = !row.attempt_id || await this.model.handoffOpen(tx, source, row.attempt_id,
          action === "revise" ? "changes_requested" : "submitted", action === "revise" ? row.revision_message_id : row.review_message_id);
        const base = { assignment_id: source.id, student_id: row.student_id, attempt_id: row.attempt_id, action, title: source.title,
          student_label: row.student_label, reviewer_label: reviewerCurrent ? row.reviewer_label : "Previous reviewer", owner_user_id: source.reviewer_id,
          message_id: action === "review" ? row.review_message_id : action === "revise" ? row.revision_message_id : null,
          source_revision: row.attempt_number ?? source.revision,
          created_at: new Date(row.reviewed_at ?? row.submitted_at ?? source.published_at ?? source.created_at).toISOString() };
        if (row.learner_user_id === user.id) {
          if (action === "review") result.push({ ...base, id: `learning_assignment:${source.id}:${row.student_id}:${row.attempt_id}:waiting`,
            stream: "waiting", state: !reviewerCurrent ? "needs_reassignment" : routeOpen ? "waiting_for_review" : "route_unavailable", href: assignmentHref(source, row.student_id, "self"), due_at: null });
          else {
            try { await this.context.family(tx, user, row.student_id, source, true); }
            catch (cause) { if (cause instanceof ForbiddenException || cause instanceof NotFoundException) continue; throw cause; }
            if (source.cutoff_at && source.cutoff_at < executionNow()) continue;
            if (source.max_attempts !== null && (row.attempt_number ?? 0) >= source.max_attempts) continue;
            result.push({ ...base, id: `learning_assignment:${source.id}:${row.student_id}:${row.attempt_id ?? "initial"}:${action}`,
              owner_user_id: reviewerCurrent && routeOpen ? user.id : source.reviewer_id,
              stream: reviewerCurrent && routeOpen ? "needs_me" : "waiting", state: !reviewerCurrent ? "needs_reassignment" : routeOpen ? "action_required" : "route_unavailable", href: assignmentHref(source, row.student_id, "self"), due_at: reviewerCurrent && routeOpen ? source.due_at?.toISOString() ?? null : null });
          }
        }
        if (source.reviewer_id === user.id && action === "review" && reviewerCurrent && routeOpen) result.push({ ...base,
          id: `learning_assignment:${source.id}:${row.student_id}:${row.attempt_id}:review`, stream: "needs_me", state: "action_required",
          href: assignmentHref(source, row.student_id), due_at: null });
      }
      return result;
    });
  }
}
