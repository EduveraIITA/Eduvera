import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { sql, type Transaction } from "kysely";
import { z } from "zod";
import type { Database } from "../database/types.js";
import type { AuthUser } from "../common/request.js";
import { DatabaseService } from "../database/database.service.js";
import { executionNow } from "../campus-model-core/execution-time.runtime.js";
import { ElectiveFinanceReviewService } from "../operations/elective-finance-review.service.js";
import { LearningAssignmentContextService } from "./learning-assignment-context.service.js";
import { LearningOfferingsService } from "./learning-offerings.service.js";
import { LearningElectiveModelService, electiveFinanceHref, type ElectiveDelivery } from "./learning-elective-model.service.js";
import { ElectiveRuleRefusal, electiveAssignment, electiveCommand, electiveDecision, electiveRequest, electiveSelection, electiveWithdrawal,
  type ElectiveActionRow, type ElectiveChangeRow, type ElectiveReceipt } from "./learning-elective-change.contracts.js";
import type { ElectiveRosterPreview } from "./learning-offering-elective-roster.js";

function stateOf(actions: ElectiveActionRow[]) {
  let delivery: ElectiveDelivery | null = null, state: ElectiveReceipt['state'] = "unassigned", decisionId: string | null = null;
  for (const action of actions) {
    if (action.kind === "request" || action.kind === "finance.assign") { delivery = (action.data.delivery as ElectiveDelivery | null) ?? null; state = delivery ? "waiting_for_finance" : "unassigned"; decisionId = null; }
    else if (action.kind === "finance.classify") { state = action.data.outcome as "no_financial_change" | "requires_financial_review"; decisionId = String(action.data.decision_id); }
    else state = action.kind === "apply" ? "applied" : "withdrawn";
  }
  return { revision: actions.at(-1)?.revision ?? 0, delivery, state, decisionId, terminal: state === "applied" || state === "withdrawn" };
}
export interface ElectiveFinanceWorkCandidate { message_id: string; change_id: string; source_revision: number }
export interface ElectiveFinanceWorkSource extends ElectiveFinanceWorkCandidate { revision: number }
const financeWorkCandidate = z.object({ message_id: z.uuid(), change_id: z.uuid(), source_revision: z.number().int().positive() }).strict();
const financeWorkDelivery = z.object({ message_id: z.uuid(), source_revision: z.number().int().positive(), reviewer: z.object({
  user_id: z.uuid(), person_id: z.uuid(), eligibility_hash: z.string().regex(/^[a-f0-9]{64}$/u),
}) });
@Injectable()
export class LearningElectiveChangeService {
  constructor(private readonly db: DatabaseService, private readonly context: LearningAssignmentContextService, private readonly offerings: LearningOfferingsService,
    private readonly finance: ElectiveFinanceReviewService, private readonly model: LearningElectiveModelService) {}
  private async academic(tx: Transaction<Database>, user: AuthUser) {
    const school = await this.context.setup(tx, user);
    const current = (await sql`SELECT membership.id FROM school_memberships membership JOIN users account ON account.id=membership.user_id AND account.is_active
      WHERE membership.school_id=${school.id}::uuid AND membership.user_id=${user.id}::uuid AND membership.is_active AND membership.role='admin'
      FOR SHARE OF membership,account`.execute(tx)).rows;
    if (!current.length) throw new ForbiddenException("Your current academic setup responsibility is unavailable.");
    return this.context.setup(tx, user);
  }
  private async lock(tx: Transaction<Database>, schoolId: string) { await sql`SELECT pg_advisory_xact_lock(hashtextextended(${schoolId},0))`.execute(tx); }
  private async committed(work: Promise<(ElectiveReceipt & { replayed: boolean }) | { refusal: ConflictException }>) {
    const result = await work; if ("refusal" in result) throw result.refusal; return result;
  }
  private async effect(tx: Transaction<Database>, user: AuthUser, schoolId: string, id: string, action: ElectiveReceipt['action'], body: { command_id: string; expected_revision: number },
    commandId: string, payload: Record<string, unknown>, work: () => Promise<ElectiveReceipt & { replayed: boolean }>) {
    await sql`SAVEPOINT elective_native_effect`.execute(tx);
    try { const result = await work(); await sql`RELEASE SAVEPOINT elective_native_effect`.execute(tx); return result; }
    catch (cause) {
      if (!(cause instanceof ElectiveRuleRefusal)) throw cause;
      await sql`ROLLBACK TO SAVEPOINT elective_native_effect`.execute(tx); await sql`RELEASE SAVEPOINT elective_native_effect`.execute(tx);
      return { refusal: await this.model.refuse(tx, user, schoolId, id, action, body, commandId, payload, cause) };
    }
  }
  private async reviewedPreview(tx: Transaction<Database>, user: AuthUser, selection: ElectiveChangeRow['selection']) {
    try { return await this.offerings.previewElectiveChange(tx, user, selection); }
    catch (cause) { if (cause instanceof BadRequestException || cause instanceof ConflictException) throw new ElectiveRuleRefusal(cause.message); throw cause; }
  }
  private async row(tx: Transaction<Database>, schoolId: string, id: string) {
    const row = (await sql<ElectiveChangeRow>`SELECT * FROM learning_elective_changes WHERE school_id=${schoolId}::uuid AND id=${z.uuid().parse(id)}::uuid FOR UPDATE`.execute(tx)).rows[0];
    if (!row) throw new NotFoundException("This elective review is unavailable in the selected campus and world."); return row;
  }
  private async actions(tx: Transaction<Database>, schoolId: string, id: string) {
    return (await sql<ElectiveActionRow>`SELECT * FROM learning_elective_change_actions WHERE school_id=${schoolId}::uuid AND change_id=${id}::uuid ORDER BY revision`.execute(tx)).rows;
  }
  private async labels(tx: Transaction<Database>, row: ElectiveChangeRow) {
    return (await sql<{ person: string; source_offering: string; destination_offering: string }>`SELECT concat_ws(' ',person.first_name,person.last_name) AS person,
      source.name AS source_offering,destination.name AS destination_offering FROM school_people person
      JOIN learning_offerings source ON source.school_id=person.school_id AND source.id=${row.source_offering_id}::uuid
      JOIN learning_offerings destination ON destination.school_id=person.school_id AND destination.id=${row.destination_offering_id}::uuid
      WHERE person.school_id=${row.school_id}::uuid AND person.id=${row.person_id}::uuid`.execute(tx)).rows[0]!;
  }
  private async append(tx: Transaction<Database>, user: AuthUser, change: Pick<ElectiveChangeRow, 'id' | 'school_id'>, kind: ElectiveReceipt['action'], revision: number,
    commandId: string, data: Record<string, unknown>, id = randomUUID()) {
    await sql`INSERT INTO learning_elective_change_actions(id,school_id,change_id,revision,kind,actor_id,command_id,data,created_at)
      VALUES(${id}::uuid,${change.school_id}::uuid,${change.id}::uuid,${revision},${kind},${user.id}::uuid,${commandId}::uuid,${JSON.stringify(data)}::jsonb,${executionNow()})`.execute(tx);
    await sql`INSERT INTO school_operations_audit(school_id,actor_id,action,target_id,metadata)
      VALUES(${change.school_id}::uuid,${user.id}::uuid,${`learning.elective_change.${kind}`},${change.id}::uuid,${JSON.stringify({ revision })}::jsonb)`.execute(tx);
    return id;
  }
  async options(user: AuthUser, sourceOfferingId: string, personId: string) {
    z.uuid().parse(sourceOfferingId); z.uuid().parse(personId);
    return this.db.transaction().execute(async tx => {
      const school = await this.academic(tx, user);
      const selected = (await sql<{ enrollment_id: string; enrollment_revision: number; starts_on: string; ends_on: string | null; person_id: string; person_revision: number; person_name: string;
        offering_id: string; offering_name: string; offering_revision: number; term_id: string; term_starts_on: string; term_ends_on: string }>`SELECT e.id AS enrollment_id,e.revision AS enrollment_revision,
          e.starts_on::text,e.ends_on::text,p.id AS person_id,p.revision AS person_revision,concat_ws(' ',p.first_name,p.last_name) AS person_name,
          o.id AS offering_id,o.name AS offering_name,o.revision AS offering_revision,c.term_id,t.starts_on::text AS term_starts_on,t.ends_on::text AS term_ends_on
        FROM learning_offering_enrollments e JOIN learning_offerings o ON o.school_id=e.school_id AND o.id=e.offering_id AND o.state='active'
        JOIN school_people p ON p.school_id=e.school_id AND p.id=e.person_id AND p.retired_at IS NULL
        JOIN learning_offering_academic_contexts c ON c.school_id=o.school_id AND c.offering_id=o.id JOIN academic_terms t ON t.school_id=c.school_id AND t.id=c.term_id
        WHERE e.school_id=${school.id}::uuid AND e.offering_id=${sourceOfferingId}::uuid AND e.person_id=${personId}::uuid
          AND e.starts_on<=${school.today}::date AND(e.ends_on IS NULL OR e.ends_on>${school.today}::date) ORDER BY e.id LIMIT 2`.execute(tx)).rows;
      if (selected.length !== 1) throw new ConflictException("Open one current academic elective enrollment before requesting a change.");
      const current = selected[0]!;
      const destinations = (await sql<{ id: string; name: string; revision: number; academic_context: Record<string, unknown> }>`SELECT o.id,o.name,o.revision,
          jsonb_build_object('term_id',c.term_id,'subject_id',c.subject_id,'course_code',c.course_code,'credits',c.credits,'programme_key',c.programme_key,'revision',c.revision) AS academic_context
        FROM learning_offerings o JOIN learning_offering_academic_contexts c ON c.school_id=o.school_id AND c.offering_id=o.id
        WHERE o.school_id=${school.id}::uuid AND o.state='active' AND o.id<>${sourceOfferingId}::uuid AND c.term_id=${current.term_id}::uuid
        ORDER BY o.name,o.id LIMIT 101`.execute(tx)).rows;
      if (destinations.length > 100) throw new ConflictException("Narrow the active term's elective catalogue before this bounded change review.");
      // Discovery only: continue the immutable current review through its owning
      // detail reader; do not infer Finance readiness or disclose account reasons.
      const openReviews = (await sql<{ id: string; revision: number; state: Exclude<ElectiveReceipt["state"], "applied" | "withdrawn">; destination_name: string; effective_on: string }>`
        SELECT change.id::text,latest.revision,
          CASE WHEN latest.kind='finance.classify' THEN latest.data->>'outcome'
            WHEN latest.data->'delivery' IS NULL OR latest.data->'delivery'='null'::jsonb THEN 'unassigned'
            ELSE 'waiting_for_finance' END AS state,
          destination.name AS destination_name,change.selection->>'effective_on' AS effective_on
        FROM learning_elective_changes change
        JOIN learning_offerings destination ON destination.school_id=change.school_id AND destination.id=change.destination_offering_id
        JOIN LATERAL(SELECT action.revision,action.kind,action.data FROM learning_elective_change_actions action
          WHERE action.school_id=change.school_id AND action.change_id=change.id ORDER BY action.revision DESC LIMIT 1) latest ON TRUE
        WHERE change.school_id=${school.id}::uuid AND change.person_id=${personId}::uuid AND change.source_offering_id=${sourceOfferingId}::uuid
          AND latest.kind IN ('request','finance.assign','finance.classify')
        ORDER BY change.created_at DESC,change.id DESC LIMIT 20`.execute(tx)).rows;
      const earliest = new Date(Date.parse(`${school.today}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
      return { today: school.today, timezone: school.timezone, date_bounds: { earliest, latest: current.term_ends_on },
        person: { id: current.person_id, name: current.person_name, revision: current.person_revision },
        source_offering: { id: current.offering_id, name: current.offering_name, revision: current.offering_revision },
        source_enrollment: { id: current.enrollment_id, revision: current.enrollment_revision, starts_on: current.starts_on, ends_on: current.ends_on },
        destinations, finance_reviewers: await this.finance.reviewers(tx, school.id), open_reviews: openReviews };
    });
  }
  async preview(user: AuthUser, raw: unknown) {
    const data = z.object({ selection: electiveSelection }).strict().parse(raw);
    return this.db.transaction().execute(async tx => { const school = await this.academic(tx, user); await this.lock(tx, school.id);
      return this.offerings.previewElectiveChange(tx, user, data.selection); });
  }
  async confirmation(user: AuthUser, id: string, commandId: string, action: string, financeSchoolId?: string) {
    z.uuid().parse(id); z.uuid().parse(commandId); const kind = z.enum(["request", "finance.assign", "finance.classify", "apply", "withdraw"]).parse(action);
    return this.db.transaction().execute(async tx => {
      const school = kind === "finance.classify" ? await this.finance.campus(tx, user, z.uuid().parse(financeSchoolId)) : await this.academic(tx, user);
      await this.lock(tx, school.id);
      if (kind === "finance.classify") {
        const row = await this.row(tx, school.id, id), state = stateOf(await this.actions(tx, school.id, row.id));
        const reviewer = await this.finance.reviewer(tx, school.id, user.id);
        if (!reviewer || !state.delivery || reviewer.user_id !== state.delivery.reviewer.user_id || reviewer.person_id !== state.delivery.reviewer.person_id
          || reviewer.eligibility_hash !== state.delivery.reviewer.eligibility_hash) throw new ForbiddenException("Your exact Finance review responsibility changed.");
      }
      return this.model.confirmation(tx, user, school.id, id, commandId, kind);
    });
  }
  async request(user: AuthUser, raw: unknown) {
    const data = electiveRequest.parse(raw);
    return this.committed(this.db.transaction().execute(async tx => {
      const school = await this.academic(tx, user); await this.lock(tx, school.id);
      const existing = (await sql<ElectiveChangeRow>`SELECT * FROM learning_elective_changes WHERE id=${data.change_id}::uuid FOR UPDATE`.execute(tx)).rows[0];
      if (existing && existing.school_id !== school.id) throw new ForbiddenException("This elective review identifier is unavailable.");
      const current = existing ? stateOf(await this.actions(tx, school.id, existing.id)) : { revision: 0 };
      const prepared = await this.model.prepare(tx, user, school.actor, school.id, data.change_id, "request", data, current.revision, data, { school_id: school.id, actor_person_id: school.actor.person_id });
      if (prepared.refusal) return { refusal: prepared.refusal }; if (prepared.replay) return prepared.replay;
      return this.effect(tx, user, school.id, data.change_id, "request", data, prepared.command_id, data, async () => {
      const preview = await this.reviewedPreview(tx, user, data.selection);
      if (preview.fingerprint !== data.preview_fingerprint) throw new ElectiveRuleRefusal("The reviewed elective, schedule or person changed. Review the current impact before sending.");
      const reviewer = data.finance_reviewer ? await this.finance.reviewer(tx, school.id, data.finance_reviewer.user_id) : null;
      if (data.finance_reviewer && (!reviewer || reviewer.eligibility_hash !== data.finance_reviewer.eligibility_hash)) throw new ElectiveRuleRefusal("The selected Finance responsibility changed. Review the current named recipient.");
      await sql`INSERT INTO learning_elective_changes(id,school_id,person_id,source_offering_id,destination_offering_id,source_enrollment_id,selection,preview,preview_fingerprint,reason,catch_up,created_by,command_id,created_at)
        VALUES(${data.change_id}::uuid,${school.id}::uuid,${data.selection.person.id}::uuid,${data.selection.source_offering.id}::uuid,${data.selection.destination_offering.id}::uuid,
          ${data.selection.source_enrollment.id}::uuid,${JSON.stringify(data.selection)}::jsonb,${JSON.stringify(preview)}::jsonb,${preview.fingerprint},${data.reason},${JSON.stringify(data.catch_up)}::jsonb,${user.id}::uuid,${prepared.command_id}::uuid,${executionNow()})`.execute(tx);
      const route = reviewer ? await this.model.route(tx, user, school.id, data.change_id, 1, reviewer, data.command_id) : null;
      const event = await this.model.event(tx, user, school.id, data.change_id, 1, data.command_id, reviewer ? "finance_requested" : "requested", route && reviewer ? { route, reviewer } : undefined);
      const result = { id: data.change_id, command_id: data.command_id, revision: 1, action: "request" as const, state: reviewer ? "waiting_for_finance" as const : "unassigned" as const };
      await this.append(tx, user, { id: data.change_id, school_id: school.id }, "request", 1, prepared.command_id, { delivery: event.delivery, state: result.state });
      await this.model.finish(tx, school.id, prepared.command_id, 1, event.outbox_id, result);
      return { ...result, replayed: false };
      });
    }));
  }
  async detail(user: AuthUser, id: string) {
    return this.db.transaction().execute(async tx => {
      const school = await this.academic(tx, user); await this.lock(tx, school.id); const row = await this.row(tx, school.id, id), state = stateOf(await this.actions(tx, school.id, id));
      const reviewer = state.delivery ? await this.finance.reviewer(tx, school.id, state.delivery.reviewer.user_id) : null;
      const same = Boolean(reviewer && state.delivery && reviewer.person_id === state.delivery.reviewer.person_id && reviewer.eligibility_hash === state.delivery.reviewer.eligibility_hash);
      const route = state.delivery ? await this.model.deliveryState(tx, school.id, id, state.delivery) : null;
      let currentPreview: ElectiveRosterPreview | null = null; const blockers: string[] = [];
      if (!state.terminal) { try { currentPreview = await this.offerings.previewElectiveChange(tx, user, row.selection); } catch (cause) { blockers.push(cause instanceof Error ? cause.message : "The current elective impact must be reviewed."); } }
      const previewChanged = Boolean(!state.terminal && (!currentPreview || currentPreview.fingerprint !== row.preview_fingerprint));
      if (previewChanged) blockers.push("The reviewed academic or schedule basis changed. Withdraw this proposal and review the current elective change.");
      let basisChanged: boolean | null = null;
      if (state.state === "no_financial_change") { try { await this.finance.assertNoChange(tx, school.id, id, row.person_id, state.delivery?.reviewer ?? null); basisChanged = false; } catch { basisChanged = true; blockers.push("Finance must review the current named responsibility and invoice basis again."); } }
      else if (!state.terminal) blockers.push(state.state === "requires_financial_review" ? "Finance recorded that further financial review is required. No academic or financial completion is implied." : state.delivery ? "The named Finance recorder must explicitly classify this elective change." : "Assign an eligible named Finance recorder to continue this unassigned handoff.");
      // Applied is an immutable accepted no-change decision, not an open Core
      // delivery. Current route closure must not relabel that historical fact.
      const financeState = state.state === "applied" ? "no_financial_change" as const : !state.delivery ? "unassigned" as const : !same ? "reviewer_changed" as const : state.state === "no_financial_change" || state.state === "requires_financial_review" ? state.state : route?.open ? "waiting" as const : "route_unavailable" as const;
      return { id, revision: state.revision, labels: await this.labels(tx, row), selection: row.selection, reason: row.reason, catch_up: row.catch_up, preview: row.preview,
        current_preview: currentPreview, preview_changed: previewChanged, state: state.state,
        finance: { reviewer: state.delivery?.reviewer ?? null, state: financeState, decision_id: state.decisionId, ledger_basis_changed: basisChanged, href: electiveFinanceHref(id) },
        can_apply: !state.terminal && !previewChanged && state.state === "no_financial_change" && basisChanged === false,
        can_assign_finance: !state.terminal, can_withdraw: !state.terminal, blockers };
    });
  }
  async assignFinance(user: AuthUser, id: string, raw: unknown) {
    const data = electiveAssignment.parse(raw);
    return this.committed(this.db.transaction().execute(async tx => {
      const school = await this.academic(tx, user); await this.lock(tx, school.id); const row = await this.row(tx, school.id, id), state = stateOf(await this.actions(tx, school.id, id));
      const prepared = await this.model.prepare(tx, user, school.actor, school.id, id, "finance.assign", data, state.revision, data, { actor_person_id: school.actor.person_id });
      if (prepared.refusal) return { refusal: prepared.refusal }; if (prepared.replay) return prepared.replay;
      return this.effect(tx, user, school.id, id, "finance.assign", data, prepared.command_id, data, async () => {
      if (state.terminal) throw new ElectiveRuleRefusal("This elective review is already closed.");
      const reviewer = await this.finance.reviewer(tx, school.id, data.reviewer.user_id);
      if (!reviewer || reviewer.eligibility_hash !== data.reviewer.eligibility_hash) throw new ElectiveRuleRefusal("The selected Finance responsibility changed. Review the current person.");
      const revision = state.revision + 1, route = await this.model.route(tx, user, school.id, id, revision, reviewer, data.command_id);
      const event = await this.model.event(tx, user, school.id, id, revision, data.command_id, "finance_requested", { route, reviewer });
      await this.model.supersede(tx, school.id, id, state.delivery, prepared.command_id, event.model_event_id);
      const result = { id, command_id: data.command_id, revision, action: "finance.assign" as const, state: "waiting_for_finance" as const };
      await this.append(tx, user, row, result.action, revision, prepared.command_id, { delivery: event.delivery, state: result.state });
      await this.model.finish(tx, school.id, prepared.command_id, revision, event.outbox_id, result); return { ...result, replayed: false };
      });
    }));
  }
  async financeWorkspace(user: AuthUser, schoolId: string, id: string) {
    return this.db.transaction().execute(async tx => {
      await this.finance.campus(tx, user, z.uuid().parse(schoolId)); await this.lock(tx, schoolId); const row = await this.row(tx, schoolId, id), state = stateOf(await this.actions(tx, schoolId, id));
      const reviewer = await this.finance.reviewer(tx, schoolId, user.id);
      if (!reviewer || !state.delivery || reviewer.user_id !== state.delivery.reviewer.user_id || reviewer.person_id !== state.delivery.reviewer.person_id || reviewer.eligibility_hash !== state.delivery.reviewer.eligibility_hash)
        throw new ForbiddenException("Only this change's currently eligible named Finance recorder can open its financial review.");
      const basis = await this.finance.basis(tx, schoolId, row.person_id), route = await this.model.deliveryState(tx, schoolId, id, state.delivery);
      const latest = await this.finance.latest(tx, schoolId, id);
      return { id, revision: state.revision, labels: await this.labels(tx, row), selection: row.selection, reason: row.reason, preview: row.preview, state: state.state, reviewer,
        ledger_basis: basis.basis, ledger_basis_hash: basis.hash, latest_decision: latest && latest.id === state.decisionId ? latest : null,
        can_classify: !state.terminal && route.open, finance_account_href: `/areas/fees/ledger?person_id=${encodeURIComponent(row.person_id)}` };
    });
  }
  /** Link-only source resolution for an already-owned Core mailbox. Batch native
   * metadata, not ledger/People detail; opening/classifying still rechecks the
   * complete current Finance route through its ordinary owning endpoint. */
  async financeWorkSources(user: AuthUser, schoolId: string, candidates: readonly ElectiveFinanceWorkCandidate[]): Promise<ElectiveFinanceWorkSource[]> {
    const valid = candidates.flatMap(candidate => { const parsed = financeWorkCandidate.safeParse(candidate); return parsed.success ? [parsed.data] : []; });
    if (!valid.length || !user.is_active || user.active_school_id !== schoolId || !z.uuid().safeParse(schoolId).success) return [];
    return this.db.transaction().setIsolationLevel("repeatable read").execute(async tx => {
      try { await this.finance.campus(tx, user, schoolId); } catch (cause) { if (cause instanceof ForbiddenException) return []; throw cause; }
      const reviewer = await this.finance.reviewer(tx, schoolId, user.id); if (!reviewer) return [];
      const ids = [...new Set(valid.map(candidate => candidate.change_id))];
      const rows = (await sql<{ id: string; revision: number; delivery: unknown }>`SELECT change.id::text,latest.revision,routing.data->'delivery' AS delivery
        FROM learning_elective_changes change
        JOIN LATERAL(SELECT action.revision,action.kind,action.data FROM learning_elective_change_actions action
          WHERE action.school_id=change.school_id AND action.change_id=change.id ORDER BY action.revision DESC LIMIT 1) latest ON TRUE
        JOIN LATERAL(SELECT action.data FROM learning_elective_change_actions action
          WHERE action.school_id=change.school_id AND action.change_id=change.id AND action.kind IN ('request','finance.assign')
          ORDER BY action.revision DESC LIMIT 1) routing ON TRUE
        WHERE change.school_id=${schoolId}::uuid AND change.id=ANY(${sql.val(ids)}::uuid[])
          AND(latest.kind IN ('request','finance.assign') OR(latest.kind='finance.classify' AND latest.data->>'outcome'='requires_financial_review'))`.execute(tx)).rows;
      const current = new Map(rows.map(row => [row.id, row]));
      return valid.flatMap(candidate => {
        const row = current.get(candidate.change_id); if (!row) return [];
        const parsed = financeWorkDelivery.safeParse(row.delivery); if (!parsed.success) return [];
        const delivery = parsed.data;
        return delivery.message_id === candidate.message_id && delivery.source_revision === candidate.source_revision
          && delivery.reviewer.user_id === user.id && delivery.reviewer.person_id === reviewer.person_id
          && delivery.reviewer.eligibility_hash === reviewer.eligibility_hash ? [{ ...candidate, revision: row.revision }] : [];
      });
    });
  }
  async classify(user: AuthUser, schoolId: string, id: string, raw: unknown) {
    const data = electiveDecision.parse(raw);
    return this.committed(this.db.transaction().execute(async tx => {
      const campus = await this.finance.campus(tx, user, z.uuid().parse(schoolId)); await this.lock(tx, schoolId); const row = await this.row(tx, schoolId, id), state = stateOf(await this.actions(tx, schoolId, id));
      if (!state.delivery || state.delivery.reviewer.user_id !== user.id) throw new ForbiddenException("Only the explicitly named current Finance recorder can classify this elective change.");
      const delivery = state.delivery;
      const prepared = await this.model.prepare(tx, user, campus.actor, schoolId, id, "finance.classify", data, state.revision, data, { sources: campus.technical.sources, reviewer: state.delivery.reviewer });
      if (prepared.refusal) return { refusal: prepared.refusal }; if (prepared.replay) return prepared.replay;
      return this.effect(tx, user, schoolId, id, "finance.classify", data, prepared.command_id, data, async () => {
      if (state.terminal) throw new ElectiveRuleRefusal("This elective review is already closed.");
      const revision = state.revision + 1, actionId = randomUUID(), decisionId = randomUUID();
      await this.append(tx, user, row, "finance.classify", revision, prepared.command_id, { decision_id: decisionId, outcome: data.outcome }, actionId);
      await this.finance.record(tx, user, { school_id: schoolId, change_id: id, person_id: row.person_id, action_id: actionId, command_id: prepared.command_id, correlation_id: data.command_id,
        decision_id: decisionId, reviewer: delivery.reviewer, expected_ledger_basis_hash: data.expected_ledger_basis_hash, outcome: data.outcome, reason: data.reason });
      const event = await this.model.event(tx, user, schoolId, id, revision, data.command_id, "finance_classified");
      await this.model.respond(tx, user, schoolId, id, delivery, data.command_id, event.outbox_id, data.outcome === "no_financial_change");
      const result = { id, command_id: data.command_id, revision, action: "finance.classify" as const, state: data.outcome };
      await this.model.finish(tx, schoolId, prepared.command_id, revision, event.outbox_id, result); return { ...result, replayed: false };
      });
    }));
  }
  async apply(user: AuthUser, id: string, raw: unknown) {
    const data = electiveCommand.parse(raw);
    return this.committed(this.db.transaction().execute(async tx => {
      const school = await this.academic(tx, user); await this.lock(tx, school.id); const row = await this.row(tx, school.id, id), state = stateOf(await this.actions(tx, school.id, id));
      const prepared = await this.model.prepare(tx, user, school.actor, school.id, id, "apply", data, state.revision, data, { actor_person_id: school.actor.person_id },
        state.decisionId ? { finance_decision_id: state.decisionId, preview_fingerprint: row.preview_fingerprint, person_id: row.person_id,
          source_offering_id: row.source_offering_id, destination_offering_id: row.destination_offering_id, effective_on: row.selection.effective_on } : null);
      if (prepared.refusal) return { refusal: prepared.refusal }; if (prepared.replay) return prepared.replay;
      return this.effect(tx, user, school.id, id, "apply", data, prepared.command_id, data, async () => {
      if (state.terminal) throw new ElectiveRuleRefusal("This elective review is already closed.");
      if (state.state !== "no_financial_change") throw new ElectiveRuleRefusal("Finance must explicitly finish the financial impact review before this elective changes.");
      const decision = await this.finance.assertNoChange(tx, school.id, id, row.person_id, state.delivery?.reviewer ?? null);
      const current = await this.reviewedPreview(tx, user, row.selection);
      if (current.fingerprint !== row.preview_fingerprint) throw new ElectiveRuleRefusal("The academic, enrollment or dated schedule impact changed. Review a new exact proposal.");
      const applied = await this.offerings.applyElectiveChange(tx, user, current, data.command_id, { command_id: prepared.command_id, correlation_id: data.command_id, change_id: id, finance_decision_id: decision.id }), revision = state.revision + 1;
      const result = { id, command_id: data.command_id, revision, action: "apply" as const, state: "applied" as const, ...applied };
      const event = await this.model.event(tx, user, school.id, id, revision, data.command_id, "applied");
      await this.append(tx, user, row, "apply", revision, prepared.command_id, { ...applied, finance_decision_id: state.decisionId });
      await this.model.finish(tx, school.id, prepared.command_id, revision, event.outbox_id, result); return { ...result, replayed: false };
      });
    }));
  }
  async withdraw(user: AuthUser, id: string, raw: unknown) {
    const data = electiveWithdrawal.parse(raw);
    return this.committed(this.db.transaction().execute(async tx => {
      const school = await this.academic(tx, user); await this.lock(tx, school.id); const row = await this.row(tx, school.id, id), state = stateOf(await this.actions(tx, school.id, id));
      const prepared = await this.model.prepare(tx, user, school.actor, school.id, id, "withdraw", data, state.revision, data, { actor_person_id: school.actor.person_id });
      if (prepared.refusal) return { refusal: prepared.refusal }; if (prepared.replay) return prepared.replay; if (state.terminal) throw new ConflictException("This elective review is already closed.");
      const revision = state.revision + 1, event = await this.model.event(tx, user, school.id, id, revision, data.command_id, "withdrawn");
      await this.model.supersede(tx, school.id, id, state.delivery, prepared.command_id, event.model_event_id);
      await this.append(tx, user, row, "withdraw", revision, prepared.command_id, { reason: data.reason });
      const result = { id, command_id: data.command_id, revision, action: "withdraw" as const, state: "withdrawn" as const };
      await this.model.finish(tx, school.id, prepared.command_id, revision, event.outbox_id, result); return { ...result, replayed: false };
    }));
  }
}
