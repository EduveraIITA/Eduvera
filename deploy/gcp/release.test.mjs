import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guard, assertRuntime, verify } from './release.mjs';

const now = Date.parse('2026-10-09T00:00:00Z');
const env = { GITHUB_REPOSITORY: 'EduveraIITA/Eduvera', GITHUB_REF: 'refs/heads/Stage', GITHUB_SHA: 'a'.repeat(40), GCP_PROJECT_ID: 'eduera-511111', GCP_REGION: 'asia-south1', GCP_SERVICE: 'eduvera-stage', GCP_MIGRATION_JOB: 'eduvera-stage-migrate', GCP_IMAGE: 'asia-south1-docker.pkg.dev/eduera-511111/eduera/web', GCP_TRIAL_DEPLOY_UNTIL: '2026-11-08T00:00:00Z' };
test('only the exact trusted Stage target is accepted', () => {
  guard(env, now);
  for (const [key, value] of Object.entries({ GITHUB_REPOSITORY: 'attacker/Eduvera', GITHUB_REF: 'refs/pull/1/merge', GITHUB_SHA: 'latest', GCP_PROJECT_ID: 'other', GCP_REGION: 'us-central1', GCP_SERVICE: 'production', GCP_MIGRATION_JOB: 'wrong', GCP_IMAGE: 'other/image' })) assert.throws(() => guard({ ...env, [key]: value }, now));
});
test('unapproved, expired and unbounded deployment windows fail closed', () => {
  for (const value of ['', 'invalid', '2026-10-08', '2027-10-09']) assert.throws(() => guard({ ...env, GCP_TRIAL_DEPLOY_UNTIL: value }, now));
});
const fixture = () => {
  const result = {
  service: { metadata: { annotations: { 'run.googleapis.com/minScale': '1', 'run.googleapis.com/maxScale': '1' } }, spec: { template: { metadata: { annotations: { 'run.googleapis.com/cpu-throttling': 'false' } }, spec: { serviceAccountName: 'stage-runtime@eduera-511111.iam.gserviceaccount.com', containers: [{ resources: { limits: { cpu: '1', memory: '1Gi' } }, env: [...['DATABASE_URL', 'EVENT_DATABASE_URL', 'COOKIE_SECRET', 'METRICS_TOKEN', 'RESTRICTED_CASE_ENCRYPTION_KEY'].map(name => ({ name, valueFrom: { secretKeyRef: { name: 'private-secret', key: '1' } } })), ...Object.entries({ DEPLOYMENT_ENVIRONMENT: 'stage', COOKIE_SECURE: 'true', RATE_LIMIT_STORE: 'postgres', UPLOAD_DIR: '/files' }).map(([name, value]) => ({ name, value }))], volumeMounts: [{ name: 'files', mountPath: '/files' }] }], volumes: [{ name: 'files', csi: { driver: 'gcsfuse.run.googleapis.com', volumeAttributes: { bucketName: 'eduera-511111-stage-files' } } }] } } }, status: { traffic: [{ percent: 100, revisionName: 'old' }] } },
  job: { spec: { template: { spec: { taskCount: 1, template: { spec: { maxRetries: 0, serviceAccountName: 'stage-migrator@eduera-511111.iam.gserviceaccount.com', containers: [{ command: ['node'], args: ['dist/database/migrate.js'], env: [{ name: 'MIGRATION_DATABASE_URL', valueFrom: { secretKeyRef: { name: 'database', key: '1' } } }] }] } } } } } },
  };
  result.service.spec.template.spec.containers[0].env.push(
    { name: 'PUBLIC_URL', value: 'https://eduvera-stage-367469594690.asia-south1.run.app' },
    { name: 'ALLOWED_ORIGINS', value: 'https://eduvera-stage-367469594690.asia-south1.run.app' },
  );
  result.job.spec.template.spec.template.spec.timeoutSeconds = '300';
  result.job.spec.template.spec.template.spec.containers[0].resources = { limits: { cpu: '1', memory: '512Mi' } };
  return result;
};
test('a bounded runtime with durable files and an isolated migrator passes', () => {
  const { service, job } = fixture(); assert.equal(assertRuntime(service, job), 'old');
});
test('ephemeral files, plaintext secrets, GPUs and unsafe jobs fail', () => {
  const mutations = [
    s => { s.spec.template.spec.volumes = []; },
    s => { s.spec.template.spec.containers[0].env[0] = { name: 'DATABASE_URL', value: 'secret' }; },
    s => { s.spec.template.spec.containers[0].resources.limits['nvidia.com/gpu'] = '1'; },
    s => { s.metadata.annotations['run.googleapis.com/maxScale'] = '10'; },
    s => { s.spec.template.metadata.annotations['run.googleapis.com/cpu-throttling'] = 'true'; },
    s => { s.status.traffic = []; },
  ];
  for (const change of mutations) { const { service, job } = fixture(); change(service); assert.throws(() => assertRuntime(service, job)); }
  const { service, job } = fixture(); job.spec.template.spec.template.spec.containers[0].args = ['dist/database/seed.js']; assert.throws(() => assertRuntime(service, job));
});
test('smoke check rejects a stale release and unexpected origins', async () => {
  await assert.rejects(verify('https://untrusted.example', env.GITHUB_SHA));
  await assert.rejects(verify('https://example.run.app', env.GITHUB_SHA, async () => new Response(JSON.stringify({ release_sha: 'wrong', environment: 'stage' }))));
});
test('rejects a costly migrator and a wrong canonical origin', () => {
  const { service, job } = fixture();
  job.spec.template.spec.template.spec.containers[0].resources.limits.memory = '16Gi';
  assert.throws(() => assertRuntime(service, job));
  const second = fixture();
  second.service.spec.template.spec.containers[0].env.find(item => item.name === 'PUBLIC_URL').value = 'https://other.run.app';
  assert.throws(() => assertRuntime(second.service, second.job));
});
