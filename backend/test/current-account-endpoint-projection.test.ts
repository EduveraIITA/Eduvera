import 'reflect-metadata';
import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, type CompiledQuery, type DatabaseConnection, type QueryResult } from 'kysely';
import { describe, expect, it } from 'vitest';
import { CampusModelCoreService } from '../src/campus-model-core/campus-model-core.service.js';
import { executionEnvironmentStorage } from '../src/campus-model-core/execution-time.runtime.js';
import { simulationRequestEnvironment } from '../src/database/simulation-world.service.js';
import type { DatabaseService } from '../src/database/database.service.js';
import type { Database } from '../src/database/types.js';

const school = '10000000-0000-4000-8000-000000000001', person = '20000000-0000-4000-8000-000000000001';
const user = '30000000-0000-4000-8000-000000000001', otherUser = '30000000-0000-4000-8000-000000000002';
const at = '2026-10-31T08:30:00.000Z';
type Endpoint = { person_id: string; user_id: string };
function fixture(options: { namespace?: string | null; endpoints?: Endpoint[]; diagnostic?: Record<string, unknown> } = {}) {
  const queries: CompiledQuery[] = [];
  class Driver extends DummyDriver {
    override acquireConnection(): Promise<DatabaseConnection> {
      return Promise.resolve({ executeQuery: <R>(query: CompiledQuery): Promise<QueryResult<R>> => {
        queries.push(query);
        let rows: unknown[];
        if (query.sql.includes("current_setting('thatcampus.namespace_id'")) rows = [{ namespace: options.namespace ?? null }];
        else if (query.sql.startsWith('SELECT person_id,user_id')) rows = options.endpoints ?? [];
        else if (query.sql.startsWith('SELECT eligible.*')) rows = [];
        else if (query.sql.startsWith('WITH explicit_person AS')) rows = options.diagnostic ? [options.diagnostic] : [];
        else throw new Error('Unexpected identity projection query.');
        return Promise.resolve({ rows: rows as R[] });
      }, streamQuery: () => { throw new Error('No streaming in this identity fixture.'); } });
    }
  }
  const db = new Kysely<Database>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new Driver(),
    createIntrospector: value => new PostgresIntrospector(value), createQueryCompiler: () => new PostgresQueryCompiler() } });
  // No default executor is available: these reads must use the caller's exact tx.
  const core = new CampusModelCoreService({} as DatabaseService);
  return { db, core, queries, read: (input: Parameters<typeof core.listCurrentAccountEndpoints>[1] = { school_id: school, at }) =>
    db.transaction().execute(tx => core.listCurrentAccountEndpoints(tx, input)) };
}

describe('Current account endpoint read port', () => {
  it('retains every eligible account, exact effective instant and selected person without collapsing to person choices', async () => {
    const endpoints = [{ person_id: person, user_id: user }, { person_id: person, user_id: otherUser }], f = fixture({ endpoints });
    try {
      expect(await f.read({ school_id: school, at, person_ids: [person] })).toEqual(endpoints);
      expect(f.queries).toHaveLength(2);
      const query = f.queries[1]!;
      expect(query.parameters).toEqual([school, at, [person]]);
      expect(query.sql).toContain('person_id=ANY('); expect(query.sql).not.toContain('DISTINCT');
    } finally { await f.db.destroy(); }
  });

  it('returns no accounts for an explicit empty person selection instead of broadening it to the campus', async () => {
    const f = fixture({ endpoints: [{ person_id: person, user_id: user }] });
    try { expect(await f.read({ school_id: school, at, person_ids: [] })).toEqual([]); expect(f.queries).toHaveLength(1); }
    finally { await f.db.destroy(); }
  });

  it('validates institution, instant and bounded explicit selectors before any executor query', async () => {
    const f = fixture();
    try {
      for (const input of [{ school_id: 'not-a-campus', at }, { school_id: school, at: 'tomorrow' }, { school_id: school, at, person_ids: Array.from({ length: 1_001 }, () => person) }]) await expect(f.read(input)).rejects.toThrow();
      expect(f.queries).toEqual([]);
    } finally { await f.db.destroy(); }
  });

  it('refuses a foreign Live executor before reading private endpoint persistence', async () => {
    const f = fixture({ namespace: 'live:another-campus' });
    try { await expect(f.read()).rejects.toThrow(/selected execution data plane/); expect(f.queries).toHaveLength(1); }
    finally { await f.db.destroy(); }
  });

  it('requires the exact selected Simulation executor instead of silently reading Live', async () => {
    const environment = simulationRequestEnvironment({ institution_id: school, scenario_id: '40000000-0000-4000-8000-000000000001',
      run_id: '50000000-0000-4000-8000-000000000001', virtual_now: at, source_snapshot_ref: 'snapshot:test', manifest_ref: 'manifest:test', checked_at: at });
    const f = fixture();
    try { await expect(executionEnvironmentStorage.run(environment, () => f.read())).rejects.toThrow(/selected execution data plane/); expect(f.queries).toHaveLength(1); }
    finally { await f.db.destroy(); }
  });

  it('reads the matching Simulation executor at the supplied virtual instant without changing the identity selector', async () => {
    const environment = simulationRequestEnvironment({ institution_id: school, scenario_id: '40000000-0000-4000-8000-000000000001',
      run_id: '50000000-0000-4000-8000-000000000001', virtual_now: at, source_snapshot_ref: 'snapshot:test', manifest_ref: 'manifest:test', checked_at: at });
    const endpoints = [{ person_id: person, user_id: user }], f = fixture({ namespace: environment.namespace_id, endpoints });
    try {
      expect(await executionEnvironmentStorage.run(environment, () => f.read({ school_id: school, at, person_ids: [person] }))).toEqual(endpoints);
      expect(f.queries[1]!.parameters).toEqual([school, at, [person]]);
    } finally { await f.db.destroy(); }
  });
});

describe('Retained account endpoint history contract', () => {
  it('returns endpoint_inactive for retained ended/revoked history, never account_not_linked or a new acting identity', async () => {
    const f = fixture({ diagnostic: { agent_id: person, person_id: person, user_id: user, endpoint_active: false,
      account_active: true, membership_active: true, profile_linked: true } });
    try {
      const resolution = await f.db.transaction().execute(tx => f.core.resolveAccountEndpoint(tx, { school_id: school, user_id: user, at }));
      expect(resolution).toMatchObject({ acting: false, reason: 'endpoint_inactive', person_id: person });
      const history = f.queries.find(query => query.sql.startsWith('WITH explicit_person AS'))!;
      // Eligibility is a diagnostic expression, not a filter that loses old
      // endpoints and allows public joining to recreate retained access.
      const historyWhere = history.sql.slice(history.sql.lastIndexOf('FROM campus_model_agent_endpoints endpoint'));
      expect(historyWhere).toContain("endpoint.provider='thatcampus'");
      expect(historyWhere).not.toMatch(/endpoint\.(?:effective_from|effective_until|status)\s*(?:<=|>|=)/u);
    } finally { await f.db.destroy(); }
  });

  it('reserves account_not_linked for an account with no retained endpoint row', async () => {
    const f = fixture();
    try {
      const resolution = await f.db.transaction().execute(tx => f.core.resolveAccountEndpoint(tx, { school_id: school, user_id: user, at }));
      expect(resolution).toMatchObject({ acting: false, reason: 'account_not_linked', person_id: null, agent_id: null });
    } finally { await f.db.destroy(); }
  });
});
