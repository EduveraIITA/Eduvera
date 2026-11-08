import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import type { AuthUser } from "../common/request.js";
import { DatabaseService } from "../database/database.service.js";
import type { Database } from "../database/types.js";
import { executionNow } from "../campus-model-core/execution-time.runtime.js";
import { assignmentHandoverReceipt, assignmentId, assignmentReviewerHandover } from "./learning-assignment.contracts.js";
import { LearningAssignmentContextService, type AssignmentSource } from "./learning-assignment-context.service.js";
import { assignmentHash, LearningAssignmentModelService } from "./learning-assignment-model.service.js";
import { assignmentHandoverReferences, currentAssignmentAttempt } from "./learning-assignment-handover-state.js";
import type { Selectable } from "kysely";
import type { LearningAssignmentAttemptTable } from "./learning-assignment.tables.js";

type Tx = Transaction<Database>;
type Pending = Selectable<LearningAssignmentAttemptTable> & { decision: "request_changes" | null; learner_user_id: string | null };
const pageOf = (input?: string) => { const page = Number(input ?? 1); if (!Number.isInteger(page) || page < 1 || page > 10000) throw new ConflictException("Choose a valid handover page."); return page; };

/** Setup may repair responsibility, never inspect private drafts or act as a reviewer. */
@Injectable()
export class LearningAssignmentHandoverService {
  constructor(private readonly db: DatabaseService, private readonly context: LearningAssignmentContextService, private readonly model: LearningAssignmentModelService) {}

  private async pending(tx: Tx, source: AssignmentSource) {
    const rows = (await sql<Pending>`SELECT attempt.*,review.decision,CASE WHEN source.context_kind='class_term' THEN student.user_id ELSE person.account_user_id END AS learner_user_id
      FROM learning_assignments source JOIN learning_assignment_audience audience ON audience.school_id=source.school_id AND audience.assignment_id=source.id
      JOIN school_people person ON person.id=audience.person_id AND person.school_id=audience.school_id
      LEFT JOIN students student ON student.id=audience.student_id AND student.school_id=audience.school_id
      JOIN LATERAL(SELECT item.* FROM learning_assignment_attempts item WHERE item.school_id=audience.school_id AND item.assignment_id=audience.assignment_id
        AND item.learner_id=audience.learner_id ORDER BY item.attempt_number DESC LIMIT 1) attempt ON true
      LEFT JOIN learning_assignment_reviews review ON review.school_id=source.school_id AND review.attempt_id=attempt.id
      WHERE source.school_id=${source.school_id}::uuid AND source.id=${source.id}::uuid AND review.decision IS DISTINCT FROM 'reviewed'
      ORDER BY attempt.learner_id`.execute(tx)).rows;
    const references = await assignmentHandoverReferences(tx, source.school_id, rows.map(row => row.id));
    const result: Pending[] = [];
    for (const row of rows) {
      if (source.context_kind === "learning_offering") {
        const learner = await this.model.identityPort().resolvePersonAgent(tx, { school_id: source.school_id, person_id: row.learner_id, at: executionNow().toISOString() });
        row.learner_user_id = learner.acting ? learner.user_id : null;
      }
      result.push((await currentAssignmentAttempt(tx, source.school_id, source.id, row, references))!);
    }
    return result;
  }

  private preview(source: AssignmentSource, rows: Pending[]) {
    return assignmentHash({ id: source.id, revision: source.revision, reviewer_id: source.reviewer_id,
      work: rows.map(row => ({ id: row.id, learner_id: row.learner_id, attempt_number: row.attempt_number, decision: row.decision,
        review_message_id: row.review_message_id, revision_message_id: row.revision_message_id })) });
  }

  private async metadata(tx: Tx, source: AssignmentSource) {
    const current = await tx.selectFrom("users").select(["first_name", "last_name"]).where("id", "=", source.reviewer_id).executeTakeFirstOrThrow();
    let eligible = true;
    try { await this.context.reviewer(tx, { id: source.reviewer_id, is_active: true, active_school_id: source.school_id } as AuthUser, source); }
    catch (cause) { if (cause instanceof ForbiddenException || cause instanceof NotFoundException) eligible = false; else throw cause; }
    const pending = await this.pending(tx, source);
    return { id: source.id, title: source.title, revision: source.revision,
      reviewer: { id: source.reviewer_id, name: `${current.first_name} ${current.last_name}`.trim(), current: eligible },
      pending_reviews: pending.filter(row => !row.decision).length, requested_revisions: pending.filter(row => row.decision === "request_changes").length,
      preview_hash: this.preview(source, pending) };
  }

  async list(user: AuthUser, query: { page?: string }) {
    const page = pageOf(query.page);
    return this.db.transaction().execute(async tx => {
      const school = await this.context.setup(tx, user);
      const rows = await tx.selectFrom("learning_assignments").selectAll().where("school_id", "=", school.id).where("state", "=", "published")
        .orderBy("updated_at", "desc").orderBy("id").limit(11).offset((page - 1) * 10).execute();
      return { items: await Promise.all(rows.slice(0, 10).map(row => this.metadata(tx, row))), page, has_more: rows.length > 10 };
    });
  }

  private async reviewers(tx: Tx, user: AuthUser, source: AssignmentSource) {
    const school = await this.context.account(tx, user);
    const ids: Array<{ id: string }> = [];
    if (source.context_kind === "learning_offering") {
      const people = await tx.selectFrom("learning_offering_teaching_assignments").select("person_id").distinct()
        .where("school_id", "=", source.school_id).where("offering_id", "=", source.offering_id!).where("can_review", "=", true).where("starts_on", "<=", school.today)
        .where(eb => eb.or([eb("ends_on", "is", null), eb("ends_on", ">", school.today)])).orderBy("person_id").execute();
      for (const person of people) {
        const endpoint = await this.model.identityPort().resolvePersonAgent(tx, { school_id: source.school_id, person_id: person.person_id, at: executionNow().toISOString() });
        if (endpoint.acting) ids.push({ id: endpoint.user_id });
      }
    } else ids.push(...(await sql<{ id: string }>`SELECT DISTINCT binding.user_id AS id FROM staff_role_bindings binding
      WHERE binding.school_id=${source.school_id}::uuid AND binding.context_kind='class' AND binding.scope_id=${source.class_section_id}::uuid
        AND binding.status='active' AND binding.role_active AND 'learning.assignments.manage'=ANY(binding.permissions)
        AND ${school.today}::date>=binding.starts_on AND(binding.ends_on IS NULL OR ${school.today}::date<=binding.ends_on)
        AND(binding.subject_id IS NULL OR binding.subject_id=${source.subject_id}::uuid) ORDER BY id`.execute(tx)).rows);
    const result: Array<{ id: string; name: string }> = [];
    for (const { id } of ids) {
      if (id === source.reviewer_id) continue;
      try {
        const actor = { ...user, id }, access = source.context_kind === "learning_offering"
          ? await this.context.offeringTeacher(tx, actor, source.offering_id!, "review") : await this.context.teacher(tx, actor, source.class_section_id!, source.subject_id);
        if (await tx.selectFrom("learning_assignment_audience").select("person_id").where("school_id", "=", source.school_id).where("assignment_id", "=", source.id).where("person_id", "=", access.school.actor.person_id).executeTakeFirst()) continue;
        const person = await tx.selectFrom("school_people").select(["first_name", "last_name"]).where("school_id", "=", source.school_id).where("id", "=", access.school.actor.person_id).executeTakeFirstOrThrow();
        result.push({ id, name: `${person.first_name} ${person.last_name}`.trim() });
      } catch (cause) { if (!(cause instanceof ForbiddenException || cause instanceof NotFoundException)) throw cause; }
    }
    return result;
  }

  async detail(user: AuthUser, id: string) {
    return this.db.transaction().setIsolationLevel("repeatable read").execute(async tx => {
      await this.context.setup(tx, user); const source = await this.context.source(tx, user, assignmentId.parse(id));
      if (source.state !== "published") throw new ConflictException("Publish the assignment before changing its review responsibility.");
      const history = await tx.selectFrom("learning_assignment_review_handovers").select(["id", "source_revision", "reason", "created_at", "previous_reviewer_id", "reviewer_id"])
        .where("school_id", "=", source.school_id).where("assignment_id", "=", source.id).orderBy("source_revision", "desc").limit(20).execute();
      return { ...await this.metadata(tx, source), reviewers: await this.reviewers(tx, user, source),
        history: history.map(item => ({ ...item, created_at: item.created_at.toISOString() })),
        privacy: "This setup view does not show private work. The named reviewer may open this assignment's submitted attempts and feedback; private drafts stay with each learner." };
    });
  }

  async transfer(user: AuthUser, id: string, raw: unknown) {
    const data = assignmentReviewerHandover.parse(raw);
    return this.db.transaction().execute(async tx => {
      const school = await this.context.setup(tx, user), source = await this.context.source(tx, user, assignmentId.parse(id), true);
      const prepared = await this.model.prepare(tx, user, source, "reviewer.handover", data, { id, ...data }, [{ school_id: school.id, user_id: user.id }], false, true);
      if (prepared.status === "completed") return { ...assignmentHandoverReceipt.parse(prepared.metadata), replayed: true };
      if (source.state !== "published") throw new ConflictException("Only a published assignment has a review handover.");
      if (!await this.reviewers(tx, user, source).then(rows => rows.some(row => row.id === data.reviewer_id))) throw new ForbiddenException("Choose a different currently eligible reviewer for this exact learning context.");
      const replacement = source.context_kind === "learning_offering" ? await this.context.offeringTeacher(tx, { ...user, id: data.reviewer_id }, source.offering_id!, "review")
        : await this.context.teacher(tx, { ...user, id: data.reviewer_id }, source.class_section_id!, source.subject_id);
      const rows = await this.pending(tx, source);
      if (this.preview(source, rows) !== data.preview_hash) throw new ConflictException({ code: "assignment_handover_preview_obsolete", message: "Submitted work changed. Review the current handover before confirming.",
        fields: { assignment_handover_obsolete: { code: "assignment_handover_preview_obsolete", confirmation: "permanently_inapplicable", receipt_state: "absent", handler: "learning.assignments",
          source_id: source.id, command_id: data.command_id, expected_revision: data.expected_revision, reviewed_preview_hash: data.preview_hash, current_preview_hash: this.preview(source, rows) } } });
      // All ordinary submission/review writers share-lock the assignment first, so this exact preview cannot change underneath the handover.
      const jobs: Array<{ row: Pending; kind: "review" | "revision"; recipient: string; trace: Awaited<ReturnType<LearningAssignmentModelService["handoffTrace"]>>;
        prepared: Awaited<ReturnType<LearningAssignmentModelService["prepareHandoverClosure"]>> | null }> = [];
      for (const row of rows) {
        const kind = row.decision === "request_changes" ? "revision" as const : "review" as const;
        let recipient = data.reviewer_id;
        if (kind === "revision") {
          if (!row.learner_user_id) continue;
          try { await this.context.family(tx, { ...user, id: row.learner_user_id }, row.learner_id, source, true); }
          catch (cause) { if (cause instanceof ForbiddenException || cause instanceof NotFoundException) continue; throw cause; }
          recipient = row.learner_user_id;
        }
        const oldMessage = kind === "review" ? row.review_message_id : row.revision_message_id;
        const trace = await this.model.handoffTrace(tx, source, row.id, kind === "review" ? "submitted" : "changes_requested", oldMessage);
        if (oldMessage && !trace) throw new ConflictException("An earlier handoff could not be verified. The assignment is unchanged; ask campus support to review the exact route.");
        const closure = trace?.message_open ? await this.model.prepareHandoverClosure(tx, user, source, row.id, kind, trace, data.command_id) : null;
        if (closure && closure.status !== "ready") throw new ConflictException("A handover closure needs current review.");
        jobs.push({ row, kind, recipient, trace, prepared: closure });
      }
      const next = { ...source, revision: source.revision + 1, reviewer_id: data.reviewer_id,
        reviewer_person_id: source.context_kind === "learning_offering" ? replacement.school.actor.person_id : null, updated_at: executionNow() };
      const route = await this.model.route(tx, user, next, "review", data.reviewer_id, data.command_id, true);
      await tx.insertInto("learning_assignment_review_handovers").values({ id: data.command_id, school_id: source.school_id, assignment_id: id,
        source_revision: next.revision, previous_revision: source.revision, previous_reviewer_id: source.reviewer_id, previous_reviewer_person_id: source.reviewer_person_id,
        reviewer_id: next.reviewer_id, reviewer_person_id: next.reviewer_person_id, review_route_version_id: route.behaviour_version_id, review_subscription_id: route.subscription_id,
        command_id: prepared.command_id, assigned_by: user.id, reason: data.reason, created_at: next.updated_at }).execute();
      const saved = await tx.updateTable("learning_assignments").set({ revision: next.revision, reviewer_id: next.reviewer_id, reviewer_person_id: next.reviewer_person_id,
        review_route_version_id: route.behaviour_version_id, review_subscription_id: route.subscription_id, updated_at: next.updated_at }).where("school_id", "=", source.school_id).where("id", "=", id).returningAll().executeTakeFirstOrThrow();
      let reviewsReissued = 0;
      for (const job of jobs) {
        if (job.prepared?.status === "ready" && job.trace) await this.model.closeHandoverMessage(tx, user, saved, job.row.id, job.kind, job.trace, job.prepared.command_id, data.command_id);
        const handoff = job.kind === "review" ? route : { behaviour_version_id: job.row.revision_route_version_id, subscription_id: job.row.revision_subscription_id, selector_key: job.row.revision_selector_key };
        const action = job.kind === "review" ? "submitted" : "changes_requested";
        const event = await this.model.event(tx, user, saved, action, data.command_id, [job.recipient],
          { ...(source.context_kind === "learning_offering" ? { person_id: job.row.learner_id } : { student_id: job.row.learner_id }), attempt_id: job.row.id },
          { route: handoff, recipient: job.recipient, href: `/areas/messages/assignments?${new URLSearchParams(source.context_kind === "learning_offering"
            ? job.kind === "review" ? { scope: "offering", offering_id: source.offering_id!, assignment: id, learner: job.row.learner_id } : { scope: "person", person_id: job.row.learner_id, assignment: id }
            : job.kind === "review" ? { scope: "class", class_section_id: source.class_section_id!, assignment: id, learner: job.row.learner_id } : { scope: "self", student_id: job.row.learner_id, assignment: id }).toString()}` },
          `handover:${job.kind}:${job.row.id}`);
        if (!event.message_id) throw new ConflictException("The replacement handoff was not retained. Nothing changed.");
        await tx.insertInto("learning_assignment_handover_messages").values({ school_id: source.school_id, assignment_id: id, handover_id: data.command_id,
          attempt_id: job.row.id, learner_id: job.row.learner_id, kind: job.kind, source_revision: saved.revision,
          previous_message_id: job.kind === "review" ? job.row.review_message_id : job.row.revision_message_id, message_id: event.message_id, created_at: executionNow() }).execute();
        if (job.kind === "review") reviewsReissued++;
      }
      const event = await this.model.event(tx, user, saved, "reviewer_reassigned", data.command_id, [user.id, source.reviewer_id, data.reviewer_id]);
      const result = { id, handover_id: data.command_id, revision: saved.revision, reviewer_id: data.reviewer_id, reviews_reissued: reviewsReissued };
      await this.model.finish(tx, saved, prepared.command_id, result, event.event_id);
      return { ...result, replayed: false };
    });
  }
}
