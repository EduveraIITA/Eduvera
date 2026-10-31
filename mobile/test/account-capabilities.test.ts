import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkspaceManifest } from '../../packages/contracts/src/workspace';
import { accountChannelBody, accountChannelFingerprint, accountChannelLinkCurrent, accountConnectionContexts, accountMemoryAvailable, accountMemoryDeletePath, accountMemoryListFingerprint, accountQueryBelongsToActor, assertAccountChannelDisconnected, assertMemoriesCleared, assertMemoryDeleted, parseAccountChannelLink, parseAccountChannels, parseAccountMemories, parseAccountProPreference, selectedAccountConnection } from '../src/lib/account-capabilities';
const learner = '11111111-1111-4111-8111-111111111111', memoryId = '22222222-2222-4222-8222-222222222222';
const context = { key: `dependent:${learner}`, label: 'Learner', detail: 'Current relationship', audience: 'parent' as const, studentId: learner };
const item = { id: memoryId, portal: 'student', category: 'communication_preference', topic: 'style', content: 'Use concise answers.', expires_at: '2027-10-29T00:00:00Z' };
const memories = { items: [item], budget: { used_tokens: 10, max_tokens: 1200, used_items: 1, max_items: 32 }, contract: '2026-10-10.1' };
const provider = { name: 'telegram' as const, configured: true, label: 'Telegram', username: '@ThatCampusBot', connection: null };

test('memory remains readable and deletable in Live with Pro disabled and is never available in Simulation', () => {
  assert.equal(accountMemoryAvailable('live', 'campus', false), true);
  assert.equal(accountMemoryAvailable('live', 'campus', true), true);
  assert.equal(accountMemoryAvailable('live', null, true), false);
  for (const enabled of [false, true]) assert.equal(accountMemoryAvailable('simulation', 'campus', enabled), false);
});
test('connection contexts come only from contributed work and exact relationships; stale selection never falls back', () => {
  const manifest = { more: { groups: [{ key: 'work', items: [{ key: 'governance' }, { key: 'responsibilities' }] }], setup: [] }, areas: [{ scopes: [{ kind: 'self' }, { kind: 'dependent', id: learner, label: 'Learner' }, { kind: 'dependent' }, { kind: 'class', id: learner }], surfaces: [{ scopes: [{ kind: 'dependent', id: learner }] }] }] } as unknown as WorkspaceManifest;
  const contexts = accountConnectionContexts(manifest);
  assert.deepEqual(contexts.map(value => [value.key, value.audience, value.studentId]), [['institution', 'principal', undefined], ['assigned-work', 'teacher', undefined], ['self:self', 'student', undefined], [`dependent:${learner}`, 'parent', learner]]);
  assert.equal(selectedAccountConnection(contexts, 'revoked-learner'), null); assert.equal(selectedAccountConnection(contexts, '')?.key, 'institution');
  assert.deepEqual(accountConnectionContexts({ ...manifest, more: { setup: [] }, areas: [] }), []);
});
test('Pro preference and actor cache matching reject malformed or different account values', () => {
  assert.deepEqual(parseAccountProPreference({ enabled: false, preview: true }), { enabled: false, preview: true });
  for (const value of [{ enabled: 'false', preview: true }, { enabled: true, preview: false }, null]) assert.throws(() => parseAccountProPreference(value));
  const origin = 'https://campus.example', scope = (actor: string, server = origin, mode = 'live') => JSON.stringify([server, JSON.stringify([actor, 'campus', mode, mode === 'live' ? null : 'run-a'])]);
  assert.equal(accountQueryBelongsToActor(['campus', scope('actor'), '/api'], 'actor', origin), true);
  assert.equal(accountQueryBelongsToActor(['campus', scope('actor', origin, 'simulation'), '/api'], 'actor', origin), true);
  for (const key of [['campus', scope('another')], ['campus', scope('actor', 'https://foreign.example')], ['campus', JSON.stringify(['actor', 'campus', 'live', null])], ['campus', '{"0":"actor"}'], ['other', scope('actor')], ['campus', 'invalid']]) assert.equal(accountQueryBelongsToActor(key, 'actor', origin), false);
});
test('memory wire values and deletion acknowledgements fail closed; a lowered budget stays honest', () => {
  const parsed = parseAccountMemories(memories); assert.equal(parsed.items[0]?.content, item.content);
  assert.equal(parseAccountMemories({ ...memories, budget: { ...memories.budget, max_tokens: 1 } }).budget.used_tokens, 10);
  for (const row of [{ ...item, id: '../other' }, { ...item, category: 'permissions' }, { ...item, expires_at: 'invalid' }, { ...item, content: null }]) assert.throws(() => parseAccountMemories({ ...memories, items: [row] }));
  for (const budget of [{ ...memories.budget, used_tokens: NaN }, { ...memories.budget, used_items: 2 }, { ...memories.budget, max_items: -1 }]) assert.throws(() => parseAccountMemories({ ...memories, budget }));
  assert.throws(() => parseAccountMemories({ ...memories, items: [item, item], budget: { ...memories.budget, used_items: 2 } }));
  assert.equal(accountMemoryDeletePath(memoryId), `/api/v1/agent/memories/${memoryId}`); assert.throws(() => accountMemoryDeletePath('../other'));
  assertMemoryDeleted({ deleted: true, id: memoryId }, memoryId); assert.throws(() => assertMemoryDeleted({ deleted: true, id: learner }, memoryId));
  assertMemoriesCleared({ cleared: true, count: 0 }); assert.throws(() => assertMemoriesCleared({ cleared: true, count: Infinity }));
});
test('memory preflight fingerprints ignore list ordering but preserve exact source text/context', () => {
  const parsed = parseAccountMemories(memories).items[0]!, other = { ...parsed, id: learner };
  assert.equal(accountMemoryListFingerprint([parsed, other]), accountMemoryListFingerprint([other, parsed]));
  for (const changed of [{ ...parsed, content: 'A new preference.' }, { ...parsed, portal: 'parent' as const }, { ...parsed, topic: 'new' }]) assert.notEqual(accountMemoryListFingerprint([parsed]), accountMemoryListFingerprint([changed]));
});
test('channel wire rows are bounded and account-wide without inferred campus identity', () => {
  const connection = { portal: 'parent', student_id: learner, linked_at: '2026-10-29T00:00:00Z', last_inbound_at: null, last_outbound_at: null, uncertain_replies: 1 };
  const parsed = parseAccountChannels({ providers: [{ ...provider, connection }] }); assert.equal(parsed[0]?.connection?.student_id, learner); assert.equal('school_id' in parsed[0]!.connection!, false);
  assert.throws(() => parseAccountChannels({ providers: [provider, provider] }));
  assert.throws(() => parseAccountChannels({ providers: [{ ...provider, connection: { ...connection, uncertain_replies: '1' } }] }));
  assert.deepEqual(accountChannelBody('telegram', context), { provider: 'telegram', portal: 'parent', student_id: learner });
  assert.throws(() => accountChannelBody('telegram', { ...context, studentId: undefined }));
  assertAccountChannelDisconnected({ provider: 'telegram', connected: false }, 'telegram'); assert.throws(() => assertAccountChannelDisconnected({ provider: 'whatsapp', connected: false }, 'telegram'));
});
test('only exact returned Telegram links can open; malformed errors never echo a private token', () => {
  const token = 'x'.repeat(43), value = { provider: 'telegram', connect_url: `https://t.me/ThatCampusBot?start=${token}`, expires_at: '2026-10-29T12:00:00Z' };
  assert.equal(parseAccountChannelLink(value, provider).url, value.connect_url);
  const longName = 'b'.repeat(64); assert.ok(parseAccountChannelLink({ ...value, connect_url: `https://t.me/${longName}?start=${token}` }, { ...provider, username: '@' + longName }));
  for (const connect_url of [`https://foreign.example/ThatCampusBot?start=${token}`, `https://t.me/OtherCampusBot?start=${token}`, `https://t.me/ThatCampusBot?start=${token}&start=${token}`, `javascript:${token}`, `https://user:password@t.me/ThatCampusBot?start=${token}`, `invalid-${token}`]) assert.throws(() => parseAccountChannelLink({ ...value, connect_url }, provider), error => error instanceof Error && !error.message.includes(token));
});
test('transient provider links stop opening after expiry, provider removal or a changed account binding', () => {
  const link = { provider: provider.name, source: accountChannelFingerprint(provider), expiresAt: '2026-10-29T12:00:00Z' }, now = Date.parse('2026-10-29T11:59:00Z');
  assert.equal(accountChannelLinkCurrent(link, [provider], now), true);
  assert.equal(accountChannelLinkCurrent(link, [provider], Date.parse(link.expiresAt)), false);
  for (const providers of [[], undefined, [{ ...provider, configured: false }], [{ ...provider, username: '@OtherCampusBot' }], [{ ...provider, connection: { portal: 'parent' as const, student_id: learner, linked_at: '2026-10-29T11:59:30Z', last_inbound_at: null, last_outbound_at: null } }]]) assert.equal(accountChannelLinkCurrent(link, providers, now), false);
});
