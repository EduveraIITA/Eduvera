import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { sql, type Selectable, type Transaction } from "kysely";
import { z } from "zod";
import { DOMAIN_COMMAND_GATEWAY_PORT, type DomainCommandGatewayPort, type PreparedDomainCommand } from "../campus-model-core/domain-command-gateway.port.js";
import { DOMAIN_EVENT_JOURNAL_PORT, type DomainEventJournalPort } from "../campus-model-core/domain-event-journal.port.js";
import { executionNow } from "../campus-model-core/execution-time.runtime.js";
import { HUMAN_AGENT_IDENTITY_PORT, type HumanAgentIdentityPort } from "../campus-model-core/human-agent-identity.port.js";
import type { AuthUser } from "../common/request.js";
import { DatabaseService } from "../database/database.service.js";
import type { AssessmentResultReviewActionTable, AssessmentResultReviewTable, Database } from "../database/types.js";
import { hasScopedSchoolPermission } from "../roles/authorization.js";

type Tx = Transaction<Database>;
type Review = Selectable<AssessmentResultReviewTable>;
type Action = AssessmentResultReviewActionTable["action"];
type ReviewView = Review & {
  assessment_title: string; publication_sequence: number; learner_name: string; reviewer_name: string;
  source_result_id: string; correction_id: string | null; correction_sequence: number | null;
};
const uuid = z.string().uuid();
const note = z.string().trim().min(3).max(1000);
const targetFields = { person_id: uuid.optional(), student_id: uuid.optional() };
const exactTarget = (value: { person_id?: string | undefined; student_id?: string | undefined }) => Boolean(value.person_id) !== Boolean(value.student_id);
const targetInput = z.object(targetFields).strict().refine(exactTarget);
const submitInput = z.object({ ...targetFields, reviewer_user_id: uuid, note, idempotency_key: uuid }).strict().refine(exactTarget);
const decisionBase = z.object({ idempotency_key: uuid, expected_revision: z.number().int().positive() });
const decisionInput = z.discriminatedUnion("action", [
  decisionBase.extend({ action: z.literal("resolve"), note }).strict(),
  decisionBase.extend({ action: z.literal("refer_correction"), note }).strict(),
  decisionBase.extend({ action: z.literal("reassign"), reviewer_user_id: uuid }).strict(),
]);
const queuePageSize = 15;

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new BadRequestException("Choose one valid result review and complete the required fields.");
  return parsed.data;
}

function digest(input: unknown) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function display(row: ReviewView) {
  const correction = row.correction_id !== null && row.correction_sequence !== null
    ? { publication_id: row.correction_id, sequence: row.correction_sequence } : null;
  return {
    id: row.id, school_id: row.school_id, assessment_id: row.assessment_id, assessment_title: row.assessment_title,
    publication_id: row.publication_id, publication_sequence: row.publication_sequence, learner_name: row.learner_name,
    reviewer: { user_id: row.reviewer_user_id, name: row.reviewer_name }, request_note: row.request_note,
    response_note: row.response_note, state: correction ? "corrected" as const : row.state, revision: row.revision,
    requested_at: new Date(row.requested_at).toISOString(), correction,
  };
}

@Injectable()
export class ResultReviewsService {
  constructor(private readonly db: DatabaseService,
    @Inject(HUMAN_AGENT_IDENTITY_PORT) private readonly identities: HumanAgentIdentityPort,
    @Inject(DOMAIN_COMMAND_GATEWAY_PORT) private readonly commands: DomainCommandGatewayPort,
    @Inject(DOMAIN_EVENT_JOURNAL_PORT) private readonly events: DomainEventJournalPort) {}

  private async actor(db: Tx, user: AuthUser, schoolId: string) {
    parse(uuid, schoolId);
    if (user.active_school_id !== schoolId) throw new ForbiddenException("Choose this campus before opening a result review.");
    const actor = await this.identities.resolveAccountEndpoint(db, { school_id: schoolId, user_id: user.id, at: executionNow().toISOString() });
    if (!actor.acting) throw new ForbiddenException("A current campus account is required.");
    return actor;
  }

  private async requireLearnerTarget(db: Tx, schoolId: string, userId: string, personId: string, target: z.infer<typeof targetInput>) {
    if (target.person_id === personId) return;
    if (target.student_id) {
      const student = await db.selectFrom("students as student").innerJoin("school_memberships as member", join => join
        .onRef("member.school_id", "=", "student.school_id").onRef("member.user_id", "=", "student.user_id"))
        .select("student.id").where("student.school_id", "=", schoolId).where("student.id", "=", target.student_id)
        .where("student.person_id", "=", personId).where("student.user_id", "=", userId)
        .where("member.role", "=", "student").where("member.is_active", "=", true).forShare(["student", "member"]).executeTakeFirst();
      if (student) return;
    }
    throw new ForbiddenException("Choose a published result from your own campus account.");
  }

  private async membership(db: Tx, schoolId: string, userId: string) {
    return db.selectFrom("school_memberships as member").innerJoin("users as account", "account.id", "member.user_id")
      .select("member.role").where("member.school_id", "=", schoolId).where("member.user_id", "=", userId)
      .where("member.is_active", "=", true).where("account.is_active", "=", true)
      .where("member.role", "in", ["admin", "staff"]).orderBy(sql`(member.role='admin') DESC`)
      .forShare(["member", "account"]).executeTakeFirst();
  }

  private async reviewer(db: Tx, schoolId: string, assessmentId: string, userId: string, requesterUserId: string, learnerPersonId: string) {
    if (userId === requesterUserId) return null;
    const member = await this.membership(db, schoolId, userId);
    if (!member) return null;
    const identity = await this.identities.resolveAccountEndpoint(db, { school_id: schoolId, user_id: userId, at: executionNow().toISOString() });
    if (!identity.acting || identity.person_id === learnerPersonId) return null;
    const assignments = await db.selectFrom("assessment_staff_assignments").select(["role", "user_id"])
      .where("school_id", "=", schoolId).where("assessment_id", "=", assessmentId).forShare().execute();
    const examiner = assignments.find(item => item.role === "examiner");
    if (!examiner || examiner.user_id === userId) return null;
    const examinerIdentity = await this.identities.resolveAccountEndpoint(db, {
      school_id: schoolId, user_id: examiner.user_id, at: executionNow().toISOString(),
    });
    if (examinerIdentity.person_id === identity.person_id) return null;
    if (member.role === "staff" && (!assignments.some(item => item.role === "moderator" && item.user_id === userId)
      || !await hasScopedSchoolPermission(db, userId, schoolId, "assessments.moderate", "assessment", assessmentId))) return null;
    return { user_id: userId, name: identity.label };
  }

  private async defaultReviewer(db: Tx, schoolId: string, assessmentId: string, userId: string, personId: string) {
    const moderator = await db.selectFrom("assessment_staff_assignments").select("user_id")
      .where("school_id", "=", schoolId).where("assessment_id", "=", assessmentId).where("role", "=", "moderator")
      .forShare().executeTakeFirst();
    return moderator ? this.reviewer(db, schoolId, assessmentId, moderator.user_id, userId, personId) : null;
  }

  private async source(db: Tx, schoolId: string, assessmentId: string, publicationId: string, personId: string) {
    const result = (await sql<{ learner_id: string; current: boolean }>`SELECT result.learner_id, NOT EXISTS(
        SELECT 1 FROM assessment_publication_results newer_result
        JOIN assessment_publications newer ON newer.school_id=newer_result.school_id AND newer.id=newer_result.publication_id
        WHERE newer_result.school_id=result.school_id AND newer_result.assessment_id=result.assessment_id
          AND newer_result.person_id=result.person_id AND newer.sequence>publication.sequence) AS current
      FROM assessment_publication_results result JOIN assessment_publications publication
        ON publication.school_id=result.school_id AND publication.id=result.publication_id
      WHERE result.school_id=${schoolId}::uuid AND result.assessment_id=${assessmentId}::uuid
        AND result.publication_id=${publicationId}::uuid AND result.person_id=${personId}::uuid`.execute(db)).rows[0];
    if (!result) throw new NotFoundException("This published result is unavailable.");
    return result;
  }

  private views(db: Tx, schoolId: string, filter: ReturnType<typeof sql>, page?: number) {
    return sql<ReviewView>`SELECT review.*, assessment.title AS assessment_title, publication.sequence AS publication_sequence,
      concat_ws(' ',learner.first_name,learner.last_name) AS learner_name,
      concat_ws(' ',reviewer.first_name,reviewer.last_name) AS reviewer_name,
      published.source_result_id, correction.id AS correction_id, correction.sequence AS correction_sequence
      FROM assessment_result_reviews review
      JOIN assessments assessment ON assessment.id=review.assessment_id AND assessment.school_id=review.school_id
      JOIN assessment_publications publication ON publication.id=review.publication_id AND publication.school_id=review.school_id
      JOIN assessment_publication_results published ON published.school_id=review.school_id AND published.publication_id=review.publication_id
        AND published.learner_id=review.learner_id AND published.person_id=review.person_id
      JOIN school_people learner ON learner.id=review.person_id AND learner.school_id=review.school_id
      JOIN users reviewer ON reviewer.id=review.reviewer_user_id
      LEFT JOIN LATERAL (
        SELECT later.id,later.sequence FROM assessment_publication_results revised
        JOIN assessment_publications later ON later.school_id=revised.school_id AND later.id=revised.publication_id
        WHERE review.state='correction_requested' AND revised.school_id=review.school_id AND revised.assessment_id=review.assessment_id
          AND revised.person_id=review.person_id AND revised.source_result_id=published.source_result_id
          AND revised.source_result_revision>published.source_result_revision AND later.sequence>publication.sequence
          AND (revised.outcome,revised.marks,revised.grade,revised.feedback)
            IS DISTINCT FROM (published.outcome,published.marks,published.grade,published.feedback)
        ORDER BY later.sequence LIMIT 1
      ) correction ON true
      WHERE review.school_id=${schoolId}::uuid AND ${filter}
      ORDER BY review.requested_at DESC, review.id DESC
      ${page === undefined ? sql`LIMIT 40` : sql`LIMIT ${queuePageSize + 1} OFFSET ${(page - 1) * queuePageSize}`}`.execute(db).then(result => result.rows);
  }

  private async view(db: Tx, schoolId: string, reviewId: string) {
    const row = (await this.views(db, schoolId, sql`review.id=${reviewId}::uuid`))[0];
    if (!row) throw new NotFoundException("This result review is unavailable.");
    return row;
  }

  private async previousOpen(db: Tx, schoolId: string, assessmentId: string, personId: string, publicationId: string) {
    return (await this.views(db, schoolId, sql`review.assessment_id=${assessmentId}::uuid AND review.person_id=${personId}::uuid
      AND review.publication_id<>${publicationId}::uuid AND (review.state='submitted' OR review.state='correction_requested' AND correction.id IS NULL)`)).length > 0;
  }

  async learner(user: AuthUser, schoolId: string, assessmentId: string, publicationId: string, input: unknown) {
    parse(uuid, assessmentId); parse(uuid, publicationId);
    const target = parse(targetInput, input);
    return this.db.transaction().execute(async db => {
      const actor = await this.actor(db, user, schoolId);
      await this.requireLearnerTarget(db, schoolId, user.id, actor.person_id, target);
      const source = await this.source(db, schoolId, assessmentId, publicationId, actor.person_id);
      const reviews = await this.views(db, schoolId, sql`review.assessment_id=${assessmentId}::uuid AND review.person_id=${actor.person_id}::uuid`);
      const reviewer = await this.defaultReviewer(db, schoolId, assessmentId, user.id, actor.person_id);
      const unavailableReason = reviews.some(review => review.publication_id === publicationId) ? "already_requested"
        : !source.current ? "stale_publication"
        : await this.previousOpen(db, schoolId, assessmentId, actor.person_id, publicationId) ? "previous_review_open"
        : reviewer ? null : "reviewer_unavailable";
      return { school_id: schoolId, person_id: actor.person_id, student_id: target.student_id ?? null, assessment_id: assessmentId, publication_id: publicationId,
        reviewer: unavailableReason === null ? reviewer : null, unavailable_reason: unavailableReason, reviews: reviews.map(display) };
    });
  }

  private async lockAssessment(db: Tx, schoolId: string, assessmentId: string) {
    const row = await db.selectFrom("assessments").select("id")
      .where("school_id", "=", schoolId).where("id", "=", assessmentId).forUpdate().executeTakeFirst();
    if (!row) throw new NotFoundException("This published result is unavailable.");
  }

  private async existingAction(db: Tx, schoolId: string, userId: string, key: string, hash: string) {
    const action = await db.selectFrom("assessment_result_review_actions").selectAll()
      .where("school_id", "=", schoolId).where("actor_user_id", "=", userId).where("client_key", "=", key).executeTakeFirst();
    if (action && action.request_hash !== hash) throw new ConflictException("This request key was already used for different work.");
    return action;
  }

  private async lockIntent(db: Tx, schoolId: string, userId: string, key: string) {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`result-review:${schoolId}:${userId}:${key}`},0))`.execute(db);
  }

  private obsolete(schoolId: string, actorId: string, key: string, sourceId: string, message: string) {
    return new ConflictException({ message, code: "result_review_stale", fields: { school_id: schoolId, actor_user_id: actorId, idempotency_key: key, source_id: sourceId } });
  }

  async receipt(user: AuthUser, schoolId: string, key: string) {
    parse(uuid, key);
    return this.db.transaction().execute(async db => {
      const actor = await this.actor(db, user, schoolId);
      const action = await db.selectFrom("assessment_result_review_actions").selectAll()
        .where("school_id", "=", schoolId).where("actor_user_id", "=", user.id).where("client_key", "=", key).executeTakeFirst();
      if (!action) throw new NotFoundException("This review receipt is unavailable.");
      const row = await this.view(db, schoolId, action.review_id);
      if (action.action === "submit") {
        if (row.person_id !== actor.person_id) throw new NotFoundException("This review receipt is unavailable.");
      } else await this.staffAccess(db, user, row);
      return { review: display(row), client_key: key, accepted_revision: action.revision, accepted_reviewer_user_id: action.reviewer_user_id, action: action.action };
    });
  }

  async submit(user: AuthUser, schoolId: string, assessmentId: string, publicationId: string, body: unknown) {
    parse(uuid, assessmentId); parse(uuid, publicationId);
    const input = parse(submitInput, body);
    const hash = digest({ assessmentId, publicationId, ...input });
    return this.db.transaction().execute(async db => {
      const actor = await this.actor(db, user, schoolId);
      await this.requireLearnerTarget(db, schoolId, user.id, actor.person_id, input);
      await this.lockIntent(db, schoolId, user.id, input.idempotency_key);
      await this.lockAssessment(db, schoolId, assessmentId);
      const source = await this.source(db, schoolId, assessmentId, publicationId, actor.person_id);
      const replay = await this.existingAction(db, schoolId, user.id, input.idempotency_key, hash);
      if (replay) return { review: display(await this.view(db, schoolId, replay.review_id)), client_key: input.idempotency_key, accepted_revision: replay.revision, accepted_reviewer_user_id: replay.reviewer_user_id, action: replay.action };
      if (!source.current) throw this.obsolete(schoolId, user.id, input.idempotency_key, publicationId, "A newer result is available. Open that release before requesting a review.");
      const existing = await db.selectFrom("assessment_result_reviews").select("id")
        .where("school_id", "=", schoolId).where("publication_id", "=", publicationId).where("person_id", "=", actor.person_id).executeTakeFirst();
      if (existing) throw this.obsolete(schoolId, user.id, input.idempotency_key, publicationId, "You already requested a review of this release. Refresh to see its status.");
      if (await this.previousOpen(db, schoolId, assessmentId, actor.person_id, publicationId)) throw this.obsolete(schoolId, user.id, input.idempotency_key, publicationId, "An earlier review is still open.");
      const reviewer = await this.defaultReviewer(db, schoolId, assessmentId, user.id, actor.person_id);
      if (reviewer?.user_id !== input.reviewer_user_id) throw this.obsolete(schoolId, user.id, input.idempotency_key, publicationId, "The reviewer has changed or is unavailable. Refresh before submitting.");
      const now = executionNow().toISOString(), id = randomUUID();
      const row = { id, school_id: schoolId, assessment_id: assessmentId, publication_id: publicationId, learner_id: source.learner_id,
        person_id: actor.person_id, requested_by: user.id, reviewer_user_id: reviewer.user_id, request_note: input.note,
        response_note: null, state: "submitted" as const, revision: 1, requested_at: now, updated_at: now };
      const command = await this.prepare(db, user, row, "submit", input.idempotency_key, hash, 0, now);
      const saved = await db.insertInto("assessment_result_reviews").values(row).returningAll().executeTakeFirstOrThrow();
      return this.finish(db, user, saved, "submit", input.idempotency_key, hash, now, command);
    });
  }

  async staffQueue(user: AuthUser, schoolId: string, rawPage: unknown) {
    const page = rawPage === undefined ? 1 : parse(z.coerce.number().int().min(1).max(10000), rawPage);
    return this.db.transaction().execute(async db => {
      const actor = await this.actor(db, user, schoolId);
      const member = await this.membership(db, schoolId, user.id);
      if (!member) throw new ForbiddenException("Staff access is required for result review work.");
      const administrator = member.role === "admin";
      const at = executionNow();
      // Batch the same current named-moderator floor used by the detail read.
      // A lost appointment removes the item before pagination, without an
      // additional identity/permission roundtrip for every review in the queue.
      const rows = await this.views(db, schoolId, sql`
        (review.state='submitted' OR review.state='correction_requested' AND correction.id IS NULL)
        AND (${administrator} OR (review.reviewer_user_id=${user.id}::uuid AND review.person_id<>${actor.person_id}::uuid
          AND review.state='submitted' AND EXISTS (
            SELECT 1 FROM staff_role_bindings binding JOIN schools campus ON campus.id=binding.school_id
            JOIN assessment_staff_assignments assigned ON assigned.school_id=binding.school_id
              AND assigned.assessment_id=binding.scope_id AND assigned.user_id=binding.user_id AND assigned.role='moderator'
            WHERE binding.school_id=review.school_id AND binding.user_id=${user.id}::uuid AND binding.context_kind='assessment'
              AND binding.scope_id=review.assessment_id AND binding.source_kind='assessment_assignment'
              AND binding.role_active AND binding.status='active' AND 'assessments.moderate'=ANY(binding.permissions)
              AND binding.starts_on<=(${at}::timestamptz AT TIME ZONE campus.timezone)::date
              AND (binding.ends_on IS NULL OR binding.ends_on>=(${at}::timestamptz AT TIME ZONE campus.timezone)::date))
          AND NOT EXISTS (
            SELECT 1 FROM assessment_staff_assignments examiner
            LEFT JOIN LATERAL campus_model_current_account_endpoints(examiner.school_id, examiner.user_id, ${at}::timestamptz) endpoint ON true
            WHERE examiner.school_id=review.school_id AND examiner.assessment_id=review.assessment_id AND examiner.role='examiner'
              AND (examiner.user_id=${user.id}::uuid OR endpoint.person_id=${actor.person_id}::uuid))))`, page);
      return { school_id: schoolId, items: rows.slice(0, queuePageSize).map(row => ({
        id: row.id, assessment_title: row.assessment_title, learner_name: row.learner_name,
        publication_sequence: row.publication_sequence, reviewer_name: row.reviewer_name, state: row.state,
      })), page, has_more: rows.length > queuePageSize };
    });
  }

  private async staffAccess(db: Tx, user: AuthUser, review: Review) {
    const member = await this.membership(db, review.school_id, user.id);
    const assigned = review.reviewer_user_id === user.id && Boolean(await this.reviewer(db, review.school_id, review.assessment_id, user.id, review.requested_by, review.person_id));
    if (!assigned && member?.role !== "admin") throw new NotFoundException("This result review is unavailable.");
    return { assigned, administrator: member?.role === "admin" };
  }

  async staffDetail(user: AuthUser, schoolId: string, reviewId: string) {
    parse(uuid, reviewId);
    return this.db.transaction().execute(async db => {
      await this.actor(db, user, schoolId);
      const row = await this.view(db, schoolId, reviewId);
      const { administrator, assigned } = await this.staffAccess(db, user, row);
      const replacementReviewers = [];
      if (administrator && row.state === "submitted" && !await this.reviewer(db, schoolId, row.assessment_id, row.reviewer_user_id, row.requested_by, row.person_id)) {
        const candidates = await db.selectFrom("school_memberships").select("user_id")
          .where("school_id", "=", schoolId).where("role", "=", "admin").where("is_active", "=", true).orderBy("user_id").limit(50).execute();
        for (const candidate of candidates) {
          const allowed = await this.reviewer(db, schoolId, row.assessment_id, candidate.user_id, row.requested_by, row.person_id);
          if (allowed) replacementReviewers.push(allowed);
        }
      }
      return { review: display(row), can_decide: assigned && row.state === "submitted", replacement_reviewers: replacementReviewers,
        source_result_id: row.source_result_id };
    });
  }

  async decide(user: AuthUser, schoolId: string, reviewId: string, body: unknown) {
    parse(uuid, reviewId);
    const input = parse(decisionInput, body), hash = digest({ reviewId, ...input });
    return this.db.transaction().execute(async db => {
      await this.actor(db, user, schoolId);
      await this.lockIntent(db, schoolId, user.id, input.idempotency_key);
      const observed = await this.view(db, schoolId, reviewId);
      await this.staffAccess(db, user, observed);
      await this.lockAssessment(db, schoolId, observed.assessment_id);
      const row = await db.selectFrom("assessment_result_reviews").selectAll().where("school_id", "=", schoolId).where("id", "=", reviewId).forUpdate().executeTakeFirstOrThrow();
      const { assigned, administrator } = await this.staffAccess(db, user, row);
      const replay = await this.existingAction(db, schoolId, user.id, input.idempotency_key, hash);
      if (replay) return { review: display(await this.view(db, schoolId, reviewId)), client_key: input.idempotency_key, accepted_revision: replay.revision, accepted_reviewer_user_id: replay.reviewer_user_id, action: replay.action };
      if (row.revision !== input.expected_revision || row.state !== "submitted") throw this.obsolete(schoolId, user.id, input.idempotency_key, reviewId, "This request changed. Refresh before deciding.");
      let state: Review["state"] = "submitted", response: string | null = null, reviewerUserId = row.reviewer_user_id;
      if (input.action === "reassign") {
        if (!administrator || await this.reviewer(db, schoolId, row.assessment_id, row.reviewer_user_id, row.requested_by, row.person_id)) {
          throw new ForbiddenException("Only a coordinator can replace an unavailable reviewer.");
        }
        const eligible = await this.reviewer(db, schoolId, row.assessment_id, input.reviewer_user_id, row.requested_by, row.person_id);
        if (!eligible || (await this.membership(db, schoolId, eligible.user_id))?.role !== "admin") throw this.obsolete(schoolId, user.id, input.idempotency_key, reviewId, "Choose a currently eligible coordinator.");
        reviewerUserId = eligible.user_id;
      } else {
        if (!assigned) throw new ForbiddenException("Only the current named reviewer can decide this request.");
        if (input.action === "refer_correction" && !await this.canRefer(db, row)) {
          throw this.obsolete(schoolId, user.id, input.idempotency_key, reviewId, "This learner already has a revised result. Review the current publication before responding.");
        }
        state = input.action === "resolve" ? "resolved" : "correction_requested";
        response = input.note;
      }
      const now = executionNow().toISOString();
      const command = await this.prepare(db, user, row, input.action, input.idempotency_key, hash, row.revision, now);
      const saved = await db.updateTable("assessment_result_reviews").set({ state, response_note: response, reviewer_user_id: reviewerUserId,
        revision: row.revision + 1, updated_at: now }).where("school_id", "=", schoolId).where("id", "=", reviewId)
        .where("revision", "=", row.revision).returningAll().executeTakeFirstOrThrow();
      return this.finish(db, user, saved, input.action, input.idempotency_key, hash, now, command);
    });
  }

  private async canRefer(db: Tx, row: Review) {
    const result = (await sql<{ current: boolean }>`SELECT NOT EXISTS(
        SELECT 1 FROM assessment_publication_results revised
        JOIN assessment_publications later ON later.school_id=revised.school_id AND later.id=revised.publication_id
        WHERE revised.school_id=original.school_id AND revised.assessment_id=original.assessment_id
          AND revised.person_id=original.person_id AND later.sequence>publication.sequence
          AND (revised.source_result_id,revised.source_result_revision)
            IS DISTINCT FROM (original.source_result_id,original.source_result_revision)) AS current
      FROM assessment_publication_results original JOIN assessment_publications publication
        ON publication.school_id=original.school_id AND publication.id=original.publication_id
      WHERE original.school_id=${row.school_id}::uuid AND original.publication_id=${row.publication_id}::uuid
        AND original.person_id=${row.person_id}::uuid`.execute(db)).rows[0];
    return result?.current === true;
  }

  private entity(row: Pick<Review, "id" | "state" | "revision">) {
    return { kind: "assessment_result_review", domain: "assessments", domain_id: row.id, label: "Result review",
      lifecycle_state: row.state === "resolved" ? "inactive" as const : "active" as const, source_revision: row.revision, metadata: {} };
  }

  private async prepare(db: Tx, user: AuthUser, row: Pick<Review, "school_id" | "id" | "state" | "revision" | "publication_id" | "assessment_id">, action: Action, key: string, hash: string, currentRevision: number, now: string) {
    const command = await this.commands.prepareDomainCommand(db, {
      school_id: row.school_id, actor_user_id: user.id, command_type: `assessment.result_review.${action}`,
      handler_key: `assessments.result_review_${action}`, handler_version: 1, source_domain: "assessments",
      target: this.entity(row), current_revision: currentRevision, expected_revision: currentRevision,
      capability: action === "submit" ? "assessments.request_result_review" : "assessments.moderate", purpose: `assessment_result_review_${action}`,
      requested_at: now, correlation_id: row.id, causation_id: null, idempotency_key: `result-review:${user.id}:${key}`,
      operating_rule_version_ref: null, configuration_refs: [],
      authority_attestation: { evaluator_domain: "assessments", decision: "allowed",
        reason_codes: [action === "submit" ? "exact_own_publication" : action === "reassign" ? "current_institution_coordinator" : "current_named_reviewer"],
        authority_source_refs: [{ review_id: row.id, assessment_id: row.assessment_id, publication_id: row.publication_id }],
        operating_rule_refs: [], valid_until: null },
      safe_context: { review_id: row.id, action, request_hash: hash },
    });
    if (command.status !== "ready") throw new ConflictException("The exact result review command requires recovery.");
    return command;
  }

  private async finish(db: Tx, user: AuthUser, row: Review, action: Action, key: string, hash: string, now: string, command: PreparedDomainCommand) {
    await db.insertInto("assessment_result_review_actions").values({
      school_id: row.school_id, review_id: row.id, revision: row.revision, actor_user_id: user.id, reviewer_user_id: row.reviewer_user_id,
      client_key: key, request_hash: hash, command_id: command.command_id, action, accepted_at: now,
    }).execute();
    const eventType = "assessment.result_review.updated", eventKey = `assessment-result-review:${row.id}:${row.revision}`;
    const payload = { review_id: row.id, action, revision: row.revision };
    // Keep the identity and prose in the owning records. General realtime
    // subscribers receive no audience for this private event.
    const outbox = await db.insertInto("event_outbox").values({
      school_id: row.school_id, event_type: eventType, aggregate_type: "assessment_result_review", aggregate_id: row.id,
      audience_user_ids: [], payload, idempotency_key: eventKey,
    }).returning("id").executeTakeFirstOrThrow();
    await this.events.recordAcceptedEvent(db, {
      school_id: row.school_id, source_outbox_event_id: outbox.id, event_type: eventType, subject: this.entity(row), context: null,
      actor_user_id: user.id, audience_user_ids: [...new Set([user.id, row.reviewer_user_id])],
      occurred_at: now, effective_from: now, effective_until: null, source_domain: "assessments", source_record_id: row.id,
      source_revision: row.revision, correlation_id: row.id, causation_event_id: null, idempotency_key: eventKey, payload,
    });
    await this.commands.completeDomainCommand(db, { school_id: row.school_id, command_id: command.command_id,
      terminal_state: "accepted", code: `result_review_${action}`, explanation: "The authorized result review action was recorded.",
      resulting_revision: row.revision, domain_event_id: outbox.id, metadata: payload, completed_at: now });
    return { review: display(await this.view(db, row.school_id, row.id)), client_key: key, accepted_revision: row.revision, accepted_reviewer_user_id: row.reviewer_user_id, action };
  }
}
