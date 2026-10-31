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
import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DOMAIN_COMMAND_GATEWAY_PORT } from '../campus-model-core/domain-command-gateway.port.js';
import { DOMAIN_COMMAND_RECEIPT_READ_PORT } from '../campus-model-core/domain-command-receipt-read.port.js';
import { DOMAIN_EVENT_JOURNAL_PORT } from '../campus-model-core/domain-event-journal.port.js';
import { COORDINATION_CONFIGURATION_PORT, coordinationConfigurationHash } from '../campus-model-core/coordination-configuration.port.js';
import { COORDINATION_RUNTIME_PORT } from '../campus-model-core/coordination-runtime.port.js';
import { executionNow } from '../campus-model-core/execution-time.runtime.js';
import { resourceLoanHref } from './resource-loans.contracts.js';
const commands = { issued: 'issue', return_recorded: 'return.record', return_corrected: 'return.correct', due_changed: 'due.change', question_asked: 'question.ask', replied: 'question.reply', resolved: 'question.resolve', custody_changed: 'custody.change' };
export const resourceLoanHash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
let ResourceLoansModel = class ResourceLoansModel {
    gateway;
    receipts;
    journal;
    configuration;
    coordination;
    constructor(gateway, receipts, journal, configuration, coordination) {
        this.gateway = gateway;
        this.receipts = receipts;
        this.journal = journal;
        this.configuration = configuration;
        this.coordination = coordination;
    }
    key(userId, commandId) { return `resource-loan:${userId}:${commandId}`; }
    async retained(tx, user, schoolId, commandId) {
        return this.receipts.readDomainCommandReceipt(tx, { school_id: schoolId, actor_user_id: user.id, source_domain: 'resource_loans', handler_key: 'resource_loans.commands', handler_version: 1, idempotency_key: this.key(user.id, commandId) });
    }
    async prepare(tx, user, actor, loan, action, body, currentRevision, authority, previous) {
        const payloadHash = resourceLoanHash({ loan_id: loan.id, action, ...body }), type = `resource_loans.${commands[action]}`;
        const borrowerAction = action === 'question_asked' || action === 'replied' && typeof authority === 'object' && authority !== null && 'borrower_person_id' in authority && authority.borrower_person_id === actor.person_id;
        const retained = await this.retained(tx, user, loan.school_id, body.command_id);
        if (retained) {
            if (retained.actor_agent_id !== actor.agent_id || retained.command_type !== type || retained.target.domain !== 'resource_loans' || retained.target.domain_id !== loan.id
                || retained.expected_revision !== body.expected_revision || retained.safe_context.payload_hash !== payloadHash)
                throw new ConflictException('This command belongs to different resource work.');
            if (retained.state === 'pending')
                throw new ConflictException({ code: 'resource_loan_pending', message: 'This exact action is awaiting confirmation. Refresh without sending another action.' });
            if (retained.receipt.terminal_state !== 'accepted')
                throw new ConflictException('This resource action was not accepted. Review its current record.');
            return { replay: true, revision: retained.receipt.resulting_revision };
        }
        if (currentRevision !== body.expected_revision)
            throw new ConflictException({ code: 'resource_loan_obsolete', message: 'This loan changed. Review the current record before sending a new action.', fields: { resource_loan_obsolete: { confirmation: 'permanently_inapplicable', receipt_state: 'absent', loan_id: loan.id, command_id: body.command_id, expected_revision: body.expected_revision, current_revision: currentRevision, reason: 'stream_advanced' } } });
        const prepared = await this.gateway.prepareDomainCommand(tx, { school_id: loan.school_id, actor_user_id: user.id, command_type: type, handler_key: 'resource_loans.commands', handler_version: 1, source_domain: 'resource_loans',
            target: { kind: 'resource_loan', domain: 'resource_loans', domain_id: loan.id, label: loan.item_name, lifecycle_state: 'active', source_revision: Math.max(1, currentRevision), metadata: {} },
            current_revision: currentRevision, expected_revision: body.expected_revision, capability: borrowerAction ? action === 'question_asked' ? 'resource_loans.question.ask' : 'resource_loans.question.reply' : 'resource_loans.manage', purpose: `resource_${commands[action].replaceAll('.', '_')}`,
            requested_at: executionNow().toISOString(), correlation_id: previous?.correlation_id ?? body.command_id, causation_id: previous?.event_id ?? null, idempotency_key: this.key(user.id, body.command_id), operating_rule_version_ref: null, configuration_refs: [],
            authority_attestation: { evaluator_domain: 'resource_loans', decision: 'allowed', reason_codes: [borrowerAction ? 'exact_canonical_borrower' : action === 'custody_changed' && typeof authority === 'object' && authority !== null && 'custody_basis' in authority && authority.custody_basis === 'orphan_recovery' ? 'exact_orphan_custody_recovery' : 'explicit_current_custodian'], authority_source_refs: [authority], operating_rule_refs: [], valid_until: null }, safe_context: { loan_id: loan.id, payload_hash: payloadHash } });
        if (prepared.status !== 'ready')
            throw new ConflictException('Refresh this exact resource command.');
        return { replay: false, prepared };
    }
    async complete(tx, schoolId, prepared, revision, eventId, metadata) {
        await this.gateway.completeDomainCommand(tx, { school_id: schoolId, command_id: prepared.command_id, terminal_state: 'accepted', code: 'resource_loan_accepted', explanation: 'The Resources owner accepted this exact custody action.', resulting_revision: revision, domain_event_id: eventId, metadata, completed_at: executionNow().toISOString() });
    }
    async configureQuestion(tx, user, loan, questionId, commandId, recipient, action = 'question_asked') {
        const at = executionNow().toISOString(), key = `loan_question_${questionId.replaceAll('-', '')}_${loan.revision}`;
        const content = { school_id: loan.school_id, actor_user_id: user.id, source_domain: 'resource_loans', source_record_id: loan.id, source_revision: loan.revision, configuration_key: key,
            operating_rule_ref: `resource-loan-question:${questionId}`, effective_from: at, enabled: true, behaviour_key: key, behaviour_schema_version: 1,
            behaviour_configuration: { workflow: 'resource_loan_question', loan_id: loan.id, question_id: questionId, recipient_person_id: recipient.person_id, recipient_user_id: recipient.user_id, timing: 'no_automatic_deadline' },
            subscription: { source_domain: 'resource_loans', event_type: `resource_loans.${action}`, reaction_kind: 'resource_loan_question', message_kind: 'request', selector_key: key, required_capability: 'resource_loans.manage', scope_mode: 'event_scope', min_recipients: 1, max_recipients: 1, message_schema_version: 1, response_due_after_seconds: null, expires_after_seconds: null, retry_after_seconds: null, max_attempts: 1, priority: 3 },
            recipients: [recipient], approval_note: action === 'custody_changed' ? 'This explicit responsibility change routes the already open question to the named eligible successor. No physical receipt or new permission is inferred.' : 'The borrower explicitly asks the exact retained custodian to review this one loan. No return, reminder, renewal, fine, or new institutional authority is inferred.' };
        const hash = coordinationConfigurationHash(content), ids = [];
        for (const phase of ['approve', 'activate']) {
            const prepared = await this.gateway.prepareDomainCommand(tx, { school_id: loan.school_id, actor_user_id: user.id, command_type: `resource_loans.coordination.configure.${phase}`, handler_key: 'resource_loans.coordination.configure', handler_version: 1, source_domain: 'resource_loans', target: { kind: 'resource_loan', domain: 'resource_loans', domain_id: loan.id, label: loan.item_name, lifecycle_state: 'active', source_revision: loan.revision, metadata: {} }, current_revision: loan.revision, expected_revision: loan.revision,
                capability: action === 'custody_changed' ? 'resource_loans.manage' : 'resource_loans.question.ask', purpose: 'explicit_resource_question_delivery', requested_at: at, correlation_id: commandId, causation_id: ids[0] ?? null, idempotency_key: `${key}:${phase}`, operating_rule_version_ref: content.operating_rule_ref, configuration_refs: [],
                authority_attestation: { evaluator_domain: 'resource_loans', decision: 'allowed', reason_codes: [action === 'custody_changed' ? 'explicit_custody_transfer' : 'exact_borrower', 'retained_custodian'], authority_source_refs: [{ borrower_person_id: loan.borrower_person_id, custodian_person_id: loan.custodian_person_id }], operating_rule_refs: [], valid_until: null }, safe_context: { configuration_hash: hash, source_record_id: loan.id, source_revision: loan.revision, configuration_key: key } });
            if (prepared.status !== 'ready')
                throw new ConflictException('The loan question route needs a refresh.');
            ids.push(prepared.command_id);
            if (phase === 'approve')
                await this.complete(tx, loan.school_id, prepared, loan.revision, null, { configuration_hash: hash });
            else {
                const route = await this.configuration.configureRoute(tx, { ...content, configuration_hash: hash, approval_command_id: ids[0], activation_command_id: prepared.command_id });
                await this.complete(tx, loan.school_id, prepared, loan.revision, null, { configuration_hash: hash });
                return { ...route, selector_key: key, recipient_user_id: recipient.user_id, recipient_person_id: recipient.person_id };
            }
        }
        throw new ConflictException('Question delivery was not configured.');
    }
    async finish(tx, user, loan, receipt, prepared, audience, questionRoute, previous) {
        const at = executionNow().toISOString(), payload = { loan_id: loan.id, revision: loan.revision, action: receipt.action, command_id: prepared.command_id, ...(receipt.action === 'custody_changed' ? { source_command_id: prepared.command_id } : {}) };
        const outbox = await tx.insertInto('event_outbox').values({ school_id: loan.school_id, event_type: `resource_loans.${receipt.action}`, aggregate_type: 'resource_loan_event', aggregate_id: loan.id,
            audience_user_ids: [], payload, idempotency_key: `resource-loan:${prepared.command_id}:source`, created_at: executionNow(), notification_user_ids: [], notification_payload: null }).returning('id').executeTakeFirstOrThrow();
        const event = { school_id: loan.school_id, source_outbox_event_id: outbox.id, event_type: `resource_loans.${receipt.action}`,
            subject: { kind: 'resource_loan', domain: 'resource_loans', domain_id: loan.id, label: loan.item_name, lifecycle_state: 'active', source_revision: loan.revision, metadata: {} }, context: null, actor_user_id: user.id, occurred_at: at, effective_from: at, effective_until: null,
            source_domain: 'resource_loans', source_record_id: loan.id, source_revision: loan.revision, correlation_id: previous?.correlation_id ?? prepared.command_id, causation_event_id: previous?.event_id ?? null, idempotency_key: `resource-loan-event:${prepared.command_id}`, payload };
        let route = null;
        if (questionRoute) {
            route = await this.coordination.publishAcceptedEvent(tx, { ...event, event_kind: 'domain_event', expected_route: { behaviour_version_id: questionRoute.behaviour_version_id, subscription_id: questionRoute.subscription_id },
                message: { subject: 'Borrowing question', summary: 'The borrower asks the named custodian to review this loan.', payload: { loan_id: loan.id, question_id: receipt.question_id, source_revision: loan.revision, action_path: resourceLoanHref(loan.id) } },
                selector_input: { selector_key: questionRoute.selector_key, recipient_agents: [{ agent_kind: 'human', user_id: questionRoute.recipient_user_id }], scope: event.subject } });
            const result = route;
            if (result.status !== 'matched' || result.message_ids.length !== 1)
                throw new ConflictException('The retained custodian could not receive this question.');
            if (previous?.message_open)
                await this.coordination.supersedeDomainMessage(tx, { school_id: loan.school_id, command_id: prepared.command_id, message_id: previous.message_id, previous_event_id: previous.event_id, previous_source_revision: previous.source_revision, resulting_event_id: result.event_id, required_capability: 'resource_loans.manage', occurred_at: at, idempotency_key: `resource-custody-supersede:${prepared.command_id}` });
            route = { ...result, event_type: event.event_type, source_revision: loan.revision, recipient_person_id: questionRoute.recipient_person_id };
        }
        else
            await this.journal.recordAcceptedEvent(tx, { ...event, audience_user_ids: [user.id] });
        await this.complete(tx, loan.school_id, prepared, loan.revision, outbox.id, { id: loan.id, revision: loan.revision });
        await tx.insertInto('event_outbox').values({ school_id: loan.school_id, event_type: 'resources.updated', aggregate_type: 'resource_loan', aggregate_id: loan.id,
            audience_user_ids: [...new Set(audience)], payload: { ...payload, refresh: ['resources', 'workspace', 'attention'] }, idempotency_key: `resource-loan:${prepared.command_id}:refresh`, created_at: executionNow(), notification_user_ids: [], notification_payload: null }).execute();
        return { route, outbox_id: outbox.id };
    }
    async questionTrace(tx, loan, question) {
        const retained = question.coordination_receipt;
        const source_revision = retained.source_revision ?? question.revision, event_type = retained.event_type ?? 'resource_loans.question_asked';
        const trace = await this.coordination.findExactTrace(tx, { school_id: loan.school_id, source_domain: 'resource_loans', source_record_id: loan.id, event_type, source_revision });
        if (!trace || retained.message_ids?.length !== 1 || trace.message_id !== retained.message_ids[0])
            throw new ConflictException('This question’s exact custodian work receipt is unavailable.');
        return { ...trace, source_revision, event_type };
    }
    async resolveQuestion(tx, user, loan, question, outboxId, commandId) {
        const retained = question.coordination_receipt;
        if (retained.message_ids?.length !== 1)
            throw new ConflictException('This question’s exact custodian work receipt is unavailable.');
        const trace = await this.questionTrace(tx, loan, question);
        if (!trace || trace.message_id !== retained.message_ids[0] || !trace.message_open)
            throw new ConflictException('This question’s retained work changed. Refresh the loan.');
        await this.coordination.recordRecipientResponse(tx, { school_id: loan.school_id, message_id: trace.message_id, correlation_id: trace.correlation_id, recipient: { agent_kind: 'human', user_id: user.id }, actor: { agent_kind: 'human', user_id: user.id }, expected_source_record_id: loan.id, expected_source_revision: trace.source_revision, source_outbox_event_id: outboxId,
            code: 'resource_question_resolved', explanation: 'The named custodian explicitly resolved this borrowing question; physical custody follows its separate receipts.', response: { loan_id: loan.id, question_id: question.id }, occurred_at: executionNow().toISOString(), idempotency_key: `resource-question-resolve:${commandId}` });
    }
};
ResourceLoansModel = __decorate([
    Injectable(),
    __param(0, Inject(DOMAIN_COMMAND_GATEWAY_PORT)),
    __param(1, Inject(DOMAIN_COMMAND_RECEIPT_READ_PORT)),
    __param(2, Inject(DOMAIN_EVENT_JOURNAL_PORT)),
    __param(3, Inject(COORDINATION_CONFIGURATION_PORT)),
    __param(4, Inject(COORDINATION_RUNTIME_PORT)),
    __metadata("design:paramtypes", [Object, Object, Object, Object, Object])
], ResourceLoansModel);
export { ResourceLoansModel };
//# sourceMappingURL=resource-loans.model.js.map