import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { containerProgram, validateRecipientKey, provision } from './provision-stage-gatekeeper.mjs';
const pair = generateKeyPairSync('rsa', { modulusLength: 3072, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
test('accepts only a strong public recipient key', () => {
  validateRecipientKey(pair.publicKey);
  assert.throws(() => validateRecipientKey(pair.privateKey));
  const weak = generateKeyPairSync('rsa', { modulusLength: 1024, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  assert.throws(() => validateRecipientKey(weak.publicKey));
});
test('Cloud Run CLI receives exactly two arguments and no plaintext password', () => {
  const program = containerProgram(pair.publicKey, '12345678-1234-1234-1234-123456789abc');
  assert.equal(program.includes(','), false);
  assert.equal(program.includes(pair.privateKey), false);
  assert.match(program, /^eval\(atob\("[A-Za-z0-9+/=]+"\)\)$/);
  assert.throws(() => containerProgram(pair.publicKey, 'arbitrary operation'));
});
test('an unapproved invocation never makes a cloud call', async () => {
  let called = false;
  await assert.rejects(provision({}, () => { called = true; }));
  assert.equal(called, false);
});
test('maintenance retains normal migration and deployment protections', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/stage.yml', import.meta.url), 'utf8');
  assert.match(workflow, /gatekeeper-provision:/);
  assert.match(workflow, /needs: verify/);
  assert.match(workflow, /\[provision-gatekeeper\]/);
  const reusable = readFileSync(new URL('../../.github/workflows/google-cloud-stage.yml', import.meta.url), 'utf8');
  assert.match(reusable, /provision_gatekeeper:/);
  assert.match(reusable, /GCP_SERVICE: eduvera-stage/);
});
