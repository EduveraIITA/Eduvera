import assert from 'node:assert/strict';
import { test } from 'vitest';
import { MatrixApiError, MatrixClient, matrixLocalpart, matrixSettings, matrixTransactionId } from '../src/chat/matrix/matrix-client.js';

const school = '11111111-1111-4111-8111-111111111111';
const person = '22222222-2222-4222-8222-222222222222';
const otherSchool = '33333333-3333-4333-8333-333333333333';
const room = '!private:chat.example.test';
const config = () => matrixSettings({ MATRIX_ENABLED: 'true', MATRIX_INTERNAL_URL: 'https://chat.example.test',
  MATRIX_SERVER_NAME: 'chat.example.test', MATRIX_AS_TOKEN: 'x'.repeat(48) });
function stub(responses: Array<{ status?: number; body: unknown }>) {
  const requests: Array<{ url: URL; init: RequestInit }> = [];
  const fetcher: typeof fetch = (input, init) => {
    requests.push({ url: new URL(input instanceof Request ? input.url : String(input)), init: init ?? {} });
    const next = responses.shift();
    assert.ok(next, 'Unexpected extra Matrix request');
    return Promise.resolve(new Response(JSON.stringify(next.body), { status: next.status ?? 200,
      headers: { 'Content-Type': 'application/json' } }));
  };
  return { client: new MatrixClient(config(), fetcher), requests };
}

test('disabled mode does not need secrets or a remote service', async () => {
  const settings = matrixSettings({});
  assert.equal(settings.enabled, false);
  const client = new MatrixClient(settings, () => { throw new Error('Must not reach network'); });
  await assert.rejects(client.request('GET', '/_matrix/client/versions'), /M_DISABLED/);
});
test('remote connections require TLS; only explicit local container hops allow HTTP', () => {
  const env = { MATRIX_ENABLED: 'true', MATRIX_AS_TOKEN: 'a'.repeat(48), MATRIX_SERVER_NAME: 'chat.example.test' };
  assert.throws(() => matrixSettings({ ...env, MATRIX_INTERNAL_URL: 'http://remote.example.test' }), /HTTPS/);
  assert.equal(matrixSettings({ ...env, MATRIX_INTERNAL_URL: 'http://synapse:8008' }).baseUrl, 'http://synapse:8008');
  for (const url of ['https://user:secret@example.test', 'https://example.test/path', 'https://example.test?token=secret', 'not-a-url-secret']) {
    assert.throws(() => matrixSettings({ ...env, MATRIX_INTERNAL_URL: url }), error => {
      assert.ok(error instanceof Error); assert.ok(!error.message.includes('secret')); return true;
    });
  }
  assert.throws(() => matrixSettings({ ...env, MATRIX_INTERNAL_URL: 'https://chat.example.test', MATRIX_AS_TOKEN: '' }), /secret store/);
});
test('a person has different Matrix identities in different schools', () => {
  assert.notEqual(matrixLocalpart(school, person), matrixLocalpart(otherSchool, person));
  assert.throws(() => matrixLocalpart('another:homeserver', person), /scope/);
  assert.match(matrixLocalpart(school, person), /^edu_[0-9a-f]{32}_[0-9a-f]{32}$/);
});
test('event transaction IDs are stable across retries and distinct across queued events', () => {
  assert.equal(matrixTransactionId('123'), matrixTransactionId('123'));
  assert.notEqual(matrixTransactionId('123'), matrixTransactionId('124'));
});
test('AS credentials stay in headers and redirects are refused', async () => {
  const { client, requests } = stub([{ body: { user_id: '@eduvera_bot:chat.example.test' } }]);
  await client.request('GET', '/_matrix/client/v3/account/whoami');
  const call = requests[0];
  assert.ok(call);
  assert.equal(call.url.origin, config().baseUrl);
  assert.ok(!call.url.toString().includes(config().asToken));
  assert.equal(new Headers(call.init.headers).get('Authorization'), `Bearer ${config().asToken}`);
  assert.equal(call.init.redirect, 'error');
  await assert.rejects(client.request('GET', 'https://evil.example.test/_matrix/client/versions'), /Invalid Matrix API path/);
});
test('provider and network errors do not disclose response bodies, URLs or secrets', async () => {
  const { client } = stub([{ status: 403, body: { errcode: 'secret-value', error: 'private student content' } }]);
  await assert.rejects(client.request('GET', '/_matrix/client/v3/account/whoami'), error => {
    assert.ok(error instanceof MatrixApiError); assert.equal(error.code, 'M_UNKNOWN');
    assert.ok(!error.message.includes('private')); assert.ok(!error.message.includes('secret')); return true;
  });
  const unavailable = new MatrixClient(config(), () => Promise.reject(new Error('private-token-in-url')));
  await assert.rejects(unavailable.request('GET', '/_matrix/client/v3/account/whoami'), /M_UNAVAILABLE/);
});
test('registration only treats M_USER_IN_USE as success', async () => {
  const existing = stub([{ status: 400, body: { errcode: 'M_USER_IN_USE' } }]);
  await existing.client.register(existing.client.userId(school, person));
  const denied = stub([{ status: 403, body: { errcode: 'M_FORBIDDEN' } }]);
  await assert.rejects(denied.client.register(denied.client.userId(school, person)), /M_FORBIDDEN/);
});
test('new rooms are private, non-federated and governed by the service account', async () => {
  const { client, requests } = stub([{ status: 404, body: { errcode: 'M_NOT_FOUND' } },
    { body: { room_id: room } }, { body: { school_id: school, conversation_id: person } }]);
  assert.equal(await client.ensureRoom(school, person), room);
  const createRequest = requests[1];
  assert.ok(createRequest);
  assert.ok(typeof createRequest.init.body === 'string');
  const body = JSON.parse(createRequest.init.body) as {
    visibility: string; creation_content: Record<string, boolean>;
    initial_state: Array<{ type: string; content: Record<string, string> }>;
    power_level_content_override: { invite: number; state_default: number; users: Record<string, number> };
  };
  assert.equal(body.visibility, 'private'); assert.equal(body.creation_content['m.federate'], false);
  assert.equal(body.initial_state.find(x => x.type === 'm.room.join_rules')?.content.join_rule, 'invite');
  assert.equal(body.initial_state.find(x => x.type === 'm.room.history_visibility')?.content.history_visibility, 'joined');
  assert.equal(body.power_level_content_override.invite, 100);
  assert.equal(body.power_level_content_override.users[client.botId], 100);
});
test('an existing room alias must match the exact school and conversation', async () => {
  const { client } = stub([{ body: { room_id: room } }, { body: { school_id: otherSchool, conversation_id: person } }]);
  await assert.rejects(client.ensureRoom(school, person), /M_SCOPE_MISMATCH/);
});
test('an alias-creation race is recovered and scope-checked', async () => {
  const { client } = stub([{ status: 404, body: { errcode: 'M_NOT_FOUND' } },
    { status: 400, body: { errcode: 'M_ROOM_IN_USE' } }, { body: { room_id: room } },
    { body: { school_id: school, conversation_id: person } }]);
  assert.equal(await client.ensureRoom(school, person), room);
});
test('sending uses a stable transaction path and the scoped sender identity', async () => {
  const { client, requests } = stub([{ body: { event_id: '$accepted' } }]);
  const identity = client.userId(school, person);
  const transaction = matrixTransactionId('42');
  assert.equal(await client.send(room, identity, transaction, { body: 'A question', msgtype: 'm.text' }), '$accepted');
  const sent = requests[0];
  assert.ok(sent);
  assert.equal(sent.url.searchParams.get('user_id'), identity);
  assert.ok(sent.url.pathname.endsWith(`/send/m.room.message/${transaction}`));
});
test('malformed success responses do not mark a message delivered', async () => {
  const { client } = stub([{ body: {} }]);
  await assert.rejects(client.send(room, client.userId(school, person), 'txn', { body: 'Hello' }), /M_INVALID_EVENT/);
});
