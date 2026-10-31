import 'reflect-metadata';
import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, type CompiledQuery, type DatabaseConnection, type QueryResult } from 'kysely';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/common/request.js';
import type { DomainCommandGatewayPort } from '../src/campus-model-core/domain-command-gateway.port.js';
import type { DomainEventJournalPort } from '../src/campus-model-core/domain-event-journal.port.js';
import type { ActingHumanAgentIdentity, HumanAgentIdentityPort, HumanAgentIdentityResolution } from '../src/campus-model-core/human-agent-identity.port.js';
import type { DatabaseService } from '../src/database/database.service.js';
import type { Database } from '../src/database/types.js';
import { authorizeExternalInvitation } from '../src/facilities/facilities-external.access.js';
import { VisitOnboardingIdentity } from '../src/gate/visit-onboarding-identity.js';
import { PersonAccountInvitationsService } from '../src/operations/person-account-invitations.service.js';

const school = '10000000-0000-4000-8000-000000000001';
const userId = '20000000-0000-4000-8000-000000000001';
const person = '30000000-0000-4000-8000-000000000001';
const source = '40000000-0000-4000-8000-000000000001';
const assignment = '50000000-0000-4000-8000-000000000001';
const at = new Date('2026-10-30T12:00:00Z');
const account: AuthUser & { onboarding_pending: boolean } = {
  id: userId, username: 'member.test', email: 'visitor@example.test', first_name: 'Visitor', last_name: 'Person',
  role: 'member', is_active: true, email_verified_at: at, onboarding_pending: false,
};
const actor: ActingHumanAgentIdentity = {
  acting: true, school_id: school, user_id: userId, person_id: person, label: 'Visitor Person',
  agent_id: '60000000-0000-4000-8000-000000000001', endpoint_id: '70000000-0000-4000-8000-000000000001',
  effective_from: '2026-10-29T00:00:00Z', effective_until: null,
};
const invitation = { school_id: school, repair_id: source, assignment_id: assignment, person_id: person, actor_user_id: userId };
const sourceRow = { id: assignment, person_id: person, coordinator_person_id: person, person_revision: 3,
  starts_at: new Date('2026-10-31T00:00:00Z'), ends_at: new Date('2026-11-01T00:00:00Z') };

function database(respond: (query: CompiledQuery) => unknown[]) {
  const queries: CompiledQuery[] = [];
  class Driver extends DummyDriver {
    override acquireConnection(): Promise<DatabaseConnection> {
      return Promise.resolve({
        executeQuery: <R>(query: CompiledQuery): Promise<QueryResult<R>> => {
          queries.push(query);
          return Promise.resolve({ rows: respond(query) as R[] });
        },
        streamQuery: () => { throw new Error('Streaming is outside this identity fixture.'); },
      });
    }
  }
  const db = new Kysely<Database>({ dialect: {
    createAdapter: () => new PostgresAdapter(), createDriver: () => new Driver(),
    createIntrospector: value => new PostgresIntrospector(value), createQueryCompiler: () => new PostgresQueryCompiler(),
  } });
  return { db, queries };
}

function identity(resolution: HumanAgentIdentityResolution) {
  const resolveAccountEndpoint = vi.fn<HumanAgentIdentityPort['resolveAccountEndpoint']>().mockResolvedValue(resolution);
  const linkAccountEndpoint = vi.fn<HumanAgentIdentityPort['linkAccountEndpoint']>();
  return { port: { resolveAccountEndpoint, linkAccountEndpoint } as unknown as HumanAgentIdentityPort,
    resolveAccountEndpoint, linkAccountEndpoint };
}

afterEach(() => { vi.useRealTimers(); });

describe('Identity consumer boundaries', () => {
  it('uses the same transaction and exact instant for Facilities identity and native source authorization', async () => {
    vi.useFakeTimers(); vi.setSystemTime(at);
    const f = database(() => [sourceRow]), identities = identity(actor);
    identities.resolveAccountEndpoint.mockImplementation(() => {
      vi.setSystemTime(new Date(at.getTime() + 60_000));
      return Promise.resolve(actor);
    });
    try {
      await f.db.transaction().execute(async tx => {
        await expect(authorizeExternalInvitation(tx, identities.port, invitation)).resolves.toMatchObject({
          repair_id: source, assignment_id: assignment, person_id: person, person_revision: 3,
        });
        expect(identities.resolveAccountEndpoint).toHaveBeenCalledExactlyOnceWith(tx, {
          school_id: school, user_id: userId, at: at.toISOString(),
        });
      });
      expect(f.queries).toHaveLength(1);
      const query = f.queries[0]!;
      expect(query.parameters).toEqual(expect.arrayContaining([school, source, assignment, person, userId]));
      const sourceInstants = query.parameters.filter((value): value is Date => value instanceof Date);
      expect(sourceInstants.length).toBeGreaterThan(0);
      expect(sourceInstants.every(value => value.getTime() === at.getTime())).toBe(true);
    } finally { await f.db.destroy(); }
  });

  it('does not let current app identity bypass a refused Facilities assignment or coordinator check', async () => {
    const f = database(() => []), identities = identity(actor);
    try {
      await expect(f.db.transaction().execute(tx => authorizeExternalInvitation(tx, identities.port, invitation)))
        .rejects.toThrow(/current repair coordinator and an unexpired assignment/);
      expect(identities.resolveAccountEndpoint).toHaveBeenCalledOnce();
      expect(f.queries).toHaveLength(1);
    } finally { await f.db.destroy(); }
  });

  it.each(['account_not_linked', 'endpoint_inactive', 'account_inactive', 'membership_inactive', 'profile_unlinked'] as const)('refuses Facilities invitations for %s before consulting the source', async reason => {
      const f = database(() => [sourceRow]), identities = identity({ acting: false, school_id: school,
        user_id: userId, person_id: person, agent_id: actor.agent_id, reason });
      try {
        await expect(f.db.transaction().execute(tx => authorizeExternalInvitation(tx, identities.port, invitation)))
          .rejects.toThrow(/current repair coordinator and an unexpired assignment/);
        expect(f.queries).toEqual([]);
      } finally { await f.db.destroy(); }
    });

  it('passes the People-owned identity port into Facilities invitation authorization', async () => {
    const f = database(() => []), identities = identity(actor);
    const service = new PersonAccountInvitationsService({} as DatabaseService, identities.port,
      {} as DomainCommandGatewayPort, {} as DomainEventJournalPort);
    try {
      await expect(f.db.transaction().execute(tx => service.assertWorkIssuer(tx, {
        school_id: school, created_by: userId, person_id: person, access_scope: 'assigned_work',
        work_source_kind: 'facility_repair', work_source_id: source, work_access_id: assignment,
      }))).rejects.toThrow(/current repair coordinator and an unexpired assignment/);
      expect(identities.resolveAccountEndpoint).toHaveBeenCalledOnce();
      expect(f.queries).toHaveLength(1);
    } finally { await f.db.destroy(); }
  });

  it.each(['endpoint_inactive', 'account_inactive', 'membership_inactive', 'profile_unlinked'] as const)('does not restore retained Visit identity reported by Core as %s', async reason => {
      const f = database(query => query.sql.includes('FROM users WHERE id=') ? [account] : []);
      const identities = identity({ acting: false, school_id: school, user_id: userId,
        person_id: person, agent_id: actor.agent_id, reason });
      const service = new VisitOnboardingIdentity(identities.port), beforeBinding = vi.fn<(personId: string) => Promise<void>>();
      try {
        await expect(f.db.transaction().execute(tx => service.joinIdentity(tx, {
          user: account, schoolId: school, sourceId: source, issuerId: userId, beforeBinding,
        }))).rejects.toThrow(/retained campus identity/);
        expect(beforeBinding).not.toHaveBeenCalled();
        expect(identities.linkAccountEndpoint).not.toHaveBeenCalled();
        expect(f.queries.some(query => /^(?:INSERT|UPDATE|DELETE)\b/.test(query.sql))).toBe(false);
      } finally { await f.db.destroy(); }
    });

  it('retains the native history veto for an account with no Core endpoint history', async () => {
    const f = database(query => query.sql.includes('FROM users WHERE id=') ? [account]
      : query.sql.includes(') AS retained') ? [{ retained: true }] : []);
    const identities = identity({ acting: false, school_id: school, user_id: userId,
      person_id: null, agent_id: null, reason: 'account_not_linked' });
    const service = new VisitOnboardingIdentity(identities.port), beforeBinding = vi.fn<(personId: string) => Promise<void>>();
    try {
      await expect(f.db.transaction().execute(tx => service.joinIdentity(tx, {
        user: account, schoolId: school, sourceId: source, issuerId: userId, beforeBinding,
      }))).rejects.toThrow(/retained campus access/);
      expect(beforeBinding).not.toHaveBeenCalled();
      expect(identities.linkAccountEndpoint).not.toHaveBeenCalled();
      expect(f.queries.some(query => /^(?:INSERT|UPDATE|DELETE)\b/.test(query.sql))).toBe(false);
    } finally { await f.db.destroy(); }
  });
});
