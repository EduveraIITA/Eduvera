import { ConflictException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import { randomUUID } from "node:crypto";
import type { Database } from "../database/types.js";
import type { AuthUser } from "../common/request.js";
import type { ActingHumanAgentIdentity } from "../campus-model-core/human-agent-identity.port.js";
import { DOMAIN_COMMAND_GATEWAY_PORT, type DomainCommandGatewayPort } from "../campus-model-core/domain-command-gateway.port.js";
import { DOMAIN_COMMAND_RECEIPT_READ_PORT, type DomainCommandReceiptReadPort } from "../campus-model-core/domain-command-receipt-read.port.js";
import { COORDINATION_CONFIGURATION_PORT, coordinationConfigurationHash, type CoordinationConfigurationPort, type CoordinationRouteContent } from "../campus-model-core/coordination-configuration.port.js";
import { COORDINATION_RUNTIME_PORT, type CoordinationRuntimePort } from "../campus-model-core/coordination-runtime.port.js";
import { DOMAIN_EVENT_JOURNAL_PORT, type DomainEventJournalPort } from "../campus-model-core/domain-event-journal.port.js";
import { executionEnvironmentStorage, executionNow } from "../campus-model-core/execution-time.runtime.js";
import { financeHash } from "../operations/finance-arrangements.store.js";
import { ElectiveRuleRefusal, electiveReceipt, type ElectiveCommand, type ElectiveReceipt, type ElectiveFinanceReviewer } from "./learning-elective-change.contracts.js";

export const electiveFinanceHref = (id: string) => `/areas/fees/ledger?elective_review=${encodeURIComponent(id)}`;
export interface ElectiveRoute { behaviour_version_id: string; subscription_id: string; selector_key: string }
export interface ElectiveDelivery { route: ElectiveRoute; reviewer: ElectiveFinanceReviewer; message_id: string; model_event_id: string; source_revision: number; correlation_id: string }
interface NativeRefusal { id: string; school_id: string; source_id: string; actor_id: string; command_id: string; client_command_id: string; action: ElectiveReceipt['action'];
  expected_revision: number; payload_hash: string; reviewed_request: Record<string, unknown>; message: string }
@Injectable()
export class LearningElectiveModelService {
  constructor(@Inject(DOMAIN_COMMAND_GATEWAY_PORT) private readonly commands: DomainCommandGatewayPort,
    @Inject(DOMAIN_COMMAND_RECEIPT_READ_PORT) private readonly receipts: DomainCommandReceiptReadPort,
    @Inject(COORDINATION_CONFIGURATION_PORT) private readonly configuration: CoordinationConfigurationPort,
    @Inject(COORDINATION_RUNTIME_PORT) readonly coordination: CoordinationRuntimePort,
    @Inject(DOMAIN_EVENT_JOURNAL_PORT) private readonly journal: DomainEventJournalPort) {}
  private target(id: string, revision: number) { return { kind: "elective_change", domain: "learning_elective", domain_id: id,
    label: "Elective change", lifecycle_state: revision ? "active" as const : "planned" as const, source_revision: Math.max(1, revision), metadata: {} }; }
  private refusal(row: NativeRefusal) {
    return new ConflictException({ code: "elective_change_refused", message: row.message, fields: { elective_change_refusal: {
      confirmation: "terminal_refusal", receipt_state: "completed", terminal_state: "conflicted", handler: "learning.elective_change",
      school_id: row.school_id, actor_user_id: row.actor_id, environment_namespace_id: executionEnvironmentStorage.getStore()?.namespace_id ?? `live:${row.school_id}`,
      source_id: row.source_id, command_id: row.client_command_id, action: row.action, expected_revision: row.expected_revision,
      payload_hash: row.payload_hash, refusal_id: row.id, reason_code: "elective_review_refused", reviewed_request: row.reviewed_request,
    } } });
  }
  async refuse(tx: Transaction<Database>, user: AuthUser, schoolId: string, id: string, action: ElectiveReceipt['action'], body: ElectiveCommand,
    commandId: string, payload: Record<string, unknown>, cause: ElectiveRuleRefusal) {
    const row: NativeRefusal = { id: randomUUID(), school_id: schoolId, source_id: id, actor_id: user.id, command_id: commandId,
      client_command_id: body.command_id, action, expected_revision: body.expected_revision, payload_hash: financeHash({ id, action, payload }),
      reviewed_request: JSON.parse(JSON.stringify(payload)) as Record<string, unknown>, message: cause.message.slice(0, 500) };
    await sql`INSERT INTO learning_elective_change_refusals(id,school_id,source_id,actor_id,command_id,client_command_id,action,expected_revision,payload_hash,reviewed_request,message,created_at)
      VALUES(${row.id}::uuid,${schoolId}::uuid,${id}::uuid,${user.id}::uuid,${commandId}::uuid,${body.command_id}::uuid,${action},${body.expected_revision},${row.payload_hash},
        ${JSON.stringify(row.reviewed_request)}::jsonb,${row.message},${executionNow()})`.execute(tx);
    await this.commands.completeDomainCommand(tx, { school_id: schoolId, command_id: commandId, terminal_state: "conflicted", code: "elective_review_refused",
      explanation: "The owning elective review rules declined this exact command. No enrollment, timetable, classification, audit or update event was changed.",
      resulting_revision: body.expected_revision, domain_event_id: null,
      metadata: { refusal_id: row.id, elective_change_id: id, action, payload_hash: row.payload_hash }, completed_at: executionNow().toISOString() });
    return this.refusal(row);
  }
  async confirmation(tx: Transaction<Database>, user: AuthUser, schoolId: string, id: string, commandId: string, action: ElectiveReceipt['action']) {
    const prior = await this.receipts.readDomainCommandReceipt(tx, { school_id: schoolId, actor_user_id: user.id, source_domain: "learning_elective",
      handler_key: "learning.elective_change", handler_version: 1, idempotency_key: `elective-change:${user.id}:${commandId}` });
    const base = { handler: "learning.elective_change", source_id: id, command_id: commandId, action };
    if (!prior) return { ...base, state: "not_found" as const };
    if (prior.target.kind !== "elective_change" || prior.target.domain !== "learning_elective" || prior.target.domain_id !== id || prior.command_type !== `learning.elective_change.${action}`)
      throw new ConflictException("This receipt belongs to different elective work.");
    if (prior.state === "pending") return { ...base, state: "pending" as const };
    if (prior.receipt.terminal_state !== "accepted") return { ...base, state: "not_accepted" as const };
    const result = electiveReceipt.parse(prior.receipt.metadata); if (result.id !== id || result.action !== action) throw new ConflictException("This elective receipt could not be verified.");
    return { ...base, state: "accepted" as const, result };
  }
  async prepare(tx: Transaction<Database>, user: AuthUser, actor: ActingHumanAgentIdentity, schoolId: string, id: string,
    action: ElectiveReceipt['action'], body: ElectiveCommand, revision: number, payload: unknown, authority: unknown,
    sourceProof: { finance_decision_id: string; preview_fingerprint: string; person_id: string; source_offering_id: string; destination_offering_id: string; effective_on: string } | null = null) {
    const hash = financeHash({ id, action, payload }), key = `elective-change:${user.id}:${body.command_id}`;
    const prior = await this.receipts.readDomainCommandReceipt(tx, { school_id: schoolId, actor_user_id: user.id, source_domain: "learning_elective",
      handler_key: "learning.elective_change", handler_version: 1, idempotency_key: key });
    if (prior) {
      if (prior.actor_agent_id !== actor.agent_id || prior.command_type !== `learning.elective_change.${action}` || prior.target.domain !== "learning_elective"
        || prior.target.kind !== "elective_change" || prior.target.domain_id !== id || prior.expected_revision !== body.expected_revision || prior.safe_context.payload_hash !== hash)
        throw new ConflictException("This command belongs to different elective work. Keep the original action for recovery.");
      if (prior.state !== "completed") throw new ConflictException("The exact elective action is not confirmed. Keep its original command.");
      if (prior.receipt.terminal_state !== "accepted") {
        if (prior.receipt.terminal_state !== "conflicted" || prior.receipt.code !== "elective_review_refused") throw new ConflictException("The exact elective outcome could not be confirmed. Keep the original action.");
        const refusal = (await sql<NativeRefusal>`SELECT * FROM learning_elective_change_refusals WHERE school_id=${schoolId}::uuid AND command_id=${prior.receipt.command_id}::uuid
          AND actor_id=${user.id}::uuid AND source_id=${id}::uuid`.execute(tx)).rows[0];
        if (!refusal || refusal.id !== prior.receipt.metadata.refusal_id || refusal.action !== action || refusal.expected_revision !== body.expected_revision || refusal.client_command_id !== body.command_id
          || refusal.payload_hash !== hash || financeHash({ id, action, payload: refusal.reviewed_request }) !== hash || prior.receipt.metadata.payload_hash !== hash)
          throw new ConflictException("The retained elective refusal does not match this exact reviewed action.");
        return { refusal: this.refusal(refusal) };
      }
      const result = electiveReceipt.parse(prior.receipt.metadata); if (result.id !== id || result.action !== action) throw new ConflictException("The original elective receipt could not be verified.");
      return { replay: { ...result, replayed: true } };
    }
    if (revision !== body.expected_revision) {
      if (revision > body.expected_revision) throw new ConflictException({ code: "elective_change_obsolete", message: "This elective review advanced. Review its current state before a new action.",
        fields: { elective_change_obsolete: { handler: "learning.elective_change", source_id: id, command_id: body.command_id, action,
          expected_revision: body.expected_revision, current_revision: revision, school_id: schoolId, actor_user_id: user.id,
          environment_namespace_id: executionEnvironmentStorage.getStore()?.namespace_id ?? `live:${schoolId}`,
          confirmation: "permanently_inapplicable", receipt_state: "absent", reason: "review_advanced", reviewed_request: payload } } });
      throw new ConflictException("This elective review revision is unavailable. Keep the original action until its exact result is confirmed.");
    }
    const prepared = await this.commands.prepareDomainCommand(tx, { school_id: schoolId, actor_user_id: user.id, source_domain: "learning_elective",
      handler_key: "learning.elective_change", handler_version: 1, command_type: `learning.elective_change.${action}`, target: this.target(id, revision),
      expected_revision: body.expected_revision, current_revision: revision, capability: action === "finance.classify" ? "fees.manage" : "campus.setup",
      purpose: action === "finance.classify" ? "classify_elective_financial_impact" : "review_dated_elective_change", requested_at: executionNow().toISOString(),
      correlation_id: body.command_id, causation_id: null, idempotency_key: key, operating_rule_version_ref: null, configuration_refs: [],
      authority_attestation: { evaluator_domain: "learning_elective", decision: "allowed",
        reason_codes: [action === "finance.classify" ? "current_named_finance_impact_recorder" : "current_academic_setup_responsibility"],
        authority_source_refs: [{ evaluator_domain: action === "finance.classify" ? "finance" : "learning_elective", current_owner_evidence: authority }], operating_rule_refs: [], valid_until: null }, safe_context: { elective_change_id: id, payload_hash: hash, ...(sourceProof ?? {}) } });
    if (prepared.status !== "ready" || prepared.actor_agent_id !== actor.agent_id) throw new ForbiddenException("Your current account endpoint changed. Refresh before continuing.");
    return { command_id: prepared.command_id };
  }
  finish(tx: Transaction<Database>, schoolId: string, commandId: string, revision: number, eventId: string | null, result: Record<string, unknown>) {
    return this.commands.completeDomainCommand(tx, { school_id: schoolId, command_id: commandId, terminal_state: "accepted", code: "elective_change_recorded",
      explanation: "The owning service recorded this exact elective review action. No charge, refund, waiver or payment was created.", resulting_revision: revision,
      domain_event_id: eventId, metadata: result, completed_at: executionNow().toISOString() });
  }
  async route(tx: Transaction<Database>, user: AuthUser, schoolId: string, id: string, revision: number, reviewer: ElectiveFinanceReviewer, commandId: string) {
    const now = executionNow().toISOString(), key = `elective_finance_${id.replaceAll("-", "")}_${revision}`;
    const content: CoordinationRouteContent = { school_id: schoolId, actor_user_id: user.id, source_domain: "learning_elective", source_record_id: id,
      source_revision: revision, configuration_key: key, operating_rule_ref: `elective-finance:${id}:${revision}`, effective_from: now, enabled: true,
      behaviour_key: key, behaviour_schema_version: 1, behaviour_configuration: { workflow: "elective_finance_review", elective_change_id: id,
        recipient_user_id: reviewer.user_id, recipient_person_id: reviewer.person_id, eligibility_hash: reviewer.eligibility_hash,
        approved_in: "explicit_elective_change_review", timing: "no_deadline_or_automatic_decision" },
      subscription: { source_domain: "learning_elective", event_type: "learning.elective_change.finance_requested", reaction_kind: "elective_finance_review", message_kind: "task",
        selector_key: key, required_capability: "fees.manage", scope_mode: "event_scope", min_recipients: 1, max_recipients: 1, message_schema_version: 1,
        response_due_after_seconds: null, expires_after_seconds: null, max_attempts: 1, retry_after_seconds: null, priority: 3 },
      recipients: [{ person_id: reviewer.person_id, user_id: reviewer.user_id }],
      approval_note: "The academic reviewer explicitly selected this currently eligible Finance recorder for one elective change. No money, fee authority, deadline or automatic decision is granted." };
    const hash = coordinationConfigurationHash(content);
    const prepare = (phase: "approve" | "activate", causation: string | null) => this.commands.prepareDomainCommand(tx, { school_id: schoolId, actor_user_id: user.id,
      source_domain: "learning_elective", handler_key: "learning_elective.coordination.configure", handler_version: 1, command_type: `learning_elective.coordination.configure.${phase}`,
      target: this.target(id, revision), current_revision: revision, expected_revision: revision, capability: "campus.setup", purpose: "explicit_elective_finance_delivery",
      requested_at: now, correlation_id: commandId, causation_id: causation, idempotency_key: `${key}:${commandId}:${phase}`,
      operating_rule_version_ref: content.operating_rule_ref, configuration_refs: [],
      authority_attestation: { evaluator_domain: "learning_elective", decision: "allowed", reason_codes: ["current_academic_setup_responsibility", "explicit_current_finance_recipient"],
        authority_source_refs: [{ elective_change_id: id, reviewer_user_id: reviewer.user_id, reviewer_person_id: reviewer.person_id, eligibility_hash: reviewer.eligibility_hash }], operating_rule_refs: [], valid_until: null },
      safe_context: { configuration_hash: hash, source_record_id: id, source_revision: revision, configuration_key: key } });
    const approval = await prepare("approve", null); if (approval.status !== "ready") throw new ConflictException("Review Finance delivery again.");
    await this.finish(tx, schoolId, approval.command_id, revision, null, { configuration_hash: hash });
    const activation = await prepare("activate", approval.command_id); if (activation.status !== "ready") throw new ConflictException("Review Finance delivery again.");
    const configured = await this.configuration.configureRoute(tx, { ...content, configuration_hash: hash, approval_command_id: approval.command_id, activation_command_id: activation.command_id });
    await this.finish(tx, schoolId, activation.command_id, revision, null, { configuration_hash: hash });
    if (!configured.behaviour_version_id || !configured.subscription_id) throw new ConflictException("This exact Finance handoff is unavailable. Keep the change unassigned until it can be reviewed.");
    return { behaviour_version_id: configured.behaviour_version_id, subscription_id: configured.subscription_id, selector_key: key };
  }
  async event(tx: Transaction<Database>, user: AuthUser, schoolId: string, id: string, revision: number, commandId: string, action: string,
    delivery?: { route: ElectiveRoute; reviewer: ElectiveFinanceReviewer }) {
    const now = executionNow().toISOString(), payload = { elective_change_id: id, revision };
    const outbox = await tx.insertInto("event_outbox").values({ school_id: schoolId, event_type: `learning.elective_change.${action}`, aggregate_type: "elective_change", aggregate_id: id,
      audience_user_ids: [], payload, idempotency_key: `elective:${commandId}:${action}`, notification_user_ids: [], notification_payload: null, created_at: executionNow() }).returning("id").executeTakeFirstOrThrow();
    await tx.insertInto("event_outbox").values({ school_id: schoolId, event_type: "diary.updated", aggregate_type: "elective_change", aggregate_id: id,
      audience_user_ids: [user.id], payload: { ...payload, refresh: ["learning-assignments", "fees", "workspace"] }, idempotency_key: `elective-refresh:${commandId}:${action}`, notification_user_ids: [], notification_payload: null, created_at: executionNow() }).execute();
    const base = { school_id: schoolId, source_outbox_event_id: outbox.id, event_type: `learning.elective_change.${action}`, subject: this.target(id, revision),
      context: null, actor_user_id: user.id, occurred_at: now, effective_from: now, effective_until: null, source_domain: "learning_elective", source_record_id: id,
      source_revision: revision, correlation_id: commandId, causation_event_id: null, idempotency_key: `elective-event:${commandId}:${action}`, payload };
    if (!delivery) { const recorded = await this.journal.recordAcceptedEvent(tx, { ...base, audience_user_ids: [user.id] }); return { outbox_id: outbox.id, model_event_id: recorded.event_id, delivery: null }; }
    const routed = await this.coordination.publishAcceptedEvent(tx, { ...base, event_kind: "domain_event", expected_route: {
      behaviour_version_id: delivery.route.behaviour_version_id, subscription_id: delivery.route.subscription_id },
      message: { subject: "Review elective financial impact", summary: "Record the financial impact of this exact proposed course change. No charge or refund is automatic.",
        payload: { workflow: "elective_finance_review", ...payload, action_path: electiveFinanceHref(id) } },
      selector_input: { selector_key: delivery.route.selector_key, recipient_agents: [{ agent_kind: "human", user_id: delivery.reviewer.user_id }], scope: base.subject } });
    if (routed.status !== "matched" || routed.message_ids.length !== 1 || routed.deliveries[0]?.recipient.agent_kind !== "human" || routed.deliveries[0].recipient.user_id !== delivery.reviewer.user_id)
      throw new ConflictException("This exact Finance handoff could not be confirmed. Nothing was sent.");
    return { outbox_id: outbox.id, model_event_id: routed.event_id, delivery: { ...delivery, message_id: routed.message_ids[0]!, model_event_id: routed.event_id, source_revision: revision, correlation_id: commandId } };
  }
  async deliveryState(tx: Transaction<Database>, schoolId: string, id: string, delivery: ElectiveDelivery) {
    const current = await this.coordination.resolveEventRoute(tx, { school_id: schoolId, source_domain: "learning_elective", event_type: "learning.elective_change.finance_requested",
      selector_key: delivery.route.selector_key, occurred_at: executionNow().toISOString() });
    const trace = await this.coordination.findExactTrace(tx, { school_id: schoolId, source_domain: "learning_elective", source_record_id: id,
      event_type: "learning.elective_change.finance_requested", source_revision: delivery.source_revision, message_id: delivery.message_id });
    return { trace, open: current.status === "matched" && current.behaviour_version_id === delivery.route.behaviour_version_id && current.subscription_id === delivery.route.subscription_id
      && trace?.event_id === delivery.model_event_id && trace.message_id === delivery.message_id && trace.correlation_id === delivery.correlation_id && trace.message_open === true };
  }
  async respond(tx: Transaction<Database>, user: AuthUser, schoolId: string, id: string, delivery: ElectiveDelivery, commandId: string, outboxId: string, final: boolean) {
    const state = await this.deliveryState(tx, schoolId, id, delivery); if (!state.open) throw new ConflictException("This Finance handoff is no longer open. Ask the academic reviewer to assign the current Finance responsibility explicitly.");
    // Submitting an authorized native classification is actual recipient
    // interaction. Record delivery before its nonterminal acknowledgement;
    // never claim that an untouched queued notification was read or accepted.
    if (!final && state.trace?.message_state === "queued") await this.coordination.recordMessageOutcome(tx, { school_id: schoolId, message_id: delivery.message_id, state: "delivered",
      actor: { agent_kind: "human", user_id: user.id }, source_outbox_event_id: outboxId, code: "elective_finance_progress_delivered", explanation: "The assigned Finance recorder submitted a classification through its authorized native review.",
      response: null, occurred_at: executionNow().toISOString(), idempotency_key: `elective-finance-progress-delivery:${commandId}` });
    if (!final && state.trace?.message_state === "acknowledged") return { retained_message_state: "acknowledged" };
    if (!final) return this.coordination.recordMessageOutcome(tx, { school_id: schoolId, message_id: delivery.message_id, state: "acknowledged",
      actor: { agent_kind: "human", user_id: user.id }, source_outbox_event_id: outboxId, code: "elective_financial_work_required", explanation: "Finance recorded that further financial review is required. This task remains open; no financial adjustment is implied.",
      response: null, occurred_at: executionNow().toISOString(), idempotency_key: `elective-finance-progress:${commandId}` });
    return this.coordination.recordRecipientResponse(tx, { school_id: schoolId, message_id: delivery.message_id, correlation_id: delivery.correlation_id,
      recipient: { agent_kind: "human", user_id: user.id }, actor: { agent_kind: "human", user_id: user.id }, expected_source_record_id: id,
      expected_source_revision: delivery.source_revision, source_outbox_event_id: outboxId, code: "elective_no_financial_change", explanation: "The current named Finance recorder confirmed the exact financial classification. No money was posted.",
      response: { elective_change_id: id, outcome: "no_financial_change" }, occurred_at: executionNow().toISOString(), idempotency_key: `elective-finance-response:${commandId}` });
  }
  async supersede(tx: Transaction<Database>, schoolId: string, id: string, delivery: ElectiveDelivery | null, commandId: string, resultingEventId: string) {
    if (!delivery) return;
    const state = await this.deliveryState(tx, schoolId, id, delivery);
    if (!state.trace || state.trace.message_id !== delivery.message_id || state.trace.event_id !== delivery.model_event_id) throw new ConflictException("The exact prior Finance delivery could not be verified.");
    if (["responded", "cancelled", "expired", "dead_letter"].includes(state.trace.message_state ?? "")) return;
    await this.coordination.supersedeDomainMessage(tx, { school_id: schoolId, command_id: commandId, message_id: delivery.message_id,
      previous_event_id: delivery.model_event_id, previous_source_revision: delivery.source_revision, resulting_event_id: resultingEventId,
      required_capability: "campus.setup", occurred_at: executionNow().toISOString(), idempotency_key: `elective-delivery-supersede:${commandId}:${delivery.message_id}` });
  }
}
