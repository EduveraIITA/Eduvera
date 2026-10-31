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
import { sql } from 'kysely';
import { DOMAIN_COMMAND_GATEWAY_PORT } from '../campus-model-core/domain-command-gateway.port.js';
import { DOMAIN_COMMAND_RECEIPT_READ_PORT } from '../campus-model-core/domain-command-receipt-read.port.js';
import { DOMAIN_EVENT_JOURNAL_PORT } from '../campus-model-core/domain-event-journal.port.js';
import { COORDINATION_CONFIGURATION_PORT, coordinationConfigurationHash } from '../campus-model-core/coordination-configuration.port.js';
import { COORDINATION_RUNTIME_PORT } from '../campus-model-core/coordination-runtime.port.js';
import { executionNow } from '../campus-model-core/execution-time.runtime.js';
import { facilitiesHref } from './facilities.contracts.js';
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
let FacilitiesModel = class FacilitiesModel {
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
    key(user, command) { return `facilities:${user}:${command}`; }
    retained(tx, user, schoolId, commandId) { return this.receipts.readDomainCommandReceipt(tx, { school_id: schoolId, actor_user_id: user.id, source_domain: 'facilities', handler_key: 'facilities.commands', handler_version: 1, idempotency_key: this.key(user.id, commandId) }); }
    async prepare(tx, user, actor, target, action, body, capability, authority, validUntil = null) {
        const payloadHash = hash({ target_id: target.id, action, ...body }), retained = await this.retained(tx, user, target.school_id, body.command_id), kind = action === 'rule_configured' ? 'facility_rule' : 'facility_repair';
        if (retained) {
            if (retained.actor_agent_id !== actor.agent_id || retained.command_type !== `facilities.${action}` || retained.target.domain_id !== target.id || retained.expected_revision !== body.expected_revision || retained.safe_context.payload_hash !== payloadHash)
                throw new ConflictException('This command belongs to different repair work.');
            if (retained.state === 'pending')
                throw new ConflictException({ code: 'facilities_pending', message: 'This exact repair action is awaiting confirmation. Refresh without submitting another action.' });
            if (retained.receipt.terminal_state !== 'accepted')
                throw new ConflictException('This repair action was not accepted. Review its current record.');
            return { replay: true, revision: retained.receipt.resulting_revision };
        }
        if (target.revision !== body.expected_revision)
            throw new ConflictException({ code: 'facilities_obsolete', message: 'This repair changed. Review its current state before sending another action.', fields: { facilities_obsolete: { confirmation: 'permanently_inapplicable', receipt_state: 'absent', repair_id: target.id, command_id: body.command_id, expected_revision: body.expected_revision, current_revision: target.revision, reason: 'stream_advanced' } } });
        const previous = target.coordination_receipt;
        const prepared = await this.gateway.prepareDomainCommand(tx, { school_id: target.school_id, actor_user_id: user.id, command_type: `facilities.${action}`, handler_key: 'facilities.commands', handler_version: 1, source_domain: 'facilities',
            target: { kind, domain: 'facilities', domain_id: target.id, label: kind === 'facility_rule' ? 'Repair intake rule' : 'Repair', lifecycle_state: 'active', source_revision: Math.max(1, target.revision), metadata: {} },
            current_revision: target.revision, expected_revision: body.expected_revision, capability, purpose: `facilities_${action}`, requested_at: executionNow().toISOString(), correlation_id: target.id, causation_id: previous?.event_id ?? null,
            idempotency_key: this.key(user.id, body.command_id), operating_rule_version_ref: target.rule_id ? `facilities-rule:${target.rule_id}` : null, configuration_refs: target.rule_id ? [{ kind: 'facilities_intake_rule', ref: target.rule_id, version: '1' }] : [],
            authority_attestation: { evaluator_domain: 'facilities', decision: 'allowed', reason_codes: [capability === 'facilities.manage' ? 'explicit_current_facilities_authority' : 'exact_repair_participant'], authority_source_refs: [authority], operating_rule_refs: target.rule_id ? [{ rule_id: target.rule_id }] : [], valid_until: validUntil }, safe_context: { repair_id: target.id, payload_hash: payloadHash, ...(authority && typeof authority === 'object' && 'external_scope' in authority ? { external_scope: authority.external_scope } : {}) } });
        if (prepared.status !== 'ready')
            throw new ConflictException('Refresh this exact repair command.');
        return { replay: false, prepared };
    }
    complete(tx, school, prepared, revision, outbox, targetId, metadata = {}) { return this.gateway.completeDomainCommand(tx, { school_id: school, command_id: prepared.command_id, terminal_state: 'accepted', code: 'facilities_accepted', explanation: 'Facilities accepted this exact operation; reported work and verified completion remain distinct.', resulting_revision: revision, domain_event_id: outbox, metadata: { id: targetId, revision, ...metadata }, completed_at: executionNow().toISOString() }); }
    async refreshAsset(tx, repair, receipt, prepared) {
        if (!repair.asset_impact || !repair.holding_id || receipt.action === 'photo_added')
            return;
        const item = (await sql `SELECT campus_id FROM campus_resource_holdings
   WHERE school_id=${repair.school_id}::uuid AND id=${repair.holding_id}::uuid
    AND campus_asset_is_published(school_id,campus_id,id)`.execute(tx)).rows[0];
        if (!item)
            return;
        const payload = { campus_id: item.campus_id, holding_id: repair.holding_id, revision: repair.revision, source_command_id: prepared.command_id, refresh: ['campus-assets'] };
        const audience = (await sql `SELECT DISTINCT user_id FROM school_memberships
   WHERE school_id=${repair.school_id}::uuid AND is_active
    AND campus_asset_event_recipient_valid(${repair.school_id}::uuid,'campus_assets.updated',${JSON.stringify(payload)}::jsonb,user_id)`.execute(tx)).rows.map(row => row.user_id);
        await tx.insertInto('event_outbox').values({ school_id: repair.school_id, event_type: 'campus_assets.updated', aggregate_type: 'campus_asset', aggregate_id: repair.holding_id,
            audience_user_ids: audience, payload, idempotency_key: `facilities-asset:${prepared.command_id}`, created_at: executionNow(), notification_user_ids: [], notification_payload: null }).execute();
    }
    async finishSettings(tx, user, rule, prepared) {
        const payload = { rule_id: rule.id, revision: rule.revision, source_command_id: prepared.command_id }, at = rule.created_at;
        const outbox = await tx.insertInto('event_outbox').values({ school_id: rule.school_id, event_type: 'facilities.rule_configured', aggregate_type: 'facility_rule_event', aggregate_id: rule.school_id, audience_user_ids: [], payload, idempotency_key: `facilities-rule:${prepared.command_id}`, created_at: at, notification_user_ids: [], notification_payload: null }).returning('id').executeTakeFirstOrThrow();
        await this.journal.recordAcceptedEvent(tx, { school_id: rule.school_id, source_outbox_event_id: outbox.id, event_type: 'facilities.rule_configured', subject: { kind: 'facility_rule', domain: 'facilities', domain_id: rule.school_id, label: 'Repair intake rule', lifecycle_state: 'active', source_revision: rule.revision, metadata: {} }, context: null, actor_user_id: user.id, occurred_at: at.toISOString(), effective_from: at.toISOString(), effective_until: null, source_domain: 'facilities', source_record_id: rule.school_id, source_revision: rule.revision, correlation_id: rule.school_id, causation_event_id: null, idempotency_key: `facilities-rule-event:${prepared.command_id}`, payload, audience_user_ids: [user.id] });
        await this.complete(tx, rule.school_id, prepared, rule.revision, outbox.id, rule.school_id);
    }
    async configure(tx, user, repair, receipt, recipient, capability) {
        const at = repair.updated_at.toISOString(), key = `repair_${repair.id.replaceAll('-', '')}`;
        const verifying = repair.state === 'awaiting_verification', external = repair.external_assignment_id ? await tx.selectFrom('facilities_external_assignments').selectAll().where('school_id', '=', repair.school_id).where('id', '=', repair.external_assignment_id).executeTakeFirst() : undefined;
        const internalActor = (await sql `SELECT facilities_person_internal_participant(${repair.school_id}::uuid,${repair.id}::uuid,${receipt.actor_person_id}::uuid) AS valid`.execute(tx)).rows[0]?.valid, externalRecipient = !verifying && external?.status === 'granted' && recipient?.person_id === external.person_id, expiry = externalRecipient ? Math.max(1, Math.ceil((external.ends_at.getTime() - repair.updated_at.getTime()) / 1000)) : null, actorExpiry = external?.person_id === receipt.actor_person_id && (!internalActor || ['external_ready', 'accepted', 'updated', 'completed'].includes(receipt.action)) ? external.ends_at.toISOString() : null;
        const content = { school_id: repair.school_id, actor_user_id: user.id, source_domain: 'facilities', source_record_id: repair.id, source_revision: repair.revision, configuration_key: key,
            operating_rule_ref: `facilities-rule:${repair.rule_id}`, effective_from: at, enabled: Boolean(recipient) && repair.state !== 'closed', behaviour_key: key, behaviour_schema_version: 1,
            behaviour_configuration: { workflow: 'facilities_repair', repair_id: repair.id, rule_id: repair.rule_id, recipient_person_id: recipient?.person_id ?? null, recipient_user_id: recipient?.user_id ?? null, timing: externalRecipient ? 'explicit_external_access_end' : 'no_automatic_deadline', external_assignment_id: external?.id ?? null, external_access_ends_at: externalRecipient ? external.ends_at.toISOString() : null, stage: repair.state === 'closed' ? 'closed' : verifying ? 'verification' : 'handling' },
            subscription: { source_domain: 'facilities', event_type: `facilities.repair.${receipt.action}`, reaction_kind: verifying ? 'facilities_repair_verification' : 'facilities_repair_handling', message_kind: verifying ? 'request' : repair.state === 'reported' ? 'offer' : 'task', selector_key: key,
                required_capability: verifying ? 'facilities.verify' : 'facilities.handle', scope_mode: 'event_scope', min_recipients: 1, max_recipients: 1, message_schema_version: 1, response_due_after_seconds: null, expires_after_seconds: expiry, retry_after_seconds: null, max_attempts: 1, priority: 3 },
            recipients: recipient && repair.state !== 'closed' ? [recipient] : [], approval_note: 'This exact repair operation continues the explicitly configured accountable-handler and verifier policy. No emergency response SLA, room-entry consent, contractor acceptance or spending authority is inferred.' };
        const configurationHash = coordinationConfigurationHash(content), ids = [];
        for (const phase of ['approve', 'activate']) {
            const command = await this.gateway.prepareDomainCommand(tx, { school_id: repair.school_id, actor_user_id: user.id, command_type: `facilities.coordination.configure.${phase}`, handler_key: 'facilities.coordination.configure', handler_version: 1, source_domain: 'facilities',
                target: { kind: 'facility_repair', domain: 'facilities', domain_id: repair.id, label: 'Repair', lifecycle_state: 'active', source_revision: repair.revision, metadata: {} }, current_revision: repair.revision, expected_revision: repair.revision,
                capability, purpose: 'explicit_repair_next_responsibility', requested_at: at, correlation_id: repair.id, causation_id: ids[0] ?? null, idempotency_key: `${key}:${repair.revision}:${phase}`, operating_rule_version_ref: content.operating_rule_ref, configuration_refs: [{ kind: 'facilities_intake_rule', ref: repair.rule_id, version: '1' }],
                authority_attestation: { evaluator_domain: 'facilities', decision: 'allowed', reason_codes: ['explicit_retained_repair_policy'], authority_source_refs: [{ rule_id: repair.rule_id, coordinator_person_id: repair.coordinator_person_id, handler_person_id: repair.handler_person_id, verifier_person_id: repair.verifier_person_id, external_assignment_id: external?.id ?? null }], operating_rule_refs: [{ rule_id: repair.rule_id }], valid_until: actorExpiry },
                safe_context: { configuration_hash: configurationHash, source_record_id: repair.id, source_revision: repair.revision, configuration_key: key } });
            if (command.status !== 'ready')
                throw new ConflictException('The repair handoff needs a refresh.');
            ids.push(command.command_id);
            if (phase === 'approve')
                await this.complete(tx, repair.school_id, command, repair.revision, null, repair.id);
            else {
                const configured = await this.configuration.configureRoute(tx, { ...content, configuration_hash: configurationHash, approval_command_id: ids[0], activation_command_id: command.command_id });
                await this.complete(tx, repair.school_id, command, repair.revision, null, repair.id);
                return { ...configured, selector_key: key };
            }
        }
        throw new ConflictException('Repair routing was not configured.');
    }
    async finish(tx, user, repair, receipt, prepared, capability, recipient, audience, previous) {
        const at = repair.updated_at.toISOString(), payload = { repair_id: repair.id, revision: repair.revision, action: receipt.action, source_command_id: prepared.command_id };
        const outbox = await tx.insertInto('event_outbox').values({ school_id: repair.school_id, event_type: `facilities.repair.${receipt.action}`, aggregate_type: 'facility_repair_event', aggregate_id: repair.id, audience_user_ids: [], payload, idempotency_key: `facilities:${prepared.command_id}:source`, created_at: repair.updated_at, notification_user_ids: [], notification_payload: null }).returning('id').executeTakeFirstOrThrow();
        // Record a real recipient response while its exact invitation grant is still
        // effective. Activating the next version retires that prior scoped grant.
        // Both response and replacement remain in this one owning transaction.
        if (previous?.message_id && previous.recipient_user_id === user.id) {
            const trace = await this.coordination.findExactTrace(tx, { school_id: repair.school_id, source_domain: 'facilities', source_record_id: repair.id, event_type: previous.event_type, source_revision: previous.source_revision, message_id: previous.message_id });
            if (!trace || trace.message_id !== previous.message_id)
                throw new ConflictException('The previous exact repair handoff is unavailable.');
            if (trace.message_open)
                await this.coordination.recordRecipientResponse(tx, { school_id: repair.school_id, message_id: previous.message_id, correlation_id: repair.id, recipient: { agent_kind: 'human', user_id: user.id }, actor: { agent_kind: 'human', user_id: user.id }, expected_source_record_id: repair.id, expected_source_revision: previous.source_revision, source_outbox_event_id: outbox.id, code: `facilities_${receipt.action}`, explanation: 'The exact recipient acted through the authoritative repair operation.', response: { repair_id: repair.id, revision: repair.revision, action: receipt.action }, occurred_at: at, idempotency_key: `facilities-response:${prepared.command_id}` });
        }
        const event = { school_id: repair.school_id, source_outbox_event_id: outbox.id, event_type: `facilities.repair.${receipt.action}`, subject: { kind: 'facility_repair', domain: 'facilities', domain_id: repair.id, label: 'Repair', lifecycle_state: 'active', source_revision: repair.revision, metadata: {} }, context: null, actor_user_id: user.id, occurred_at: at, effective_from: at, effective_until: null, source_domain: 'facilities', source_record_id: repair.id, source_revision: repair.revision, correlation_id: repair.id, causation_event_id: previous?.event_id ?? null, idempotency_key: `facilities-event:${prepared.command_id}`, payload };
        let eventId, messageId = null;
        const route = await this.configure(tx, user, repair, receipt, recipient, capability);
        if (recipient && repair.state !== 'closed') {
            const result = await this.coordination.publishAcceptedEvent(tx, { ...event, event_kind: 'domain_event', expected_route: { behaviour_version_id: route.behaviour_version_id, subscription_id: route.subscription_id },
                message: { subject: repair.state === 'awaiting_verification' ? 'Check completed repair' : repair.state === 'reported' ? 'Accept repair responsibility' : 'Continue repair', summary: 'Open the exact repair for its current state and authorized next action.', payload: { workflow: 'facilities_repair', repair_id: repair.id, source_revision: repair.revision, action_path: facilitiesHref(repair.id) } },
                selector_input: { selector_key: route.selector_key, recipient_agents: [{ agent_kind: 'human', user_id: recipient.user_id }], scope: event.subject } });
            if (result.status !== 'matched' || result.message_ids.length !== 1)
                throw new ConflictException('The named next repair handler could not receive its work.');
            eventId = result.event_id;
            messageId = result.message_ids[0];
        }
        else {
            const result = await this.journal.recordAcceptedEvent(tx, { ...event, audience_user_ids: [user.id] });
            eventId = result.event_id;
        }
        if (previous?.message_id) {
            const trace = await this.coordination.findExactTrace(tx, { school_id: repair.school_id, source_domain: 'facilities', source_record_id: repair.id, event_type: previous.event_type, source_revision: previous.source_revision, message_id: previous.message_id });
            if (!trace || trace.message_id !== previous.message_id)
                throw new ConflictException('The previous exact repair handoff is unavailable.');
            if (trace.message_open) {
                if (previous.recipient_user_id === user.id)
                    await this.coordination.recordRecipientResponse(tx, { school_id: repair.school_id, message_id: previous.message_id, correlation_id: repair.id, recipient: { agent_kind: 'human', user_id: user.id }, actor: { agent_kind: 'human', user_id: user.id }, expected_source_record_id: repair.id, expected_source_revision: previous.source_revision, source_outbox_event_id: outbox.id, code: `facilities_${receipt.action}`, explanation: 'The exact recipient acted through the authoritative repair operation.', response: { repair_id: repair.id, revision: repair.revision, action: receipt.action }, occurred_at: at, idempotency_key: `facilities-response:${prepared.command_id}` });
                else
                    await this.coordination.supersedeDomainMessage(tx, { school_id: repair.school_id, command_id: prepared.command_id, message_id: previous.message_id, previous_event_id: previous.event_id, resulting_event_id: eventId, required_capability: capability, occurred_at: at, idempotency_key: `facilities-supersede:${prepared.command_id}` });
            }
        }
        const retained = { event_id: eventId, source_revision: repair.revision, event_type: event.event_type, message_id: messageId, recipient_user_id: messageId ? recipient.user_id : null, capability: repair.state === 'awaiting_verification' ? 'facilities.verify' : 'facilities.handle', route_unavailable: repair.state !== 'closed' && !recipient };
        await tx.updateTable('facilities_repairs').set({ coordination_receipt: retained }).where('school_id', '=', repair.school_id).where('id', '=', repair.id).execute();
        await this.complete(tx, repair.school_id, prepared, repair.revision, outbox.id, repair.id, { action: receipt.action, external_access_id: repair.external_assignment_id });
        await tx.insertInto('event_outbox').values({ school_id: repair.school_id, event_type: 'facilities.updated', aggregate_type: 'facility_repair', aggregate_id: repair.id, audience_user_ids: [...new Set(audience)], payload: { ...payload, refresh: ['facilities', 'workspace', 'attention'] }, idempotency_key: `facilities:${prepared.command_id}:refresh`, created_at: executionNow(), notification_user_ids: [], notification_payload: null }).execute();
        await this.refreshAsset(tx, repair, receipt, prepared);
        return retained;
    }
};
FacilitiesModel = __decorate([
    Injectable(),
    __param(0, Inject(DOMAIN_COMMAND_GATEWAY_PORT)),
    __param(1, Inject(DOMAIN_COMMAND_RECEIPT_READ_PORT)),
    __param(2, Inject(DOMAIN_EVENT_JOURNAL_PORT)),
    __param(3, Inject(COORDINATION_CONFIGURATION_PORT)),
    __param(4, Inject(COORDINATION_RUNTIME_PORT)),
    __metadata("design:paramtypes", [Object, Object, Object, Object, Object])
], FacilitiesModel);
export { FacilitiesModel };
//# sourceMappingURL=facilities.model.js.map