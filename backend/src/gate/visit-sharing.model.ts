import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Transaction } from 'kysely';
import type { Database } from '../database/types.js';
import type { AuthUser } from '../common/request.js';
import type { ActingHumanAgentIdentity } from '../campus-model-core/human-agent-identity.port.js';
import { DOMAIN_COMMAND_GATEWAY_PORT, type DomainCommandGatewayPort, type PreparedDomainCommand } from '../campus-model-core/domain-command-gateway.port.js';
import { DOMAIN_COMMAND_RECEIPT_READ_PORT, type DomainCommandReceiptReadPort } from '../campus-model-core/domain-command-receipt-read.port.js';
import { DOMAIN_EVENT_JOURNAL_PORT, type DomainEventJournalPort } from '../campus-model-core/domain-event-journal.port.js';
import { COORDINATION_CONFIGURATION_PORT, coordinationConfigurationHash, type CoordinationConfigurationPort, type CoordinationRouteContent } from '../campus-model-core/coordination-configuration.port.js';
import { COORDINATION_RUNTIME_PORT, type CoordinationRuntimePort } from '../campus-model-core/coordination-runtime.port.js';
import { executionNow } from '../campus-model-core/execution-time.runtime.js';
import { sharedVisitHref, type VisitQuestionCoordination } from './visit-sharing.contracts.js';

type Tx = Transaction<Database>;
export const visitSharingHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export interface VisitSharingSource { school_id: string; visit_id: string; id: string; revision: number; kind: 'share' | 'question'; last_event_id?: string | null; at?: string }
export interface VisitSharingEvent { visit_id: string; share_id: string; root_id: string; question_id: string | null; revision: number; action: string }

@Injectable()
export class VisitSharingModel {
  constructor(
    @Inject(DOMAIN_COMMAND_GATEWAY_PORT) private readonly gateway: DomainCommandGatewayPort,
    @Inject(DOMAIN_COMMAND_RECEIPT_READ_PORT) private readonly receipts: DomainCommandReceiptReadPort,
    @Inject(DOMAIN_EVENT_JOURNAL_PORT) private readonly journal: DomainEventJournalPort,
    @Inject(COORDINATION_CONFIGURATION_PORT) private readonly configuration: CoordinationConfigurationPort,
    @Inject(COORDINATION_RUNTIME_PORT) readonly coordination: CoordinationRuntimePort,
  ) {}
  private key(user: string, command: string) { return `gate-visit-sharing:${user}:${command}`; }
  retained(tx: Tx, user: AuthUser, school: string, command: string) {
    return this.receipts.readDomainCommandReceipt(tx, { school_id: school, actor_user_id: user.id, source_domain: 'gate',
      handler_key: 'gate.visit-sharing.v1', handler_version: 1, idempotency_key: this.key(user.id, command) });
  }
  async prepare(tx: Tx, user: AuthUser, actor: ActingHumanAgentIdentity, source: VisitSharingSource, action: string,
    body: { command_id: string; expected_revision: number; [key: string]: unknown }, capability: string,
    authority: Record<string, unknown>, commitment: Record<string, unknown>, validUntil: string | null) {
    const hash = visitSharingHash({ source_id: source.id, kind: source.kind, action, ...body });
    const old = await this.retained(tx, user, source.school_id, body.command_id);
    if (old) {
      if (old.actor_agent_id !== actor.agent_id || old.target.domain_id !== source.id || old.command_type !== `gate.visit_${source.kind}.${action}`
        || old.expected_revision !== body.expected_revision || old.safe_context.payload_hash !== hash)
        throw new ConflictException('This command belongs to a different shared visit action.');
      if (old.state === 'pending') throw new ConflictException({ code: 'visit_sharing_pending', message: 'This exact action is awaiting confirmation. Check it before sending another action.' });
      if (old.receipt.terminal_state !== 'accepted') throw new ConflictException('This shared visit action was not accepted. Review its current state.');
      return { replay: true as const, result: old.receipt.metadata };
    }
    if (source.revision !== body.expected_revision) throw new ConflictException({ code: 'visit_sharing_changed', message: 'This shared visit changed. Review its current state before saving.', fields: { visit_sharing_changed: {
      confirmation: 'permanently_inapplicable', receipt_state: 'absent', visit_id: source.visit_id, command_id: body.command_id,
      expected_revision: body.expected_revision, current_revision: source.revision, reason: 'stream_advanced' } } });
    const command = await this.gateway.prepareDomainCommand(tx, {
      school_id: source.school_id, actor_user_id: user.id, command_type: `gate.visit_${source.kind}.${action}`, source_domain: 'gate',
      handler_key: 'gate.visit-sharing.v1', handler_version: 1,
      target: { kind: source.kind === 'share' ? 'gate_visit_sharing' : 'gate_visit_question', domain: 'gate', domain_id: source.id,
        label: source.kind === 'share' ? 'Shared campus visit' : 'Visit question', lifecycle_state: 'active', source_revision: Math.max(1, source.revision), metadata: {} },
      current_revision: source.revision, expected_revision: body.expected_revision, capability, purpose: `gate_visit_${source.kind}_${action}`,
      requested_at: source.at ?? executionNow().toISOString(), correlation_id: source.id, causation_id: source.last_event_id ?? null,
      idempotency_key: this.key(user.id, body.command_id), operating_rule_version_ref: null, configuration_refs: [],
      authority_attestation: { evaluator_domain: 'gate', decision: 'allowed', reason_codes: [capability === 'gate.manage' ? 'explicit_current_visit_coordinator' : 'exact_shared_visit_participant'],
        authority_source_refs: [authority], operating_rule_refs: [], valid_until: validUntil },
      safe_context: { visit_id: source.visit_id, payload_hash: hash, commitment },
    });
    if (command.status !== 'ready') throw new ConflictException('Refresh this exact shared visit command.');
    return { replay: false as const, prepared: command };
  }
  async configureQuestion(tx: Tx, user: AuthUser, source: VisitSharingSource, questionId: string,
    owner: { person_id: string; user_id: string }, capability: string, shareId: string, validUntil: string | null,
    eventType = 'gate.visit_question.asked') {
    const at = source.at ?? executionNow().toISOString(), key = `visit_question_${questionId.replaceAll('-', '')}`;
    const content: CoordinationRouteContent = { school_id: source.school_id, actor_user_id: user.id, source_domain: 'gate', source_record_id: questionId,
      source_revision: source.revision, configuration_key: key, operating_rule_ref: `visit-share:${shareId}`, effective_from: at, enabled: true,
      behaviour_key: key, behaviour_schema_version: 1,
      behaviour_configuration: { workflow: 'gate_visit_question', visit_id: source.visit_id, question_id: questionId, share_id: shareId,
        recipient_person_id: owner.person_id, recipient_user_id: owner.user_id, timing: 'no_automatic_deadline' },
      subscription: { source_domain: 'gate', event_type: eventType, reaction_kind: 'gate_visit_question', message_kind: 'request',
        selector_key: key, required_capability: 'gate.visit.question.reply', scope_mode: 'event_scope', min_recipients: 1, max_recipients: 1,
        message_schema_version: 1, response_due_after_seconds: null, expires_after_seconds: null, max_attempts: 1, retry_after_seconds: null, priority: 3 },
      recipients: [owner], approval_note: 'This explicit visitor question is delivered only to the retained campus coordinator. No gate admission, room reservation, acknowledgement duty or automatic SLA is inferred.' };
    const hash = coordinationConfigurationHash(content), commands: string[] = [];
    for (const phase of ['approve', 'activate'] as const) {
      const command = await this.gateway.prepareDomainCommand(tx, { school_id: source.school_id, actor_user_id: user.id,
        command_type: `gate.coordination.configure.${phase}`, source_domain: 'gate', handler_key: 'gate.coordination.configure', handler_version: 1,
        target: { kind: 'gate_visit_question', domain: 'gate', domain_id: questionId, label: 'Visit question', lifecycle_state: 'active', source_revision: source.revision, metadata: {} },
        current_revision: source.revision, expected_revision: source.revision, capability, purpose: 'explicit_visit_question_delivery', requested_at: at,
        correlation_id: questionId, causation_id: commands[0] ?? null, idempotency_key: `${key}:${source.revision}:${phase}`, operating_rule_version_ref: content.operating_rule_ref,
        configuration_refs: [], authority_attestation: { evaluator_domain: 'gate', decision: 'allowed', reason_codes: ['explicit_exact_visit_question'],
          authority_source_refs: [{ visit_id: source.visit_id, share_id: shareId, owner_person_id: owner.person_id }], operating_rule_refs: [], valid_until: validUntil },
        safe_context: { configuration_hash: hash, source_record_id: questionId, source_revision: source.revision, configuration_key: key } });
      if (command.status !== 'ready') throw new ConflictException('The visit question delivery needs a refresh.');
      commands.push(command.command_id);
      if (phase === 'activate') {
        const configured = await this.configuration.configureRoute(tx, { ...content, configuration_hash: hash, approval_command_id: commands[0]!, activation_command_id: command.command_id });
        await this.gateway.completeDomainCommand(tx, { school_id: source.school_id, command_id: command.command_id, terminal_state: 'accepted', code: 'visit_question_route_accepted',
          explanation: 'The exact question recipient route was retained.', resulting_revision: source.revision, domain_event_id: null, metadata: { configuration_hash: hash }, completed_at: at });
        if (!configured.behaviour_version_id || !configured.subscription_id) throw new ConflictException('The question owner could not receive this request.');
        return { ...configured, selector_key: key, recipient_user_id: owner.user_id };
      }
      await this.gateway.completeDomainCommand(tx, { school_id: source.school_id, command_id: command.command_id, terminal_state: 'accepted', code: 'visit_question_route_approved',
        explanation: 'The explicit question route was approved.', resulting_revision: source.revision, domain_event_id: null, metadata: { configuration_hash: hash }, completed_at: at });
    }
    throw new ConflictException('The question delivery was not configured.');
  }
  async event(tx: Tx, user: AuthUser, source: VisitSharingSource, data: VisitSharingEvent, command: PreparedDomainCommand,
    route?: Awaited<ReturnType<VisitSharingModel['configureQuestion']>>) {
    const at = source.at ? new Date(source.at) : executionNow(), payload = { ...data, source_command_id: command.command_id };
    const type = `gate.visit_${source.kind}.${data.action}`;
    const outbox = await tx.insertInto('event_outbox').values({ school_id: source.school_id, event_type: type,
      aggregate_type: source.kind === 'share' ? 'gate_visit_share_event' : 'gate_visit_question_event', aggregate_id: source.id,
      audience_user_ids: [], payload, idempotency_key: `gate-visit-sharing-source:${command.command_id}`, created_at: at, notification_user_ids: [], notification_payload: null }).returning('id').executeTakeFirstOrThrow();
    const base = { school_id: source.school_id, source_outbox_event_id: outbox.id, event_type: type,
      subject: { kind: source.kind === 'share' ? 'gate_visit_sharing' : 'gate_visit_question', domain: 'gate', domain_id: source.id,
        label: source.kind === 'share' ? 'Shared campus visit' : 'Visit question', lifecycle_state: 'active' as const, source_revision: data.revision, metadata: {} },
      context: null, actor_user_id: user.id, occurred_at: at.toISOString(), effective_from: at.toISOString(), effective_until: null,
      source_domain: 'gate', source_record_id: source.id, source_revision: data.revision, correlation_id: source.id,
      causation_event_id: source.last_event_id ?? null, idempotency_key: `gate-visit-sharing-journal:${command.command_id}`, payload };
    if (!route) {
      const result = await this.journal.recordAcceptedEvent(tx, { ...base, audience_user_ids: [user.id] });
      return { event_id: result.event_id, outbox_id: outbox.id, receipt: null };
    }
    const published = await this.coordination.publishAcceptedEvent(tx, { ...base, event_kind: 'domain_event',
      expected_route: { behaviour_version_id: route.behaviour_version_id!, subscription_id: route.subscription_id! },
      message: { subject: 'Visit question', summary: 'Open this shared visit to answer its private question.',
        payload: { workflow: 'gate_visit_question', visit_id: data.visit_id, question_id: data.question_id, share_root_id: data.root_id,
          source_revision: data.revision, action_path: sharedVisitHref(data.visit_id) } },
      selector_input: { selector_key: route.selector_key, recipient_agents: [{ agent_kind: 'human', user_id: route.recipient_user_id }], scope: base.subject } });
    if (published.status !== 'matched' || published.message_ids.length !== 1 || published.deliveries[0]?.recipient.agent_kind !== 'human'
      || published.deliveries[0].recipient.user_id !== route.recipient_user_id) throw new ConflictException('The question was not sent because its exact campus recipient is unavailable.');
    const receipt: VisitQuestionCoordination = { event_id: published.event_id, source_revision: data.revision, event_type: type,
      message_id: published.message_ids[0]!, recipient_user_id: route.recipient_user_id, correlation_id: source.id,
      behaviour_version_id: route.behaviour_version_id!, subscription_id: route.subscription_id!, selector_key: route.selector_key };
    return { event_id: published.event_id, outbox_id: outbox.id, receipt };
  }
  async closePrevious(tx: Tx, user: AuthUser, source: VisitSharingSource, previous: VisitQuestionCoordination | null,
    result: { event_id: string; outbox_id: string }, command: PreparedDomainCommand, capability: string, response: boolean) {
    if (!previous?.message_id) return;
    const trace = await this.coordination.findExactTrace(tx, { school_id: source.school_id, source_domain: 'gate', source_record_id: source.id,
      event_type: previous.event_type, source_revision: previous.source_revision, message_id: previous.message_id });
    if (!trace || trace.message_id !== previous.message_id || trace.event_id !== previous.event_id) throw new ConflictException('The exact visit question delivery evidence is unavailable.');
    if (!trace.message_open) return;
    if (response) await this.coordination.recordRecipientResponse(tx, { school_id: source.school_id, message_id: previous.message_id, correlation_id: source.id,
      recipient: { agent_kind: 'human', user_id: user.id }, actor: { agent_kind: 'human', user_id: user.id }, expected_source_record_id: source.id,
      expected_source_revision: previous.source_revision, source_outbox_event_id: result.outbox_id, code: 'visit_question_answered',
      explanation: 'The exact campus question owner recorded the native answer.', response: { visit_id: source.visit_id, question_id: source.id },
      occurred_at: source.at ?? executionNow().toISOString(), idempotency_key: `visit-question-response:${command.command_id}` });
    else await this.coordination.supersedeDomainMessage(tx, { school_id: source.school_id, command_id: command.command_id,
      message_id: previous.message_id, previous_event_id: previous.event_id, resulting_event_id: result.event_id, required_capability: capability,
      occurred_at: source.at ?? executionNow().toISOString(), idempotency_key: `visit-question-supersede:${command.command_id}` });
  }
  async complete(tx: Tx, user: AuthUser, source: VisitSharingSource, data: VisitSharingEvent, command: PreparedDomainCommand, outbox: string,
    audience: string[]) {
    const metadata = { visit_id: data.visit_id, share_id: data.share_id, share_root_id: data.root_id,
      ...(data.question_id ? { question_id: data.question_id } : {}), revision: data.revision, action: data.action };
    await this.gateway.completeDomainCommand(tx, { school_id: source.school_id, command_id: command.command_id, terminal_state: 'accepted',
      code: 'visit_sharing_accepted', explanation: 'This exact shared visit operation was saved. It does not record admission, presence or completed work.',
      resulting_revision: data.revision, domain_event_id: outbox, metadata, completed_at: executionNow().toISOString() });
    await tx.insertInto('event_outbox').values({ school_id: source.school_id, event_type: 'gate.visit_shared.updated', aggregate_type: 'gate_visit_shared',
      aggregate_id: source.visit_id, audience_user_ids: [...new Set(audience)], payload: { ...data, source_command_id: command.command_id, refresh: ['gate-visits', 'workspace', 'attention'] },
      idempotency_key: `gate-visit-sharing-refresh:${command.command_id}`, created_at: executionNow(), notification_user_ids: [], notification_payload: null }).execute();
    return metadata;
  }
}
