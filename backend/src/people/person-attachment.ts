import { ConflictException, ForbiddenException } from '@nestjs/common';
import { sql, type Kysely, type Transaction } from 'kysely';
import { z } from 'zod';
import type { Database } from '../database/types.js';
import type { DomainCommandGatewayPort, PreparedDomainCommand } from '../campus-model-core/domain-command-gateway.port.js';
import type { DomainEventJournalPort } from '../campus-model-core/domain-event-journal.port.js';
import type { HumanAgentIdentityPort } from '../campus-model-core/human-agent-identity.port.js';
import { executionNow } from '../campus-model-core/execution-time.runtime.js';
import type { EnrollmentRosterTarget } from '../attendance/academic-enrollment-roster.source.js';

export const existingPersonReferenceSchema = z.object({ id: z.string().uuid(), expected_revision: z.number().int().positive() }).strict();
export type ExistingPersonReference = z.infer<typeof existingPersonReferenceSchema>;
export interface AttachmentPerson { id: string; first_name: string; last_name: string; revision: number; contact_email: string; contact_phone: string }
export interface AttachmentModelPorts { gateway: DomainCommandGatewayPort; journal: DomainEventJournalPort; identity: HumanAgentIdentityPort }

/** Explicit identity review, never a contact/name match or an access grant. */
export async function lockAttachmentPerson(tx: Kysely<Database> | Transaction<Database>, schoolId: string, reference: ExistingPersonReference, lock = true) {
  const person = (await sql<AttachmentPerson>`SELECT id,first_name,last_name,revision,contact_email,contact_phone
    FROM school_people WHERE school_id=${schoolId}::uuid AND id=${reference.id}::uuid AND retired_at IS NULL ${lock ? sql`FOR UPDATE` : sql``}`.execute(tx)).rows[0];
  if (!person) throw new ConflictException('Choose an existing active person from this institution.');
  if (person.revision !== reference.expected_revision) throw new ConflictException('This person changed. Refresh their profile and review the attachment again.');
  return person;
}

export async function preparePersonAttachment(tx: Transaction<Database>, ports: AttachmentModelPorts | undefined, input: {
  school_id: string; actor_id: string; person: AttachmentPerson; command_type: string; source_domain: string;
  idempotency_key: string; correlation_id: string; permission: string;
  request_hash: string; source_ref: string; source_revision: number; roster_targets?: EnrollmentRosterTarget[];
}) {
  if (!ports) throw new ConflictException('The reviewed person attachment path is unavailable.');
  const actor = await ports.identity.resolveAccountEndpoint(tx, { school_id: input.school_id, user_id: input.actor_id, at: executionNow().toISOString() });
  if (!actor.acting) throw new ForbiddenException('Current campus app access is required to attach this record.');
  const prepared = await ports.gateway.prepareDomainCommand(tx, { school_id: input.school_id, actor_user_id: input.actor_id,
    command_type: input.command_type, handler_key: 'people.person_attachment', handler_version: 1, source_domain: input.source_domain,
    target: { kind: 'person', domain: 'people', domain_id: input.person.id, label: `${input.person.first_name} ${input.person.last_name}`.trim(),
      lifecycle_state: 'active', source_revision: input.person.revision, metadata: {} },
    current_revision: input.person.revision, expected_revision: input.person.revision, capability: 'people:manage',
    purpose: 'attach_existing_person_record', requested_at: executionNow().toISOString(), correlation_id: input.correlation_id,
    causation_id: null, idempotency_key: input.idempotency_key, operating_rule_version_ref: null, configuration_refs: [],
    authority_attestation: { evaluator_domain: input.source_domain, decision: 'allowed', reason_codes: ['current_owning_record_management_permission'],
      authority_source_refs: [{ school_id: input.school_id, permission: input.permission }], operating_rule_refs: [], valid_until: null },
    safe_context: { person_id: input.person.id, account_access_changed: false, request_hash: input.request_hash,
      source_operation: input.command_type, source_ref: input.source_ref, source_revision: input.source_revision,
      ...(input.roster_targets ? { enrollment_roster_targets: input.roster_targets } : {}) } });
  if (prepared.status !== 'ready') throw new ConflictException('This attachment already completed. Refresh the profile.');
  return prepared;
}

export async function completePersonAttachment(tx: Transaction<Database>, ports: AttachmentModelPorts, input: {
  school_id: string; actor_id: string; person: AttachmentPerson; prepared: PreparedDomainCommand; outbox_event_id: string;
  source_domain: string; source_record_id: string; correlation_id: string; idempotency_key: string;
}) {
  const now = executionNow().toISOString();
  const event = await ports.journal.recordAcceptedEvent(tx, { school_id: input.school_id, source_outbox_event_id: input.outbox_event_id,
    event_type: 'people.updated', subject: { kind: 'person', domain: 'people', domain_id: input.person.id,
      label: `${input.person.first_name} ${input.person.last_name}`.trim(), lifecycle_state: 'active', source_revision: input.person.revision, metadata: {} },
    context: null, actor_user_id: input.actor_id, audience_user_ids: [], occurred_at: now, effective_from: now, effective_until: null,
    source_domain: input.source_domain, source_record_id: input.source_record_id, source_revision: 1,
    correlation_id: input.correlation_id, causation_event_id: null, idempotency_key: input.idempotency_key,
    payload: { action: 'existing_person_record_attached', person_id: input.person.id, account_access_changed: false } });
  await ports.gateway.completeDomainCommand(tx, { school_id: input.school_id, command_id: input.prepared.command_id,
    terminal_state: 'accepted', code: 'existing_person_record_attached', explanation: 'The existing campus person was reused; no account or permission was created.',
    resulting_revision: input.person.revision, domain_event_id: input.outbox_event_id,
    metadata: { model_event_id: event.event_id, person_id: input.person.id }, completed_at: now });
}

/** One reviewed owning intake/import can create several identities atomically. */
export async function prepareAttachmentBatch(tx: Transaction<Database>, ports: AttachmentModelPorts, input: {
  school_id:string;actor_id:string;target_id:string;target_kind:string;label:string;revision:number;
  command_type:string;source_domain:string;key:string;correlation_id:string;request_hash:string;permission:string;roster_targets?:EnrollmentRosterTarget[];
}) {
  const actor = await ports.identity.resolveAccountEndpoint(tx,{school_id:input.school_id,user_id:input.actor_id,at:executionNow().toISOString()});
  if (!actor.acting) throw new ForbiddenException('Current campus app access is required.');
  const receipt = await ports.gateway.prepareDomainCommand(tx,{school_id:input.school_id,actor_user_id:input.actor_id,
    command_type:input.command_type,handler_key:'people.owning_intake',handler_version:1,source_domain:input.source_domain,
    target:{kind:input.target_kind,domain:input.source_domain,domain_id:input.target_id,label:input.label,lifecycle_state:'planned',source_revision:Math.max(1,input.revision),metadata:{}},
    current_revision:input.revision,expected_revision:input.revision,capability:'people:manage',purpose:'reviewed_people_intake',
    requested_at:executionNow().toISOString(),correlation_id:input.correlation_id,causation_id:null,idempotency_key:input.key,
    operating_rule_version_ref:null,configuration_refs:[],authority_attestation:{evaluator_domain:input.source_domain,decision:'allowed',
      reason_codes:['current_owning_intake_permission'],authority_source_refs:[{permission:input.permission,school_id:input.school_id}],operating_rule_refs:[],valid_until:null},
    safe_context:{request_hash:input.request_hash,source_operation:input.command_type,source_ref:input.target_id,source_revision:input.revision,
      ...(input.roster_targets?{enrollment_roster_targets:input.roster_targets}:{})}});
  if(receipt.status!=='ready')throw new ConflictException('This intake already completed. Refresh its receipt.');
  return receipt;
}

export async function registerCreatedPerson(tx: Transaction<Database>, ports: AttachmentModelPorts, input: {
  school_id:string;actor_id:string;person:{id:string;first_name:string;last_name:string;revision?:number};correlation_id:string;command_id:string;key:string;
  account_created?:boolean;
}) {
  const event = await tx.insertInto('event_outbox').values({school_id:input.school_id,event_type:'people.updated',aggregate_type:'person',
    aggregate_id:input.person.id,audience_user_ids:[input.actor_id],payload:{action:'person_identity_registered',person_id:input.person.id,refresh:['people.participants']},
    idempotency_key:input.key}).returning('id').executeTakeFirstOrThrow();
  return ports.journal.recordAcceptedEvent(tx,{school_id:input.school_id,source_outbox_event_id:event.id,event_type:'people.updated',
    subject:{kind:'person',domain:'people',domain_id:input.person.id,label:`${input.person.first_name} ${input.person.last_name}`.trim(),lifecycle_state:'active',source_revision:input.person.revision ?? 1,metadata:{}},
    context:null,actor_user_id:input.actor_id,audience_user_ids:[],occurred_at:executionNow().toISOString(),effective_from:executionNow().toISOString(),effective_until:null,
    source_domain:'people',source_record_id:input.person.id,source_revision:input.person.revision ?? 1,correlation_id:input.correlation_id,causation_event_id:null,idempotency_key:input.key,
    payload:{action:'person_identity_registered',source_command_id:input.command_id,account_created:input.account_created ?? false}});
}
