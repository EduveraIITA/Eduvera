import { execFileSync } from 'node:child_process';
import { createPublicKey } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { guard, assertRuntime } from './release.mjs';

export function validateRecipientKey(pem) {
  if (!pem.startsWith('-----BEGIN PUBLIC KEY-----') || pem.includes('PRIVATE KEY')) throw new Error('A public encryption key is required');
  const key = createPublicKey(pem);
  if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength < 3072) throw new Error('An RSA key of at least 3072 bits is required');
  return key;
}

// This exact bounded operation executes inside the already configured private
// database job. It reuses the tested gate account transaction, not an app login.
export async function provisionInsideContainer(publicKeyBase64, operationId) {
  await import('reflect-metadata');
  const crypto = await import('node:crypto');
  const { pathToFileURL } = await import('node:url');
  const { Pool, types } = await import('pg');
  const { Kysely, PostgresDialect } = await import('kysely');
  const load = path => import(pathToFileURL(process.cwd() + '/dist/' + path).href);
  const { postgresClientConnectionConfig } = await load('database/connection-policy.js');
  const { GateService } = await load('gate/gate.service.js');
  const { effectiveSchoolAccess, hasScopedSchoolPermission } = await load('roles/authorization.js');
  const publicKey = Buffer.from(publicKeyBase64, 'base64').toString('utf8');
  if (!publicKey.startsWith('-----BEGIN PUBLIC KEY-----') || publicKey.includes('PRIVATE KEY')) throw new Error('Invalid recipient');
  const recipient = crypto.createPublicKey(publicKey);
  if (recipient.asymmetricKeyType !== 'rsa' || recipient.asymmetricKeyDetails.modulusLength < 3072) throw new Error('Invalid recipient');
  types.setTypeParser(1082, value => value);
  const pool = new Pool({ ...postgresClientConnectionConfig(process.env.MIGRATION_DATABASE_URL, { name: 'MIGRATION_DATABASE_URL', purpose: 'migrations', requireRemoteTls: true }), max: 1, application_name: 'eduera_authorized_gatekeeper_provision' });
  const db = new Kysely({ dialect: new PostgresDialect({ pool }) });
  try {
    const result = await pool.query("SELECT u.id,u.username,u.email,u.first_name,u.last_name,u.role,u.is_active,u.email_verified_at,s.id school_id,s.name school_name FROM users u JOIN school_memberships m ON m.user_id=u.id AND m.role='admin' AND m.is_active JOIN schools s ON s.id=m.school_id WHERE u.username='meera.principal' AND u.is_active AND s.code='cis'");
    if (result.rows.length !== 1) throw new Error('Expected one active principal in the designated review school');
    const principal = result.rows[0];
    const existingRole = (await pool.query("SELECT capability_permissions,context_kind,is_active FROM staff_responsibility_types WHERE school_id=$1 AND code='gatekeeper'", [principal.school_id])).rows[0];
    if (existingRole && (!existingRole.is_active || existingRole.context_kind !== 'institution' || JSON.stringify([...new Set(existingRole.capability_permissions)].sort()) !== '["gate.manage"]')) throw new Error('Gatekeeper role is not the expected least-privilege role');
    const existingAccount = (await pool.query("SELECT id,role,is_active FROM users WHERE username='gatekeeper.review'")).rows[0];
    let account;
    if (existingAccount) account = { id: existingAccount.id, username: 'gatekeeper.review', password: null, created: false };
    else {
      const gate = new GateService(db, {});
      account = { ...await gate.gatekeeper(principal, principal.school_id, { name: 'Gatekeeper Review', username: 'gatekeeper.review' }), created: true };
    }
    const access = await effectiveSchoolAccess(db, account.id, principal.school_id);
    const permissions = [...new Set(access.sources.map(source => source.permission))].sort();
    if (access.role !== 'staff' || JSON.stringify(permissions) !== '["gate.manage"]' || !await hasScopedSchoolPermission(db, account.id, principal.school_id, 'gate.manage', 'institution', principal.school_id)) throw new Error('Account scope verification failed');
    const member = (await pool.query("SELECT count(*)::int total FROM school_memberships WHERE user_id=$1 AND is_active", [account.id])).rows[0];
    const profile = (await pool.query("SELECT staff_kind,status FROM staff_profiles WHERE user_id=$1 AND school_id=$2", [account.id, principal.school_id])).rows[0];
    const user = (await pool.query("SELECT role,is_active,email_verified_at FROM users WHERE id=$1", [account.id])).rows[0];
    if (member.total !== 1 || profile?.staff_kind !== 'non_teaching' || profile.status !== 'active' || user.role !== 'staff' || !user.is_active || !user.email_verified_at) throw new Error('Account identity verification failed');
    await db.insertInto('audit_events').values({actor_id:principal.id,school_id:principal.school_id,action:'gate.direct_database_provision',target_type:'gate',target_id:account.id,request_id:operationId,ip_hash:'',metadata:{source:'user_authorized_database_maintenance',created:account.created,permissions}}).execute();
    const packet = Buffer.from(JSON.stringify({ ...account, permissions, school: principal.school_name, school_id: principal.school_id, operation_id: operationId, login_url: 'https://eduvera-stage-367469594690.asia-south1.run.app/login' }));
    const key = crypto.randomBytes(32), iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(packet), cipher.final()]);
    const wrappedKey = crypto.publicEncrypt({ key: recipient, oaepHash: 'sha256', padding: crypto.constants.RSA_PKCS1_OAEP_PADDING }, key);
    const envelope = { version: 1, operation_id: operationId, wrapped_key: wrappedKey.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: encrypted.toString('base64') };
    // Logs contain ciphertext only; no account password or database credential.
    console.log('GATEKEEPER_PROVISION_RESULT:' + Buffer.from(JSON.stringify(envelope)).toString('base64'));
    console.log('Gatekeeper account verified with only Manage In & Out access.');
  } finally { await db.destroy(); }
}

export function containerProgram(publicKeyPem, operationId) {
  validateRecipientKey(publicKeyPem);
  if (!/^[0-9a-f-]{36}$/.test(operationId)) throw new Error('A unique operation UUID is required');
  const source = '(' + provisionInsideContainer.toString() + ')(' + JSON.stringify(Buffer.from(publicKeyPem).toString('base64')) + ',' + JSON.stringify(operationId) + ').catch(error=>{console.error("Gatekeeper provisioning failed",error.code||"operation_failed");process.exitCode=1;})';
  return 'eval(atob(' + JSON.stringify(Buffer.from(source).toString('base64')) + '))';
}

export async function provision(env, run = (args) => execFileSync('gcloud', args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })) {
  guard(env);
  if (env.GCP_STAGE_DEPLOY_ENABLED !== 'true' || env.GITHUB_EVENT_NAME !== 'push' || env.PROVISION_GATEKEEPER !== 'true') throw new Error('Explicit trusted Stage maintenance trigger is required');
  const common = ['--project=eduera-511111', '--region=asia-south1'];
  const service = JSON.parse(run(['run', 'services', 'describe', 'eduvera-stage', ...common, '--format=json']));
  const jobBefore = JSON.parse(run(['run', 'jobs', 'describe', 'eduvera-stage-migrate', ...common, '--format=json']));
  assertRuntime(service, jobBefore);
  const pem = readFileSync(new URL('./gatekeeper-review-public.pem', import.meta.url), 'utf8');
  const program = containerProgram(pem, env.GATEKEEPER_OPERATION_ID);
  // Per-execution arguments do not modify the job's normal schema-migration config.
  const execution = JSON.parse(run(['run', 'jobs', 'execute', 'eduvera-stage-migrate', ...common, '--args=-e,' + program, '--tasks=1', '--task-timeout=300s', '--wait', '--format=json']));
  const name = execution.metadata?.name ?? execution.name?.split('/').at(-1);
  if (!name || !/^eduvera-stage-migrate-[a-z0-9-]+$/.test(name)) throw new Error('Unexpected execution identity');
  const filter = 'resource.type="cloud_run_job" AND resource.labels.job_name="eduvera-stage-migrate" AND labels."run.googleapis.com/execution_name"="' + name + '"';
  let envelope;
  for (let attempt = 0; attempt < 12; attempt++) {
    const entries = JSON.parse(run(['logging', 'read', filter, '--project=eduera-511111', '--freshness=1h', '--limit=100', '--format=json']));
    const line = entries.map(entry => entry.textPayload ?? entry.jsonPayload?.message ?? '').find(value => value.startsWith('GATEKEEPER_PROVISION_RESULT:'));
    if (line) { envelope = line.slice('GATEKEEPER_PROVISION_RESULT:'.length); break; }
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  const jobAfter = JSON.parse(run(['run', 'jobs', 'describe', 'eduvera-stage-migrate', ...common, '--format=json']));
  if (JSON.stringify(jobBefore.spec.template) !== JSON.stringify(jobAfter.spec.template)) throw new Error('Migration job configuration changed unexpectedly');
  if (!envelope) throw new Error('Encrypted result not available yet; retain the private recipient key and inspect this execution');
  writeFileSync('gatekeeper-encrypted-result.txt', envelope + '\n', { mode: 0o600 });
  console.log('GATEKEEPER_ENCRYPTED_RESULT:' + envelope);
  console.log('Created or verified gatekeeper.review; migration job configuration preserved.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await provision(process.env);
