import { execFileSync } from 'node:child_process';
import { createCipheriv, constants, publicEncrypt, randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { guard, assertRuntime } from './release.mjs';
import { validateRecipientKey } from './provision-stage-gatekeeper.mjs';

export function credentialHash(password) {
  const salt = randomBytes(24);
  return `scrypt$32768$8$1$${salt.toString('base64url')}$${scryptSync(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('base64url')}`;
}

// Runs only in the existing private database job. No plaintext password enters
// Cloud Run arguments, environment, logs or database audit metadata.
export async function createInsideContainer(passwordHash, operationId, providedPool) {
  if (!/^scrypt\$32768\$8\$1\$[\w-]{32}\$[\w-]{86}$/.test(passwordHash) || !/^[0-9a-f-]{36}$/.test(operationId)) throw new Error('Invalid operation');
  const { createRequire } = await import('node:module');
  const { pathToFileURL } = await import('node:url');
  const { randomUUID } = await import('node:crypto');
  let pool = providedPool;
  if (!pool) {
    const require = createRequire(process.cwd() + '/package.json');
    const { Pool } = require('pg');
    const { postgresClientConnectionConfig } = await import(pathToFileURL(process.cwd() + '/dist/database/connection-policy.js').href);
    pool = new Pool({ ...postgresClientConnectionConfig(process.env.MIGRATION_DATABASE_URL, { name: 'MIGRATION_DATABASE_URL', purpose: 'migrations', requireRemoteTls: true }), max: 1, application_name: 'eduera_authorized_new_gate_demo' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const principals = (await client.query("SELECT s.id school_id,u.id actor_id FROM schools s JOIN school_memberships m ON m.school_id=s.id AND m.role='admin' AND m.is_active JOIN users u ON u.id=m.user_id AND u.username='meera.principal' AND u.role='admin' AND u.is_active WHERE s.code='cis'")).rows;
    if (principals.length !== 1) throw new Error('Expected the designated review institution');
    const { school_id: school, actor_id: actor } = principals[0];
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`roles:${school}`]);
    if ((await client.query("SELECT 1 FROM users WHERE username='gate.demo'")).rows.length) throw new Error('Account already exists; no password or account will be overwritten');
    await client.query(`INSERT INTO staff_responsibility_types(school_id,code,name,category,scope_kind,description,access_summary,requires_acceptance,capability_permissions,context_kind,source_kind,workflow_family,updated_by)
      VALUES($1,'gatekeeper','Gatekeeper','operations','school','School gate entry and exit','Manage In & Out',false,ARRAY['gate.manage'],'institution','system','gatekeeper',$2)
      ON CONFLICT(school_id,code) DO NOTHING`, [school, actor]);
    const role = (await client.query("SELECT * FROM staff_responsibility_types WHERE school_id=$1 AND code='gatekeeper' FOR SHARE", [school])).rows[0];
    if (!role?.is_active || role.context_kind !== 'institution' || JSON.stringify(role.capability_permissions) !== '["gate.manage"]') throw new Error('Unexpected Gatekeeper role');
    const userId = randomUUID();
    const email = `gate.demo.${userId}@accounts.eduera.invalid`;
    await client.query("INSERT INTO users(id,username,email,password_hash,first_name,last_name,role,is_active,email_verified_at) VALUES($1,'gate.demo',$2,$3,'Gatekeeper','Demo','staff',true,now())", [userId, email, passwordHash]);
    await client.query("INSERT INTO school_memberships(user_id,school_id,role,is_active) VALUES($1,$2,'staff',true)", [userId, school]);
    const profile = (await client.query(`INSERT INTO staff_profiles(school_id,user_id,staff_code,first_name,last_name,email,phone,staff_kind,designation,department,employment_type,joined_on,status,created_by,updated_by)
      VALUES($1,$2,$3,'Gatekeeper','Demo',$4,'','non_teaching','Gatekeeper','Security','full_time',current_date,'active',$5,$5) RETURNING id`, [school, userId, `GATE-${userId.slice(0,8)}`, email, actor])).rows[0];
    const assignment = (await client.query(`INSERT INTO staff_responsibility_assignments(school_id,responsibility_type_id,staff_profile_id,scope_label,starts_on,status,assigned_by,responded_at)
      VALUES($1,$2,$3,'School gate',current_date,'active',$4,now()) RETURNING id,revision`, [school, role.id, profile.id, actor])).rows[0];
    await client.query("INSERT INTO staff_responsibility_audits(school_id,assignment_id,actor_id,action,from_status,to_status) VALUES($1,$2,$3,'activated',NULL,'active')", [school, assignment.id, actor]);
    await client.query("INSERT INTO school_operations_audit(school_id,actor_id,action,target_id,metadata) VALUES($1,$2,'staff.role.assigned',$3,$4::jsonb)", [school, actor, assignment.id, JSON.stringify({ revision: assignment.revision, role_id: role.id, scope_id: school, source: 'user_authorized_new_gate_demo', operation_id: operationId })]);
    await client.query(`INSERT INTO event_outbox(school_id,event_type,aggregate_type,aggregate_id,audience_user_ids,payload,idempotency_key,notification_user_ids,notification_payload)
      VALUES($1,'staff.access.updated','staff_access',$2,$3::uuid[],$4::jsonb,$5,ARRAY[]::uuid[],NULL)`, [school, assignment.id, [actor, userId], JSON.stringify({ school_id: school, revision: assignment.revision }), `gate-demo:${operationId}`]);
    await client.query("INSERT INTO audit_events(actor_id,school_id,action,target_type,target_id,request_id,ip_hash,metadata) VALUES($1,$2,'gate.direct_database_provision','gate',$3,$4,'',$5::jsonb)", [actor, school, userId, operationId, JSON.stringify({ source: 'user_authorized_new_gate_demo', permissions: ['gate.manage'] })]);
    const bindings = (await client.query('SELECT context_kind,scope_id,status,permissions FROM staff_role_bindings WHERE school_id=$1 AND user_id=$2', [school, userId])).rows;
    const access = (await client.query("SELECT staff_has_resource_permission($1,$2,'gate.manage','institution',$1) allowed,staff_has_resource_permission($1,$2,'departure.manage','institution',$1) departure", [school, userId])).rows[0];
    if (bindings.length !== 1 || bindings[0].context_kind !== 'institution' || bindings[0].scope_id !== school || bindings[0].status !== 'active' || JSON.stringify(bindings[0].permissions) !== '["gate.manage"]' || !access.allowed || access.departure) throw new Error('Gate scope verification failed');
    await client.query('COMMIT');
    return { username: 'gate.demo', role: 'Gatekeeper', permissions: ['gate.manage'], school_id: school, operation_id: operationId };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    if (!providedPool) await pool.end();
  }
}

export function containerProgram(hash, operationId) {
  if (!/^scrypt\$32768\$8\$1\$[\w-]{32}\$[\w-]{86}$/.test(hash) || !/^[0-9a-f-]{36}$/.test(operationId)) throw new Error('Invalid operation');
  const source = '(' + createInsideContainer.toString() + ')(' + JSON.stringify(hash) + ',' + JSON.stringify(operationId) + ').then(()=>console.log("Verified new gate.demo with only gate.manage")).catch(()=>{console.error("New gate demo creation failed; no existing account was reset");process.exitCode=1;})';
  return 'eval(atob(' + JSON.stringify(Buffer.from(source).toString('base64')) + '))';
}

export function encryptCredentials(packet, publicKey) {
  const recipient = validateRecipientKey(publicKey), key = randomBytes(32), iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(packet)), cipher.final()]);
  return Buffer.from(JSON.stringify({ version: 1, operation_id: packet.operation_id, wrapped_key: publicEncrypt({ key: recipient, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, key).toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') })).toString('base64');
}

export async function provision(env, run = args => execFileSync('gcloud', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 4 * 1024 * 1024 })) {
  guard(env);
  if (env.GITHUB_EVENT_NAME !== 'push' || env.GCP_STAGE_DEPLOY_ENABLED !== 'true' || env.CREATE_NEW_GATE_DEMO !== 'true') throw new Error('Explicit trusted new-account operation required');
  const flags = ['--project=eduera-511111', '--region=asia-south1'];
  const service = JSON.parse(run(['run', 'services', 'describe', 'eduvera-stage', ...flags, '--format=json']));
  const before = JSON.parse(run(['run', 'jobs', 'describe', 'eduvera-stage-migrate', ...flags, '--format=json']));
  assertRuntime(service, before);
  const password = 'E!7a' + randomBytes(24).toString('base64url'), operationId = randomUUID(), hash = credentialHash(password);
  const program = containerProgram(hash, operationId);
  console.log('::add-mask::' + password);
  console.log('::add-mask::' + hash);
  console.log('::add-mask::' + program);
  // Emit recoverable ciphertext before execution, so an incidental later failure
  // cannot lose the initial credential. It is delivered only after success.
  const packet = { username: 'gate.demo', password, role: 'Gatekeeper', permissions: ['gate.manage'], operation_id: operationId, login_url: 'https://app.thatcampus.com/login' };
  console.log('GATE_DEMO_CREDENTIAL_RESULT:' + encryptCredentials(packet, readFileSync(new URL('./gatekeeper-review-public.pem', import.meta.url), 'utf8')));
  let execution;
  try {
    execution = JSON.parse(run(['run', 'jobs', 'execute', 'eduvera-stage-migrate', ...flags, '--args=-e,' + program, '--tasks=1', '--task-timeout=300s', '--wait', '--format=json']));
  } catch {
    throw new Error('Private account execution failed; retain the encrypted packet and inspect the execution before retrying. No account reset was attempted.');
  } finally {
    const after = JSON.parse(run(['run', 'jobs', 'describe', 'eduvera-stage-migrate', ...flags, '--format=json']));
    if (JSON.stringify(before.spec.template) !== JSON.stringify(after.spec.template)) throw new Error('Migration job configuration changed unexpectedly');
  }
  const name = execution.metadata?.name ?? execution.name?.split('/').at(-1);
  if (!/^eduvera-stage-migrate-[a-z0-9-]+$/.test(name ?? '')) throw new Error('Unexpected execution identity');
  if (!execution.status?.conditions?.some(condition => condition.type === 'Completed' && condition.status === 'True')) throw new Error('Successful execution status is required');
  console.log(`Verified new gate.demo: Gatekeeper role, only gate.manage. Execution ${name}. Existing users, including kavita.staff, and persisted migration configuration unchanged.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await provision(process.env); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
