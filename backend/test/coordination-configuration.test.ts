import { randomUUID } from 'node:crypto';
import { PostgresQueryCompiler, type CompiledQuery, type OperationNode, type Transaction } from 'kysely';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../src/database/types.js';
import type { HumanAgentIdentityPort } from '../src/campus-model-core/human-agent-identity.port.js';
import { CoordinationConfigurationService } from '../src/campus-model-core/coordination-configuration.service.js';
import { coordinationConfigurationHash, coordinationRouteConfigurationSchema, type CoordinationRouteConfiguration, type CoordinationRouteContent } from '../src/campus-model-core/coordination-configuration.port.js';
import { invigilationInvitationApprovalSchema } from '../src/assessments/invigilation-invitation-policy.contracts.js';

function fixture(options: { persist?: boolean; latestRevision?: number; timing?: Pick<CoordinationRouteContent['subscription'], 'response_due_after_seconds' | 'expires_after_seconds'> } = {}) {
  const school = randomUUID(), realm = randomUUID(), actor = randomUUID(), person = randomUUID(), agent = randomUUID(), at = new Date(Date.now() - 1_000).toISOString();
  const content: CoordinationRouteContent = { school_id: school, actor_user_id: actor, configuration_key: 'test_invitations',
    source_domain: 'assessments', source_record_id: randomUUID(), source_revision: 1, operating_rule_ref: 'explicit-test-rule:1',
    effective_from: at, enabled: true, behaviour_key: 'test_invitation_routing', behaviour_schema_version: 1, behaviour_configuration: { schema_version: 1, response: 'explicit_only' },
    subscription: { source_domain: 'assessments', event_type: 'assessment.invigilation.offered', reaction_kind: 'assessment_invigilation_offer',
      message_kind: 'offer', selector_key: 'assessment_invigilation_recipient', required_capability: 'test:respond_only',
      scope_mode: 'institution', min_recipients: 1, max_recipients: 1, message_schema_version: 1,
      response_due_after_seconds: 60, expires_after_seconds: 120, ...options.timing, max_attempts: 1, retry_after_seconds: null, priority: 8 }, recipients: [{ person_id: person, user_id: actor }],
    approval_note: 'Explicit test approval, never automatic consent.' };
  const input: CoordinationRouteConfiguration = { ...content, configuration_hash: coordinationConfigurationHash(content),
    approval_command_id: randomUUID(), activation_command_id: randomUUID() };
  const commands = ['approve', 'activate'].map(phase => ({ id: phase === 'approve' ? input.approval_command_id : input.activation_command_id,
    state: phase === 'approve' ? 'accepted' : 'pending', command_type: `assessments.coordination.configure.${phase}`, actor_agent_id: agent,
    realm_id: realm, environment_namespace_id: `live:${school}`, source_domain: 'assessments', handler_key: 'assessments.coordination.configure',
    causation_id: phase === 'activate' ? input.approval_command_id : null, requested_at: new Date(at),
    operating_rule_version_ref: input.operating_rule_ref, safe_context: { configuration_hash: input.configuration_hash,
      source_record_id: input.source_record_id, source_revision: 1, configuration_key: input.configuration_key } }));
  const statements: string[] = [], queries: CompiledQuery[] = [], compiler = new PostgresQueryCompiler();
  const configurationId = randomUUID(), behaviourId = randomUUID(), subscriptionId = randomUUID();
  const executor = { transformQuery: (node: OperationNode) => node,
    compileQuery: (node: Parameters<PostgresQueryCompiler['compileQuery']>[0], queryId: Parameters<PostgresQueryCompiler['compileQuery']>[1]) => compiler.compileQuery(node, queryId),
    executeQuery: (query: CompiledQuery) => {
      statements.push(query.sql);
      queries.push(query);
      if (query.sql.includes('FROM operational_realms')) return Promise.resolve({ rows: [{ realm_id: realm, legacy_school_id: school }] });
      if (query.sql.includes('FROM execution_environment_namespaces')) return Promise.resolve({ rows: [{ found: true }] });
      if (query.sql.includes('FROM campus_model_commands')) return Promise.resolve({ rows: commands });
      if (query.sql.includes('SELECT source_revision FROM campus_model_coordination_configurations'))
        return Promise.resolve({ rows: options.latestRevision === undefined ? [] : [{ source_revision: options.latestRevision }] });
      if (options.persist) {
        if (query.sql.includes('pg_advisory_xact_lock') || query.sql.trimStart().startsWith('UPDATE ')
          || query.sql.includes('INSERT INTO campus_model_agent_authorities')) return Promise.resolve({ rows: [] });
        if (query.sql.includes('FROM campus_model_coordination_configurations')) return Promise.resolve({ rows: [] });
        if (query.sql.includes('FROM jsonb_to_recordset')) return Promise.resolve({ rows: [{ agent_id: agent, person_id: person, user_id: actor }] });
        if (query.sql.includes('COALESCE(max(version)')) return Promise.resolve({ rows: [{ value: 1 }] });
        if (query.sql.includes('INSERT INTO campus_model_behaviour_versions')) return Promise.resolve({ rows: [{ id: behaviourId }] });
        if (query.sql.includes('INSERT INTO campus_model_event_subscriptions')) return Promise.resolve({ rows: [{ id: subscriptionId }] });
        if (query.sql.includes('INSERT INTO campus_model_coordination_configurations')) return Promise.resolve({ rows: [{ id: configurationId,
          behaviour_version_id: behaviourId, subscription_id: subscriptionId, configuration_hash: input.configuration_hash }] });
      }
      throw new Error(`Unexpected query after a rejected configuration: ${query.sql}`);
    } };
  const tx = { getExecutor: () => executor } as unknown as Transaction<Database>;
  const identities = { resolveAccountEndpoint: vi.fn().mockResolvedValue({ acting: true, school_id: school, person_id: person,
    user_id: actor, agent_id: agent, label: 'Explicit person', endpoint_id: randomUUID(), effective_from: at, effective_until: null }) } as unknown as HumanAgentIdentityPort;
  return { input, content, commands, statements, queries, tx, service: new CoordinationConfigurationService(identities) };
}

describe('explicit coordination configuration safety boundary', () => {
  it.each([undefined, 7])('reads only the owning stable route revision (%s) without changing configuration', async revision => {
    const f = fixture(revision === undefined ? {} : { latestRevision: revision });
    await expect(f.service.latestRevision(f.tx, { school_id: f.content.school_id, source_domain: 'staff_operations', configuration_key: 'staff_leave_review' }))
      .resolves.toBe(revision ?? 0);
    const query = f.queries.find(item => item.sql.includes('SELECT source_revision FROM campus_model_coordination_configurations'))!;
    expect(query.parameters).toEqual([f.content.school_id, 'staff_operations', 'staff_leave_review']);
    expect(query.sql).toContain('ORDER BY source_revision DESC LIMIT 1');
    expect(f.statements.every(statement => !/^(?:INSERT|UPDATE|DELETE)/u.test(statement.trim()))).toBe(true);
  });
  it('rejects an untyped route identity before revision discovery', async () => {
    const f = fixture();
    await expect(f.service.latestRevision(f.tx, { school_id: f.content.school_id, source_domain: 'staff_operations', configuration_key: '../unrelated' })).rejects.toThrow();
    expect(f.statements).toHaveLength(0);
  });
  it.each([[null, null], [60, null], [null, 120], [60, 120]] as const)('retains explicit response timing %s / expiry %s without inventing a timer', async (response, expiry) => {
    const f = fixture({ persist: true, timing: { response_due_after_seconds: response, expires_after_seconds: expiry } });
    expect(coordinationRouteConfigurationSchema.parse(f.input).subscription).toMatchObject({ response_due_after_seconds: response, expires_after_seconds: expiry });
    await expect(f.service.configureRoute(f.tx, f.input)).resolves.toMatchObject({ configuration_hash: f.input.configuration_hash });
    const subscription = f.queries.find(query => query.sql.includes('INSERT INTO campus_model_event_subscriptions'))!;
    // The exact approved values go into the subscription and immutable snapshot.
    expect(subscription.parameters.slice(9, 11)).toEqual([response, expiry]);
    const snapshot = f.queries.find(query => query.sql.includes('INSERT INTO campus_model_coordination_configurations'))!;
    expect(JSON.parse(String(snapshot.parameters.at(-1))).subscription).toMatchObject({ response_due_after_seconds: response, expires_after_seconds: expiry });
  });
  it('requires explicit timing values and preserves all non-null bounds and ordering checks', () => {
    const f = fixture();
    for (const invalid of [{ response_due_after_seconds: undefined }, { expires_after_seconds: undefined },
      { response_due_after_seconds: 0 }, { expires_after_seconds: 0 }, { response_due_after_seconds: -1 },
      { expires_after_seconds: 1.5 }, { response_due_after_seconds: 31536001 }, { expires_after_seconds: 31536001 },
      { response_due_after_seconds: 121, expires_after_seconds: 120 }]) {
      expect(coordinationRouteConfigurationSchema.safeParse({ ...f.input, subscription: { ...f.input.subscription, ...invalid } }).success).toBe(false);
    }
    const noTimers = { ...f.content, subscription: { ...f.content.subscription, response_due_after_seconds: null, expires_after_seconds: null } };
    expect(coordinationConfigurationHash(noTimers)).not.toBe(f.input.configuration_hash);
  });
  it.each(['realm', 'namespace', 'causation', 'handler', 'source'] as const)('rejects forged %s evidence before any configuration write', async kind => {
    const f = fixture();
    if (kind === 'realm') for (const command of f.commands) command.realm_id = randomUUID();
    if (kind === 'namespace') for (const command of f.commands) command.environment_namespace_id = `scenario:${randomUUID()}:run:${randomUUID()}`;
    if (kind === 'causation') f.commands[1]!.causation_id = randomUUID();
    if (kind === 'handler') for (const command of f.commands) command.handler_key = 'unrelated.domain_handler';
    if (kind === 'source') for (const command of f.commands) command.safe_context.source_record_id = randomUUID();
    await expect(f.service.configureRoute(f.tx, f.input)).rejects.toThrow('Matching current approval and activation commands');
    expect(f.statements.every(statement => !/^(?:INSERT|UPDATE|DELETE)/u.test(statement.trim()))).toBe(true);
  });
  it('binds the actual behavior, timing and recipient snapshot, not a caller-provided hash', async () => {
    const f = fixture();
    const tampered = { ...f.input, subscription: { ...f.input.subscription, expires_after_seconds: 240 } };
    await expect(f.service.configureRoute(f.tx, tampered)).rejects.toThrow('exact route and recipient snapshot');
    expect(f.statements).toHaveLength(0);
    expect(coordinationConfigurationHash({ ...f.content, recipients: [{ person_id: randomUUID(), user_id: randomUUID() }] })).not.toBe(f.input.configuration_hash);
    expect(coordinationConfigurationHash({ ...f.content, behaviour_configuration: { response: 'automatic' } })).not.toBe(f.input.configuration_hash);
  });
  it('requires a deliberate enabled choice, an explicit recipient, meaningful review and valid timing', () => {
    const body = { expected_revision: 0, enabled: true, recipient_person_ids: [randomUUID()], response_due_minutes: 30,
      expires_after_minutes: 120, approval_note: 'Reviewed the exact recipients and windows.', idempotency_key: randomUUID() };
    expect(invigilationInvitationApprovalSchema.safeParse(body).success).toBe(true);
    for (const invalid of [{ ...body, recipient_person_ids: [] }, { ...body, expires_after_minutes: 1 },
      { ...body, approval_note: '' }, { ...body, recipient_person_ids: [body.recipient_person_ids[0], body.recipient_person_ids[0]] }]) {
      expect(invigilationInvitationApprovalSchema.safeParse(invalid).success).toBe(false);
    }
  });
});
