import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function guard(env, now = Date.now()) {
  if (env.GITHUB_REPOSITORY !== 'EduveraIITA/Eduvera' || env.GITHUB_REF !== 'refs/heads/Stage') throw new Error('Only the trusted Stage branch can deploy');
  if (env.GCP_PROJECT_ID !== 'eduera-511111' || env.GCP_REGION !== 'asia-south1' || env.GCP_SERVICE !== 'eduvera-stage' || env.GCP_MIGRATION_JOB !== 'eduvera-stage-migrate') throw new Error('Unexpected deployment target');
  if (env.GCP_IMAGE !== 'asia-south1-docker.pkg.dev/eduera-511111/eduera/web') throw new Error('Unexpected image repository');
  if (!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '')) throw new Error('A full release SHA is required');
  const expiry = Date.parse(env.GCP_TRIAL_DEPLOY_UNTIL ?? '');
  if (!Number.isFinite(expiry) || expiry <= now || expiry - now > 90 * 86400000) throw new Error('Trial deployment window is missing, expired or exceeds 90 days; review remaining credit before renewing');
}

export function assertRuntime(service, job) {
  const template = service.spec?.template;
  const app = template?.spec?.containers?.[0];
  const annotations = template?.metadata?.annotations ?? {};
  if (template?.spec?.containers?.length !== 1 || !['1', '1000m'].includes(app?.resources?.limits?.cpu) || app?.resources?.limits?.memory !== '1Gi') throw new Error('Runtime must remain one CPU / 1 GiB without sidecars');
  if (Object.keys(app.resources.limits).some(key => !['cpu', 'memory'].includes(key))) throw new Error('Accelerators are not allowed');
  if (annotations['run.googleapis.com/cpu-throttling'] !== 'false') throw new Error('Background events require continuously allocated CPU');
  if (service.metadata?.annotations?.['run.googleapis.com/maxScale'] !== '1' || service.metadata?.annotations?.['run.googleapis.com/minScale'] !== '1') throw new Error('Service scaling must remain capped at one instance');
  if (template.spec.serviceAccountName !== 'stage-runtime@eduera-511111.iam.gserviceaccount.com') throw new Error('Unexpected runtime identity');
  for (const name of ['DATABASE_URL', 'EVENT_DATABASE_URL', 'COOKIE_SECRET', 'METRICS_TOKEN', 'RESTRICTED_CASE_ENCRYPTION_KEY']) {
    if (!app.env?.find(item => item.name === name)?.valueFrom?.secretKeyRef) throw new Error(`${name} must use Secret Manager`);
  }
  const env = Object.fromEntries((app.env ?? []).map(item => [item.name, item.value]));
  if (env.DEMO_MODE !== 'false') throw new Error('Public demo access must remain disabled');
  if (env.AGENT_PROVIDER === 'vertex' && env.AGENT_ENABLED !== 'false') {
    if (env.AGENT_MODEL !== 'gemini-3.1-flash-lite' || env.AGENT_GOOGLE_PROJECT !== 'eduera-511111' || env.AGENT_GOOGLE_LOCATION !== 'global' || env.AGENT_BASE_URL || env.AGENT_API_KEY) throw new Error('Only the reviewed keyless cloud model is allowed');
    const expiry = Date.parse(env.AGENT_ENABLED_UNTIL ?? '');
    if (!Number.isFinite(expiry) || expiry <= Date.now() || expiry > Date.now() + 90 * 86400000) throw new Error('Cloud AI requires an unexpired trial review deadline');
    for (const [name, max] of Object.entries({ AGENT_USER_HOURLY_LIMIT: 10, AGENT_USER_DAILY_LIMIT: 30, AGENT_DAILY_BUDGET_MICROS: 500000, AGENT_MONTHLY_BUDGET_MICROS: 5000000 })) {
      const value = Number(env[name]);
      if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error(`Unsafe AI allowance: ${name}`);
    }
  }
  if (env.DEPLOYMENT_ENVIRONMENT !== 'stage' || env.COOKIE_SECURE !== 'true' || env.RATE_LIMIT_STORE !== 'postgres') throw new Error('Unsafe runtime environment');
  if (env.PUBLIC_URL !== 'https://eduvera-stage-367469594690.asia-south1.run.app' || !env.ALLOWED_ORIGINS?.split(',').includes(env.PUBLIC_URL)) throw new Error('The canonical app origin must be allowed');
  if (!app.volumeMounts?.some(mount => mount.mountPath === env.UPLOAD_DIR && template.spec.volumes?.some(volume => volume.name === mount.name && volume.csi?.driver === 'gcsfuse.run.googleapis.com' && volume.csi.volumeAttributes?.bucketName === 'eduera-511111-stage-files'))) throw new Error('Uploads must use the private persistent Stage bucket');
  const task = job.spec?.template?.spec?.template?.spec;
  if (job.spec?.template?.spec?.taskCount !== 1 || task?.maxRetries !== 0 || task?.serviceAccountName !== 'stage-migrator@eduera-511111.iam.gserviceaccount.com') throw new Error('Unsafe migration job');
  const migrate = task.containers?.[0];
  if (!['1', '1000m'].includes(migrate?.resources?.limits?.cpu) || migrate?.resources?.limits?.memory !== '512Mi' || Object.keys(migrate.resources.limits).some(key => !['cpu', 'memory'].includes(key)) || Number(task.timeoutSeconds) > 300 || !Number.isFinite(Number(task.timeoutSeconds))) throw new Error('Migration resources exceed the trial configuration');
  if (task.containers?.length !== 1 || JSON.stringify(migrate?.command) !== '["node"]' || JSON.stringify(migrate?.args) !== '["dist/database/migrate.js"]') throw new Error('Migration job must only run the schema migrator');
  if (!migrate.env?.find(item => item.name === 'MIGRATION_DATABASE_URL')?.valueFrom?.secretKeyRef) throw new Error('Migration connection must use Secret Manager');
  const active = service.status?.traffic?.filter(item => item.percent > 0) ?? [];
  if (active.length !== 1 || active[0].percent !== 100 || !active[0].revisionName) throw new Error('A single previous serving revision is required for rollback');
  return active[0].revisionName;
}

export async function verify(origin, sha, request = fetch) {
  const base = new URL(origin);
  if (base.protocol !== 'https:' || !base.hostname.endsWith('.run.app') || base.origin !== origin) throw new Error('Expected a Cloud Run HTTPS origin');
  const get = async path => {
    const response = await request(`${origin}${path}`, { signal: AbortSignal.timeout(20000), redirect: 'error' });
    if (!response.ok) throw new Error(`Smoke check failed: ${path} (${response.status})`);
    return response;
  };
  const release = await (await get('/releasez')).json();
  if (release.release_sha !== sha || release.environment !== 'stage') throw new Error('Wrong release or environment');
  if ((await (await get('/readyz')).json()).status !== 'ready') throw new Error('Database/events are not ready');
  if (!(await (await get('/')).text()).includes('<title>Edura OS · OmniSchool</title>')) throw new Error('Mobile app failed');
  if (!(await (await get('/staff/')).text()).includes('<title>OmniSchool · Staff</title>')) throw new Error('Staff app failed');
  for (const path of ['/favicon.png', '/apple-touch-icon.png', '/icons/eduvera-192.png', '/api/schema']) await get(path);
  if ((await (await get('/api/v1/auth/session/')).json()).demo_mode !== false) throw new Error('Public demo access must be disabled');
  if ((await request(`${origin}/api/v1/auth/demo-session/`, {method:'POST',headers:{'Content-Type':'application/json'},body:'{"role":"admin"}',signal:AbortSignal.timeout(20000),redirect:'error'})).status !== 404) throw new Error('Demo authentication must reject public access');
  if ((await request(`${origin}/metrics`, { signal: AbortSignal.timeout(20000), redirect: 'error' })).status !== 401) throw new Error('Metrics must reject anonymous access');
}

async function deploy(env) {
  if (env.GCP_STAGE_DEPLOY_ENABLED !== 'true') throw new Error('Deployment has not been enabled');
  const flags = [`--project=${env.GCP_PROJECT_ID}`, `--region=${env.GCP_REGION}`, '--quiet'];
  const gcloud = args => execFileSync('gcloud', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
  const describe = (kind, name) => JSON.parse(gcloud(['run', kind, 'describe', name, ...flags, '--format=json']));
  const service = describe('services', env.GCP_SERVICE);
  const previous = assertRuntime(service, describe('jobs', env.GCP_MIGRATION_JOB));
  const publicUrl = service.spec.template.spec.containers[0].env.find(item => item.name === 'PUBLIC_URL').value;
  const imageInfo = JSON.parse(execFileSync('docker', ['image', 'inspect', `${env.GCP_IMAGE}:${env.GITHUB_SHA}`], { encoding: 'utf8' }));
  const image = imageInfo[0]?.RepoDigests?.find(digest => digest.startsWith(`${env.GCP_IMAGE}@sha256:`));
  if (!image) throw new Error('Cannot find the pushed immutable image digest');
  gcloud(['run', 'jobs', 'update', env.GCP_MIGRATION_JOB, ...flags, `--image=${image}`]);
  gcloud(['run', 'jobs', 'execute', env.GCP_MIGRATION_JOB, ...flags, '--wait']);
  const tag = `check-${env.GITHUB_SHA.slice(0, 12)}`;
  let promoted = false;
  try {
    gcloud(['run', 'services', 'update', env.GCP_SERVICE, ...flags, `--image=${image}`, `--update-env-vars=RELEASE_SHA=${env.GITHUB_SHA}`, '--no-traffic', `--tag=${tag}`]);
    const updated = describe('services', env.GCP_SERVICE);
    const candidate = updated.status?.traffic?.find(item => item.tag === tag);
    if (!candidate?.url || !candidate.revisionName) throw new Error('Candidate URL/revision is missing');
    await verify(candidate.url, env.GITHUB_SHA);
    // Mark first: if the command times out after a successful promotion, rollback
    // is still attempted. Schema migrations are never automatically reversed.
    promoted = true;
    gcloud(['run', 'services', 'update-traffic', env.GCP_SERVICE, ...flags, `--to-revisions=${candidate.revisionName}=100`]);
    await verify(publicUrl, env.GITHUB_SHA);
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `### Google Cloud Stage deployed\n\nRelease: ${env.GITHUB_SHA}\n\n${publicUrl}\n\nMigrations, candidate health, both apps and public revision verified.\n`);
    console.log(`Verified Stage ${env.GITHUB_SHA} at ${publicUrl}`);
  } catch (error) {
    if (promoted) {
      gcloud(['run', 'services', 'update-traffic', env.GCP_SERVICE, ...flags, `--to-revisions=${previous}=100`]);
      console.error('Application traffic restored to the previous revision. Database migrations were not reversed.');
    }
    throw error;
  } finally {
    // Remove only this run's temporary tag, never an operator's other tags.
    gcloud(['run', 'services', 'update-traffic', env.GCP_SERVICE, ...flags, `--remove-tags=${tag}`]);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  guard(process.env);
  if (process.argv[2] === 'deploy') await deploy(process.env);
  else if (process.argv[2] !== 'guard') throw new Error('Expected guard or deploy');
}
