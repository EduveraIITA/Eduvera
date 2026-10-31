import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, type CompiledQuery, type DatabaseConnection } from 'kysely';
import { describe, expect, it } from 'vitest';
import { CampusModelCoreService } from '../src/campus-model-core/campus-model-core.service.js';
import { CAMPUS_TEMPORAL_CONTEXT_BATCH_SIZE, type CampusTemporalContextBatchQuery } from '../src/campus-model-core/contracts.js';
import type { DatabaseService } from '../src/database/database.service.js';
import type { Database } from '../src/database/types.js';

const school = randomUUID(), at = '2026-10-29T03:45:00.000Z';
const entity = { type: 'entity' as const, domain: 'campus_topology', domain_id: randomUUID() };
function fixture(selectedSchool?: string) {
  const queries: CompiledQuery[] = [];
  class ReadDriver extends DummyDriver {
    override acquireConnection(): Promise<DatabaseConnection> {
      return Promise.resolve({ executeQuery<R>(query: CompiledQuery) { queries.push(query); return Promise.resolve({ rows: [] as R[] }); },
        async *streamQuery() { yield { rows: [] }; } });
    }
  }
  const db = new Kysely<Database>({ dialect: { createDriver: () => new ReadDriver(), createAdapter: () => new PostgresAdapter(),
    createQueryCompiler: () => new PostgresQueryCompiler(), createIntrospector: d => new PostgresIntrospector(d) } });
  const scope = selectedSchool ? { current: () => ({ institution_id: selectedSchool, namespace_id: `live:${selectedSchool}` }) } : undefined;
  return { db, queries, core: new CampusModelCoreService(db as DatabaseService, scope as never) };
}

describe('bounded temporal batch validation and query budget', () => {
  it('returns explicit empty groups without borrowing a database connection', async () => {
    const f = fixture();
    try { await expect(f.core.resolveAtBatch({ school_id: school, at, subjects: [] })).resolves.toEqual([]); expect(f.queries).toHaveLength(0); }
    finally { await f.db.destroy(); }
  });
  it.each([
    { subjects: [entity, { type: 'human_agent', user_id: 'invalid' }] },
    { subjects: Array.from({ length: CAMPUS_TEMPORAL_CONTEXT_BATCH_SIZE + 1 }, () => entity) },
    { subjects: [entity], recorded_as_of: null },
    { subjects: [entity], at: 'invalid' },
  ])('rejects the complete invalid request before any SQL (%j)', async invalid => {
    const f = fixture();
    try { await expect(f.core.resolveAtBatch({ school_id: school, at, ...invalid } as CampusTemporalContextBatchQuery)).rejects.toThrow(); expect(f.queries).toHaveLength(0); }
    finally { await f.db.destroy(); }
  });
  it('preserves every missing and duplicate input position with two loans for64 entity subjects', async () => {
    const f = fixture(); const subjects = Array.from({ length: 64 }, (_, i) => i % 2 ? entity : { ...entity, domain_id: randomUUID() });
    try { await expect(f.core.resolveAtBatch({ school_id: school, at, subjects })).resolves.toEqual(subjects.map(() => [])); expect(f.queries).toHaveLength(2); }
    finally { await f.db.destroy(); }
  });
  it('keeps human-only reads to one expected-evidence query', async () => {
    const f = fixture();
    try { await expect(f.core.resolveAtBatch({ school_id: school, at, subjects: [{ type: 'human_agent', user_id: randomUUID() }] })).resolves.toEqual([[]]); expect(f.queries).toHaveLength(1); }
    finally { await f.db.destroy(); }
  });
  it('rejects a different selected school even for an empty batch before SQL', async () => {
    const f = fixture(randomUUID());
    try { await expect(f.core.resolveAtBatch({ school_id: school, at, subjects: [] })).rejects.toThrow('another operational realm'); expect(f.queries).toHaveLength(0); }
    finally { await f.db.destroy(); }
  });
});
