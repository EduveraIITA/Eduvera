import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import { executionNow } from "../campus-model-core/execution-time.runtime.js";
import type { AuthUser } from "../common/request.js";
import { DatabaseService } from "../database/database.service.js";
import type { Database } from "../database/types.js";
import type { GovernanceDecisionAuthorityReceipt } from "../governance/decision-authority.port.js";
import { FinanceArrangementsAccess } from "./finance-arrangements.access.js";
import { FinanceArrangementsBridge, financeArrangementAccountHref, financeArrangementHref } from "./finance-arrangements.bridge.js";
import { financeId, type FinanceInstalmentRequest } from "./finance-arrangements.contracts.js";
import { FinanceArrangementCommands } from "./finance-arrangements.commands.js";
import { financeDecisionRouteKey } from "./finance-arrangements.service.js";
import { agreedSchedule, arrangementBasis, arrangementHistory, arrangementInvoice, arrangementRevision, financeBasisRevision, financeHash, financeObject } from "./finance-arrangements.store.js";

const iso = (value: unknown) => typeof value === "string" && /^\d{4}-\d\d-\d\dT/u.test(value) && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
export interface FinanceArrangementWorkRecord {
  id: string; invoice_id: string; student_id: string | null; person_id?: string; revision: number; created_at: string;
  message_id: string | null; due_at: string | null; href: string; title: string;
  reviewer: { user_id: string; label: string } | null;
  state: "review_needed" | "waiting_for_review" | "needs_reassignment" | "route_unavailable" | "review_window_ended";
}
export interface FinanceDueWorkRecord { id: string; title: string; detail: string; status_label: string; due_at: string | null; created_at: string; priority: "normal" | "urgent" }

@Injectable()
export class FinanceArrangementsReadService {
  constructor(private readonly db: DatabaseService, private readonly access: FinanceArrangementsAccess, private readonly bridge: FinanceArrangementsBridge,
    private readonly commands: FinanceArrangementCommands) {}
  async discovery(user: AuthUser, schoolId: string) {
    return this.db.transaction().setIsolationLevel("repeatable read").execute(async db => {
      let campus;
      try { campus = await this.access.campus(db, user, schoolId); }
      catch (error) { if (error instanceof ForbiddenException && error.message.includes("person/account link")) return { can_record_charge: false, accounts: [] }; throw error; }
      const canRecord = Boolean(await this.access.manages(db, user, schoolId));
      const own = (await sql<{ id: string }>`SELECT invoice.id FROM fee_invoices invoice WHERE invoice.school_id=${schoolId}::uuid AND invoice.person_id=${campus.actor.person_id}::uuid
        AND EXISTS(SELECT 1 FROM fee_invoice_self_payer_entitlements e WHERE e.school_id=invoice.school_id AND e.invoice_id=invoice.id AND e.user_id=${user.id}::uuid
          AND e.person_id=invoice.person_id AND ${campus.today}::date BETWEEN e.valid_from AND e.valid_until
          AND NOT EXISTS(SELECT 1 FROM fee_invoice_self_payer_revocations r WHERE r.school_id=e.school_id AND r.entitlement_id=e.id)) LIMIT 1`.execute(db)).rows[0];
      return { can_record_charge: canRecord, accounts: own ? [{ person_id: campus.actor.person_id, label: campus.actor.label,
        href: `/areas/fees/account?scope=person&person_id=${campus.actor.person_id}` }] : [] };
    });
  }
  private async owner(db: Transaction<Database>, schoolId: string) {
    try {
      const authority = await this.access.authority.resolveDecisionOwner(db, schoolId, "fee_instalment_decision", executionNow());
      const actor = await this.access.identities.resolveAccountEndpoint(db, { school_id: schoolId, user_id: authority.user_id, at: executionNow().toISOString() });
      if (!actor.acting || actor.person_id !== authority.person.id) return null;
      const route = await this.bridge.coordination.resolveEventRoute(db, { school_id: schoolId, source_domain: "finance", event_type: "finance.instalment.requested",
        selector_key: "fee_instalment_decision_owner", occurred_at: executionNow().toISOString() });
      if (route.status !== "matched" || route.selector.required_capability !== "finance.instalments.decide") return null;
      const recipients = await this.bridge.coordination.authorizeCandidateRecipients(db, { school_id: schoolId, behaviour_version_id: route.behaviour_version_id,
        subscription_id: route.subscription_id, occurred_at: executionNow().toISOString(), recipients: [{ agent_kind: "human", user_id: authority.user_id }], scope: null });
      if (recipients.authorised.length !== 1 || recipients.authorised[0]?.agent_kind !== "human" || recipients.authorised[0].user_id !== authority.user_id) return null;
      return { authority, actor, route };
    } catch (error) {
      if (error instanceof ForbiddenException || error instanceof ConflictException || error instanceof NotFoundException) return null;
      throw error;
    }
  }
  private async routeState(db: Transaction<Database>, request: FinanceInstalmentRequest, current: { authority: GovernanceDecisionAuthorityReceipt; actor: { person_id: string };
    route: { behaviour_version_id: string; subscription_id: string } } | null) {
    const route = financeObject(request.coordination_receipt), messages = route.message_ids;
    const messageId = Array.isArray(messages) && messages.length === 1 && financeId.safeParse(messages[0]).success ? String(messages[0]) : null;
    const snapshot = financeObject(route.route_snapshot), due = iso(snapshot.response_due_at), expiry = iso(snapshot.expires_at);
    // A response target is informative, not permission expiry.
    const ended = Boolean(expiry && expiry <= executionNow().toISOString());
    const same = current && current.authority.user_id === request.reviewer_user_id && current.actor.person_id === request.reviewer_person_id
      && financeDecisionRouteKey(current.authority) === financeDecisionRouteKey(request.authority_receipt)
      && current.route.behaviour_version_id === route.behaviour_version_id && current.route.subscription_id === route.subscription_id;
    const trace = messageId ? await this.bridge.coordination.findExactTrace(db, { school_id: request.school_id, source_domain: "finance",
      source_record_id: request.id, event_type: "finance.instalment.requested", source_revision: request.stream_revision }) : null;
    const exact = trace && trace.message_id === messageId && trace.correlation_id === request.correlation_id && trace.message_open !== undefined;
    return { state: !messageId || !exact ? "route_unavailable" as const : !same ? "needs_reassignment" as const
      : ended || trace.message_state === "expired" ? "review_window_ended" as const : trace.message_open !== true ? "route_unavailable" as const : "waiting_for_review" as const,
      message_id: messageId, due_at: due };
  }

  async workspace(user: AuthUser, schoolId: string, studentId?: string, invoiceId?: string, commandId?: string, personId?: string) {
    financeId.parse(schoolId); if (studentId) financeId.parse(studentId); if (invoiceId) financeId.parse(invoiceId);
    if (personId) financeId.parse(personId);
    if (personId && studentId) throw new ConflictException("Choose one exact fee account.");
    if (commandId) { financeId.parse(commandId); if (!invoiceId) throw new ConflictException("Open the exact fee account to confirm this command."); }
    // Receipt-key waits must see a writer's commit rather than an older repeatable-read snapshot.
    return this.db.transaction().execute(async db => {
      const campus = await this.access.campus(db, user, schoolId);
      if (commandId) await sql`SELECT pg_advisory_xact_lock(hashtextextended(${schoolId},0))`.execute(db);
      const manager = await this.access.manages(db, user, schoolId), current = await this.owner(db, schoolId);
      if (!manager && !studentId && !personId) throw new ForbiddenException("Open the exact person’s fee account.");
      const ids = (await sql<{ id: string }>`SELECT id FROM fee_invoices WHERE school_id=${schoolId}::uuid
        AND (${studentId ?? null}::uuid IS NULL OR student_id=${studentId ?? null}::uuid)
        AND (${personId ?? null}::uuid IS NULL OR person_id=${personId ?? null}::uuid)
        AND (${invoiceId ?? null}::uuid IS NULL OR id=${invoiceId ?? null}::uuid) ORDER BY due_on,id`.execute(db)).rows;
      const invoices = [];
      for (const { id } of ids) {
        const invoice = await arrangementInvoice(db, schoolId, id), relation = await this.access.family(db, user, invoice, campus.actor);
        if (!await this.access.canRead(db, user, invoice, campus.actor, campus.today, Boolean(manager))) {
          if (invoiceId) throw new ForbiddenException(invoice.context_kind === "person" ? "This fee account needs current explicit access." : "This fee account is no longer in your current relationship.");
          continue;
        }
        const basis = await arrangementBasis(db, invoice), entitlement = await this.access.entitlement(db, invoice, campus.today), history = await arrangementHistory(db, schoolId, id);
        const canDecide = Boolean(manager && current?.authority.user_id === user.id && current.actor.person_id === campus.actor.person_id);
        const pending = history.find(row => row.status === "pending"), approved = history.filter(row => row.status === "approved")
          .sort((left, right) => (right.decision_revision ?? 0) - (left.decision_revision ?? 0))[0];
        const requests = [];
        for (const row of history) {
          const route = row.status === "pending" ? await this.routeState(db, row, current) : null;
          requests.push({ id: row.id, revision: row.stream_revision, status: row.status, schedule: row.schedule, note: row.note,
            submitted_at: new Date(row.created_at).toISOString(), decision_response: row.decision_response, decision_at: row.decision_at ? new Date(row.decision_at).toISOString() : null,
            reviewer: { user_id: row.reviewer_user_id, label: current?.authority.user_id === row.reviewer_user_id ? current.actor.label : "Previous reviewer" },
            ...(route ? { route_state: route.state } : {}), basis_changed: row.basis_hash !== financeHash(basis),
            can_decide: row.status === "pending" && canDecide && row.submitted_by !== user.id && route?.state === "waiting_for_review",
            can_approve: row.status === "pending" && canDecide && row.submitted_by !== user.id && route?.state === "waiting_for_review" && row.basis_hash === financeHash(basis),
            can_withdraw: row.status === "pending" && row.submitted_by === user.id && row.submitter_person_id === campus.actor.person_id && Boolean(relation.self || relation.guardian) });
        }
        const openEntitlement = entitlement.current ?? entitlement.all.find(row => !row.revoked_at && row.valid_until >= campus.today);
        const shownEntitlement = openEntitlement ?? entitlement.latest;
        invoices.push({ id: invoice.id, student_id: invoice.student_id, person_id: invoice.person_id, context_kind: invoice.context_kind,
          beneficiary: { kind: invoice.context_kind, person_id: invoice.person_id, student_id: invoice.student_id, name: invoice.student_label }, student_label: invoice.student_label, reference: invoice.reference, description: invoice.description,
          original_due_on: invoice.original_due_on ?? invoice.due_on, balance_paise: basis.balance_paise, basis_hash: financeHash(basis), basis_revision: financeBasisRevision(basis),
          stream_revision: await arrangementRevision(db, schoolId, id),
          can_request: !pending && basis.balance_paise > 0 && Boolean(relation.guardian || relation.self && entitlement.current?.user_id === user.id),
          can_enable_self_payer: canDecide && Boolean(invoice.user_id) && !openEntitlement, can_revoke_self_payer: canDecide && Boolean(openEntitlement),
          self_payer: shownEntitlement ? { ...shownEntitlement, state: shownEntitlement.revoked_at ? "revoked" : shownEntitlement.valid_until < campus.today ? "expired" : entitlement.current?.id === shownEntitlement.id ? "active" : "scheduled" } : null,
          self_payer_account_available: Boolean(invoice.user_id),
          agreement: approved ? { request_id: approved.id, approved_at: new Date(approved.decision_at!).toISOString(), ...agreedSchedule(approved, basis) } : null,
          requests });
      }
      if (invoiceId && !invoices.length) throw new NotFoundException("This fee arrangement is unavailable.");
      const confirmation = commandId && invoiceId ? await this.commands.confirmation(db, user, await arrangementInvoice(db, schoolId, invoiceId), commandId) : undefined;
      return { school_id: schoolId, today: campus.today, timezone: campus.timezone, supported_mode: "approval_required" as const, ...(confirmation ? { confirmation } : {}),
        can_manage: Boolean(manager), can_issue: Boolean(manager), can_decide_plan: Boolean(manager && current?.authority.user_id === user.id), review_route: current ? { state: "ready" as const, reviewer: { user_id: current.authority.user_id, label: current.actor.label } }
          : { state: "unavailable" as const, reviewer: null }, invoices };
    });
  }

  /** Only neutral, current source-owned work crosses into the common Work view. */
  async work(user: AuthUser, schoolId: string): Promise<{ needs_me: FinanceArrangementWorkRecord[]; waiting: FinanceArrangementWorkRecord[] }> {
    return this.db.transaction().setIsolationLevel("repeatable read").execute(async db => {
      let campus;
      try { campus = await this.access.campus(db, user, schoolId); }
      catch (error) { if (error instanceof ForbiddenException && error.message.includes("person/account link")) return { needs_me: [], waiting: [] }; throw error; }
      const current = await this.owner(db, schoolId), manager = await this.access.manages(db, user, schoolId);
      const sources = (await sql<FinanceInstalmentRequest & { reference: string }>`SELECT request.*,invoice.reference FROM fee_instalment_requests request
        JOIN fee_invoices invoice ON invoice.id=request.invoice_id AND invoice.school_id=request.school_id
        WHERE request.school_id=${schoolId}::uuid AND (request.submitted_by=${user.id}::uuid OR request.reviewer_user_id=${user.id}::uuid)
          AND NOT EXISTS(SELECT 1 FROM fee_instalment_decisions decision WHERE decision.school_id=request.school_id AND decision.request_id=request.id)
          AND NOT EXISTS(SELECT 1 FROM fee_instalment_withdrawals withdrawal WHERE withdrawal.school_id=request.school_id AND withdrawal.request_id=request.id)
        ORDER BY request.created_at,request.id`.execute(db)).rows;
      const needs_me: FinanceArrangementWorkRecord[] = [], waiting: FinanceArrangementWorkRecord[] = [];
      for (const source of sources) {
        const route = await this.routeState(db, source, current), base = { id: source.id, invoice_id: source.invoice_id, student_id: source.student_id, revision: source.stream_revision,
          created_at: new Date(source.created_at).toISOString(), message_id: route.message_id, due_at: route.due_at, title: `Instalment request · ${source.reference}`,
          reviewer: { user_id: source.reviewer_user_id, label: current?.authority.user_id === source.reviewer_user_id ? current.actor.label : "Previous reviewer" } };
        if (manager && current?.authority.user_id === user.id && route.state === "waiting_for_review" && source.submitted_by !== user.id) {
          needs_me.push({ ...base, state: "review_needed", href: financeArrangementHref(source.id, source.invoice_id) });
        }
        if (source.submitted_by === user.id && source.submitter_person_id === campus.actor.person_id) {
          const invoice = await arrangementInvoice(db, schoolId, source.invoice_id);
          if (await this.access.canRead(db, user, invoice, campus.actor, campus.today, Boolean(manager))) waiting.push({ ...base, state: route.state, href: financeArrangementAccountHref(invoice, source.submitter_relationship) });
        }
      }
      return { needs_me, waiting };
    });
  }

  /** One current due projection for both self/dependent Work. An agreement never
   * mutates the invoice and an unresolved schedule never inherits its old urgency. */
  async dueWork(user: AuthUser, schoolId: string, studentId: string, relationship: "self" | "dependent"): Promise<FinanceDueWorkRecord[]> {
    financeId.parse(schoolId); financeId.parse(studentId);
    return this.db.transaction().setIsolationLevel("repeatable read").execute(async db => {
      let campus;
      try { campus = await this.access.campus(db, user, schoolId); }
      catch (error) { if (error instanceof ForbiddenException && error.message.includes("person/account link")) return []; throw error; }
      const ids = (await sql<{ id: string }>`SELECT invoice.id FROM fee_invoices invoice
        WHERE invoice.school_id=${schoolId}::uuid AND invoice.student_id=${studentId}::uuid
          AND NOT EXISTS(SELECT 1 FROM campus_event_participants participant JOIN campus_events event ON event.id=participant.event_id AND event.school_id=participant.school_id
            LEFT JOIN campus_event_consents consent ON consent.event_id=participant.event_id AND consent.student_id=participant.student_id
            WHERE participant.school_id=invoice.school_id AND participant.student_id=invoice.student_id AND participant.fee_invoice_id=invoice.id
              AND event.status='published' AND event.ends_at>=${executionNow()} AND event.payment_required
              AND (participant.participation_requirement='mandatory' OR participant.rsvp_status='accepted') AND (NOT event.requires_guardian_consent OR consent.status='granted'))
        ORDER BY invoice.due_on,invoice.id`.execute(db)).rows;
      const result: FinanceDueWorkRecord[] = [];
      for (const { id } of ids) {
        const invoice = await arrangementInvoice(db, schoolId, id), relation = await this.access.family(db, user, invoice, campus.actor);
        if (relationship === "self" ? !relation.self : !relation.guardian) continue;
        const basis = await arrangementBasis(db, invoice);
        if (!basis.balance_paise) continue;
        const approved = (await arrangementHistory(db, schoolId, id)).filter(row => row.status === "approved")
          .sort((left, right) => (right.decision_revision ?? 0) - (left.decision_revision ?? 0))[0];
        const agreement = approved ? agreedSchedule(approved, basis) : null;
        if (agreement?.state === "satisfied") continue;
        const reviewNeeded = agreement?.state === "needs_review", due = reviewNeeded ? null : agreement?.next_due_on ?? invoice.due_on;
        const dueValue = due ? (await sql<{ value: Date | string }>`SELECT (((${due}::date+1)::timestamp AT TIME ZONE ${campus.timezone})-interval '1 millisecond') AS value`.execute(db)).rows[0]!.value : null;
        const amount = agreement && !reviewNeeded ? agreement.rows.find(row => (row.remaining_paise ?? 0) > 0)?.remaining_paise ?? basis.balance_paise : basis.balance_paise;
        result.push({ id: invoice.id, title: invoice.description,
          detail: reviewNeeded ? "The current balance is available; Finance needs to review the agreed dates." : `${new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(amount / 100)} ${agreement ? "on the agreed schedule" : "outstanding"}`,
          status_label: reviewNeeded ? "Payment plan needs review" : `${agreement ? "Agreed date" : "Due"} ${due}`,
          due_at: dueValue ? new Date(dueValue).toISOString() : null, created_at: new Date(invoice.created_at).toISOString(), priority: due && due < campus.today ? "urgent" : "normal" });
      }
      return result;
    });
  }
}
