import 'reflect-metadata';
import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, type CompiledQuery, type DatabaseConnection, type QueryResult } from 'kysely';
import { describe, expect, it, vi } from 'vitest';
import { verifyPassword } from '../src/auth/password.js';
import { executionEnvironmentStorage } from '../src/campus-model-core/execution-time.runtime.js';
import { simulationRequestEnvironment } from '../src/database/simulation-world.service.js';
import type { Database } from '../src/database/types.js';
import type { AuthUser } from '../src/common/request.js';
import type { ActingHumanAgentIdentity, HumanAgentIdentityPort, HumanAgentIdentityResolution } from '../src/campus-model-core/human-agent-identity.port.js';
import { VisitOnboardingIdentity } from '../src/gate/visit-onboarding-identity.js';

const school = '10000000-0000-4000-8000-000000000001', userId = '20000000-0000-4000-8000-000000000001';
const person = '30000000-0000-4000-8000-000000000001', source = '40000000-0000-4000-8000-000000000001';
const issuer = '50000000-0000-4000-8000-000000000001', otherCampus = '60000000-0000-4000-8000-000000000001';
const account: AuthUser & { onboarding_pending: boolean } = { id: userId, username: 'member.test', email: 'visitor@example.test',
  first_name: 'Visitor', last_name: 'Person', role: 'member', is_active: true, email_verified_at: new Date('2026-10-30T00:00:00Z'), onboarding_pending: false };
const actor: ActingHumanAgentIdentity = { acting: true, school_id: school, user_id: userId, person_id: person, label: 'Visitor Person',
  agent_id: '70000000-0000-4000-8000-000000000001', endpoint_id: '80000000-0000-4000-8000-000000000001', effective_from: '2026-10-30T00:00:00Z', effective_until: null };
const registration = { email: ' VISITOR@EXAMPLE.TEST ', firstName: 'Visitor', lastName: 'Person', password: 'Mountain!Private8926' };

function fixture(options: { existing?: boolean; insertConflict?: boolean; account?: typeof account | null; current?: HumanAgentIdentityResolution;
  retained?: boolean; bound?: boolean; linked?: ActingHumanAgentIdentity } = {}) {
  const queries: CompiledQuery[] = [], order: string[] = [];
  class Driver extends DummyDriver {
    override acquireConnection(): Promise<DatabaseConnection> {
      return Promise.resolve({ executeQuery: <R>(query: CompiledQuery): Promise<QueryResult<R>> => {
        queries.push(query); let rows: unknown[] = [];
        if (query.sql.includes('pg_advisory_xact_lock')) { /* transaction-scoped serialization */ }
        else if (query.sql.includes('SELECT id FROM users WHERE lower(email)')) rows = options.existing ? [{ id: userId }] : [];
        else if (query.sql.includes('INSERT INTO users(')) { order.push('account'); rows = options.insertConflict ? [] : [account]; }
        else if (query.sql.includes('FROM users WHERE id=')) rows = options.account === null ? [] : [options.account ?? account];
        else if (query.sql.includes(') AS retained')) rows = [{ retained: options.retained ?? false }];
        else if (query.sql.includes('INSERT INTO school_people(')) { order.push('person'); rows = [{ id: person }]; }
        else if (query.sql.includes('INSERT INTO school_memberships(')) order.push('membership');
        else if (query.sql.includes('UPDATE school_people SET account_user_id=')) { order.push('binding'); rows = options.bound === false ? [] : [{ id: person }]; }
        else throw new Error(`Unexpected identity query: ${query.sql}`);
        return Promise.resolve({ rows: rows as R[] });
      }, streamQuery: () => { throw new Error('No streaming in an isolated identity fixture'); } });
    }
  }
  const db = new Kysely<Database>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new Driver(),
    createIntrospector: value => new PostgresIntrospector(value), createQueryCompiler: () => new PostgresQueryCompiler() } });
  const resolveAccountEndpoint = vi.fn(() => Promise.resolve(options.current ?? { acting: false as const, school_id: school, user_id: userId, person_id: null, agent_id: null, reason: 'account_not_linked' as const }));
  const linkAccountEndpoint = vi.fn(() => { order.push('endpoint'); return Promise.resolve({ ...(options.linked ?? actor), replayed: false }); });
  const identities = { resolveAccountEndpoint, linkAccountEndpoint } as unknown as HumanAgentIdentityPort;
  const service = new VisitOnboardingIdentity(identities), beforeBinding = vi.fn(() => { order.push('source'); return Promise.resolve(); });
  const join = (overrides: Partial<Parameters<typeof service.joinIdentity>[1]> = {}) => db.transaction().execute(tx => service.joinIdentity(tx,
    { user: account, schoolId: school, sourceId: source, issuerId: issuer, beforeBinding, ...overrides }));
  const register = (overrides: Partial<typeof registration> = {}) => db.transaction().execute(tx => service.registerVerifiedAccount(tx, { ...registration, ...overrides }));
  return { db, service, queries, order, identities, resolveAccountEndpoint, linkAccountEndpoint, beforeBinding, join, register };
}
const writes = (queries: CompiledQuery[]) => queries.filter(query => /^(?:INSERT|UPDATE|DELETE)\b/.test(query.sql));

describe('Verified Visit onboarding identity without implicit account authentication', () => {
  it('creates only a verified neutral account with the existing password hash policy and no session/person/membership', async () => {
    const f = fixture(); try {
      const result = await f.register();
      expect(result).toMatchObject({ status: 'created', user: { id: userId, role: 'member', active_school_id: null } });
      expect(result).not.toHaveProperty('password_hash');
      const insert = writes(f.queries)[0]!;
      expect(insert.sql).toContain("'member',true"); expect(insert.parameters).toContain('visitor@example.test');
      const hash = insert.parameters.find(value => typeof value === 'string' && value.startsWith('scrypt$')) as string;
      expect(await verifyPassword(registration.password, hash)).toBe(true);
      expect(writes(f.queries)).toHaveLength(1); expect(f.linkAccountEndpoint).not.toHaveBeenCalled();
    } finally { await f.db.destroy(); }
  });
  it('requires normal sign-in for every existing email without password verification, reset or disclosure', async () => {
    const f = fixture({ existing: true }); try {
      expect(await f.register({ password: 'wrong' })).toEqual({ status: 'sign_in_required' });
      expect(writes(f.queries)).toEqual([]); expect(f.resolveAccountEndpoint).not.toHaveBeenCalled();
    } finally { await f.db.destroy(); }
  });
  it('does not claim an account created concurrently by another normal ceremony', async () => {
    const f = fixture({ insertConflict: true }); try {
      expect(await f.register()).toEqual({ status: 'sign_in_required' });
      expect(writes(f.queries)[0]!.sql).toContain('ON CONFLICT DO NOTHING');
      expect(f.queries.some(query => /UPDATE users/.test(query.sql))).toBe(false);
    } finally { await f.db.destroy(); }
  });
  it('rejects a weak new password before any identity or account write', async () => {
    const f = fixture(); try { await expect(f.register({ password: 'weak' })).rejects.toThrow(/12 characters/); expect(writes(f.queries)).toEqual([]); }
    finally { await f.db.destroy(); }
  });
  it('reuses only the exact active account endpoint and preserves independent campus membership/session selection', async () => {
    const f = fixture({ current: actor }); try {
      const result = await f.join({ user: { ...account, active_school_id: otherCampus } });
      expect(result).toMatchObject({ actor, createdCampusConnection: false, user: { active_school_id: otherCampus } });
      expect(f.beforeBinding).toHaveBeenCalledExactlyOnceWith(person); expect(writes(f.queries)).toEqual([]);
      expect(f.linkAccountEndpoint).not.toHaveBeenCalled();
      expect(f.resolveAccountEndpoint).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ school_id: school, user_id: userId }));
    } finally { await f.db.destroy(); }
  });
  it('creates an explicit self-declared person and assigned-work member only after source-free identity review', async () => {
    const f = fixture(); try {
      const result = await f.join(); expect(result.createdCampusConnection).toBe(true);
      expect(f.order).toEqual(['person', 'membership', 'source', 'binding', 'endpoint']);
      expect(f.beforeBinding).toHaveBeenCalledExactlyOnceWith(person);
      expect(f.linkAccountEndpoint).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ school_id: school, person_id: person,
        user_id: userId, actor_user_id: userId, source_domain: 'gate', source_record_id: source, source_revision: 1,
        metadata: { self_declared: true, account_access_only: true, technical_scope: 'assigned_work', issuer_user_id: issuer } }));
      const membership = writes(f.queries).find(query => query.sql.includes('INSERT INTO school_memberships'))!;
      expect(membership.sql).toContain("'member','assigned_work',true");
      expect(f.queries.some(query => /INSERT INTO (?:staff_profiles|students|school_invitations|auth_sessions)|UPDATE school_memberships/.test(query.sql))).toBe(false);
      const history = f.queries.find(query => query.sql.includes(') AS retained'))!;
      expect(history.sql).not.toMatch(/(?:contact_email|first_name|last_name)\s*=/);
      expect(history.parameters).not.toContain(account.email);
    } finally { await f.db.destroy(); }
  });
  it.each(['endpoint_inactive', 'membership_inactive', 'account_inactive', 'profile_unlinked', 'agent_not_registered'] as const)('refuses retained %s identity instead of restoring or creating another person', async reason => {
      const f = fixture({ current: { acting: false, school_id: school, user_id: userId, person_id: person, agent_id: actor.agent_id, reason } });
      try {
        await expect(f.join()).rejects.toThrow(/retained campus identity/); expect(writes(f.queries)).toEqual([]); expect(f.beforeBinding).not.toHaveBeenCalled();
        expect(f.queries.some(query => query.sql.includes(') AS retained'))).toBe(false);
        expect(f.linkAccountEndpoint).not.toHaveBeenCalled();
      }
      finally { await f.db.destroy(); }
    });
  it('refuses retained native history after Core excludes endpoint history', async () => {
    const f = fixture({ retained: true }); try {
      await expect(f.join()).rejects.toThrow(/retained campus access/); expect(writes(f.queries)).toEqual([]); expect(f.linkAccountEndpoint).not.toHaveBeenCalled();
      expect(f.resolveAccountEndpoint).toHaveBeenCalledExactlyOnceWith(expect.anything(), expect.objectContaining({ school_id: school, user_id: userId }));
      const history = f.queries.find(query => query.sql.includes(') AS retained'))!;
      for (const table of ['school_memberships', 'school_people', 'students', 'staff_profiles', 'guardian_school_profiles', 'institution_governance_appointments']) expect(history.sql).toContain(table);
      expect(f.queries.some(query => /\b(?:FROM|JOIN)\s+campus_model_/i.test(query.sql))).toBe(false);
    } finally { await f.db.destroy(); }
  });
  it.each([{ is_active: false }, { email_verified_at: null }, { onboarding_pending: true }, { email: 'changed@example.test' }])('rechecks account trust from storage before identity writes: %j', async change => {
      const f = fixture({ account: { ...account, ...change } }); try { await expect(f.join()).rejects.toThrow(/account changed/); expect(writes(f.queries)).toEqual([]); expect(f.resolveAccountEndpoint).not.toHaveBeenCalled(); }
      finally { await f.db.destroy(); }
    });
  it('does not bind or call Core if exact source evidence fails', async () => {
    const f = fixture(); try {
      await expect(f.join({ beforeBinding: () => Promise.reject(new Error('Source unavailable')) })).rejects.toThrow('Source unavailable');
      expect(f.queries.some(query => query.sql.includes('UPDATE school_people'))).toBe(false); expect(f.linkAccountEndpoint).not.toHaveBeenCalled();
    } finally { await f.db.destroy(); }
  });
  it('rejects a changed binding or mismatched identity receipt instead of accepting another person', async () => {
    for (const options of [{ bound: false }, { linked: { ...actor, person_id: source } }]) {
      const f = fixture(options); try { await expect(f.join()).rejects.toThrow(/exact campus person changed|identity receipt/); }
      finally { await f.db.destroy(); }
    }
  });
  it('refuses Simulation before queries, password hashing, source callback or identity access', async () => {
    const f = fixture(), environment = simulationRequestEnvironment({ institution_id: school, run_id: userId, scenario_id: source,
      virtual_now: '2026-10-30T00:00:00Z', source_snapshot_ref: 'sha256:source', manifest_ref: 'test', checked_at: '2026-10-30T00:00:00Z' });
    try {
      await executionEnvironmentStorage.run(environment, async () => { await expect(f.register()).rejects.toThrow(/managed in Live/); await expect(f.join()).rejects.toThrow(/managed in Live/); });
      expect(f.queries).toEqual([]); expect(f.beforeBinding).not.toHaveBeenCalled(); expect(f.resolveAccountEndpoint).not.toHaveBeenCalled();
    } finally { await f.db.destroy(); }
  });
});
