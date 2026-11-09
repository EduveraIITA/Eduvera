import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, access, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { TARGET, guard, assertRuntime, buildConfig, sourceIgnore, immutableImage, verify, release, webAssemblyManifest } from './release.mjs';

const sha = 'c1469261'.padEnd(40, 'a'), digest = `sha256:${'a'.repeat(64)}`;
const env = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: TARGET.repository, GITHUB_REPOSITORY_ID: TARGET.repositoryId, GITHUB_REPOSITORY_OWNER_ID: TARGET.ownerId, GITHUB_REF: TARGET.ref, GITHUB_WORKFLOW_REF: TARGET.workflowRef, GITHUB_EVENT_NAME: 'push', GITHUB_SHA: sha, GITHUB_RUN_ID: '123456789', GITHUB_RUN_ATTEMPT: '1', DT_WIF_PROVIDER: TARGET.wifProvider, DT_CLOUD_SQL_INSTANCE: TARGET.sqlInstance };
const binding = guard(env), wasmBytes = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
const wasmHash = createHash('sha256').update(wasmBytes).digest('hex'), wasm = { path: `/skia/canvaskit-0.41.0-${wasmHash.slice(0, 12)}.wasm`, sha256: wasmHash };
const candidateUrl = `https://dt-candidate---thatcampus-dt-367469594690.asia-south1.run.app`;
const secret = (name, id) => ({ name, valueFrom: { secretKeyRef: { name: id, key: '1' } } });
function runtime(job = false) {
  const sqlAnnotations = { 'run.googleapis.com/cloudsql-instances': TARGET.sqlInstance };
  const template = { ...(job ? {} : { metadata: { annotations: { ...sqlAnnotations, 'autoscaling.knative.dev/maxScale': '1', 'run.googleapis.com/cpu-throttling': 'false' } } }), spec: {
    serviceAccountName: `dt-${job ? 'migrator' : 'runtime'}@${TARGET.project}.iam.gserviceaccount.com`,
    ...(job ? { maxRetries: 0 } : {}),
    containers: [{ image: `${TARGET.image}@${digest}`, ...(job ? { command: ['node'], args: ['dist/database/migrate.js'] } : {}), env: job ? [{ name: 'DEPLOYMENT_ENVIRONMENT', value: 'production' }, { name: 'NODE_ENV', value: 'production' }, secret('MIGRATION_DATABASE_URL', 'thatcampus-dt-migration-database-url')] : [
      ...Object.entries({ NODE_ENV: 'production', DEPLOYMENT_ENVIRONMENT: 'production', PUBLIC_URL: TARGET.origin, ALLOWED_ORIGINS: TARGET.origin, SESSION_COOKIE_NAME: TARGET.cookie, COOKIE_SECURE: 'true', UPLOAD_DIR: TARGET.filesMount, DATABASE_POOL_MAX: '4', SIMULATION_MAX_RUNNING_RUNS_PER_INSTITUTION: '1', SIMULATION_MAX_LEASES_PER_INSTITUTION: '1', SIMULATION_WORKER_MAX_RUNS_PER_POLL: '1' }).map(([name, value]) => ({ name, value })),
      secret('DATABASE_URL', 'thatcampus-dt-database-url'), secret('EVENT_DATABASE_URL', 'thatcampus-dt-database-url'), secret('CAMPUS_SIMULATION_DATABASE_URL', 'thatcampus-dt-simulation-database-url'), secret('COOKIE_SECRET', 'thatcampus-dt-cookie-secret'),
      secret('METRICS_TOKEN', 'thatcampus-dt-metrics-token'), secret('RESTRICTED_CASE_ENCRYPTION_KEY', 'thatcampus-dt-restricted-case-key'),
    ], ...(job ? {} : { volumeMounts: [{ name: 'private-files', mountPath: TARGET.filesMount }] }) }],
    ...(job ? {} : { volumes: [{ name: 'private-files', csi: { driver: 'gcsfuse.run.googleapis.com', volumeAttributes: { bucketName: TARGET.filesBucket, mountOptions: 'uid=1000,gid=1000,stat-cache-ttl=0s' } } }] }),
  } };
  return { metadata: { name: job ? TARGET.job : TARGET.service, ...(job ? {} : { annotations: { 'run.googleapis.com/minScale': '1', 'run.googleapis.com/maxScale': '1' } }) }, spec: { template: job ? { metadata: { annotations: sqlAnnotations }, spec: { template, taskCount: 1, parallelism: 1 } } : template } };
}
const built = () => ({ status: 'SUCCESS', results: { images: [{ name: `${TARGET.image}:${sha}`, digest }] } });
function candidate() { return { ...runtime(), status: { latestCreatedRevisionName: binding.revision, traffic: [{ revisionName: 'thatcampus-dt-previous', percent: 100 }, { revisionName: binding.revision, tag: TARGET.candidateTag, url: candidateUrl }] } }; }
const execution = () => ({ metadata: { name: `${TARGET.job}-abcde` }, status: { conditions: [{ type: 'Completed', status: 'True' }], succeededCount: 1, failedCount: 0 } });
function publicFetch(override = () => undefined) {
  const calls = [];
  const fetcher = async (url, init) => {
    const path = new URL(url).pathname; calls.push({ url, path, init });
    const changed = override(path, calls); if (changed) return changed;
    if (path === '/releasez') return Response.json({ release_sha: sha, environment: 'production' });
    if (path === '/readyz') return Response.json({ status: 'ready' });
    if (path === '/' || path === '/more/virtual-campus') return new Response('<!doctype html><div id="root"></div><script defer src="/_expo/static/js/web/entry.abcdef123.js"></script>', { headers: { 'Content-Type': 'text/html', 'Content-Security-Policy': "script-src 'self' 'wasm-unsafe-eval'; object-src 'none'" } });
    if (path.endsWith('.js')) return new Response('globalThis.ThatCampusApp=true;'.repeat(20), { headers: { 'Content-Type': 'text/javascript' } });
    if (path === wasm.path) return new Response(wasmBytes, { headers: { 'Content-Type': 'application/wasm' } });
    if (path === '/api/v1/workspace') return Response.json({ message: 'Sign in required' }, { status: 401 });
    if (path === '/api/v1/auth/native/login/') return Response.json({ error: { status: 400, code: 'validation_error', detail: 'Check the submitted fields and try again.', fields: { identifier: ['Required'], password: ['Required'] } } }, { status: 400 });
    throw new Error(`Unexpected smoke request ${path}`);
  };
  return { fetcher, calls };
}
function cloud(override = () => undefined) {
  const calls = []; let descriptions = 0;
  const execute = async args => {
    calls.push(args); const changed = override(args, calls); if (changed !== undefined) return changed;
    if (args.slice(0, 3).join(' ') === 'run services describe') return ++descriptions === 1 ? runtime() : candidate();
    if (args.slice(0, 3).join(' ') === 'run jobs describe') return runtime(true);
    if (args[0] === 'builds') return built();
    if (args.slice(0, 3).join(' ') === 'run jobs update') return runtime(true);
    if (args.slice(0, 3).join(' ') === 'run jobs execute') return execution();
    return {};
  };
  return { execute, calls };
}
const has = (calls, prefix) => calls.filter(args => args.slice(0, prefix.length).join(' ') === prefix.join(' '));

test('release guard rejects another repository, fork, branch, event, identity, image or local invocation before cloud operations', async () => {
  assert.equal(binding.revision.startsWith('thatcampus-dt-r-c1469261'), true);
  for (const change of [{ GITHUB_ACTIONS: undefined }, { GITHUB_REPOSITORY: 'attacker/Eduvera' }, { GITHUB_REPOSITORY_ID: '1' }, { GITHUB_REPOSITORY_OWNER_ID: '1' }, { GITHUB_REF: 'refs/heads/main' }, { GITHUB_WORKFLOW_REF: TARGET.workflowRef.replace('digital-twin-deploy.yml', 'other.yml') }, { GITHUB_EVENT_NAME: 'pull_request_target' }, { GITHUB_SHA: 'short' }, { GITHUB_RUN_ID: '1;echo secret' }, { DT_WIF_PROVIDER: TARGET.wifProvider.replace('367469594690', '1') }, { DT_CLOUD_SQL_INSTANCE: 'other:asia-south1:server' }, { GCP_SERVICE: 'another-app' }, { GCP_IMAGE: 'gcr.io/another/app' }]) {
    let calls = 0;
    await assert.rejects(release({ ...env, ...change }, { buildFile: '/reviewed/config.json', wasm, execute: () => { calls++; } }));
    assert.equal(calls, 0, JSON.stringify(change));
  }
});

test('preflight requires the independent service identities, versioned DT secrets, exact origin, cookie, bucket and bounded pool', () => {
  assert.doesNotThrow(() => assertRuntime(runtime(), binding)); assert.doesNotThrow(() => assertRuntime(runtime(true), binding, { job: true }));
  const mutate = fn => { const value = runtime(); fn(value.spec.template.spec, value); assert.throws(() => assertRuntime(value, binding)); };
  mutate(spec => { spec.serviceAccountName = 'default@developer.gserviceaccount.com'; });
  mutate(spec => { spec.containers.push(structuredClone(spec.containers[0])); });
  for (const name of ['DATABASE_URL', 'EVENT_DATABASE_URL', 'CAMPUS_SIMULATION_DATABASE_URL', 'COOKIE_SECRET']) {
    mutate(spec => { spec.containers[0].env.find(row => row.name === name).valueFrom.secretKeyRef.name = 'unrelated-existing-secret'; });
    mutate(spec => { spec.containers[0].env.find(row => row.name === name).valueFrom.secretKeyRef.key = 'latest'; });
  }
  for (const name of ['PUBLIC_URL', 'ALLOWED_ORIGINS', 'SESSION_COOKIE_NAME', 'COOKIE_SECURE', 'UPLOAD_DIR', 'DATABASE_POOL_MAX']) mutate(spec => { spec.containers[0].env.find(row => row.name === name).value = 'unexpected'; });
  mutate(spec => { spec.volumes[0].csi.volumeAttributes.bucketName = 'existing-erp-files'; });
  mutate(spec => { spec.containers[0].env.find(row => row.name === 'EVENT_DATABASE_URL').valueFrom.secretKeyRef.key = '2'; });
  const job = runtime(true); job.spec.template.spec.template.spec.containers[0].env.find(row => row.name === 'MIGRATION_DATABASE_URL').valueFrom.secretKeyRef.name = 'another-migration';
  assert.throws(() => assertRuntime(job, binding, { job: true }));
});

test('only the exact newly built immutable image can become the candidate or migration image', () => {
  const config = buildConfig(sha); assert.deepEqual(config.images, [`${TARGET.image}:${sha}`]);
  assert.deepEqual(config.steps[0].env, ['DOCKER_BUILDKIT=1'], 'Dockerfile-specific source allowlist requires BuildKit');
  assert.ok(config.steps[0].args.includes('deploy/dt/Dockerfile'));
  assert.ok(config.steps[0].args.includes(`EXPO_PUBLIC_API_URL=${TARGET.origin}`));
  assert.equal(immutableImage(built(), sha), `${TARGET.image}@${digest}`);
  for (const invalid of [{ status: 'FAILURE' }, { status: 'SUCCESS', results: { images: [{ name: `${TARGET.image}:latest`, digest }] } }, { status: 'SUCCESS', results: { images: [{ name: `${TARGET.image}:${sha}`, digest: 'latest' }] } }]) assert.throws(() => immutableImage(invalid, sha));
});

test('optional transactional mail requires the approved isolated versioned sender and is never enabled by release defaults', () => {
  const configured=()=>{const value=runtime();value.spec.template.spec.containers[0].env.push(...Object.entries({INVITATION_EMAIL_ENABLED:'true',INVITATION_EMAIL_PROVIDER:'resend',INVITATION_EMAIL_FROM:'noreply@thatcampus.com'}).map(([name,value])=>({name,value})),secret('RESEND_API_KEY','thatcampus-dt-resend-api-key'));return value;};
  assert.doesNotThrow(()=>assertRuntime(configured(),binding));
  for(const [name,value] of [['INVITATION_EMAIL_ENABLED','yes'],['INVITATION_EMAIL_PROVIDER','smtp'],['INVITATION_EMAIL_FROM','someone@another.example']]){const actual=configured();actual.spec.template.spec.containers[0].env.find(row=>row.name===name).value=value;assert.throws(()=>assertRuntime(actual,binding));}
  for(const patch of [{name:'erp-resend-api-key',key:'1'},{name:'thatcampus-dt-resend-api-key',key:'latest'}]){const actual=configured();actual.spec.template.spec.containers[0].env.find(row=>row.name==='RESEND_API_KEY').valueFrom.secretKeyRef=patch;assert.throws(()=>assertRuntime(actual,binding));}
  const plain=configured();plain.spec.template.spec.containers[0].env.find(row=>row.name==='RESEND_API_KEY').value='must-never-be-a-literal';assert.throws(()=>assertRuntime(plain,binding));
  const absent=configured();absent.spec.template.spec.containers[0].env=absent.spec.template.spec.containers[0].env.filter(row=>row.name!=='RESEND_API_KEY');assert.throws(()=>assertRuntime(absent,binding));
  const hidden=configured();hidden.spec.template.spec.containers[0].env=hidden.spec.template.spec.containers[0].env.map(row=>row.name==='INVITATION_EMAIL_ENABLED'?secret(row.name,'unreviewed-flag'):row);assert.throws(()=>assertRuntime(hidden,binding));
});

test('job Cloud SQL is required on the V1 ExecutionTemplate and cannot be replaced by a TaskTemplate annotation', () => {
  const job = runtime(true);
  assert.equal(job.spec.template.spec.template.metadata, undefined, 'the task fixture does not invent an inner Cloud SQL annotation');
  assert.doesNotThrow(() => assertRuntime(job, binding, { job: true }));
  job.spec.template.spec.template.metadata = structuredClone(job.spec.template.metadata);
  delete job.spec.template.metadata;
  assert.throws(() => assertRuntime(job, binding, { job: true }), /Cloud SQL/u);
});

const unsafeRuntime = [
  value => { delete value.metadata.annotations['run.googleapis.com/maxScale']; },
  value => { value.metadata.annotations['run.googleapis.com/maxScale'] = '2'; },
  value => { value.metadata.annotations['run.googleapis.com/minScale'] = '0'; },
  value => { value.metadata.annotations['run.googleapis.com/scalingMode'] = 'manual'; },
  value => { value.spec.template.metadata.annotations['autoscaling.knative.dev/maxScale'] = '2'; },
  value => { value.spec.template.metadata.annotations['autoscaling.knative.dev/minScale'] = '1'; },
  value => { delete value.spec.template.metadata.annotations['run.googleapis.com/cpu-throttling']; },
  value => { value.spec.template.metadata.annotations['run.googleapis.com/cpu-throttling'] = 'true'; },
  value => { value.spec.template.spec.volumes[0].csi.readOnly = true; },
  value => { value.spec.template.spec.volumes[0].csi.volumeAttributes.mountOptions = 'uid=0,gid=1000,stat-cache-ttl=0s'; },
  value => { value.spec.template.spec.volumes[0].csi.volumeAttributes.mountOptions = 'uid=1000,gid=1000,stat-cache-ttl=60s'; },
  value => { value.spec.template.spec.volumes[0].csi.volumeAttributes.mountOptions = 'uid=1000,gid=1000,stat-cache-ttl=0s,uid=0'; },
  value => { value.spec.template.spec.containers[0].volumeMounts.push({ name: 'private-files', mountPath: '/unreviewed-files' }); },
];
test('unsafe existing scaling, CPU or file mount fails closed before build/deploy', async () => {
  for (const mutate of unsafeRuntime) {
    const value = runtime(); mutate(value);
    const gcloud = cloud(args => args.slice(0, 3).join(' ') === 'run services describe' ? value : undefined);
    await assert.rejects(release(env, { ...gcloud, fetcher: publicFetch().fetcher, buildFile: '/reviewed/config.json', wasm }));
    assert.equal(gcloud.calls.length, 1, 'read-only preflight is the only dispatched operation');
  }
});
test('unsafe returned candidate scaling, CPU or mount cannot dispatch a migration or promotion', async () => {
  for (const mutate of unsafeRuntime) {
    let described = 0;
    const gcloud = cloud(args => {
      if (args.slice(0, 3).join(' ') !== 'run services describe') return undefined;
      if (++described === 1) return runtime();
      const value = candidate(); mutate(value); return value;
    });
    const smoke = publicFetch();
    await assert.rejects(release(env, { ...gcloud, fetcher: smoke.fetcher, buildFile: '/reviewed/config.json', wasm }));
    assert.equal(has(gcloud.calls, ['run', 'deploy']).length, 1);
    assert.equal(has(gcloud.calls, ['run', 'jobs', 'execute']).length, 0);
    assert.equal(has(gcloud.calls, ['run', 'services', 'update-traffic']).length, 0);
    assert.equal(smoke.calls.length, 0);
  }
});

test('source upload excludes OIDC credentials and private/local state independently of Docker COPY', () => {
  const require = createRequire(new URL('../../backend/package.json', import.meta.url)), ignore = require('ignore');
  const filter = ignore().add(sourceIgnore());
  for (const file of ['gha-creds-123abc.json', 'nested/gha-creds-123abc.json', '.git', '.git/config', '.runtime/source.json', 'backend/.runtime-native-check/dist/output.js', 'backend/artifacts/private.json', 'artifacts/private-proof.json', 'backend/.env', 'mobile/.env.local', 'secret.txt', 'keys/service-account.json', 'backend/storage/leave-documents/private.pdf', 'mobile/ios/build/app', 'mobile/android/app/build/app.apk']) assert.equal(filter.ignores(file), true, file);
  for (const file of ['backend/src/main.ts', 'backend/migrations/001_init.sql', 'mobile/app/_layout.tsx', 'mobile/public/skia/canvaskit-0.41.0-example.wasm', 'packages/contracts/src/campus-scenes/types.ts', 'deploy/dt/Dockerfile', 'devtools/campus-simulator/src/index.mjs']) assert.equal(filter.ignores(file), false, file);
  assert.equal(sourceIgnore().includes('#!include:.gitignore'), false, 'Cloud Build does not need to consult protected Git metadata');
});

test('candidate checks validate release, readiness, actual JS/WASM bytes, anonymous refusal and cookie-free native validation', async () => {
  const smoke = publicFetch(), result = await verify(candidateUrl, sha, wasm, smoke.fetcher);
  assert.equal(result.nativeValidation, true); assert.equal(result.wasm, true);
  const native = smoke.calls.find(row => row.path === '/api/v1/auth/native/login/');
  assert.equal(native.init.body, '{}'); assert.equal(native.init.method, 'POST');
  assert.equal(native.init.headers.Authorization, undefined); assert.equal(native.init.headers.Cookie, undefined); assert.equal(native.init.headers.Origin, undefined);
  for (const request of smoke.calls) { assert.equal(new URL(request.url).origin, candidateUrl); assert.equal(request.init.redirect, 'error'); }
});

test('stale release, missing assets, HTML fallbacks, untrusted scripts, bad WASM and native cookies prevent migration/promotion', async () => {
  const cases = [
    path => path === '/api/v1/auth/native/login/' ? Response.json({ message: 'An unrelated 400 error' }, { status: 400 }) : undefined,
    path => path === '/releasez' ? Response.json({ release_sha: 'wrong', environment: 'production' }) : undefined,
    path => path === '/readyz' ? Response.json({ status: 'starting' }) : undefined,
    path => path.endsWith('.js') ? new Response('<html>fallback</html>', { headers: { 'Content-Type': 'text/html' } }) : undefined,
    path => path === '/' ? new Response('<div id="root"></div><script src="https://foreign.test/app.js"></script>', { headers: { 'Content-Type': 'text/html', 'Content-Security-Policy': "script-src 'self' 'wasm-unsafe-eval'" } }) : undefined,
    path => path === wasm.path ? new Response(Buffer.from('wrong payload'), { headers: { 'Content-Type': 'application/wasm' } }) : undefined,
    path => path === '/api/v1/auth/native/login/' ? Response.json({ error: 'invalid' }, { status: 400, headers: { 'Set-Cookie': 'unexpected=session' } }) : undefined,
  ];
  for (const corrupt of cases) {
    const gcloud = cloud(), smoke = publicFetch(corrupt);
    await assert.rejects(release(env, { ...gcloud, fetcher: smoke.fetcher, buildFile: '/reviewed/config.json', wasm }));
    assert.equal(has(gcloud.calls, ['run', 'jobs', 'execute']).length, 0); assert.equal(has(gcloud.calls, ['run', 'services', 'update-traffic']).length, 0);
  }
});

test('successful release orders zero-traffic candidate checks, exactly one migration, repeated checks and exact revision promotion', async () => {
  const gcloud = cloud(), smoke = publicFetch(), phases = [];
  const receipt = await release(env, { ...gcloud, fetcher: smoke.fetcher, buildFile: '/reviewed/config.json', wasm, onPhase: value => phases.push(value) });
  assert.equal(receipt.status, 'passed'); assert.equal(receipt.image, `${TARGET.image}@${digest}`);
  assert.deepEqual(phases, ['preflight', 'build', 'candidate', 'candidate-smoke', 'migration', 'post-migration-smoke', 'promote', 'public-smoke', 'complete']);
  const deploy = has(gcloud.calls, ['run', 'deploy'])[0]; assert.ok(deploy.includes('--no-traffic')); assert.ok(deploy.includes('--no-cpu-throttling')); assert.ok(deploy.includes('--min=1')); assert.ok(deploy.includes('--max=1'));
  const build = has(gcloud.calls, ['builds', 'submit'])[0]; assert.ok(build.includes('--ignore-file')); assert.ok(build.includes('/reviewed/source.ignore'));
  assert.equal(build[build.indexOf('--gcs-source-staging-dir') + 1], 'gs://eduera-511111-thatcampus-dt-build/sources', 'source upload uses only the new private DT build bucket');
  const update = has(gcloud.calls, ['run', 'jobs', 'update'])[0];
  for (const flag of ['--max-retries=0', '--tasks=1', '--parallelism=1', '--command=node', '--args=dist/database/migrate.js']) assert.ok(update.includes(flag));
  assert.equal(has(gcloud.calls, ['run', 'jobs', 'execute']).length, 1);
  const promotion = has(gcloud.calls, ['run', 'services', 'update-traffic'])[0]; assert.ok(promotion.includes(`${binding.revision}=100`)); assert.equal(promotion.includes('--to-latest'), false);
  for (const command of gcloud.calls) { assert.ok(command.includes(TARGET.project)); assert.ok(command.includes(TARGET.region)); }
  assert.equal(smoke.calls.filter(row => row.path === '/releasez').length, 3, 'candidate is checked before and after migration, then the public hostname');
});

test('failed or uncertain migration executes once and never promotes or attempts a database rollback', async () => {
  for (const failure of [new Error('Connection lost after dispatch'), { metadata: { name: `${TARGET.job}-failed` }, status: { failedCount: 1, conditions: [{ type: 'Completed', status: 'False' }] } }]) {
    const gcloud = cloud(args => { if (args.slice(0, 3).join(' ') === 'run jobs execute') { if (failure instanceof Error) throw failure; return failure; } });
    await assert.rejects(release(env, { ...gcloud, fetcher: publicFetch().fetcher, buildFile: '/reviewed/config.json', wasm }));
    assert.equal(has(gcloud.calls, ['run', 'jobs', 'execute']).length, 1); assert.equal(has(gcloud.calls, ['run', 'services', 'update-traffic']).length, 0);
    assert.equal(gcloud.calls.some(args => args.some(value => /rollback|down-migrat|delete-database/iu.test(value))), false);
  }
});

test('a post-migration candidate failure leaves current traffic intact and never reruns the migration', async () => {
  const gcloud = cloud(); let readiness = 0;
  const smoke = publicFetch(path => path === '/readyz' && ++readiness === 2 ? Response.json({ status: 'failed' }) : undefined);
  await assert.rejects(release(env, { ...gcloud, fetcher: smoke.fetcher, buildFile: '/reviewed/config.json', wasm }));
  assert.equal(has(gcloud.calls, ['run', 'jobs', 'execute']).length, 1); assert.equal(has(gcloud.calls, ['run', 'services', 'update-traffic']).length, 0);
});

test('CanvasKit manifest is derived from the locked installed payload and rejects stale or tampered bytes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dt-wasm-test-'));
  try {
    await writeFile(join(directory, wasm.path.split('/').at(-1)), wasmBytes);
    assert.deepEqual(await webAssemblyManifest(directory), wasm);
    await writeFile(join(directory, wasm.path.split('/').at(-1)), 'changed'); await assert.rejects(webAssemblyManifest(directory));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('one maintained workflow verifies only active applications, uses pinned OIDC actions and never cancels a running migration', async () => {
  const require = createRequire(new URL('../../mobile/package.json', import.meta.url)), yaml = require('js-yaml');
  const workflow = yaml.load(await readFile(new URL('../../.github/workflows/digital-twin-deploy.yml', import.meta.url), 'utf8'));
  assert.deepEqual(workflow.on.push.branches, ['codex/campus-digital-twin']); assert.deepEqual(Object.keys(workflow.on).sort(), ['push', 'workflow_dispatch']);
  assert.equal(workflow.concurrency['cancel-in-progress'], false); assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.equal(workflow.jobs.verify.permissions?.['id-token'], undefined); assert.equal(workflow.jobs.deploy.permissions['id-token'], 'write');
  assert.equal(workflow.jobs.deploy.needs, 'verify');
  for (const job of Object.values(workflow.jobs)) {
    assert.ok(job.if.includes(TARGET.repositoryId)); assert.ok(job.if.includes(TARGET.ownerId)); assert.ok(job.if.includes(TARGET.ref));
    for (const step of job.steps) { if (step.uses) assert.match(step.uses, /^[a-zA-Z0-9/_-]+@[a-f0-9]{40}$/u); assert.equal(step.with?.credentials_json, undefined); }
  }
  const source = workflow.jobs.verify.steps.filter(row => row.run).map(row => row.run).join('\n');
  for (const expected of ['simulation:conformance', 'typecheck', 'test:fast', 'web-assets.test.ts', 'simulation-conformance.test.ts', 'npm --prefix mobile test', 'export:web', 'deploy/dt/*.test.mjs deploy/dt/edge/*.test.mjs', '--prefix packages/contracts', 'verify-web-export.mjs']) assert.ok(source.includes(expected), expected);
  const sourceAuth = workflow.jobs.verify.steps.find(row => row.name === 'Disposable database and relevant backend behavior').run;
  const sourceAuthCommand = sourceAuth.split('\n').find(line => line.startsWith('node --import tsx node_modules/vitest/vitest.mjs run '));
  assert.ok(sourceAuthCommand, 'The explicit source/auth command must remain inspectable');
  assert.deepEqual(sourceAuthCommand.match(/test\/[a-z0-9.-]+\.test\.ts/gu), [
    'test/native-auth.test.ts', 'test/web-assets.test.ts', 'test/simulation-conformance.test.ts', 'test/account-mail-smtp.test.ts',
  ]);
  assert.doesNotMatch(sourceAuth, /test\/native-auth-session\.integration\.test\.ts/u, 'DB session cases belong to the complete PostgreSQL matrix, not the source/auth count');
  assert.equal(source.includes('--prefix frontend'), false); assert.equal(source.includes('conformance:update'), false);
  const releaseStep = workflow.jobs.deploy.steps.find(row => row.run === 'node deploy/dt/release.mjs');
  assert.equal(releaseStep.env.CLOUDSDK_AUTH_ACCESS_TOKEN, '${{ steps.google-auth.outputs.access_token }}');
  await assert.rejects(access(new URL('../../.github/workflows/digital-twin.yml', import.meta.url)), /ENOENT/u);
});

test('the owned PostgreSQL gate retains all46 files, explicit temporary HTTP build and bounded existing database targets', async () => {
  const require = createRequire(new URL('../../mobile/package.json', import.meta.url)), yaml = require('js-yaml');
  const workflow = yaml.load(await readFile(new URL('../../.github/workflows/digital-twin-deploy.yml', import.meta.url), 'utf8'));
  const step = workflow.jobs.verify.steps.find(row => row.name === 'Native identity, role revocation and real isolated-world regressions');
  const declaration = step.run.match(/const files = (\[[\s\S]*?\])\.map\(name => `test\/\$\{name\}\.integration\.test\.ts`\);/u);
  assert.ok(declaration, 'Regression inventory must remain explicit');
  const names = Array.from(runInNewContext(declaration[1]));
  assert.equal(names.length, 46); assert.equal(new Set(names).size, 46);
  for (const name of ['native-auth-session', 'academic-catalogue-recovery', 'academic-catalogue-recovery-http', 'learning-assignment-handover', 'learning-assignment-handover-worlds', 'domain-message-supersession', 'learning-assignments', 'learning-assignment-files-worlds', 'exam-schedule-amendments', 'exam-operations', 'exam-room-allocations', 'assessment-result-reviews', 'campus-operations-worlds', 'simulation-branch-concurrency', 'account-mail-delivery', 'account-mail-http', 'invitation-queue', 'native-google-locks', 'learning-elective-change', 'learning-elective-change-worlds', 'academic-offering-cycle', 'academic-offering-worlds', 'academic-offering-http', 'assessments', 'academic-reports', 'academic-history-integrity', 'grading-policy-worlds', 'assessment-evidence-integrity', 'assessment-result-worlds', 'assessment-correction-worlds'])
    assert.ok(names.includes(name), name);
  for (const name of names) await access(new URL(`../../backend/test/${name}.integration.test.ts`, import.meta.url));
  for (const name of ['LEARNING_ASSIGNMENTS_SIMULATION_TEST_TARGET_URL', 'CAMPUS_OPERATIONS_SIMULATION_TEST_TARGET_URL', 'ASSESSMENTS_SIMULATION_TEST_TARGET_URL', 'ACADEMIC_CATALOGUE_SIMULATION_TEST_TARGET_URL', 'ACADEMIC_OFFERING_SIMULATION_TEST_TARGET_URL', 'ACADEMIC_HISTORY_SIMULATION_TEST_TARGET_URL', 'GRADING_POLICY_SIMULATION_TEST_TARGET_URL', 'ASSESSMENT_EVIDENCE_SIMULATION_TEST_TARGET_URL', 'SIMULATION_MARKS_TEST_TARGET_URL', 'SIMULATION_CORRECTION_TEST_TARGET_URL'])
    assert.equal(step.env[name], step.env.CAMPUS_SIMULATION_DATABASE_URL, name);
  assert.equal(new URL(step.env.CAMPUS_SIMULATION_DATABASE_URL).pathname, '/thatcampus_dt_simulation_test');
  assert.equal(new URL(step.env.CAMPUS_SIMULATION_DATABASE_URL).hostname, '127.0.0.1');
  assert.equal(step.env.SIMULATION_COLD_COW_TEST_ISOLATED,'true');
  assert.equal(step.env.SIMULATION_COLD_COW_DATABASE_URL,workflow.jobs.verify.env.DATABASE_URL);
  assert.equal(step.env.SIMULATION_COLD_COW_EXPECT_DATABASE,'thatcampus_dt_test');
  assert.equal(step.env.NATIVE_GOOGLE_LOCKS_TEST_ISOLATED,'true');
  assert.equal(step.env.NATIVE_GOOGLE_LOCKS_EXPECT_DATABASE,'thatcampus_dt_test');
  for (const name of ['ACADEMIC_CATALOGUE_HTTP_COMPILED_ROOT','ACCOUNT_MAIL_HTTP_COMPILED_ROOT','ACADEMIC_OFFERING_HTTP_COMPILED_ROOT']) assert.ok(step.run.includes(name+": join(directory, 'dist')"),name);
  assert.match(step.run, /VISIT_ONBOARDING_HTTP_COMPILED_ROOT: join\(directory, 'dist'\)/u);
  assert.match(step.run, /await cp\(resolve\('dist'\), join\(directory, 'dist'\), \{ recursive: true \}\)/u);
  assert.equal(workflow.jobs.verify['timeout-minutes'], 45); assert.equal(workflow.jobs.deploy['timeout-minutes'], 60);
  assert.equal(step.env.DATABASE_POOL_MAX, '2');
  assert.doesNotMatch(step.run, /printenv|console\.log\(process\.env|JSON\.stringify\(process\.env|set -x/u);
});

test('the actual workflow summary gate rejects missing, skipped, todo, failed or fewer than217 PostgreSQL cases', async () => {
  const require = createRequire(new URL('../../mobile/package.json', import.meta.url)), yaml = require('js-yaml');
  const workflow = yaml.load(await readFile(new URL('../../.github/workflows/digital-twin-deploy.yml', import.meta.url), 'utf8'));
  const source = workflow.jobs.verify.steps.find(row => row.name === 'Native identity, role revocation and real isolated-world regressions').run;
  const guard = source.match(/if \(summary\.numTotalTests[\s\S]*?throw new Error\('[^']+'\);/u)?.[0];
  assert.ok(guard); assert.match(guard, /summary\.numTotalTests < 217/u);
  const accepted = { numTotalTests: 217, numPassedTests: 217, numPendingTests: 0, numTodoTests: 0 };
  const check = summary => runInNewContext(guard, { summary });
  assert.doesNotThrow(() => check(accepted));
  assert.doesNotThrow(() => check({ ...accepted, numTotalTests: 218, numPassedTests: 218 }));
  for (const summary of [{}, { ...accepted, numTotalTests: 216, numPassedTests: 216 }, { ...accepted, numPassedTests: 216 },
    { ...accepted, numPendingTests: 1 }, { ...accepted, numTodoTests: 1 }]) assert.throws(() => check(summary), /217/u);
});
