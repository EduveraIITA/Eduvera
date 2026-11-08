import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/common/request.js';
import type { Database } from '../src/database/types.js';
import { LearningElectiveChangeService, type ElectiveFinanceWorkCandidate } from '../src/learning/learning-elective-change.service.js';
import type { OwnedMessageProjection, WorkspaceRepositorySnapshot } from '../src/workspace/workspace.contracts.js';
import { workHref, WorkspaceService } from '../src/workspace/workspace.service.js';

const school = '10000000-0000-4000-8000-000000000001', userId = '10000000-0000-4000-8000-000000000002';
const person = '10000000-0000-4000-8000-000000000003', change = '10000000-0000-4000-8000-000000000004';
const messageId = '10000000-0000-4000-8000-000000000005', foreign = '10000000-0000-4000-8000-000000000006';
const user = { id: userId, is_active: true, role: 'staff', active_school_id: school } as AuthUser;
const candidate = { message_id: messageId, change_id: change, source_revision: 1 };
const reviewer = { user_id: userId, person_id: person, eligibility_hash: 'a'.repeat(64) };
const delivery = { message_id: messageId, source_revision: 1, reviewer };
const source = { ...candidate, revision: 2 };
const at = new Date('2026-11-08T12:00:00Z');
const message: OwnedMessageProjection = { id: messageId, source_domain: 'learning_elective', reaction_kind: 'elective_finance_review',
  message_kind: 'task', state: 'acknowledged', subject: 'Review elective financial impact', summary: 'No charge or refund is automatic.',
  payload: { elective_change_id: change, revision: 1, action_path: 'https://foreign.invalid/private?token=never-follow' },
  response_due_at: null, expires_at: null, queued_at: at.toISOString(), updated_at: at.toISOString() };

function owner(rows: Array<{ id: string; revision: number; delivery: unknown }>) {
  const queries = vi.fn();
  const db = new Kysely<Database>({ dialect: {
    createDriver: () => new DummyDriver(), createAdapter: () => new PostgresAdapter(),
    createIntrospector: database => new PostgresIntrospector(database), createQueryCompiler: () => new PostgresQueryCompiler(),
  } }).withPlugin({ transformQuery: ({ node }) => { queries(); return node; },
    transformResult: ({ result }) => Promise.resolve({ ...result, rows }) });
  const finance = { campus: vi.fn().mockResolvedValue({}), reviewer: vi.fn().mockResolvedValue(reviewer), basis: vi.fn(() => { throw new Error('Private ledger must not be hydrated for a link'); }) };
  const service = new LearningElectiveChangeService(db as never, {} as never, {} as never, finance as never, {} as never);
  return { db, service, finance, queries };
}

describe('elective Finance source in the existing Work and Today composition', () => {
  it('resolves a whole native batch with one source query and one current reviewer lookup, without ledger hydration', async () => {
    const batch = Array.from({ length: 30 }, (_, i) => ({ ...candidate, change_id: `20000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      message_id: `30000000-0000-4000-8000-${String(i).padStart(12, '0')}` }));
    const current = owner(batch.map(item => ({ id: item.change_id, revision: 2, delivery: { ...delivery, message_id: item.message_id } })));
    try {
      expect(await current.service.financeWorkSources(user, school, batch)).toEqual(batch.map(item => ({ ...item, revision: 2 })));
      expect(current.queries).toHaveBeenCalledTimes(1); expect(current.finance.reviewer).toHaveBeenCalledTimes(1);
      expect(current.finance.basis).not.toHaveBeenCalled();
    } finally { await current.db.destroy(); }
  });
  it('refuses malformed source identifiers/revisions, another selected campus and unavailable current Finance authority', async () => {
    const current = owner([{ id: change, revision: 2, delivery }]);
    try {
      const malformed = [{ ...candidate, change_id: '../another' }, { ...candidate, message_id: 'not-a-message' }, { ...candidate, source_revision: 0 }, { ...candidate, source_revision: '1' }];
      expect(await current.service.financeWorkSources(user, school, malformed as ElectiveFinanceWorkCandidate[])).toEqual([]);
      expect(await current.service.financeWorkSources(user, foreign, [candidate])).toEqual([]);
      expect(await current.service.financeWorkSources({ ...user, is_active: false }, school, [candidate])).toEqual([]);
      expect(current.finance.campus).not.toHaveBeenCalled(); expect(current.queries).not.toHaveBeenCalled();
      current.finance.campus.mockRejectedValueOnce(new ForbiddenException('Selected world changed'));
      expect(await current.service.financeWorkSources(user, school, [candidate])).toEqual([]); expect(current.queries).not.toHaveBeenCalled();
      current.finance.reviewer.mockResolvedValueOnce(null);
      expect(await current.service.financeWorkSources(user, school, [candidate])).toEqual([]); expect(current.queries).not.toHaveBeenCalled();
    } finally { await current.db.destroy(); }
  });
  it.each([
    { id: foreign, revision: 2, delivery },
    { id: change, revision: 2, delivery: { ...delivery, message_id: foreign } },
    { id: change, revision: 2, delivery: { ...delivery, source_revision: 2 } },
    { id: change, revision: 2, delivery: { ...delivery, reviewer: { ...reviewer, user_id: foreign } } },
    { id: change, revision: 2, delivery: { ...delivery, reviewer: { ...reviewer, person_id: foreign } } },
    { id: change, revision: 2, delivery: { ...delivery, reviewer: { ...reviewer, eligibility_hash: 'b'.repeat(64) } } },
    { id: change, revision: 2, delivery: null },
  ])('keeps a foreign, mismatched or malformed retained source unavailable (%#)', async row => {
    const current = owner([row]);
    try { expect(await current.service.financeWorkSources(user, school, [candidate])).toEqual([]); }
    finally { await current.db.destroy(); }
  });
  it('does not turn an infrastructure error into a current source proof', async () => {
    const current = owner([]); current.finance.campus.mockRejectedValueOnce(new Error('Database unavailable'));
    try { await expect(current.service.financeWorkSources(user, school, [candidate])).rejects.toThrow('Database unavailable'); }
    finally { await current.db.destroy(); }
  });
  it('builds only the canonical Finance destination from the exact owning result and ignores every payload href', () => {
    expect(workHref(message, source)).toBe(`/areas/fees/ledger?elective_review=${change}`);
    for (const [item, proof] of [
      [message, undefined], [{ ...message, source_domain: 'another_domain' }, source],
      [{ ...message, payload: { elective_change_id: foreign, revision: 1, action_path: '/areas/fees/ledger?elective_review=forged' } }, source],
      [{ ...message, payload: { elective_change_id: change, revision: '1' } }, source],
      [message, { ...source, message_id: foreign }],
    ] as const) expect(workHref(item, proof)).toBe(`/work?item=${messageId}&unavailable=source`);
  });
  it.each(['live', 'simulation'] as const)('uses the same current owner and source trace for the %s manifest and removes the link after access loss', async mode => {
    const namespace = mode === 'live' ? `live:${school}` : 'scenario:source:run:one';
    const snapshot: WorkspaceRepositorySnapshot = { institution: { id: school, name: 'Riverview Institute', timezone: 'UTC' }, membership_roles: ['staff'],
      realm_id: foreign, environment_namespace_id: namespace, acting_agent_id: person, owner_agent_ids: [person], assignments: [], messages: [message], relationships: [] };
    const repository = { load: vi.fn().mockResolvedValue(snapshot) }, elective = { financeWorkSources: vi.fn().mockResolvedValue([source]) };
    const clock = { now: () => at, read: () => ({ instant: at, iso_instant: at.toISOString(), local_date: '2026-11-08', local_time: '12:00:00', time_zone: 'UTC' }) };
    const service = new WorkspaceService(repository as never, clock as never, undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, elective as never);
    const view = { mode, institution_id: school, namespace_id: namespace, unavailable: false, virtual_clock: { now: at.toISOString() } };
    const opened = await service.manifest(user, null, view as never), item = opened.work.items[0]!;
    expect(elective.financeWorkSources).toHaveBeenCalledOnce(); expect(elective.financeWorkSources).toHaveBeenCalledWith(user, school, [candidate]);
    expect(opened.today.attention.total).toBe(1); expect(item).toMatchObject({ href: `/areas/fees/ledger?elective_review=${change}`,
      action_label: 'Review financial impact', source_label: 'Course change', source: { domain: 'learning_elective', kind: 'elective_change', id: change, revision: 2, action: 'finance.classify' },
      core_trace: { message_ids: [messageId] } });
    expect(item.status_label).not.toBe('Source unavailable'); expect(item.detail).not.toContain('link is unavailable');
    expect(JSON.stringify(opened)).not.toContain('foreign.invalid'); expect(JSON.stringify(opened)).not.toContain('eligibility_hash');
    elective.financeWorkSources.mockResolvedValueOnce([]);
    const denied = await service.manifest(user, null, view as never);
    expect(denied.work.items[0]).toMatchObject({ href: `/work?item=${messageId}&unavailable=source`, status_label: 'Source unavailable' });
    expect(denied.work.items[0]?.source).toBeUndefined();
  });
});
