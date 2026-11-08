import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { z } from "zod";
import { sql, type Transaction } from "kysely";
import type { Database } from "../database/types.js";
import { DatabaseService } from "../database/database.service.js";
import type { AuthUser } from "../common/request.js";
import { executionNow } from "../campus-model-core/execution-time.runtime.js";
import { assignmentId, learningOfferingCreate, learningOfferingEnroll, learningOfferingEnd, learningOfferingInstructor, learningOfferingReceipts, learningOfferingAcademicCommand } from "./learning-assignment.contracts.js";
import { offeringAcademicContext, saveOfferingAcademicContext, type OfferingAcademicContext } from "./learning-offering-academic.js";
import { LearningAssignmentContextService } from "./learning-assignment-context.service.js";
import { LearningAssignmentModelService } from "./learning-assignment-model.service.js";
import { ActivityPlanningService } from "../schedule-planning/activity-planning.service.js";
import { activityOccurrenceId } from "../schedule-planning/activity-occurrence.engine.js";
import { electiveSelection, ElectiveRuleRefusal, type ElectiveSelection } from "./learning-elective-change.contracts.js";
import { previewOfferingElectiveRoster, type ElectiveRosterPreview, type ElectiveRosterApplyReceipt, type ElectiveRosterSourceProof } from "./learning-offering-elective-roster.js";
import { PREPARED_DOMAIN_COMMAND_VERIFICATION_PORT, type PreparedDomainCommandVerificationPort } from "../campus-model-core/domain-command-gateway.port.js";

export interface LearningOfferingSummary {
  id: string; name: string; revision: number; can_manage: boolean; can_publish: boolean; can_review: boolean;
  own_enrollment: { id: string; person_id: string; revision: number } | null;
  current_instructor: { id: string; person_id: string; name: string; revision: number } | null;
  learner_count?: number;
  academic_context: OfferingAcademicContext | null;
}
export interface LearningOfferingDetail extends LearningOfferingSummary {
  starts_on: string; today: string; timezone: string; enrollment_change_mode: "initial_setup" | "reviewed_change";
  enrollments: Array<{ id: string; person_id: string; name: string; revision: number; starts_on: string; ends_on: string | null }>;
}
const pageOf = (value?: string) => { const page = Number(value ?? 1); if (!Number.isInteger(page) || page < 1 || page > 10000) throw new BadRequestException("Choose a valid page."); return page; };
type SelectionCommand = { source_id: string; command_id: string; expected_revision: number; current_revision: number };
/** Native learning responsibility, independent of descriptive People groups and school class/term records. */
@Injectable()
export class LearningOfferingsService {
  constructor(private readonly db: DatabaseService, private readonly context: LearningAssignmentContextService, private readonly model: LearningAssignmentModelService,
    @Optional() private readonly planning?: ActivityPlanningService,
    @Optional() @Inject(PREPARED_DOMAIN_COMMAND_VERIFICATION_PORT) private readonly commandVerifier?: PreparedDomainCommandVerificationPort) {}

  private async canSetup(tx: Transaction<Database>, user: AuthUser, schoolId: string) {
    return Boolean(await tx.selectFrom("school_memberships").select("id").where("school_id", "=", schoolId).where("user_id", "=", user.id).where("role", "=", "admin").where("is_active", "=", true).executeTakeFirst());
  }
  private async summary(tx: Transaction<Database>, user: AuthUser, school: { id: string; today: string; actor: { person_id: string } }, source: { id: string; name: string; revision: number }, manager: boolean): Promise<LearningOfferingSummary> {
    const appointments = await tx.selectFrom("learning_offering_teaching_assignments as appointment").innerJoin("school_people as person", "person.id", "appointment.person_id")
      .select(["appointment.id", "appointment.person_id", "appointment.revision", "appointment.can_publish", "appointment.can_review", "person.first_name", "person.last_name"])
      .where("appointment.school_id", "=", school.id).where("appointment.offering_id", "=", source.id).where("appointment.starts_on", "<=", school.today)
      .where(eb => eb.or([eb("appointment.ends_on", "is", null), eb("appointment.ends_on", ">", school.today)])).orderBy("appointment.created_at").orderBy("appointment.id").execute();
    const own = appointments.filter(item => item.person_id === school.actor.person_id), current = appointments.find(item => item.can_publish) ?? appointments[0];
    const registration = await tx.selectFrom("learning_offering_enrollments").select(["id", "person_id", "revision"]).where("school_id", "=", school.id).where("offering_id", "=", source.id)
      .where("person_id", "=", school.actor.person_id).where("starts_on", "<=", school.today).where(eb => eb.or([eb("ends_on", "is", null), eb("ends_on", ">", school.today)])).executeTakeFirst();
    const count = manager || own.length ? (await sql<{ count: number }>`SELECT count(*)::int AS count FROM learning_offering_enrollments WHERE school_id=${school.id}::uuid AND offering_id=${source.id}::uuid
      AND starts_on<=${school.today}::date AND(ends_on IS NULL OR ends_on>${school.today}::date)`.execute(tx)).rows[0]?.count : undefined;
    return { ...source, can_manage: manager, can_publish: own.some(item => item.can_publish), can_review: own.some(item => item.can_review), own_enrollment: registration ?? null,
      current_instructor: current ? { id: current.id, person_id: current.person_id, name: `${current.first_name} ${current.last_name}`.trim(), revision: current.revision } : null,
      academic_context: await offeringAcademicContext(tx, school.id, source.id), ...(count !== undefined ? { learner_count: count } : {}) };
  }
  async list(user: AuthUser, query: { page?: string; search?: string } = {}) {
    const page = pageOf(query.page), search = (query.search ?? "").trim();
    if (search.length > 150) throw new BadRequestException("Use a shorter search.");
    return this.db.transaction().execute(async tx => {
      const school = await this.context.account(tx, user), manager = await this.canSetup(tx, user, school.id);
      const person = await tx.selectFrom("school_people").select(["id", "first_name", "last_name", "revision"]).where("school_id", "=", school.id).where("id", "=", school.actor.person_id).executeTakeFirstOrThrow();
      const items = (await sql<{ id: string; name: string; revision: number }>`SELECT offering.id,offering.name,offering.revision FROM learning_offerings offering
        WHERE offering.school_id=${school.id}::uuid AND offering.state='active' AND(${search}='' OR strpos(lower(offering.name),lower(${search}))>0)
          AND(${manager} OR EXISTS(SELECT 1 FROM learning_offering_teaching_assignments a WHERE a.school_id=offering.school_id AND a.offering_id=offering.id AND a.person_id=${person.id}::uuid
            AND a.starts_on<=${school.today}::date AND(a.ends_on IS NULL OR a.ends_on>${school.today}::date))
            OR EXISTS(SELECT 1 FROM learning_offering_enrollments e WHERE e.school_id=offering.school_id AND e.offering_id=offering.id AND e.person_id=${person.id}::uuid
              AND e.starts_on<=${school.today}::date AND(e.ends_on IS NULL OR e.ends_on>${school.today}::date))) ORDER BY offering.name,offering.id LIMIT 11 OFFSET ${(page - 1) * 10}`.execute(tx)).rows;
      const academicReferences = manager ? { terms: await tx.selectFrom("academic_terms").select(["id", "name", "academic_year", "starts_on", "ends_on"]).where("school_id", "=", school.id).where("is_active", "=", true).orderBy("starts_on", "desc").execute(),
        subjects: await tx.selectFrom("subjects").select(["id", "name", "code", "color", "icon"]).where("school_id", "=", school.id).orderBy("name").execute() } : undefined;
      return { can_create: manager, actor_person: { id: person.id, name: `${person.first_name} ${person.last_name}`.trim(), revision: person.revision }, today: school.today, timezone: school.timezone,
        ...(academicReferences ? { academic_references: academicReferences } : {}),
        items: await Promise.all(items.slice(0, 10).map(item => this.summary(tx, user, school, item, manager))), page, has_more: items.length > 10 };
    });
  }
  async detail(user: AuthUser, id: string): Promise<LearningOfferingDetail> {
    assignmentId.parse(id);
    return this.db.transaction().execute(async tx => {
      const school = await this.context.account(tx, user), manager = await this.canSetup(tx, user, school.id);
      const source = await tx.selectFrom("learning_offerings").select(["id", "name", "revision", "created_at"]).where("school_id", "=", school.id).where("id", "=", id).where("state", "=", "active").executeTakeFirst();
      if (!source) throw new NotFoundException("Learning group unavailable.");
      const item = await this.summary(tx, user, school, { id: source.id, name: source.name, revision: source.revision }, manager);
      const historical = await tx.selectFrom("learning_assignment_audience as audience").innerJoin("learning_assignments as assignment", "assignment.id", "audience.assignment_id")
        .select("audience.person_id").where("audience.school_id", "=", school.id).where("audience.person_id", "=", school.actor.person_id).where("assignment.offering_id", "=", id).executeTakeFirst();
      if (!manager && !item.can_publish && !item.can_review && !item.own_enrollment && !historical) throw new ForbiddenException("This learning group is not available to your current account.");
      const roster = manager || item.can_publish || item.can_review;
      const enrollments = roster ? await tx.selectFrom("learning_offering_enrollments as registration").innerJoin("school_people as person", "person.id", "registration.person_id")
        .select(["registration.id", "registration.person_id", "registration.revision", "registration.starts_on", "registration.ends_on", "person.first_name", "person.last_name"])
        .where("registration.school_id", "=", school.id).where("registration.offering_id", "=", id).where("registration.ends_on", "is", null).orderBy("person.first_name").orderBy("person.id").limit(100).execute() : [];
      const first = await tx.selectFrom("learning_offering_teaching_assignments").select("starts_on").where("school_id", "=", school.id).where("offering_id", "=", id).orderBy("created_at").limit(1).executeTakeFirst();
      return { ...item, starts_on: first?.starts_on ?? school.today, today: school.today, timezone: school.timezone,
        enrollment_change_mode: await this.courseRosterIsOperating(tx,school.id,id) ? "reviewed_change" : "initial_setup",
        enrollments: enrollments.map(({ first_name, last_name, ...row }) => ({ ...row, name: `${first_name} ${last_name}`.trim() })) };
    });
  }
  private async people(tx: Transaction<Database>, schoolId: string, refs: Array<{ id: string; expected_revision: number }>, command: SelectionCommand) {
    // Stable lock order prevents competing roster/setup commands from deadlocking.
    const rows = await tx.selectFrom("school_people").select(["id", "revision", "account_user_id"]).where("school_id", "=", schoolId).where("id", "in", refs.map(ref => ref.id)).where(sql<boolean>`retired_at IS NULL`).orderBy("id").forShare().execute();
    const obsolete = refs.find(ref => rows.some(row => row.id === ref.id && row.revision > ref.expected_revision));
    if (obsolete) throw new ConflictException({ code: "learning.offering_selection_obsolete", message: "A selected person changed. Review your selection before continuing.",
      fields: { offering_obsolete: { code: "learning.offering_selection_obsolete", confirmation: "permanently_inapplicable", receipt_state: "absent", handler: "learning.offerings",
        ...command, person_id: obsolete.id, selected_revision: obsolete.expected_revision, current_person_revision: rows.find(row => row.id === obsolete.id)!.revision } } });
    if (rows.length !== refs.length || refs.some(ref => !rows.some(row => row.id === ref.id && row.revision === ref.expected_revision)))
      throw new ConflictException("A selected person changed or is unavailable. Review your selection.");
    return rows;
  }
  private date(startsOn: string, today: string) { if (startsOn > today) throw new BadRequestException("Start this learning group today or on an earlier date. Future starts are not supported in this first setup."); }
  private async instructor(tx: Transaction<Database>, user: AuthUser, schoolId: string, ref: { id: string; expected_revision: number }, command: SelectionCommand) {
    const [person] = await this.people(tx, schoolId, [ref], command);
    if (!person) throw new BadRequestException("Choose an available instructor.");
    const actor = await this.model.identityPort().resolvePersonAgent(tx, { school_id: schoolId, person_id: person.id, at: executionNow().toISOString() });
    if (!actor.acting) throw new BadRequestException("The instructor needs current app access before they can receive assignment work.");
    if (actor.person_id !== person.id) throw new ConflictException("The selected instructor's account link changed.");
    return person;
  }
  private async activeCount(tx: Transaction<Database>, schoolId: string, id: string) {
    return (await sql<{ total: number }>`SELECT count(*)::int AS total FROM learning_offering_enrollments WHERE school_id=${schoolId}::uuid AND offering_id=${id}::uuid AND ends_on IS NULL`.execute(tx)).rows[0]!.total;
  }
  private async courseRosterIsOperating(tx: Transaction<Database>, schoolId: string, offeringId: string) {
    return (await sql<{ operating: boolean }>`SELECT EXISTS(SELECT 1 FROM learning_offering_academic_contexts binding
      WHERE binding.school_id=${schoolId}::uuid AND binding.offering_id=${offeringId}::uuid AND(
        EXISTS(SELECT 1 FROM schedule_versions plan WHERE plan.school_id=binding.school_id AND plan.offering_id=binding.offering_id AND plan.published_at IS NOT NULL)
        OR EXISTS(SELECT 1 FROM learning_assignments work WHERE work.school_id=binding.school_id AND work.offering_id=binding.offering_id AND work.state='published')
        OR EXISTS(SELECT 1 FROM assessments assessment WHERE assessment.school_id=binding.school_id AND assessment.offering_id=binding.offering_id
          AND(assessment.status IN ('scheduled','marking','submitted','moderated','published') OR EXISTS(SELECT 1 FROM assessment_results result WHERE result.school_id=assessment.school_id AND result.assessment_id=assessment.id)))
      )) AS operating`.execute(tx)).rows[0]!.operating;
  }
  private async requireInitialCourseRoster(tx: Transaction<Database>, schoolId: string, offeringId: string) {
    if (await this.courseRosterIsOperating(tx,schoolId,offeringId)) throw new BadRequestException({ code: "learning.course_review_required",
      message: "This course already has published teaching or learning work. Use a reviewed elective change so future sessions and the Finance decision are handled together. A withdrawal without a destination needs its own reviewed course-withdrawal workflow; it is not supported by End registration.",
      fields: { offering_id: offeringId, recovery: "reviewed_elective_change", href: `/areas/messages/assignments?scope=offering&offering_id=${offeringId}` } });
  }
  private async addEnrollments(tx: Transaction<Database>, user: AuthUser, schoolId: string, id: string, refs: Array<{ id: string; expected_revision: number }>, startsOn: string, command: SelectionCommand) {
    await this.people(tx, schoolId, refs, command);
    if (await this.activeCount(tx, schoolId, id) + refs.length > 100) throw new BadRequestException("This learning group supports up to 100 current people.");
    const existing = await tx.selectFrom("learning_offering_enrollments").select("person_id").where("school_id", "=", schoolId).where("offering_id", "=", id).where("person_id", "in", refs.map(ref => ref.id)).where("ends_on", "is", null).execute();
    if (existing.length) throw new ConflictException("A selected person is already enrolled. Refresh the group.");
    if (await tx.selectFrom("learning_offering_teaching_assignments").select("id").where("school_id", "=", schoolId).where("offering_id", "=", id)
      .where("person_id", "in", refs.map(ref => ref.id)).where("ends_on", "is", null).executeTakeFirst())
      throw new BadRequestException("Choose learners separately from the instructor. Self-assessed assignments are not supported in this first learning group setup.");
    return tx.insertInto("learning_offering_enrollments").values(refs.map(ref => ({ id: randomUUID(), school_id: schoolId, offering_id: id, person_id: ref.id,
      selected_person_revision: ref.expected_revision, starts_on: startsOn, ends_on: null, revision: 1, created_by: user.id, created_at: executionNow(), ended_by: null, ended_at: null, end_reason: null })))
      .returning(["id", "person_id", "revision"]).execute();
  }
  async create(user: AuthUser, raw: unknown) {
    const data = learningOfferingCreate.parse(raw);
    return this.db.transaction().execute(async tx => {
      const school = await this.context.setup(tx, user);
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`learning-offering:${data.offering_id}`},0))`.execute(tx);
      const existing = await tx.selectFrom("learning_offerings").selectAll().where("id", "=", data.offering_id).forUpdate().executeTakeFirst();
      if (existing && existing.school_id !== school.id) throw new ForbiddenException("This learning group identifier is unavailable.");
      const source = existing ?? { id: data.offering_id, school_id: school.id, revision: 0 };
      const prepared = await this.model.prepareOffering(tx, user, source, "create", { command_id: data.command_id, expected_revision: 0 }, data);
      if (prepared.status === "completed") return { ...learningOfferingReceipts.create.parse(prepared.metadata), replayed: true };
      if (existing) throw new ConflictException("This learning group already exists.");
      if (data.participants.some(person => person.id === data.instructor.id)) throw new BadRequestException("Choose learners separately from the instructor. Self-assessed assignments are not supported in this first learning group setup.");
      const selection = { source_id: source.id, command_id: data.command_id, expected_revision: 0, current_revision: source.revision };
      this.date(data.starts_on, school.today); await this.instructor(tx, user, school.id, data.instructor, selection);
      const saved = await tx.insertInto("learning_offerings").values({ id: data.offering_id, school_id: school.id, name: data.name, state: "active", revision: 1, created_by: user.id, created_at: executionNow(), updated_at: executionNow() }).returningAll().executeTakeFirstOrThrow();
      const appointment = await tx.insertInto("learning_offering_teaching_assignments").values({ id: randomUUID(), school_id: school.id, offering_id: saved.id, person_id: data.instructor.id,
        selected_person_revision: data.instructor.expected_revision, can_publish: true, can_review: true, starts_on: data.starts_on, ends_on: null, revision: 1,
        created_by: user.id, created_at: executionNow(), ended_by: null, ended_at: null, end_reason: null }).returning("id").executeTakeFirstOrThrow();
      const enrollments = await this.addEnrollments(tx, user, school.id, saved.id, data.participants, data.starts_on, selection);
      const academic = data.academic_context ? await saveOfferingAcademicContext(tx, school.id, saved.id, user.id, data.academic_context) : null;
      const result = { id: saved.id, revision: saved.revision, teaching_assignment_id: appointment.id, enrollments, ...(academic ? { academic_context: academic } : {}) };
      const event = await this.model.offeringEvent(tx, user, saved, "created", prepared.command_id, [user.id]);
      await this.model.finishOffering(tx, saved, prepared.command_id, result, event);
      return { ...result, replayed: false };
    });
  }
  private async locked(tx: Transaction<Database>, schoolId: string, id: string) {
    const source = await tx.selectFrom("learning_offerings").selectAll().where("school_id", "=", schoolId).where("id", "=", assignmentId.parse(id)).forUpdate().executeTakeFirst();
    if (!source || source.state !== "active") throw new NotFoundException("Learning group unavailable.");
    return source;
  }
  async configureAcademicContext(user: AuthUser, id: string, raw: unknown) {
    const data = learningOfferingAcademicCommand.parse(raw);
    return this.db.transaction().execute(async tx => {
      const school = await this.context.setup(tx, user), source = await this.locked(tx, school.id, id);
      const prepared = await this.model.prepareOffering(tx, user, source, "academic.configure", data, { id, ...data });
      if (prepared.status === "completed") return { ...learningOfferingReceipts.academic.parse(prepared.metadata), replayed: true };
      const academic = await saveOfferingAcademicContext(tx, school.id, source.id, user.id, data.academic_context);
      const saved = await tx.updateTable("learning_offerings").set({ revision: source.revision + 1, updated_at: executionNow() }).where("school_id", "=", school.id).where("id", "=", source.id).returningAll().executeTakeFirstOrThrow();
      const result = { id: saved.id, revision: saved.revision, action: "academic.configure" as const, academic_context: academic };
      const event = await this.model.offeringEvent(tx, user, saved, "academic_configured", prepared.command_id, [user.id]);
      await this.model.finishOffering(tx, saved, prepared.command_id, result, event);
      return { ...result, replayed: false };
    });
  }
  async previewElectiveChange(tx: Transaction<Database>, user: AuthUser, rawSelection: ElectiveSelection): Promise<ElectiveRosterPreview> {
    const school = await this.context.setup(tx, user);
    return previewOfferingElectiveRoster(tx, school.id, school.today, electiveSelection.parse(rawSelection));
  }

  /** Enrollment and all reviewed future timetable successors commit together.
   * The Finance/review owner supplies its accepted explicit outcome separately;
   * this port never creates, cancels or infers any fee adjustment. */
  async applyElectiveChange(tx: Transaction<Database>, user: AuthUser, reviewed: ElectiveRosterPreview, commandId: string, sourceProof?: ElectiveRosterSourceProof): Promise<ElectiveRosterApplyReceipt> {
    assignmentId.parse(commandId);
    const school = await this.context.setup(tx, user), selection = electiveSelection.parse(reviewed.selection);
    if (!sourceProof || !this.commandVerifier) throw new ConflictException("The current reviewed elective and Finance command proof is required before enrollment can change.");
    for (const value of Object.values(sourceProof)) assignmentId.parse(value);
    const parent = await this.commandVerifier.verifyPreparedDomainCommand(tx, { school_id: school.id, actor_user_id: user.id,
      command_id: sourceProof.command_id, correlation_id: sourceProof.correlation_id, source_domain: "learning_elective", required_capability: "campus.setup",
      allowed_command_types: ["learning.elective_change.apply"] });
    if (parent.safe_context.elective_change_id !== sourceProof.change_id || parent.safe_context.finance_decision_id !== sourceProof.finance_decision_id
      || parent.safe_context.preview_fingerprint !== reviewed.fingerprint || parent.safe_context.person_id !== selection.person.id
      || parent.safe_context.source_offering_id !== selection.source_offering.id || parent.safe_context.destination_offering_id !== selection.destination_offering.id
      || parent.safe_context.effective_on !== selection.effective_on || sourceProof.correlation_id !== commandId)
      throw new ConflictException("The prepared elective command does not match this exact reviewed roster and Finance decision.");
    await tx.selectFrom("learning_offerings").select("id").where("school_id", "=", school.id)
      .where("id", "in", [selection.source_offering.id,selection.destination_offering.id]).orderBy("id").forUpdate().execute();
    const source = await this.locked(tx, school.id, selection.source_offering.id), destination = await this.locked(tx, school.id, selection.destination_offering.id);
    const rosterKey = activityOccurrenceId(school.id, "elective_roster_command", commandId, source.id);
    const prepared = await this.model.prepareOffering(tx, user, source, "elective.transfer", { command_id: rosterKey, expected_revision: selection.source_offering.expected_revision }, reviewed,
      { elective_change: { fingerprint: reviewed.fingerprint, person_id: selection.person.id, source_offering_id: source.id,
        destination_offering_id: destination.id, effective_on: selection.effective_on, plans: reviewed.schedule.impacts } });
    const receiptSchema = z.object({ source_enrollment_id: z.uuid(), destination_enrollment_id: z.uuid(), effective_on: z.iso.date(),
      schedule_revisions: z.array(z.object({ previous_plan_id: z.uuid(), plan_id: z.uuid(), revision: z.number().int().positive(), command_id: z.uuid() }).strict()) }).strict();
    if (prepared.status === "completed") return receiptSchema.parse(prepared.metadata);
    const current = await this.previewElectiveChange(tx, user, selection);
    if (current.fingerprint !== reviewed.fingerprint) throw new ElectiveRuleRefusal("The reviewed enrollment, timetable or earlier evidence changed. Review the current impact before applying it.");
    const ended = await tx.updateTable("learning_offering_enrollments").set({ ends_on: selection.effective_on, revision: selection.source_enrollment.expected_revision + 1,
      ended_by: user.id, ended_at: executionNow(), end_reason: `Reviewed elective change effective ${selection.effective_on}` })
      .where("school_id", "=", school.id).where("offering_id", "=", source.id).where("id", "=", selection.source_enrollment.id)
      .where("revision", "=", selection.source_enrollment.expected_revision).where("ends_on", "is", null).returning("id").executeTakeFirst();
    if (!ended) throw new ElectiveRuleRefusal("The exact source enrollment changed. Review the change again.");
    const added = await this.addEnrollments(tx, user, school.id, destination.id, [selection.person], selection.effective_on,
      { source_id: destination.id, command_id: rosterKey, expected_revision: selection.destination_offering.expected_revision, current_revision: destination.revision });
    const savedSource = await tx.updateTable("learning_offerings").set({ revision: source.revision + 1, updated_at: executionNow() }).where("school_id", "=", school.id).where("id", "=", source.id).returningAll().executeTakeFirstOrThrow();
    const savedDestination = await tx.updateTable("learning_offerings").set({ revision: destination.revision + 1, updated_at: executionNow() }).where("school_id", "=", school.id).where("id", "=", destination.id).returningAll().executeTakeFirstOrThrow();
    if (reviewed.schedule.impacts.length && !this.planning) throw new ConflictException("Current timetable publication is unavailable; enrollment was not applied.");
    const plans = reviewed.schedule.impacts.length ? await this.planning!.publishOfferingEnrollmentChange(tx, { authUser: user, requestId: commandId }, school.id, reviewed, prepared.command_id, rosterKey) : [];
    const result: ElectiveRosterApplyReceipt = { source_enrollment_id: ended.id, destination_enrollment_id: added[0]!.id, effective_on: selection.effective_on, schedule_revisions: plans };
    const event = await this.model.offeringEvent(tx, user, savedSource, "elective_transferred", prepared.command_id, [user.id]);
    await this.model.offeringEvent(tx, user, savedDestination, "elective_received", prepared.command_id, [user.id]);
    await this.model.finishOffering(tx, savedSource, prepared.command_id, { ...result }, event);
    return result;
  }
  async enroll(user: AuthUser, id: string, raw: unknown) {
    const data = learningOfferingEnroll.parse(raw);
    return this.db.transaction().execute(async tx => {
      const school = await this.context.setup(tx, user), source = await this.locked(tx, school.id, id);
      const prepared = await this.model.prepareOffering(tx, user, source, "enroll", data, { id, ...data });
      if (prepared.status === "completed") return { ...learningOfferingReceipts.enroll.parse(prepared.metadata), replayed: true };
      await this.requireInitialCourseRoster(tx, school.id, id);
      this.date(data.starts_on, school.today);
      const enrollments = await this.addEnrollments(tx, user, school.id, id, data.participants, data.starts_on,
        { source_id: id, command_id: data.command_id, expected_revision: data.expected_revision, current_revision: source.revision });
      const saved = await tx.updateTable("learning_offerings").set({ revision: source.revision + 1, updated_at: executionNow() }).where("id", "=", id).returningAll().executeTakeFirstOrThrow();
      const result = { id, revision: saved.revision, enrollments }, event = await this.model.offeringEvent(tx, user, saved, "enrolled", prepared.command_id, [user.id]);
      await this.model.finishOffering(tx, saved, prepared.command_id, result, event); return { ...result, replayed: false };
    });
  }
  async appointInstructor(user: AuthUser, id: string, raw: unknown) {
    const data = learningOfferingInstructor.parse(raw);
    return this.db.transaction().execute(async tx => {
      const school = await this.context.setup(tx, user), source = await this.locked(tx, school.id, id);
      const prepared = await this.model.prepareOffering(tx, user, source, "instructor.appoint", data, { id, ...data });
      if (prepared.status === "completed") return { ...learningOfferingReceipts.instructor.parse(prepared.metadata), replayed: true };
      this.date(data.starts_on, school.today); await this.instructor(tx, user, school.id, data.instructor,
        { source_id: id, command_id: data.command_id, expected_revision: data.expected_revision, current_revision: source.revision });
      if (await tx.selectFrom("learning_offering_enrollments").select("id").where("school_id", "=", school.id).where("offering_id", "=", id)
        .where("person_id", "=", data.instructor.id).where("ends_on", "is", null).executeTakeFirst())
        throw new BadRequestException("The instructor cannot also be a current learner in this first learning group setup. End that learner enrollment or choose another instructor.");
      if (await tx.selectFrom("learning_offering_teaching_assignments").select("id").where("school_id", "=", school.id).where("offering_id", "=", id).where("ends_on", "is", null).executeTakeFirst())
        throw new ConflictException("End the current teaching appointment before appointing its replacement. Published assignments are not reassigned automatically.");
      const appointment = await tx.insertInto("learning_offering_teaching_assignments").values({ id: randomUUID(), school_id: school.id, offering_id: id, person_id: data.instructor.id,
        selected_person_revision: data.instructor.expected_revision, starts_on: data.starts_on, ends_on: null, revision: 1, can_publish: true, can_review: true,
        created_by: user.id, created_at: executionNow(), ended_by: null, ended_at: null, end_reason: null }).returning("id").executeTakeFirstOrThrow();
      const saved = await tx.updateTable("learning_offerings").set({ revision: source.revision + 1, updated_at: executionNow() }).where("id", "=", id).returningAll().executeTakeFirstOrThrow();
      const result = { id, revision: saved.revision, teaching_assignment_id: appointment.id }, event = await this.model.offeringEvent(tx, user, saved, "instructor_appointed", prepared.command_id, [user.id]);
      await this.model.finishOffering(tx, saved, prepared.command_id, result, event); return { ...result, replayed: false };
    });
  }
  endEnrollment(user: AuthUser, id: string, recordId: string, raw: unknown) { return this.end(user, id, recordId, raw, false); }
  endInstructor(user: AuthUser, id: string, recordId: string, raw: unknown) { return this.end(user, id, recordId, raw, true); }
  private async end(user: AuthUser, id: string, recordId: string, raw: unknown, teaching: boolean) {
    const data = learningOfferingEnd.parse(raw); assignmentId.parse(recordId);
    return this.db.transaction().execute(async tx => {
      const school = await this.context.setup(tx, user), source = await this.locked(tx, school.id, id);
      const table = teaching ? "learning_offering_teaching_assignments" : "learning_offering_enrollments";
      const record = await tx.selectFrom(table).selectAll().where("school_id", "=", school.id).where("offering_id", "=", id).where("id", "=", recordId).forUpdate().executeTakeFirst();
      if (!record) throw new NotFoundException("This responsibility is unavailable.");
      const action = teaching ? "instructor.end" : "enrollment.end";
      const prepared = await this.model.prepareOffering(tx, user, { ...source, revision: record.revision }, action, data, { id, recordId, ...data });
      if (prepared.status === "completed") return { ...learningOfferingReceipts.end.parse(prepared.metadata), replayed: true };
      if (!teaching) await this.requireInitialCourseRoster(tx, school.id, id);
      if (record.ends_on) throw new ConflictException("This responsibility has already ended.");
      if (record.starts_on > school.today) throw new ConflictException("This future responsibility needs a separate correction.");
      await tx.updateTable(table).set({ ends_on: school.today, revision: record.revision + 1, ended_by: user.id, ended_at: executionNow(), end_reason: data.reason }).where("id", "=", recordId).execute();
      const saved = await tx.updateTable("learning_offerings").set({ revision: source.revision + 1, updated_at: executionNow() }).where("id", "=", id).returningAll().executeTakeFirstOrThrow();
      const result = { id, revision: saved.revision, record_id: recordId, record_revision: record.revision + 1, ends_on: school.today };
      const event = await this.model.offeringEvent(tx, user, saved, teaching ? "instructor_ended" : "enrollment_ended", prepared.command_id, [user.id]);
      await this.model.finishOffering(tx, saved, prepared.command_id, result, event); return { ...result, replayed: false };
    });
  }
  async confirmation(user: AuthUser, id: string, commandId: string, action: string) {
    assignmentId.parse(id); assignmentId.parse(commandId);
    if (!["create", "enroll", "enrollment.end", "instructor.end", "instructor.appoint", "academic.configure"].includes(action)) throw new BadRequestException("Choose an exact learning group action.");
    return this.db.transaction().execute(async tx => {
      const school = await this.context.setup(tx, user), receipt = await this.model.offeringReceipt(tx, user, school.id, id, commandId, action);
      const base = { handler: "learning.offerings", source_id: id, command_id: commandId, action };
      if (!receipt) return { ...base, state: "not_found" as const };
      if (receipt.state === "pending") return { ...base, state: "pending" as const };
      if (receipt.receipt.terminal_state !== "accepted") return { ...base, state: "not_accepted" as const };
      const schema = action === "create" ? learningOfferingReceipts.create : action === "academic.configure" ? learningOfferingReceipts.academic
        : action === "enroll" ? learningOfferingReceipts.enroll : action === "instructor.appoint" ? learningOfferingReceipts.instructor : learningOfferingReceipts.end;
      return { ...base, state: "accepted" as const, result: schema.parse(receipt.receipt.metadata) };
    });
  }
}
