import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { sql, type Transaction } from 'kysely';
import type { Database } from '../database/types.js';
import { DatabaseService } from '../database/database.service.js';
import type { AuthenticatedRequest, AuthUser } from '../common/request.js';
import { executionNow } from '../campus-model-core/execution-time.runtime.js';
import { HUMAN_AGENT_IDENTITY_PORT, type HumanAgentIdentityPort } from '../campus-model-core/human-agent-identity.port.js';
import { COORDINATION_CONFIGURATION_PORT, coordinationConfigurationHash, type CoordinationConfigurationPort,
  type CoordinationRouteContent } from '../campus-model-core/coordination-configuration.port.js';
import { DOMAIN_COMMAND_GATEWAY_PORT, type DomainCommandGatewayPort } from '../campus-model-core/domain-command-gateway.port.js';
import { DOMAIN_EVENT_JOURNAL_PORT, type DomainEventJournalPort } from '../campus-model-core/domain-event-journal.port.js';
import { invigilationInvitationApprovalSchema, type InvigilationInvitationPolicyView } from './invigilation-invitation-policy.contracts.js';

type Tx = Transaction<Database>;
type Version = { id: string; revision: number; enabled: boolean; response_due_minutes: number; expires_after_minutes: number;
  approved_by: string; approved_at: Date; approval_note: string; approver_name: string };

@Injectable()
export class InvigilationInvitationPolicyService {
  constructor(private readonly db: DatabaseService,
    @Inject(HUMAN_AGENT_IDENTITY_PORT) private readonly identities: HumanAgentIdentityPort,
    @Inject(COORDINATION_CONFIGURATION_PORT) private readonly configurations: CoordinationConfigurationPort,
    @Inject(DOMAIN_COMMAND_GATEWAY_PORT) private readonly commands: DomainCommandGatewayPort,
    @Inject(DOMAIN_EVENT_JOURNAL_PORT) private readonly journal: DomainEventJournalPort) {}

  private async administrator(tx: Tx, user: AuthUser, schoolId: string) {
    if (user.active_school_id && user.active_school_id !== schoolId) throw new ForbiddenException('Switch to this institution before configuring its invitations.');
    const membership = (await sql<{ id: string }>`SELECT membership.id FROM school_memberships membership
      JOIN users account ON account.id=membership.user_id AND account.is_active
      WHERE membership.school_id=${schoolId}::uuid AND membership.user_id=${user.id}::uuid
        AND membership.role='admin' AND membership.is_active FOR SHARE OF membership,account`.execute(tx)).rows[0];
    if (!membership) throw new ForbiddenException('Only a current institution administrator can approve invitation rules.');
    const actor = await this.identities.resolveAccountEndpoint(tx, { school_id: schoolId, user_id: user.id, at: executionNow().toISOString() });
    if (!actor.acting) throw new ForbiddenException('A current person and active account are required to approve invitation rules.');
    return membership;
  }

  private async eligible(tx: Tx, schoolId: string) {
    const people = await this.identities.listActingPeople(tx, { school_id: schoolId, at: executionNow().toISOString() });
    const rows = (await sql<{ user_id: string; person_id: string; designation: string | null }>`SELECT DISTINCT membership.user_id,selected.person_id,profile.designation
      FROM jsonb_to_recordset(${JSON.stringify(people)}::jsonb) selected(person_id uuid,user_id uuid)
      JOIN school_memberships membership ON membership.school_id=${schoolId}::uuid AND membership.user_id=selected.user_id
      JOIN users account ON account.id=membership.user_id AND account.is_active
      LEFT JOIN staff_profiles profile ON profile.school_id=membership.school_id AND profile.user_id=membership.user_id AND profile.status='active'
      WHERE membership.school_id=${schoolId}::uuid AND membership.is_active AND membership.role IN ('admin','staff')
        AND campus_model_account_person_is_active(${schoolId}::uuid,selected.user_id,selected.person_id,${executionNow()}::timestamptz)`.execute(tx)).rows;
    const eligible = [] as InvigilationInvitationPolicyView['eligible_recipients'];
    for (const person of people) {
      const member = rows.find(row => row.user_id === person.user_id);
      if (!member) continue;
      if (member.person_id === person.person_id) eligible.push({ person_id: person.person_id, user_id: person.user_id,
        name: person.label, designation: member.designation });
    }
    return eligible.sort((left, right) => left.name.localeCompare(right.name) || left.person_id.localeCompare(right.person_id));
  }

  private async current(tx: Tx, schoolId: string) {
    return (await sql<Version>`SELECT version.*,concat_ws(' ',account.first_name,account.last_name) AS approver_name
      FROM assessment_invigilation_policy_current current JOIN assessment_invigilation_policy_versions version
        ON version.id=current.policy_version_id AND version.school_id=current.school_id
      JOIN users account ON account.id=version.approved_by WHERE current.school_id=${schoolId}::uuid`.execute(tx)).rows[0];
  }

  private async view(tx: Tx, schoolId: string): Promise<InvigilationInvitationPolicyView> {
    const version = await this.current(tx, schoolId), eligible = await this.eligible(tx, schoolId);
    const selected = version ? (await sql<{ person_id: string }>`SELECT person_id FROM assessment_invigilation_policy_recipients
      WHERE school_id=${schoolId}::uuid AND policy_version_id=${version.id}::uuid ORDER BY person_id`.execute(tx)).rows.map(row => row.person_id) : [];
    const active = new Set(eligible.map(person => person.person_id)), missing = selected.filter(person => !active.has(person)).length;
    return { school_id: schoolId, policy: { state: !version ? 'unconfigured' : version.enabled ? 'enabled' : 'disabled',
      revision: version?.revision ?? 0, enabled: version?.enabled ?? false, recipient_person_ids: selected,
      response_due_minutes: version?.response_due_minutes ?? null, expires_after_minutes: version?.expires_after_minutes ?? null,
      approved_at: version ? new Date(version.approved_at).toISOString() : null,
      approved_by: version ? { id: version.approved_by, name: version.approver_name } : null, approval_note: version?.approval_note ?? null },
      eligible_recipients: eligible, readiness: { can_create_invitations: Boolean(version?.enabled && selected.length > missing), missing_recipient_count: missing },
      capabilities: { can_approve: true } };
  }

  async workspace(user: AuthUser, schoolId: string) {
    return this.db.transaction().execute(async tx => { await this.administrator(tx, user, schoolId); return this.view(tx, schoolId); });
  }

  async approve(req: AuthenticatedRequest, schoolId: string, body: unknown): Promise<InvigilationInvitationPolicyView> {
    const input = invigilationInvitationApprovalSchema.parse(body);
    const requestHash = createHash('sha256').update(JSON.stringify({ ...input, recipient_person_ids: [...input.recipient_person_ids].sort() })).digest('hex');
    return this.db.transaction().execute(async tx => {
      const membership = await this.administrator(tx, req.authUser, schoolId);
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`invigilation-policy:${schoolId}`},0))`.execute(tx);
      const replay = (await sql<{ request_hash: string; result_body: InvigilationInvitationPolicyView }>`SELECT request_hash,result_body
        FROM assessment_invigilation_policy_commands WHERE school_id=${schoolId}::uuid AND actor_id=${req.authUser.id}::uuid
          AND idempotency_key=${input.idempotency_key}`.execute(tx)).rows[0];
      if (replay) {
        if (replay.request_hash !== requestHash) throw new ConflictException('This approval key was already used for different rules.');
        return replay.result_body;
      }
      const previous = await this.current(tx, schoolId), currentRevision = previous?.revision ?? 0;
      if (currentRevision !== input.expected_revision) throw new ConflictException('Invitation rules changed. Refresh before approving.');
      const eligible = await this.eligible(tx, schoolId), selected = input.recipient_person_ids.map(personId => eligible.find(person => person.person_id === personId));
      if (selected.some(person => !person)) throw new BadRequestException('Choose only currently eligible people with active institution accounts.');
      const id = randomUUID(), revision = currentRevision + 1, at = executionNow().toISOString();
      const ruleRef = `assessment-invigilation-policy:${id}:${revision}`;
      const route: CoordinationRouteContent = { school_id: schoolId, actor_user_id: req.authUser.id,
        configuration_key: 'invigilation_invitations', source_domain: 'assessments', source_record_id: id, source_revision: revision,
        operating_rule_ref: ruleRef, effective_from: at, enabled: input.enabled, behaviour_key: 'assessment_invigilation_offer_routing', behaviour_schema_version: 1,
        behaviour_configuration: { workflow: 'assessment_invigilation_offer_routing', recipient_strategy: 'administrator_selected',
          response_outcomes: { accepted: 'readiness_recheck', declined: 'administrator_review', expired: 'administrator_review' } },
        subscription: { source_domain: 'assessments', event_type: 'assessment.invigilation.offered', reaction_kind: 'assessment_invigilation_offer',
          message_kind: 'offer', selector_key: 'assessment_invigilation_recipient', required_capability: `assessment_invigilation:respond:${id}`,
          scope_mode: 'institution', min_recipients: 1, max_recipients: 1, message_schema_version: 1,
          response_due_after_seconds: input.response_due_minutes * 60, expires_after_seconds: input.expires_after_minutes * 60,
          max_attempts: 1, retry_after_seconds: null, priority: 8 },
        recipients: selected.map(person => ({ person_id: person!.person_id, user_id: person!.user_id })), approval_note: input.approval_note };
      const configurationHash = coordinationConfigurationHash(route);
      const safe = { configuration_key: 'invigilation_invitations', source_record_id: id, source_revision: revision,
        configuration_hash: configurationHash, enabled: input.enabled, recipient_count: selected.length };
      const prepare = (phase: 'approve' | 'activate', causation: string | null) => this.commands.prepareDomainCommand(tx, {
        school_id: schoolId, actor_user_id: req.authUser.id, command_type: `assessments.coordination.configure.${phase}`,
        handler_key: 'assessments.coordination.configure', handler_version: 1, source_domain: 'assessments',
        target: { kind: 'operating_rule', domain: 'assessments', domain_id: `${schoolId}:invigilation_invitations`,
          label: 'Invigilation invitation rules', lifecycle_state: 'active', source_revision: revision, metadata: {} },
        current_revision: currentRevision, expected_revision: input.expected_revision, capability: 'assessments.manage',
        purpose: `invigilation_policy_${phase}`, requested_at: at, correlation_id: req.requestId, causation_id: causation,
        idempotency_key: `invigilation-policy:${req.authUser.id}:${input.idempotency_key}:${phase}`, operating_rule_version_ref: ruleRef,
        configuration_refs: [{ kind: 'domain_configuration', ref: id, version: String(revision) }],
        authority_attestation: { evaluator_domain: 'assessments', decision: 'allowed', reason_codes: ['current_institution_administrator'],
          authority_source_refs: [{ kind: 'school_membership', id: membership.id, school_id: schoolId, user_id: req.authUser.id }],
          operating_rule_refs: [{ ref: ruleRef, configuration_hash: configurationHash }], valid_until: null }, safe_context: safe });
      const approval = await prepare('approve', null);
      if (approval.status !== 'ready') throw new ConflictException('The approval receipt is incomplete. Refresh before trying again.');
      const emit = async (phase: 'approved' | 'activated', causation: string | null) => {
        const eventType = `assessment.invigilation_policy.${phase}`;
        const outbox = (await sql<{ id: string }>`INSERT INTO event_outbox(school_id,event_type,aggregate_type,aggregate_id,audience_user_ids,
          payload,idempotency_key) VALUES(${schoolId}::uuid,${eventType},'assessment_invigilation_policy',${id}::uuid,${[req.authUser.id]}::uuid[],
            ${JSON.stringify({ policy_version_id: id, revision, enabled: input.enabled, refresh: ['operating-rules', 'assessments', 'principal.get-started'] })}::jsonb,
            ${`invigilation-policy:${id}:${phase}`}) RETURNING id`.execute(tx)).rows[0]!;
        const event = await this.journal.recordAcceptedEvent(tx, { school_id: schoolId, source_outbox_event_id: outbox.id, event_type: eventType,
          subject: { kind: 'operating_rule', domain: 'assessments', domain_id: id, label: 'Invigilation invitation rules',
            lifecycle_state: input.enabled ? 'active' : 'inactive', source_revision: revision, metadata: {} },
          context: null, actor_user_id: req.authUser.id, audience_user_ids: [req.authUser.id], occurred_at: at,
          effective_from: at, effective_until: null, source_domain: 'assessments', source_record_id: id,
          source_revision: revision, correlation_id: req.requestId, causation_event_id: causation,
          idempotency_key: `invigilation-policy:${id}:${phase}`, payload: { ...safe, approval_note: input.approval_note } });
        return { outbox_id: outbox.id, event_id: event.event_id };
      };
      const approvedEvent = await emit('approved', null);
      await this.commands.completeDomainCommand(tx, { school_id: schoolId, command_id: approval.command_id, terminal_state: 'accepted',
        code: 'invigilation_policy_approved', explanation: 'The administrator approved this exact invitation rule version.',
        resulting_revision: revision, domain_event_id: approvedEvent.outbox_id, metadata: safe, completed_at: at });
      const activation = await prepare('activate', approval.command_id);
      if (activation.status !== 'ready') throw new ConflictException('The activation receipt is incomplete. Refresh before trying again.');
      const receipt = await this.configurations.configureRoute(tx, { ...route, configuration_hash: configurationHash,
        approval_command_id: approval.command_id, activation_command_id: activation.command_id });
      await sql`INSERT INTO assessment_invigilation_policy_versions(id,school_id,revision,enabled,response_due_minutes,expires_after_minutes,
        approved_by,approved_at,approval_note,configuration_hash,core_configuration_id)
        VALUES(${id}::uuid,${schoolId}::uuid,${revision},${input.enabled},${input.response_due_minutes},${input.expires_after_minutes},
          ${req.authUser.id}::uuid,${at}::timestamptz,${input.approval_note},${configurationHash},${receipt.id}::uuid)`.execute(tx);
      for (const person of selected) await sql`INSERT INTO assessment_invigilation_policy_recipients(school_id,policy_version_id,person_id,user_id)
        VALUES(${schoolId}::uuid,${id}::uuid,${person!.person_id}::uuid,${person!.user_id}::uuid)`.execute(tx);
      await sql`INSERT INTO assessment_invigilation_policy_current(school_id,policy_version_id,revision) VALUES(${schoolId}::uuid,${id}::uuid,${revision})
        ON CONFLICT(school_id) DO UPDATE SET policy_version_id=EXCLUDED.policy_version_id,revision=EXCLUDED.revision`.execute(tx);
      const activatedEvent = await emit('activated', approvedEvent.event_id);
      await this.commands.completeDomainCommand(tx, { school_id: schoolId, command_id: activation.command_id, terminal_state: 'accepted',
        code: input.enabled ? 'invigilation_policy_activated' : 'invigilation_policy_disabled',
        explanation: input.enabled ? 'Only explicitly selected recipients may receive and answer invigilation invitations.' : 'Invigilation invitation routing was explicitly disabled.',
        resulting_revision: revision, domain_event_id: activatedEvent.outbox_id, metadata: { ...safe, configuration_receipt_id: receipt.id }, completed_at: at });
      await tx.insertInto('audit_events').values({ school_id: schoolId, actor_id: req.authUser.id, action: 'assessment.invigilation_policy.approved',
        target_type: 'assessment_invigilation_policy', target_id: id, request_id: req.requestId, ip_hash: null,
        metadata: { previous_revision: currentRevision, revision, enabled: input.enabled, configuration_hash: configurationHash,
          recipient_person_ids: [...input.recipient_person_ids].sort(), approval_note: input.approval_note,
          approval_command_id: approval.command_id, activation_command_id: activation.command_id } }).execute();
      const result = await this.view(tx, schoolId);
      await sql`INSERT INTO assessment_invigilation_policy_commands(school_id,actor_id,idempotency_key,request_hash,policy_version_id,result_body)
        VALUES(${schoolId}::uuid,${req.authUser.id}::uuid,${input.idempotency_key},${requestHash},${id}::uuid,${JSON.stringify(result)}::jsonb)`.execute(tx);
      return result;
    });
  }
}
