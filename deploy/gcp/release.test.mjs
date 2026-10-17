import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guard, assertRuntime, verify, verifyPhoto, resolveImageDigest } from './release.mjs';

const now = Date.parse('2026-10-09T00:00:00Z');
const env = { GITHUB_REPOSITORY: 'EduveraIITA/Eduvera', GITHUB_REF: 'refs/heads/Stage', GITHUB_SHA: 'a'.repeat(40), GCP_PROJECT_ID: 'eduera-511111', GCP_REGION: 'asia-south1', GCP_SERVICE: 'eduvera-stage', GCP_PHOTO_SERVICE: 'eduvera-stage-photo', GCP_MIGRATION_JOB: 'eduvera-stage-migrate', GCP_IMAGE: 'asia-south1-docker.pkg.dev/eduera-511111/eduera/web', GCP_PHOTO_IMAGE: 'asia-south1-docker.pkg.dev/eduera-511111/eduera/photo-attendance', GCP_TRIAL_DEPLOY_UNTIL: '2026-11-08T00:00:00Z' };
test('only the exact trusted Stage target is accepted', () => {
  guard(env, now);
  for (const [key, value] of Object.entries({ GITHUB_REPOSITORY: 'attacker/Eduvera', GITHUB_REF: 'refs/pull/1/merge', GITHUB_SHA: 'latest', GCP_PROJECT_ID: 'other', GCP_REGION: 'us-central1', GCP_SERVICE: 'production', GCP_PHOTO_SERVICE: 'production-photo', GCP_MIGRATION_JOB: 'wrong', GCP_IMAGE: 'other/image', GCP_PHOTO_IMAGE: 'other/photo' })) assert.throws(() => guard({ ...env, [key]: value }, now));
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
    { name: 'DEMO_MODE', value: 'false' },
    { name: 'PUBLIC_DEMO_ENABLED', value: 'true' },
    { name: 'DEMO_PROFILE_SWITCHER_ENABLED', value: 'true' },
    { name: 'PUBLIC_URL', value: 'https://app.thatcampus.com' },
    { name: 'ALLOWED_ORIGINS', value: 'https://app.thatcampus.com,https://eduvera-stage-367469594690.asia-south1.run.app' },
  );
  result.job.spec.template.spec.template.spec.timeoutSeconds = '300';
  result.job.spec.template.spec.template.spec.containers[0].resources = { limits: { cpu: '1', memory: '512Mi' } };
  return result;
};
test('a bounded runtime with durable files and an isolated migrator passes', () => {
  const { service, job } = fixture(); assert.equal(assertRuntime(service, job), 'old');
});
test('development simulator variables are rejected from the Stage runtime', () => {
  for (const [name, value] of [
    ['CAMPUS_SIMULATOR_ENABLED', 'false'],
    ['CAMPUS_SIMULATOR_API_ORIGIN', 'http://127.0.0.1:8001'],
    ['SYNTHETIC_ACTOR_ENABLED', 'false'],
  ]) {
    const { service, job } = fixture();
    service.spec.template.spec.containers[0].env.push({ name, value });
    assert.throws(
      () => assertRuntime(service, job),
      new RegExp(`Development simulator variable is forbidden in Stage: ${name}`),
    );
  }
});
test('public demo bootstrap accepts only the known private-demo predecessor states', () => {
  const { service, job } = fixture();
  const app = service.spec.template.spec.containers[0];
  app.env = app.env.filter(item => !['PUBLIC_DEMO_ENABLED', 'DEMO_PROFILE_SWITCHER_ENABLED'].includes(item.name));
  assert.throws(() => assertRuntime(service, job));
  assert.equal(assertRuntime(service, job, { allowPublicDemoBootstrap: true }), 'old');
  app.env.push({ name: 'DEMO_PROFILE_SWITCHER_ENABLED', value: 'true' });
  assert.equal(assertRuntime(service, job, { allowPublicDemoBootstrap: true }), 'old');
  app.env.push({ name: 'PUBLIC_DEMO_ENABLED', value: 'false' });
  assert.throws(() => assertRuntime(service, job, { allowPublicDemoBootstrap: true }));
  app.env.find(item => item.name === 'PUBLIC_DEMO_ENABLED').value = 'true';
  app.env.find(item => item.name === 'DEMO_PROFILE_SWITCHER_ENABLED').value = 'false';
  assert.throws(() => assertRuntime(service, job, { allowPublicDemoBootstrap: true }));
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
test('photo smoke check requires models and explicit unvalidated status', async () => {
  await verifyPhoto('https://camera.run.app', async () => new Response(JSON.stringify({ model_files_present:true, accuracy_validated:false, single_operator:true })));
  await assert.rejects(verifyPhoto('https://camera.run.app', async () => new Response(JSON.stringify({ model_files_present:false, accuracy_validated:false, single_operator:true }))));
});
test('rejects a costly migrator and a wrong canonical origin', () => {
  const { service, job } = fixture();
  job.spec.template.spec.template.spec.containers[0].resources.limits.memory = '16Gi';
  assert.throws(() => assertRuntime(service, job));
  const second = fixture();
  second.service.spec.template.spec.containers[0].env.find(item => item.name === 'PUBLIC_URL').value = 'https://other.run.app';
  assert.throws(() => assertRuntime(second.service, second.job));
});
test('cloud AI deployment requires the reviewed model, budget and expiry', () => {
  const cloud = { AGENT_PROVIDER:'vertex', AGENT_MODEL:'gemini-3.1-flash-lite', AGENT_GOOGLE_PROJECT:'eduera-511111', AGENT_GOOGLE_LOCATION:'global', AGENT_ENABLED_UNTIL:new Date(Date.now()+86400000).toISOString(), AGENT_USER_HOURLY_LIMIT:'10', AGENT_USER_DAILY_LIMIT:'30', AGENT_DAILY_BUDGET_MICROS:'500000', AGENT_MONTHLY_BUDGET_MICROS:'5000000' };
  const check = values => { const {service,job}=fixture();service.spec.template.spec.containers[0].env.push(...Object.entries(values).map(([name,value])=>({name,value})));return assertRuntime(service,job); };
  assert.equal(check(cloud),'old');
  for (const [key,value] of Object.entries({AGENT_MODEL:'expensive-model',AGENT_GOOGLE_PROJECT:'other-project',AGENT_BASE_URL:'https://other.example',AGENT_ENABLED_UNTIL:'2020-01-01',AGENT_DAILY_BUDGET_MICROS:'50000000',AGENT_MONTHLY_BUDGET_MICROS:'',AGENT_USER_DAILY_LIMIT:'1000'})) assert.throws(()=>check({...cloud,[key]:value}));
});
test('Telegram deployment requires Secret Manager bindings and verified webhook registration', () => {
  const check = ({secret=true,auto='true'}={}) => {
    const {service,job}=fixture();const app=service.spec.template.spec.containers[0];
    app.env.push({name:'TELEGRAM_BOT_ENABLED',value:'true'},{name:'TELEGRAM_AUTO_REGISTER_WEBHOOK',value:auto});
    for(const name of ['TELEGRAM_BOT_TOKEN','TELEGRAM_WEBHOOK_SECRET']) app.env.push(secret
      ?{name,valueFrom:{secretKeyRef:{name:'telegram-secret',key:'latest'}}}:{name,value:'plaintext'});
    return assertRuntime(service,job);
  };
  assert.equal(check(),'old');
  assert.throws(()=>check({secret:false}));
  assert.throws(()=>check({auto:'false'}));
});

test('a fresh deployment runner resolves both pushed commit tags through Artifact Registry', () => {
  const calls = [];
  const images = [env.GCP_IMAGE, env.GCP_PHOTO_IMAGE];
  const digests = ['sha256:' + '1'.repeat(64), 'sha256:' + '2'.repeat(64)];
  const execute = (command, args, options) => {
    const index = calls.length;
    calls.push({ command, args, options });
    return digests[index] + '\n';
  };
  assert.deepEqual(images.map(image => resolveImageDigest(image, env.GITHUB_SHA, execute)),
    images.map((image, index) => `${image}@${digests[index]}`));
  assert.deepEqual(calls, images.map(image => ({
    command: 'gcloud',
    args: ['artifacts', 'docker', 'images', 'describe', `${image}:${env.GITHUB_SHA}`,
      '--project=eduera-511111', '--format=value(image_summary.digest)', '--quiet'],
    options: { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  })));
});
test('release image lookup rejects unexpected repositories and non-commit tags before execution', () => {
  const execute = () => assert.fail('Invalid image references must not reach the registry');
  for (const image of ['', 'other/image', env.GCP_IMAGE + '/other', env.GCP_IMAGE + '@sha256:' + '1'.repeat(64)]) {
    assert.throws(() => resolveImageDigest(image, env.GITHUB_SHA, execute), /Unexpected release image repository/);
  }
  for (const sha of [undefined, '', 'latest', 'a'.repeat(39), 'A'.repeat(40), 'a'.repeat(41)]) {
    assert.throws(() => resolveImageDigest(env.GCP_IMAGE, sha, execute), /full release SHA/);
  }
});
test('missing images, denied registry access and malformed digests fail closed', () => {
  const digest = 'sha256:' + 'a'.repeat(64);
  for (const output of ['', 'null', 'latest', 'sha256:abc', 'sha512:' + 'a'.repeat(64),
    'sha256:' + 'A'.repeat(64), env.GCP_IMAGE + '@' + digest, digest + '\n' + digest]) {
    assert.throws(() => resolveImageDigest(env.GCP_IMAGE, env.GITHUB_SHA, () => output), /valid pushed immutable image digest/);
  }
  for (const message of ['Image not found', 'Permission denied']) {
    const failure = new Error(message);
    assert.throws(() => resolveImageDigest(env.GCP_IMAGE, env.GITHUB_SHA, () => { throw failure; }), error => error === failure);
  }
});
