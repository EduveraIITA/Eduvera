import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const TARGET = Object.freeze({
  repository: 'EduveraIITA/Eduvera', repositoryId: '1361145323', ownerId: '328263463',
  ref: 'refs/heads/codex/campus-digital-twin', project: 'eduera-511111', region: 'asia-south1',
  workflowRef: 'EduveraIITA/Eduvera/.github/workflows/digital-twin-deploy.yml@refs/heads/codex/campus-digital-twin',
  service: 'thatcampus-dt', job: 'thatcampus-dt-migrate',
  image: 'asia-south1-docker.pkg.dev/eduera-511111/thatcampus-dt/app',
  origin: 'https://app2.thatcampus.com', cookie: 'thatcampus_dt_session',
  sqlInstance: 'eduera-511111:asia-south1:eduera-db',
  wifProvider: 'projects/367469594690/locations/global/workloadIdentityPools/github-dt/providers/github',
  filesBucket: 'eduera-511111-thatcampus-dt-files', filesMount: '/app/storage/leave-documents',
  sourceStaging: 'gs://eduera-511111-thatcampus-dt-build/sources',
  candidateTag: 'dt-candidate',
});
const account = role => `dt-${role}@${TARGET.project}.iam.gserviceaccount.com`;
const shaPattern = /^[a-f0-9]{40}$/u, digestPattern = /^sha256:[a-f0-9]{64}$/u;

/** This entry point is deliberately not a generic deploy script. It cannot be
 * redirected at a different branch, application, project, image or identity. */
export function guard(env) {
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_REPOSITORY !== TARGET.repository
    || env.GITHUB_REPOSITORY_ID !== TARGET.repositoryId || env.GITHUB_REPOSITORY_OWNER_ID !== TARGET.ownerId
    || env.GITHUB_REF !== TARGET.ref || env.GITHUB_WORKFLOW_REF !== TARGET.workflowRef || !['push', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME)) {
    throw new Error('Digital Twin deployment requires the exact authorized GitHub repository and branch.');
  }
  if (!shaPattern.test(env.GITHUB_SHA ?? '')) throw new Error('A full commit SHA is required.');
  if (!/^[1-9][0-9]{0,19}$/u.test(env.GITHUB_RUN_ID ?? '') || !/^[1-9][0-9]{0,3}$/u.test(env.GITHUB_RUN_ATTEMPT ?? '')) throw new Error('A GitHub run identity is required.');
  if (env.DT_WIF_PROVIDER !== TARGET.wifProvider) throw new Error('The isolated Digital Twin WIF provider is required.');
  if (env.DT_CLOUD_SQL_INSTANCE !== TARGET.sqlInstance) throw new Error('The reviewed Cloud SQL connection name is required.');
  for (const [key, expected] of Object.entries({ GCP_PROJECT: TARGET.project, GCP_REGION: TARGET.region, GCP_SERVICE: TARGET.service, GCP_IMAGE: TARGET.image })) {
    if (env[key] !== undefined && env[key] !== expected) throw new Error(`Unexpected ${key}.`);
  }
  const suffix = `r-${env.GITHUB_SHA.slice(0, 12)}-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`;
  const revision = `${TARGET.service}-${suffix}`;
  if (revision.length > 63) throw new Error('The candidate revision name is too long.');
  return { sha: env.GITHUB_SHA, suffix, revision, sqlInstance: env.DT_CLOUD_SQL_INSTANCE };
}

function templateOf(resource, job) {
  return job ? resource?.spec?.template?.spec?.template : resource?.spec?.template;
}
function environmentOf(container) {
  const rows = container?.env ?? [];
  if (new Set(rows.map(row => row.name)).size !== rows.length) throw new Error('Duplicate runtime environment entries.');
  return Object.fromEntries(rows.map(row => [row.name, row]));
}
function secretReference(env, key, expected) {
  const row = env[key], secret = row?.valueFrom?.secretKeyRef;
  if (row?.value !== undefined || secret?.name !== expected || !/^[1-9][0-9]*$/u.test(secret?.key ?? '')) {
    throw new Error(`An isolated, version-pinned Digital Twin secret is required for ${key}.`);
  }
  return secret.name;
}
export function assertRuntime(resource, binding, { job = false, image } = {}) {
  if (resource?.metadata?.name !== (job ? TARGET.job : TARGET.service)) throw new Error('Unexpected Cloud Run resource.');
  const template = templateOf(resource, job), spec = template?.spec, containers = spec?.containers;
  if (spec?.serviceAccountName !== account(job ? 'migrator' : 'runtime') || containers?.length !== 1) throw new Error('Unexpected runtime identity or container count.');
  if (!containers[0].image?.startsWith(`${TARGET.image}@`) || image && containers[0].image !== image) throw new Error('Unexpected deployed Digital Twin image.');
  const env = environmentOf(containers[0]);
  if (env.DEPLOYMENT_ENVIRONMENT?.value !== 'production' || env.NODE_ENV?.value !== 'production') throw new Error('Digital Twin requires its own production environment binding.');
  // A job attaches Cloud SQL to its ExecutionTemplate, while its identity and
  // containers belong to the nested TaskTemplate. Service bindings live on the
  // RevisionTemplate. Read the actual V1 API locations rather than a shared
  // synthetic shape that could accept an ineffective job annotation.
  const annotations = (job ? resource.spec.template : template).metadata?.annotations ?? {};
  if (annotations['run.googleapis.com/cloudsql-instances'] !== binding.sqlInstance) throw new Error('Unexpected Cloud SQL connection binding.');
  if (job) {
    secretReference(env, 'MIGRATION_DATABASE_URL', 'thatcampus-dt-migration-database-url');
    const task = resource.spec.template.spec;
    if (task.taskCount !== 1 || task.parallelism !== 1 || spec.maxRetries !== 0
      || JSON.stringify(containers[0].command) !== '["node"]' || JSON.stringify(containers[0].args) !== '["dist/database/migrate.js"]') throw new Error('Migration must be one task, one attempt and the exact migration entry point.');
    return;
  }
  const serviceAnnotations = resource.metadata.annotations ?? {};
  if (serviceAnnotations['run.googleapis.com/minScale'] !== '1' || serviceAnnotations['run.googleapis.com/maxScale'] !== '1'
    || annotations['autoscaling.knative.dev/maxScale'] !== '1'
    || ![undefined, '0'].includes(annotations['autoscaling.knative.dev/minScale'])
    || ![undefined, 'automatic'].includes(serviceAnnotations['run.googleapis.com/scalingMode'])
    || serviceAnnotations['run.googleapis.com/manualInstanceCount'] !== undefined
    || annotations['run.googleapis.com/cpu-throttling'] !== 'false') throw new Error('Digital Twin requires one service instance, bounded revisions and always-allocated CPU.');
  const database = secretReference(env, 'DATABASE_URL', 'thatcampus-dt-database-url'), simulation = secretReference(env, 'CAMPUS_SIMULATION_DATABASE_URL', 'thatcampus-dt-simulation-database-url');
  if (database === simulation) throw new Error('Live and Simulation database secrets must be distinct.');
  if (secretReference(env, 'EVENT_DATABASE_URL', 'thatcampus-dt-database-url') !== database) throw new Error('Events must bind to the same new Digital Twin application database.');
  if (env.EVENT_DATABASE_URL.valueFrom.secretKeyRef.key !== env.DATABASE_URL.valueFrom.secretKeyRef.key) throw new Error('Application and events database secret versions must match.');
  secretReference(env, 'COOKIE_SECRET', 'thatcampus-dt-cookie-secret');
  secretReference(env, 'METRICS_TOKEN', 'thatcampus-dt-metrics-token');
  secretReference(env, 'RESTRICTED_CASE_ENCRYPTION_KEY', 'thatcampus-dt-restricted-case-key');
  for (const key of ['DEMO_MODE', 'PUBLIC_DEMO_ENABLED', 'DEMO_PROFILE_SWITCHER_ENABLED', 'HOSTED_CAMPUS_SIMULATOR_ENABLED']) {
    if (env[key]?.value && env[key].value !== 'false') throw new Error(`The ordinary Digital Twin deployment must not enable ${key}.`);
  }
  for (const [key, value] of Object.entries({ PUBLIC_URL: TARGET.origin, ALLOWED_ORIGINS: TARGET.origin, SESSION_COOKIE_NAME: TARGET.cookie, COOKIE_SECURE: 'true', UPLOAD_DIR: TARGET.filesMount, DATABASE_POOL_MAX: '4', SIMULATION_MAX_RUNNING_RUNS_PER_INSTITUTION: '1', SIMULATION_MAX_LEASES_PER_INSTITUTION: '1', SIMULATION_WORKER_MAX_RUNS_PER_POLL: '1' })) {
    if (env[key]?.value !== value) throw new Error(`Unexpected Digital Twin ${key}.`);
  }
  const mounts = containers[0].volumeMounts ?? [], volumes = spec.volumes ?? [];
  const mount = mounts.find(row => row.mountPath === TARGET.filesMount), volume = volumes.find(row => row.name === mount?.name);
  if (mounts.length !== 1 || volumes.length !== 1 || volume?.csi?.driver !== 'gcsfuse.run.googleapis.com'
    || volume.csi.volumeAttributes?.bucketName !== TARGET.filesBucket || ![undefined, false].includes(volume.csi.readOnly)) throw new Error('The new writable private Digital Twin file bucket mount is required.');
  const options = volume.csi.volumeAttributes.mountOptions?.split(',').map(row => row.trim().split('='));
  if (!options || options.some(row => row.length !== 2) || new Set(options.map(row => row[0])).size !== options.length) throw new Error('Explicit, unambiguous Digital Twin file mount options are required.');
  const mountOptions = Object.fromEntries(options);
  const zeroCache = mountOptions['stat-cache-ttl'] === '0s' || mountOptions['metadata-cache-ttl-secs'] === '0';
  if (options.length !== 3 || mountOptions.uid !== '1000' || mountOptions.gid !== '1000' || !zeroCache) throw new Error('Digital Twin file mount requires node ownership and zero metadata cache TTL.');
}

export function buildConfig(sha) {
  if (!shaPattern.test(sha ?? '')) throw new Error('A full build SHA is required.');
  const image = `${TARGET.image}:${sha}`;
  return {
    steps: [{ name: 'gcr.io/cloud-builders/docker', env: ['DOCKER_BUILDKIT=1'], args: ['build', '--file', 'deploy/dt/Dockerfile', '--build-arg', `RELEASE_SHA=${sha}`, '--build-arg', `EXPO_PUBLIC_API_URL=${TARGET.origin}`, '--tag', image, '.'] }],
    images: [image], tags: ['thatcampus-dt', `sha-${sha}`], timeout: '2400s', options: { logging: 'CLOUD_LOGGING_ONLY' },
  };
}
/** Source upload is a separate boundary from Docker COPY. In particular the
 * temporary OIDC credential file must never enter the Cloud Build source tar. */
export function sourceIgnore() {
  return [
    '.git', '**/.git', '**/node_modules', '**/dist', '**/coverage',
    '.runtime', '**/.runtime', '.runtime-*', '**/.runtime-*', 'artifacts', '**/artifacts', 'research', '**/research', 'tmp', '.codex',
    '.env', '.env.*', '**/.env', '**/.env.*', '**/secret.txt', 'secret.txt',
    'gha-creds-*.json', '**/gha-creds-*.json', '**/*.key', '**/*.p12', '**/*.p8',
    '**/*service-account*.json', '**/*credentials*.json',
    'backend/storage', 'mobile/ios', 'mobile/android', 'mobile/.expo',
    '**/.DS_Store', '**/*.log',
  ].join('\n') + '\n';
}
export function immutableImage(build, sha) {
  if (build?.status !== 'SUCCESS') throw new Error('Cloud Build did not report success.');
  const built = build.results?.images?.find(row => row.name === `${TARGET.image}:${sha}`);
  if (!digestPattern.test(built?.digest ?? '')) throw new Error('The exact built image digest is missing.');
  return `${TARGET.image}@${built.digest}`;
}
function assertImage(image) {
  if (!image?.startsWith(`${TARGET.image}@`) || !digestPattern.test(image.slice(TARGET.image.length + 1))) throw new Error('Only the new Digital Twin image digest can deploy.');
}
function candidateOrigin(service, binding) {
  if (service?.status?.latestCreatedRevisionName !== binding.revision) throw new Error('The expected candidate revision was not created.');
  const candidate = service.status.traffic?.find(row => row.tag === TARGET.candidateTag && row.revisionName === binding.revision);
  if (!candidate || Number(candidate.percent ?? 0) !== 0 || service.status.traffic.some(row => Number(row.percent ?? 0) > 0 && (row.revisionName === binding.revision || row.latestRevision === true))) throw new Error('Candidate must have a tag and zero production traffic.');
  const url = new URL(candidate.url);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash
    || !url.hostname.startsWith(`${TARGET.candidateTag}---${TARGET.service}-`) || !url.hostname.endsWith('.run.app')) throw new Error('Unexpected candidate URL.');
  return url.origin;
}
export async function webAssemblyManifest(directory = 'mobile/public/skia') {
  const candidates = (await readdir(directory)).filter(name => /^canvaskit-[0-9.]+-[a-f0-9]{12}\.wasm$/u.test(name));
  if (candidates.length !== 1) throw new Error('Exactly one installed CanvasKit payload is required.');
  const bytes = await readFile(join(directory, candidates[0]));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (!candidates[0].includes(`-${sha256.slice(0, 12)}.wasm`) || !bytes.subarray(0, 8).equals(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]))) throw new Error('The installed CanvasKit payload is invalid.');
  return { path: `/skia/${candidates[0]}`, sha256 };
}
async function responseBytes(response, maximum) {
  const declared = response.headers.get('content-length');
  if (declared && (!/^[0-9]+$/u.test(declared) || Number(declared) > maximum)) throw new Error('Smoke response is too large.');
  const chunks = []; let length = 0;
  for await (const chunk of response.body ?? []) { length += chunk.length; if (length > maximum) throw new Error('Smoke response exceeded its limit.'); chunks.push(Buffer.from(chunk)); }
  return Buffer.concat(chunks);
}
/** Public, credential-free checks: {} validates the native route without
 * authenticating an account, creating a session or performing a domain write. */
export async function verify(origin, sha, wasm, fetcher = fetch) {
  if (!shaPattern.test(sha ?? '')) throw new Error('An exact full release SHA is required for smoke checks.');
  const base = new URL(origin);
  if (base.protocol !== 'https:' || base.username || base.password || base.origin !== origin) throw new Error('An exact HTTPS smoke origin is required.');
  const request = async (path, init = {}, { status = 200, mime, maximum = 64 * 1024 } = {}) => {
    const url = new URL(path, base);
    if (url.origin !== origin || !url.pathname.startsWith('/') || url.username || url.password) throw new Error('A smoke check escaped its candidate origin.');
    const response = await fetcher(url.href, { ...init, redirect: 'error', signal: AbortSignal.timeout(30_000), headers: { ...init.headers, 'Cache-Control': 'no-cache' } });
    if (response.status !== status || mime && !mime.test(response.headers.get('content-type') ?? '')) throw new Error(`Smoke response failed for ${url.pathname}.`);
    return { response, bytes: await responseBytes(response, maximum) };
  };
  const json = async (path, init, status) => {
    const result = await request(path, init, { status, mime: /^application\/(?:[a-z0-9.+-]+\+)?json\b/iu });
    return { ...result, value: JSON.parse(result.bytes.toString('utf8')) };
  };
  const release = (await json('/releasez')).value;
  if (release.release_sha !== sha || release.environment !== 'production') throw new Error('Candidate release identity is incorrect.');
  if ((await json('/readyz')).value.status !== 'ready') throw new Error('Database/events are not ready.');
  const home = await request('/', {}, { mime: /^text\/html\b/iu, maximum: 2 * 1024 * 1024 });
  const html = home.bytes.toString('utf8');
  if (!/id=["']root["']/u.test(html)) throw new Error('The Expo application root is missing.');
  const deepLink = await request('/more/virtual-campus', {}, { mime: /^text\/html\b/iu, maximum: 2 * 1024 * 1024 });
  if (!deepLink.bytes.equals(home.bytes)) throw new Error('A canonical campus deep link did not return the same packaged application.');
  const policy = home.response.headers.get('content-security-policy') ?? '';
  const scriptPolicy = policy.split(';').find(value => value.trim().startsWith('script-src ')) ?? '';
  if (!scriptPolicy.includes("'wasm-unsafe-eval'") || /(?:^|\s)'unsafe-eval'(?:\s|$)/u.test(scriptPolicy)) throw new Error('The reviewed same-origin WebAssembly CSP is missing.');
  const scriptPaths = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/giu)].map(match => new URL(match[1], base));
  if (!scriptPaths.length || scriptPaths.length > 5) throw new Error('The Expo entry script is missing or ambiguous.');
  for (const script of scriptPaths) {
    if (script.origin !== origin || !/^\/_expo\/static\/js\/web\/[a-zA-Z0-9._-]+\.js$/u.test(script.pathname) || script.search || script.hash) throw new Error('An unexpected entry script escaped the packaged Expo boundary.');
    const bundle = await request(script.pathname, {}, { mime: /(?:java|ecma)script/iu, maximum: 32 * 1024 * 1024 });
    if (bundle.bytes.length < 128 || /^\s*</u.test(bundle.bytes.toString('utf8', 0, 256))) throw new Error('The entry script returned an HTML fallback.');
  }
  if (!/^\/skia\/canvaskit-[0-9.]+-[a-f0-9]{12}\.wasm$/u.test(wasm?.path ?? '') || !/^[a-f0-9]{64}$/u.test(wasm?.sha256 ?? '')) throw new Error('The reviewed WebAssembly manifest is required.');
  const module = await request(wasm.path, {}, { mime: /^application\/wasm\b/iu, maximum: 24 * 1024 * 1024 });
  if (createHash('sha256').update(module.bytes).digest('hex') !== wasm.sha256) throw new Error('The deployed WebAssembly payload differs from the installed dependency.');
  const denied = await json('/api/v1/workspace', undefined, 401);
  if (denied.response.headers.get('set-cookie')) throw new Error('An anonymous protected read issued a session cookie.');
  const native = await json('/api/v1/auth/native/login/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, 400);
  if (native.response.headers.get('set-cookie') || native.value?.access_token || native.value?.user) throw new Error('The native validation probe created an unexpected session.');
  if (native.value?.error?.status !== 400 || native.value.error.code !== 'validation_error'
    || typeof native.value.error.detail !== 'string' || !native.value.error.detail.trim()
    || !Array.isArray(native.value.error.fields?.identifier) || !native.value.error.fields.identifier.length
    || !Array.isArray(native.value.error.fields?.password) || !native.value.error.fields.password.length) throw new Error('The native validation probe did not return its owning API error.');
  return { release: true, ready: true, expo: true, deepLink: true, scripts: scriptPaths.length, wasm: true, anonymousRefusal: true, nativeValidation: true };
}

function defaultExecute(args) {
  const result = spawnSync('gcloud', [...args, '--quiet'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, env: { ...process.env, CLOUDSDK_CORE_DISABLE_PROMPTS: '1' } });
  if (result.error || result.status !== 0) throw new Error(`Cloud operation failed: ${args.slice(0, 3).join(' ')} (no automatic replay). Inspect Cloud Run/Build logs.`);
  try { return JSON.parse(result.stdout); } catch { throw new Error('Cloud operation did not return inspectable JSON.'); }
}
function assertExecution(execution) {
  if (!execution?.metadata?.name?.startsWith(`${TARGET.job}-`) || execution.status?.failedCount > 0
    || !execution.status?.conditions?.some(row => row.type === 'Completed' && row.status === 'True')) throw new Error('The one-attempt migration execution did not complete successfully.');
}

/** No general retry wrapper surrounds cloud mutations or migration execution.
 * Failure leaves traffic unchanged until the explicit promotion step. Database
 * rollback is never attempted, including after partial migration or uncertainty. */
export async function release(env, { execute = defaultExecute, fetcher = fetch, wasm, buildFile, onPhase = () => {} } = {}) {
  const binding = guard(env), flags = ['--project', TARGET.project, '--region', TARGET.region, '--format=json'];
  if (!buildFile || !wasm) throw new Error('Reviewed build configuration and WebAssembly manifest are required.');
  const command = args => execute([...args, ...flags]);
  onPhase('preflight');
  assertRuntime(await command(['run', 'services', 'describe', TARGET.service]), binding);
  assertRuntime(await command(['run', 'jobs', 'describe', TARGET.job]), binding, { job: true });
  onPhase('build');
  const built = await command(['builds', 'submit', '.', '--config', buildFile, '--ignore-file', join(dirname(buildFile), 'source.ignore'), '--gcs-source-staging-dir', TARGET.sourceStaging, '--suppress-logs', '--service-account', `projects/${TARGET.project}/serviceAccounts/${account('builder')}`]);
  const image = immutableImage(built, binding.sha); assertImage(image);
  onPhase('candidate');
  await command(['run', 'deploy', TARGET.service, '--image', image, '--service-account', account('runtime'), '--revision-suffix', binding.suffix, '--tag', TARGET.candidateTag, '--no-traffic', '--min=1', '--max=1', '--min-instances=0', '--max-instances=1', '--no-cpu-throttling', '--update-env-vars', `RELEASE_SHA=${binding.sha}`]);
  const candidate = await command(['run', 'services', 'describe', TARGET.service]);
  assertRuntime(candidate, binding, { image });
  const origin = candidateOrigin(candidate, binding);
  onPhase('candidate-smoke'); const before = await verify(origin, binding.sha, wasm, fetcher);
  onPhase('migration');
  const migration = await command(['run', 'jobs', 'update', TARGET.job, '--image', image, '--service-account', account('migrator'), '--command=node', '--args=dist/database/migrate.js', '--tasks=1', '--parallelism=1', '--max-retries=0', '--task-timeout=1200s', '--update-env-vars', `RELEASE_SHA=${binding.sha}`]);
  assertRuntime(migration, binding, { job: true, image });
  const execution = await command(['run', 'jobs', 'execute', TARGET.job, '--wait']);
  assertExecution(execution);
  onPhase('post-migration-smoke'); const after = await verify(origin, binding.sha, wasm, fetcher);
  onPhase('promote');
  await command(['run', 'services', 'update-traffic', TARGET.service, '--to-revisions', `${binding.revision}=100`, '--remove-tags', TARGET.candidateTag]);
  onPhase('public-smoke'); const publicSmoke = await verify(TARGET.origin, binding.sha, wasm, fetcher);
  onPhase('complete');
  return { status: 'passed', sha: binding.sha, revision: binding.revision, image, buildId: built.id, candidateOrigin: origin, publicOrigin: TARGET.origin, migrationExecution: execution.metadata.name, before, after, publicSmoke };
}

async function main() {
  guard(process.env);
  const directory = await mkdtemp(join(tmpdir(), 'thatcampus-dt-release-')), buildFile = join(directory, 'cloudbuild.json');
  const receiptPath = resolve('artifacts/dt-deploy/release.json'); let phase = 'prepare', receipt;
  try {
    await writeFile(buildFile, JSON.stringify(buildConfig(process.env.GITHUB_SHA)));
    await writeFile(join(directory, 'source.ignore'), sourceIgnore());
    receipt = await release(process.env, { buildFile, wasm: await webAssemblyManifest(), onPhase: value => { phase = value; process.stdout.write(`Digital Twin release: ${value}\n`); } });
  } catch (error) {
    receipt = { status: 'failed', sha: process.env.GITHUB_SHA, phase, message: error instanceof Error ? error.message : 'Release failed.', databaseRollbackAttempted: false };
    process.exitCode = 1;
  } finally {
    await mkdir(resolve('artifacts/dt-deploy'), { recursive: true }); await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
    await rm(directory, { recursive: true, force: true });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
