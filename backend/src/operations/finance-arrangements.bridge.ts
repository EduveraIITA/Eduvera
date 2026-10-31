import { ConflictException, Inject, Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";
import { COORDINATION_RUNTIME_PORT, type CoordinationRuntimePort } from "../campus-model-core/coordination-runtime.port.js";
import { DOMAIN_EVENT_JOURNAL_PORT, type DomainEventJournalPort } from "../campus-model-core/domain-event-journal.port.js";
import { executionNow } from "../campus-model-core/execution-time.runtime.js";
import type { Database } from "../database/types.js";
import type { GovernanceDecisionAuthorityReceipt } from "../governance/decision-authority.port.js";
import type { FinanceInvoice, FinanceInstalmentRequest } from "./finance-arrangements.contracts.js";
import { financeObject } from "./finance-arrangements.store.js";

export const financeArrangementHref = (requestId: string, invoiceId: string) => `/areas/fees/ledger?view=arrangements&arrangement=${encodeURIComponent(requestId)}&invoice=${encodeURIComponent(invoiceId)}`;
export const financeArrangementAccountHref = (invoice: { student_id: string | null; person_id?: string; id: string }, relationship: "self" | "guardian") =>
  invoice.student_id ? `/areas/fees/account?scope=${relationship === "self" ? "self" : "dependent"}&student_id=${encodeURIComponent(invoice.student_id)}&invoice=${encodeURIComponent(invoice.id)}&view=arrangements`
    : `/areas/fees/account?scope=person&person_id=${encodeURIComponent(invoice.person_id!)}&invoice_id=${encodeURIComponent(invoice.id)}&view=arrangements`;

@Injectable()
export class FinanceArrangementsBridge {
  constructor(@Inject(COORDINATION_RUNTIME_PORT) readonly coordination: CoordinationRuntimePort,
    @Inject(DOMAIN_EVENT_JOURNAL_PORT) private readonly journal: DomainEventJournalPort) {}
  async outbox(db: Transaction<Database>, invoice: FinanceInvoice, sourceId: string, actorId: string, eventType: string, commandId: string, revision: number, audience: string[]) {
    const outbox = await db.insertInto("event_outbox").values({ school_id: invoice.school_id, event_type: eventType, aggregate_type: "fee_arrangement", aggregate_id: sourceId,
      audience_user_ids: [...new Set([actorId, ...audience])], payload: { invoice_id: invoice.id, ...(invoice.student_id ? { student_id: invoice.student_id } : { person_id: invoice.person_id }), arrangement_id: sourceId, revision,
        refresh: ["fees", "attention", "workspace"] }, idempotency_key: `fee-arrangement:${commandId}:${eventType}`,
      notification_user_ids: [], notification_payload: null, created_at: executionNow() }).returning("id").executeTakeFirstOrThrow();
    // Existing application realtime has one registered fee-refresh event. Its
    // separate neutral envelope is not a substitute for the typed Core event.
    await db.insertInto("event_outbox").values({ school_id: invoice.school_id, event_type: "fees.updated", aggregate_type: "fee_arrangement", aggregate_id: sourceId,
      audience_user_ids: [...new Set([actorId, ...audience])], payload: { invoice_id: invoice.id, ...(invoice.student_id ? { student_id: invoice.student_id } : { person_id: invoice.person_id }), arrangement_id: sourceId, revision,
        refresh: ["fees", "attention", "workspace"] }, idempotency_key: `fee-arrangement-refresh:${commandId}`,
      notification_user_ids: [], notification_payload: null, created_at: executionNow() }).execute();
    return outbox;
  }
  async requested(db: Transaction<Database>, input: { invoice: FinanceInvoice; request_id: string; actor_id: string; command_id: string; outbox_id: string;
    revision: number; owner: GovernanceDecisionAuthorityReceipt }) {
    const { invoice } = input, at = executionNow().toISOString();
    const route = await this.coordination.publishAcceptedEvent(db, { school_id: invoice.school_id, source_outbox_event_id: input.outbox_id,
      event_kind: "domain_event", event_type: "finance.instalment.requested", subject: { kind: "fee_instalment_request", domain: "finance", domain_id: input.request_id,
        label: "Instalment request", lifecycle_state: "active", source_revision: input.revision, metadata: {} },
      context: { kind: "fee_invoice", domain: "finance", domain_id: invoice.id, label: "Fee account", lifecycle_state: "active", source_revision: 1, metadata: {} },
      actor_user_id: input.actor_id, occurred_at: at, effective_from: at, effective_until: null, source_domain: "finance", source_record_id: input.request_id,
      source_revision: input.revision, correlation_id: input.command_id, causation_event_id: null, idempotency_key: `fee-instalment-requested:${input.request_id}:${input.revision}`,
      payload: { request_id: input.request_id, invoice_id: invoice.id, revision: input.revision },
      message: { subject: "Review instalment request", summary: "A fee account has a proposed payment schedule for your authorized decision.",
        payload: { request_id: input.request_id, invoice_id: invoice.id, source_revision: input.revision, action_path: financeArrangementHref(input.request_id, invoice.id) } },
      selector_input: { selector_key: "fee_instalment_decision_owner", recipient_agents: [{ agent_kind: "human", user_id: input.owner.user_id }], scope: null } });
    if (route.status !== "matched" || route.deliveries.length !== 1 || route.deliveries[0]?.recipient.agent_kind !== "human"
      || route.deliveries[0].recipient.user_id !== input.owner.user_id) throw new ConflictException("Finance’s review route is not ready. Your proposal has not been sent. Ask Finance to confirm the reviewer.");
    return route;
  }
  async accepted(db: Transaction<Database>, invoice: FinanceInvoice, sourceId: string, actorId: string, eventType: string, commandId: string, revision: number, outboxId: string) {
    const at = executionNow().toISOString();
    return this.journal.recordAcceptedEvent(db, { school_id: invoice.school_id, source_outbox_event_id: outboxId, event_type: eventType,
      subject: { kind: "fee_arrangement", domain: "finance", domain_id: sourceId, label: "Fee arrangement", lifecycle_state: "active", source_revision: revision, metadata: {} },
      context: { kind: "fee_invoice", domain: "finance", domain_id: invoice.id, label: "Fee account", lifecycle_state: "active", source_revision: 1, metadata: {} },
      actor_user_id: actorId, audience_user_ids: [actorId], occurred_at: at, effective_from: at, effective_until: null,
      source_domain: "finance", source_record_id: sourceId, source_revision: revision, correlation_id: commandId, causation_event_id: null,
      idempotency_key: `fee-arrangement-event:${commandId}`, payload: { invoice_id: invoice.id, revision } });
  }
  messageId(request: FinanceInstalmentRequest) {
    const ids = financeObject(request.coordination_receipt).message_ids;
    if (!Array.isArray(ids) || ids.length !== 1 || typeof ids[0] !== "string") throw new ConflictException("This request’s retained review route is unavailable. Withdraw it and send a new proposal.");
    return ids[0];
  }
  async assertCurrentRoute(db: Transaction<Database>, request: FinanceInstalmentRequest, requireOpen = true) {
    const retained = financeObject(request.coordination_receipt), current = await this.coordination.resolveEventRoute(db, { school_id: request.school_id,
      source_domain: "finance", event_type: "finance.instalment.requested", selector_key: "fee_instalment_decision_owner", occurred_at: executionNow().toISOString() });
    if (current.status !== "matched" || current.behaviour_version_id !== retained.behaviour_version_id || current.subscription_id !== retained.subscription_id)
      throw new ConflictException("The payment-plan review route changed. The requester can withdraw and send a new proposal.");
    const trace = await this.coordination.findExactTrace(db, { school_id: request.school_id, source_domain: "finance", source_record_id: request.id,
      event_type: "finance.instalment.requested", source_revision: request.stream_revision });
    if (!trace || trace.message_id !== this.messageId(request) || trace.correlation_id !== request.correlation_id || trace.message_open === undefined || requireOpen && trace.message_open !== true)
      throw new ConflictException("This review is no longer open. The requester can withdraw the proposal and send it again.");
  }
  decide(db: Transaction<Database>, request: FinanceInstalmentRequest, actorId: string, commandId: string, outboxId: string, revision: number, decision: "approved" | "rejected") {
    return this.coordination.recordRecipientResponse(db, { school_id: request.school_id, message_id: this.messageId(request), correlation_id: request.correlation_id,
      recipient: { agent_kind: "human", user_id: actorId }, actor: { agent_kind: "human", user_id: actorId }, expected_source_record_id: request.id,
      expected_source_revision: request.stream_revision, source_outbox_event_id: outboxId, code: `fee_instalment_${decision}`,
      explanation: "The current configured Finance decision owner recorded a decision on the proposed schedule.", response: { request_id: request.id, decision, resulting_revision: revision },
      occurred_at: executionNow().toISOString(), idempotency_key: `fee-instalment-response:${commandId}` });
  }
  async withdraw(db: Transaction<Database>, request: FinanceInstalmentRequest, actorId: string, commandId: string, outboxId: string) {
    const retained = this.messageId(request), trace = await this.coordination.findExactTrace(db, { school_id: request.school_id, source_domain: "finance",
      source_record_id: request.id, event_type: "finance.instalment.requested", source_revision: request.stream_revision });
    if (!trace || trace.message_id !== retained || trace.correlation_id !== request.correlation_id || !trace.message_state) throw new ConflictException("This request’s exact review evidence is unavailable. No withdrawal was recorded.");
    if (["expired", "cancelled", "responded", "dead_letter"].includes(trace.message_state)) return { retained_message_state: trace.message_state, already_terminal: true };
    const result = await this.coordination.recordMessageOutcome(db, { school_id: request.school_id, message_id: retained, state: "cancelled",
      actor: { agent_kind: "human", user_id: actorId }, source_outbox_event_id: outboxId, code: "fee_instalment_withdrawn",
      explanation: "The requester withdrew the pending instalment proposal.", response: null, occurred_at: executionNow().toISOString(), idempotency_key: `fee-instalment-withdrawal:${commandId}` });
    return { retained_message_state: result.state, already_terminal: false };
  }
}
