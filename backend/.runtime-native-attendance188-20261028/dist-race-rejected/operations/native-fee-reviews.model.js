var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { ConflictException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { DOMAIN_COMMAND_GATEWAY_PORT } from "../campus-model-core/domain-command-gateway.port.js";
import { DOMAIN_COMMAND_RECEIPT_READ_PORT } from "../campus-model-core/domain-command-receipt-read.port.js";
import { COORDINATION_CONFIGURATION_PORT, coordinationConfigurationHash } from "../campus-model-core/coordination-configuration.port.js";
import { COORDINATION_RUNTIME_PORT } from "../campus-model-core/coordination-runtime.port.js";
import { DOMAIN_EVENT_JOURNAL_PORT } from "../campus-model-core/domain-event-journal.port.js";
import { executionNow } from "../campus-model-core/execution-time.runtime.js";
import { financeHash } from "./finance-arrangements.store.js";
import { nativeFeeResult } from "./native-fee-reviews.contracts.js";
export const nativeFeeReviewHref = (invoice, reviewId, manager, relationship = "self") => manager ? `/areas/fees/ledger?view=review&${invoice.student_id ? `invoice=${encodeURIComponent(invoice.id)}` : `person_id=${encodeURIComponent(invoice.person_id)}&invoice_id=${encodeURIComponent(invoice.id)}`}&native_review=${encodeURIComponent(reviewId)}`
    : `/areas/fees/account?scope=${invoice.student_id ? relationship === "guardian" ? "dependent" : "self" : "person"}&${invoice.student_id ? `student_id=${encodeURIComponent(invoice.student_id)}&invoice` : `person_id=${encodeURIComponent(invoice.person_id)}&invoice_id`}=${encodeURIComponent(invoice.id)}&view=reviews&native_review=${encodeURIComponent(reviewId)}`;
export function obsoleteNativeFeeReview(invoiceId, reviewId, body, revision, reason) {
    return new ConflictException({ code: "native_fee_review_obsolete", message: "This fee work changed. Your details are kept; review the current account before sending again.",
        fields: { native_fee_review_obsolete: { handler: "finance.payment_review", invoice_id: invoiceId, review_id: reviewId,
                command_id: body.command_id, expected_revision: body.expected_revision, current_revision: revision, reason,
                confirmation: "permanently_inapplicable", receipt_state: "absent" } } });
}
let NativeFeeReviewsModel = class NativeFeeReviewsModel {
    commands;
    receipts;
    configuration;
    coordination;
    journal;
    constructor(commands, receipts, configuration, coordination, journal) {
        this.commands = commands;
        this.receipts = receipts;
        this.configuration = configuration;
        this.coordination = coordination;
        this.journal = journal;
    }
    async confirmation(tx, user, invoice, commandId) {
        const retained = await this.receipts.readDomainCommandReceipt(tx, { school_id: invoice.school_id, actor_user_id: user.id,
            source_domain: "finance", handler_key: "finance.payment_review", handler_version: 1, idempotency_key: `native-fee-review:${user.id}:${commandId}` });
        const base = { handler: "finance.payment_review", invoice_id: invoice.id, command_id: commandId };
        if (!retained)
            return { ...base, source_id: null, action: null, state: "not_found" };
        if (retained.target.domain !== "finance" || retained.target.kind !== "fee_invoice" || retained.target.domain_id !== invoice.id
            || !["report", "decide", "withdraw"].some(action => retained.command_type === `finance.payment_review.${action}`))
            throw new ConflictException("This confirmation belongs to different fee work.");
        const sourceId = retained.safe_context.review_id, action = retained.command_type.slice("finance.payment_review.".length);
        if (typeof sourceId !== "string")
            throw new ConflictException("This exact fee review identity is unavailable.");
        const qualified = { ...base, source_id: sourceId, action };
        if (retained.state === "pending")
            return { ...qualified, state: "pending" };
        if (retained.receipt.terminal_state !== "accepted")
            return { ...qualified, state: "not_accepted" };
        const result = nativeFeeResult.safeParse(retained.receipt.metadata);
        if (!result.success || result.data.invoice_id !== invoice.id || result.data.id !== sourceId)
            throw new ConflictException("The exact fee result is unavailable. No new action was sent.");
        return { ...qualified, state: "accepted", result: result.data };
    }
    async prepare(tx, user, actor, invoice, reviewId, action, body, revision, authority) {
        const hash = financeHash({ invoice_id: invoice.id, review_id: reviewId, action, ...body });
        const key = `native-fee-review:${user.id}:${body.command_id}`;
        const retained = await this.receipts.readDomainCommandReceipt(tx, { school_id: invoice.school_id, actor_user_id: user.id,
            source_domain: "finance", handler_key: "finance.payment_review", handler_version: 1, idempotency_key: key });
        if (retained) {
            if (retained.actor_agent_id !== actor.agent_id || retained.command_type !== `finance.payment_review.${action}` || retained.target.domain !== "finance"
                || retained.target.kind !== "fee_invoice" || retained.target.domain_id !== invoice.id || retained.expected_revision !== body.expected_revision
                || retained.safe_context.payload_hash !== hash)
                throw new ConflictException("This command was already used for different fee work.");
            if (retained.state === "pending")
                throw new ConflictException("This fee action is awaiting confirmation. Keep the same action and refresh.");
            if (retained.receipt.terminal_state !== "accepted")
                throw new ConflictException("This fee action was not accepted. Review the current account.");
            const result = nativeFeeResult.parse(retained.receipt.metadata);
            if (result.invoice_id !== invoice.id || result.id !== reviewId || retained.safe_context.review_id !== reviewId)
                throw new ConflictException("The exact fee review result is unavailable.");
            return { replay: { ...result, replayed: true } };
        }
        if (revision !== body.expected_revision) {
            if (revision > body.expected_revision)
                throw obsoleteNativeFeeReview(invoice.id, reviewId, body, revision, "stream_advanced");
            throw new ConflictException("This fee revision is unavailable. Refresh the account.");
        }
        const prepared = await this.commands.prepareDomainCommand(tx, { school_id: invoice.school_id, actor_user_id: user.id,
            command_type: `finance.payment_review.${action}`, source_domain: "finance", handler_key: "finance.payment_review", handler_version: 1,
            target: { kind: "fee_invoice", domain: "finance", domain_id: invoice.id, label: "Fee account", lifecycle_state: "active", source_revision: Math.max(1, revision), metadata: {} },
            expected_revision: body.expected_revision, current_revision: revision, capability: action === "decide" ? "fees.manage" : "finance.payment_review.request",
            purpose: `fee_payment_review_${action}`, requested_at: executionNow().toISOString(), correlation_id: body.command_id, causation_id: null,
            idempotency_key: key, operating_rule_version_ref: null, configuration_refs: [],
            authority_attestation: { evaluator_domain: "finance", decision: "allowed", reason_codes: [action === "decide"
                        ? typeof authority === "object" && authority !== null && "route_kind" in authority && authority.route_kind === "guardian_queue"
                            ? "current_independent_guardian_queue_fee_operator" : "current_named_independent_fee_operator" : "current_invoice_relationship"],
                authority_source_refs: [authority], operating_rule_refs: [], valid_until: null }, safe_context: { invoice_id: invoice.id, review_id: reviewId, payload_hash: hash } });
        if (prepared.status !== "ready" || prepared.actor_agent_id !== actor.agent_id)
            throw new ForbiddenException("Your current fee identity changed. Refresh before continuing.");
        return { command_id: prepared.command_id };
    }
    finish(tx, invoice, commandId, revision, eventId, result) {
        return this.commands.completeDomainCommand(tx, { school_id: invoice.school_id, command_id: commandId, terminal_state: "accepted", code: "native_fee_review_accepted",
            explanation: "The owning Finance service accepted this fee action. Only an independently verified payment creates a receipt.", resulting_revision: revision,
            domain_event_id: eventId, metadata: result, completed_at: executionNow().toISOString() });
    }
    async route(tx, user, invoice, reviewId, revision, reviewer, commandId, authority) {
        const at = executionNow().toISOString(), key = `fee_review_${reviewId.replaceAll("-", "")}`;
        const content = { school_id: invoice.school_id, actor_user_id: user.id, source_domain: "finance", source_record_id: reviewId,
            source_revision: revision, configuration_key: key, operating_rule_ref: `fee-payment-review:${reviewId}`, effective_from: at, enabled: true,
            behaviour_key: key, behaviour_schema_version: 1,
            behaviour_configuration: { workflow: "finance_payment_review", review_id: reviewId, invoice_id: invoice.id, recipient_user_id: reviewer.user_id,
                recipient_person_id: reviewer.person_id, reviewer_eligibility_hash: reviewer.eligibility_hash, approved_in: "explicit_fee_review_submission", timing: "no_response_deadline" },
            subscription: { source_domain: "finance", event_type: "finance.payment_review.reported", reaction_kind: "finance_payment_review", message_kind: "request",
                selector_key: key, required_capability: "finance.payment_review.respond", scope_mode: "event_scope", min_recipients: 1, max_recipients: 1,
                message_schema_version: 1, response_due_after_seconds: null, expires_after_seconds: null, retry_after_seconds: null, max_attempts: 1, priority: 3 },
            recipients: [{ person_id: reviewer.person_id, user_id: reviewer.user_id }],
            approval_note: "The sender explicitly selected this currently eligible independent fee reviewer for this one report or question. No financial power, deadline, reminder or automatic decision is granted." };
        const hash = coordinationConfigurationHash(content);
        const prepare = (phase, causation) => this.commands.prepareDomainCommand(tx, { school_id: invoice.school_id, actor_user_id: user.id,
            command_type: `finance.coordination.configure.${phase}`, source_domain: "finance", handler_key: "finance.coordination.configure", handler_version: 1,
            target: { kind: "fee_payment_review", domain: "finance", domain_id: reviewId, label: "Fee review delivery", lifecycle_state: "active", source_revision: revision, metadata: {} },
            expected_revision: revision, current_revision: revision, capability: "finance.payment_review.request", purpose: "explicit_fee_review_delivery", requested_at: at,
            correlation_id: commandId, causation_id: causation, idempotency_key: `${key}:${commandId}:${phase}`, operating_rule_version_ref: content.operating_rule_ref,
            configuration_refs: [], authority_attestation: { evaluator_domain: "finance", decision: "allowed", reason_codes: ["exact_current_invoice_requester", "explicit_eligible_review_recipient"],
                authority_source_refs: [authority, { reviewer_user_id: reviewer.user_id, reviewer_person_id: reviewer.person_id, eligibility_hash: reviewer.eligibility_hash }], operating_rule_refs: [], valid_until: null },
            safe_context: { configuration_hash: hash, source_record_id: reviewId, source_revision: revision, configuration_key: key } });
        const approval = await prepare("approve", null);
        if (approval.status !== "ready")
            throw new ConflictException("Fee review delivery needs a refresh.");
        await this.finish(tx, invoice, approval.command_id, revision, null, { configuration_hash: hash });
        const activation = await prepare("activate", approval.command_id);
        if (activation.status !== "ready")
            throw new ConflictException("Fee review delivery needs a refresh.");
        const route = await this.configuration.configureRoute(tx, { ...content, configuration_hash: hash, approval_command_id: approval.command_id, activation_command_id: activation.command_id });
        await this.finish(tx, invoice, activation.command_id, revision, null, { configuration_hash: hash });
        if (!route.behaviour_version_id || !route.subscription_id)
            throw new ConflictException("Fee review delivery is unavailable.");
        return { behaviour_version_id: route.behaviour_version_id, subscription_id: route.subscription_id, selector_key: key };
    }
    async event(tx, user, invoice, reviewId, revision, commandId, action, audience, route) {
        const at = executionNow().toISOString(), payload = { invoice_id: invoice.id, native_review_id: reviewId, revision,
            ...(invoice.student_id ? { student_id: invoice.student_id } : { person_id: invoice.person_id }) };
        await tx.insertInto("event_outbox").values({ school_id: invoice.school_id, event_type: "fees.updated", aggregate_type: "fee_native_review", aggregate_id: reviewId,
            audience_user_ids: [...new Set(audience)], payload: { ...payload, refresh: ["fees", "workspace", "attention"] },
            idempotency_key: `native-fee-review-refresh:${commandId}`, notification_user_ids: [], notification_payload: null, created_at: executionNow() }).execute();
        const outbox = await tx.insertInto("event_outbox").values({ school_id: invoice.school_id, event_type: `finance.payment_review.${action}`,
            aggregate_type: "fee_native_review", aggregate_id: reviewId, audience_user_ids: [], payload,
            idempotency_key: `native-fee-review:${commandId}:${action}`, notification_user_ids: [], notification_payload: null, created_at: executionNow() }).returning("id").executeTakeFirstOrThrow();
        const subject = { kind: "fee_payment_review", domain: "finance", domain_id: reviewId, label: "Fee review", lifecycle_state: "active", source_revision: revision, metadata: {} };
        const base = { school_id: invoice.school_id, source_outbox_event_id: outbox.id, event_type: `finance.payment_review.${action}`, subject,
            context: { kind: "fee_invoice", domain: "finance", domain_id: invoice.id, label: "Fee account", lifecycle_state: "active", source_revision: 1, metadata: {} },
            actor_user_id: user.id, occurred_at: at, effective_from: at, effective_until: null, source_domain: "finance", source_record_id: reviewId,
            source_revision: revision, correlation_id: commandId, causation_event_id: null, idempotency_key: `native-fee-review-event:${commandId}`, payload };
        // A withdrawn report may retain a now-inactive recipient. Historical
        // ownership remains on its message; recording this actor's accepted event
        // must not provision or reactivate that recipient.
        if (!route) {
            await this.journal.recordAcceptedEvent(tx, { ...base, audience_user_ids: [user.id] });
            return { outbox_id: outbox.id, receipt: null };
        }
        const receipt = await this.coordination.publishAcceptedEvent(tx, { ...base, event_kind: "domain_event", expected_route: {
                behaviour_version_id: route.behaviour_version_id, subscription_id: route.subscription_id
            },
            message: { subject: "Fee review requested", summary: "Open this fee account to review the reported payment or question.",
                payload: { workflow: "finance_payment_review", invoice_id: invoice.id, review_id: reviewId, source_revision: revision, action_path: nativeFeeReviewHref(invoice, reviewId, true) } },
            selector_input: { selector_key: route.selector_key, recipient_agents: [{ agent_kind: "human", user_id: route.recipient }], scope: subject } });
        if (receipt.status !== "matched" || receipt.message_ids.length !== 1 || receipt.deliveries[0]?.recipient.agent_kind !== "human"
            || receipt.deliveries[0].recipient.user_id !== route.recipient)
            throw new ConflictException("The selected fee reviewer is unavailable. Your report was not sent.");
        return { outbox_id: outbox.id, receipt };
    }
    async routeState(tx, request) {
        const retained = request.coordination_receipt, ids = retained.message_ids;
        const message = Array.isArray(ids) && ids.length === 1 && typeof ids[0] === "string" ? ids[0] : null;
        if (!message || typeof retained.selector_key !== "string")
            return { message_id: message, open: false };
        const current = await this.coordination.resolveEventRoute(tx, { school_id: request.school_id, source_domain: "finance", event_type: "finance.payment_review.reported",
            selector_key: retained.selector_key, occurred_at: executionNow().toISOString() });
        const trace = await this.coordination.findExactTrace(tx, { school_id: request.school_id, source_domain: "finance", source_record_id: request.id,
            event_type: "finance.payment_review.reported", source_revision: request.stream_revision });
        return { message_id: message, open: Boolean(current.status === "matched" && current.behaviour_version_id === retained.behaviour_version_id
                && current.subscription_id === retained.subscription_id && trace?.message_id === message && trace.correlation_id === request.command_id && trace.message_open === true),
            trace };
    }
    async close(tx, user, request, commandId, outboxId, action) {
        const state = await this.routeState(tx, request);
        if (!state.message_id || !state.trace || state.trace.message_id !== state.message_id || state.trace.correlation_id !== request.command_id)
            throw new ConflictException("This fee review’s exact delivery evidence is unavailable.");
        if (action === "decided") {
            if (!state.open)
                throw new ConflictException("This fee review delivery is no longer open. Its sender can withdraw and send it again.");
            await this.coordination.recordRecipientResponse(tx, { school_id: request.school_id, message_id: state.message_id, correlation_id: request.command_id,
                recipient: { agent_kind: "human", user_id: user.id }, actor: { agent_kind: "human", user_id: user.id }, expected_source_record_id: request.id,
                expected_source_revision: request.stream_revision, source_outbox_event_id: outboxId, code: "fee_review_decided", explanation: "The retained independent fee operator recorded the native decision.",
                response: { invoice_id: request.invoice_id, review_id: request.id }, occurred_at: executionNow().toISOString(), idempotency_key: `native-fee-review-response:${commandId}` });
        }
        else if (!["cancelled", "expired", "responded", "dead_letter"].includes(state.trace.message_state ?? "")) {
            await this.coordination.recordMessageOutcome(tx, { school_id: request.school_id, message_id: state.message_id, state: "cancelled",
                actor: { agent_kind: "human", user_id: user.id }, source_outbox_event_id: outboxId, code: "fee_review_withdrawn", explanation: "The sender withdrew pending fee work.",
                response: null, occurred_at: executionNow().toISOString(), idempotency_key: `native-fee-review-withdraw:${commandId}` });
        }
    }
};
NativeFeeReviewsModel = __decorate([
    Injectable(),
    __param(0, Inject(DOMAIN_COMMAND_GATEWAY_PORT)),
    __param(1, Inject(DOMAIN_COMMAND_RECEIPT_READ_PORT)),
    __param(2, Inject(COORDINATION_CONFIGURATION_PORT)),
    __param(3, Inject(COORDINATION_RUNTIME_PORT)),
    __param(4, Inject(DOMAIN_EVENT_JOURNAL_PORT)),
    __metadata("design:paramtypes", [Object, Object, Object, Object, Object])
], NativeFeeReviewsModel);
export { NativeFeeReviewsModel };
//# sourceMappingURL=native-fee-reviews.model.js.map