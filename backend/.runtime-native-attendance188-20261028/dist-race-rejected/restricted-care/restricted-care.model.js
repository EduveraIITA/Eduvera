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
import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { createHmac } from "node:crypto";
import { DOMAIN_COMMAND_GATEWAY_PORT } from "../campus-model-core/domain-command-gateway.port.js";
import { DOMAIN_COMMAND_RECEIPT_READ_PORT } from "../campus-model-core/domain-command-receipt-read.port.js";
import { DOMAIN_EVENT_JOURNAL_PORT } from "../campus-model-core/domain-event-journal.port.js";
import { executionNow } from "../campus-model-core/execution-time.runtime.js";
import { config } from "../config.js";
const sourceDomain = "restricted_care";
const handlerKey = "restricted_care.commands";
export function refuseCareCommand(commandId, caseId, reason, message) {
    throw new ConflictException({ code: "care_command_refused", message, fields: { care_command_refused: {
                confirmation: "not_accepted", receipt_state: "absent", command_id: commandId, case_id: caseId, reason,
            } } });
}
/** Native care adapter to the shared command/journal ports. Protected content
 * never leaves this owner: Core holds keyed commitments and opaque receipts. */
let RestrictedCareModel = class RestrictedCareModel {
    gateway;
    receipts;
    journal;
    constructor(gateway, receipts, journal) {
        this.gateway = gateway;
        this.receipts = receipts;
        this.journal = journal;
    }
    key(user, commandId) { return `restricted-care:${user.id}:${commandId}`; }
    commitment(input) {
        // A secret-key commitment avoids making private short references guessable.
        return createHmac("sha256", config().restrictedCaseEncryptionKey).update(JSON.stringify(input)).digest("hex");
    }
    retained(tx, user, schoolId, commandId) {
        return this.receipts.readDomainCommandReceipt(tx, { school_id: schoolId, actor_user_id: user.id,
            source_domain: sourceDomain, handler_key: handlerKey, handler_version: 1, idempotency_key: this.key(user, commandId) });
    }
    async prepare(tx, user, source, action, input, authority) {
        const hash = this.commitment({ case_id: source.id, action, ...input });
        const previous = await this.retained(tx, user, source.school_id, input.command_id);
        if (previous) {
            if (previous.command_type !== `restricted_care.${action}` || previous.target.domain !== sourceDomain
                || previous.target.domain_id !== source.id || previous.safe_context.payload_commitment !== hash
                || previous.expected_revision !== (input.expected_revision ?? 0)) {
                throw new ConflictException("This confirmation belongs to different protected work. Keep the original request unchanged.");
            }
            if (previous.state === "pending")
                throw new ConflictException("This exact protected action is still awaiting confirmation. Check its result before sending another action.");
            if (previous.receipt.terminal_state !== "accepted")
                throw new ConflictException("This exact protected action was not accepted. Review the current record.");
            return { replay: true, receipt_id: String(previous.receipt.metadata.receipt_id) };
        }
        const expected = input.expected_revision ?? 0;
        if (source.revision !== expected)
            refuseCareCommand(input.command_id, source.id, "stream_advanced", "The protected record changed. Review its current version before sending a new action.");
        const prepared = await this.gateway.prepareDomainCommand(tx, { school_id: source.school_id, actor_user_id: user.id,
            command_type: `restricted_care.${action}`, handler_key: handlerKey, handler_version: 1, source_domain: sourceDomain,
            target: { kind: "restricted_care_case", domain: sourceDomain, domain_id: source.id, label: "Protected care case", lifecycle_state: "active", source_revision: Math.max(1, source.revision), metadata: {} },
            current_revision: source.revision, expected_revision: expected, capability: action === "intake" ? "restricted_care.intake" : action === "orphan.reassign" ? "restricted_care.recover" : "restricted_care.handle",
            purpose: `restricted_care_${action.replaceAll(".", "_")}`, requested_at: executionNow().toISOString(), correlation_id: input.command_id,
            causation_id: null, idempotency_key: this.key(user, input.command_id), operating_rule_version_ref: null, configuration_refs: [],
            authority_attestation: { evaluator_domain: sourceDomain, decision: "allowed", reason_codes: [action === "intake" ? "active_staff_protected_intake" : action === "orphan.reassign" ? "administrator_minimal_orphan_recovery" : "exact_current_protected_assignment"],
                authority_source_refs: [authority], operating_rule_refs: [], valid_until: null }, safe_context: { case_id: source.id, payload_commitment: hash } });
        if (prepared.status !== "ready")
            throw new ConflictException("Check the exact protected action before continuing.");
        return { replay: false, prepared };
    }
    async finish(tx, user, source, prepared, receiptId, eventId, eventType) {
        const at = executionNow().toISOString();
        await this.journal.recordAcceptedEvent(tx, { school_id: source.school_id, source_outbox_event_id: eventId, event_type: eventType,
            subject: { kind: "restricted_care_case", domain: sourceDomain, domain_id: source.id, label: "Protected care case", lifecycle_state: "active", source_revision: source.revision, metadata: {} },
            context: null, actor_user_id: user.id, occurred_at: at, effective_from: at, effective_until: null, source_domain: sourceDomain,
            source_record_id: source.id, source_revision: source.revision, correlation_id: prepared.command_id, causation_event_id: null,
            idempotency_key: `restricted-care-event:${prepared.command_id}`, payload: { case_id: source.id, revision: source.revision, receipt_id: receiptId }, audience_user_ids: [] });
        await this.gateway.completeDomainCommand(tx, { school_id: source.school_id, command_id: prepared.command_id, terminal_state: "accepted",
            code: "restricted_care_accepted", explanation: "The protected care owner accepted this exact action.", resulting_revision: source.revision,
            domain_event_id: eventId, metadata: { case_id: source.id, receipt_id: receiptId }, completed_at: at });
    }
};
RestrictedCareModel = __decorate([
    Injectable(),
    __param(0, Inject(DOMAIN_COMMAND_GATEWAY_PORT)),
    __param(1, Inject(DOMAIN_COMMAND_RECEIPT_READ_PORT)),
    __param(2, Inject(DOMAIN_EVENT_JOURNAL_PORT)),
    __metadata("design:paramtypes", [Object, Object, Object])
], RestrictedCareModel);
export { RestrictedCareModel };
//# sourceMappingURL=restricted-care.model.js.map