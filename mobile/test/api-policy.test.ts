import assert from 'node:assert/strict';
import test from 'node:test';
import { isExecutionRequest, isInternalHref, normalizeApiOrigin, safeDownloadFilename, scopeIdentity } from '../src/lib/api-policy';

test('production accepts only an exact HTTPS origin without credentials or URL state', () => {
  assert.equal(normalizeApiOrigin(' https://campus.example:8443/ '), 'https://campus.example:8443');
  for (const value of ['http://campus.example', 'http://localhost:8000', 'https://user:password@campus.example', 'https://campus.example/api', 'https://campus.example?token=secret', 'https://campus.example#fragment', 'file:///private/file']) assert.throws(() => normalizeApiOrigin(value));
});
test('development HTTP requires an actual loopback/private IP or exact localhost', () => {
  for (const value of ['http://localhost:8000', 'http://127.0.0.1:8000', 'http://127.1:8000', 'http://[::1]:8000', 'http://10.0.2.2:8000', 'http://192.168.1.4:8000', 'http://172.16.0.1', 'http://172.31.255.255']) assert.ok(normalizeApiOrigin(value, true));
  for (const value of ['http://localhost.evil.example', 'http://127.0.0.1.evil.example', 'http://10.evil.example', 'http://192.168.evil.example', 'http://172.31.evil.example', 'http://172.15.1.1', 'http://172.32.1.1', 'http://8.8.8.8', 'http://0.0.0.0']) assert.throws(() => normalizeApiOrigin(value, true));
});
test('internal links reject schemes, host references, escaped separators and dot traversal', () => {
  for (const value of ['/today', '/areas/attendance?date=2026-10-27', '/more/account#security', '/areas/messages?body=hello%2Fworld']) assert.equal(isInternalHref(value), true, value);
  for (const value of ['https://outside.example/file', '//outside.example/file', '/\\outside.example', '/api/v1/%2foutside', '/api/v1/%5coutside', '/api/v1/../auth', '/api/v1/%2e%2e/auth', '/api/v1/.%2e/auth', '/api/v1/%00record', '/api/v1/%zz', '/api/v1/record\n']) assert.equal(isInternalHref(value), false, value);
});
test('account and Simulation control-plane requests are distinct from campus data', () => {
  assert.equal(isExecutionRequest('/api/v1/auth/me/'), false);
  assert.equal(isExecutionRequest('/api/v1/auth/native/register/'), false);
  assert.equal(isExecutionRequest('/api/v1/invitations/accept/'), false);
  assert.equal(isExecutionRequest('/api/v1/invitations/recipient-proof/?check=1'), false);
  assert.equal(isExecutionRequest('/api/v1/invitations/another-command/'), true);
  assert.equal(isExecutionRequest('/api/v1/schools/campus/invitations/'), true);
  assert.equal(isExecutionRequest('/api/v1/schools/campus/simulation/runs'), false);
  assert.equal(isExecutionRequest('/api/v1/schools/campus/people/participants'), true);
  assert.equal(isExecutionRequest('/api/v1/notifications/'), true);
});
test('query and retained-command identity changes with actor, institution and each world', () => {
  const identity = scopeIdentity('actor', 'campus', { mode: 'live', namespace_id: 'live:campus' });
  for (const other of [scopeIdentity('other', 'campus', { mode: 'live', namespace_id: 'live:campus' }), scopeIdentity('actor', 'other', { mode: 'live', namespace_id: 'live:other' }), scopeIdentity('actor', 'campus', { mode: 'simulation', namespace_id: 'scenario:a:run:one' }), scopeIdentity('actor', 'campus', { mode: 'simulation', namespace_id: 'scenario:a:run:two' })]) assert.notEqual(identity, other);
});
test('download filenames stay a finite basename and retain a useful extension', () => {
  assert.equal(safeDownloadFilename('../../private/report.pdf'), 'report.pdf');
  assert.equal(safeDownloadFilename('C:\\private\\report.pdf'), 'report.pdf');
  assert.equal(safeDownloadFilename('..'), 'campus-file');
  assert.equal(safeDownloadFilename('report\n?.pdf'), 'report__.pdf');
  assert.equal(safeDownloadFilename('résumé.pdf'), 'résumé.pdf');
  const long = safeDownloadFilename(`${'a'.repeat(200)}.pdf`);
  assert.equal(long.length, 120); assert.ok(long.endsWith('.pdf'));
});
