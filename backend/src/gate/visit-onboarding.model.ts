import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Transaction } from 'kysely';
import type { Database } from '../database/types.js';
import type { AuthUser } from '../common/request.js';
import { DOMAIN_COMMAND_GATEWAY_PORT, type DomainCommandGatewayPort, type PreparedDomainCommand } from '../campus-model-core/domain-command-gateway.port.js';
import { DOMAIN_COMMAND_RECEIPT_READ_PORT, type DomainCommandReceiptReadPort } from '../campus-model-core/domain-command-receipt-read.port.js';
import { DOMAIN_EVENT_JOURNAL_PORT, type DomainEventJournalPort } from '../campus-model-core/domain-event-journal.port.js';
import { executionNow } from '../campus-model-core/execution-time.runtime.js';
type Tx = Transaction<Database>;
export const onboardingHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export interface OnboardingSource { school: string; visit: string; id: string; recordId: string; revision: number; action: 'issue' | 'revoke' | 'joined' }
@Injectable()
export class VisitOnboardingModel {
  constructor(@Inject(DOMAIN_COMMAND_GATEWAY_PORT) private readonly gateway: DomainCommandGatewayPort,
    @Inject(DOMAIN_COMMAND_RECEIPT_READ_PORT) private readonly receipts: DomainCommandReceiptReadPort,
    @Inject(DOMAIN_EVENT_JOURNAL_PORT) private readonly journal: DomainEventJournalPort) {}
  retained(tx: Tx, user: AuthUser, school: string, command: string) {
    return this.receipts.readDomainCommandReceipt(tx, { school_id: school, actor_user_id: user.id, source_domain: 'gate',
      handler_key: 'gate.visit-onboarding.v1', handler_version: 1, idempotency_key: `visit-onboarding:${user.id}:${command}` });
  }
  async prepare(tx: Tx, user: AuthUser, source: OnboardingSource, command: string, commitment: unknown) {
    const hash = onboardingHash(commitment), retained = await this.retained(tx, user, source.school, command);
    if (retained) {
      if (retained.target.domain_id !== source.id || retained.command_type !== `gate.visit_onboarding.${source.action}`
        || retained.safe_context.payload_hash !== hash) throw new ConflictException('This command belongs to a different visit action.');
      if (retained.state !== 'completed' || retained.receipt.terminal_state !== 'accepted') throw new ConflictException('This exact visit action is not confirmed. Inspect its receipt before another action.');
      return { replay: true as const, receipt: retained.receipt.metadata };
    }
    const at = executionNow().toISOString(), result = await this.gateway.prepareDomainCommand(tx, {
      school_id: source.school, actor_user_id: user.id, command_type: `gate.visit_onboarding.${source.action}`, source_domain: 'gate',
      handler_key: 'gate.visit-onboarding.v1', handler_version: 1,
      target: { kind: source.action === 'joined' ? 'gate_visit_registration' : 'gate_visit_onboarding_link', domain: 'gate', domain_id: source.id,
        label: source.action === 'joined' ? 'Visitor self-registration' : 'Visit registration link', lifecycle_state: 'active', source_revision: Math.max(1, source.revision), metadata: {} },
      current_revision: source.revision, expected_revision: source.revision, capability: source.action === 'joined' ? 'gate.visit.self.register' : 'gate.manage',
      purpose: 'visit_scoped_self_registration', requested_at: at, correlation_id: source.id, causation_id: null,
      idempotency_key: `visit-onboarding:${user.id}:${command}`, operating_rule_version_ref: null, configuration_refs: [],
      authority_attestation: { evaluator_domain: 'gate', decision: 'allowed', reason_codes: [source.action === 'joined' ? 'verified_authenticated_self_claim_current_link' : 'current_explicit_gate_issuer'],
        authority_source_refs: [{ school_id: source.school, visit_id: source.visit, source_id: source.recordId }], operating_rule_refs: [], valid_until: null },
      safe_context: { visit_id: source.visit, actor_user_id: user.id, source_id: source.recordId, payload_hash: hash },
    });
    if (result.status !== 'ready') throw new ConflictException('Inspect the original visit command before another action.');
    return { replay: false as const, command: result };
  }
  async complete(tx: Tx, user: AuthUser, source: OnboardingSource, command: PreparedDomainCommand) {
    const at = executionNow().toISOString(), revision = source.revision + 1,
      payload = { visit_id: source.visit, source_id: source.recordId, revision, action: source.action, source_command_id: command.command_id },
      type = `gate.visit_onboarding.${source.action}`;
    const event = await tx.insertInto('event_outbox').values({ school_id: source.school, event_type: type,
      aggregate_type: 'gate_visit_onboarding_event', aggregate_id: source.id, audience_user_ids: [], notification_user_ids: [], notification_payload: null,
      payload, idempotency_key: `visit-onboarding-event:${command.command_id}`, created_at: new Date(at) }).returning('id').executeTakeFirstOrThrow();
    await this.journal.recordAcceptedEvent(tx, { school_id: source.school, source_outbox_event_id: event.id, event_type: type,
      subject: { kind: source.action === 'joined' ? 'gate_visit_registration' : 'gate_visit_onboarding_link', domain: 'gate', domain_id: source.id,
        label: 'Visit onboarding', lifecycle_state: 'active', source_revision: revision, metadata: {} },
      context: null, actor_user_id: user.id, audience_user_ids: [], occurred_at: at, effective_from: at, effective_until: null,
      source_domain: 'gate', source_record_id: source.id, source_revision: revision, correlation_id: source.id, causation_event_id: null,
      idempotency_key: `visit-onboarding-journal:${command.command_id}`, payload });
    await this.gateway.completeDomainCommand(tx, { school_id: source.school, command_id: command.command_id, terminal_state: 'accepted',
      code: 'visit_onboarding_accepted', explanation: 'The exact visit registration action was saved. No entry, presence or organiser conversation authority was granted.',
      resulting_revision: revision, domain_event_id: event.id, metadata: { source_id: source.recordId, visit_id: source.visit, revision, action: source.action }, completed_at: at });
    return event.id;
  }
}
