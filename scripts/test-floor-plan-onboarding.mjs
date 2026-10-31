import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { userInfo } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { spawn } from 'node:child_process';

// A bounded, independent fixture on the existing PostgreSQL17 server. This runner
// never builds dist, starts a second database server, or writes the normal store.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backend = join(root, 'backend');
const require = createRequire(join(backend, 'package.json'));
const { Pool } = require('pg');
const args = new Set(process.argv.slice(2));
for (const arg of args) {
  if (!['--retain-for-browser'].includes(arg)) throw new Error(`Unknown option: ${arg}`);
}
const retain = args.has('--retain-for-browser');
const config = process.env.FLOOR_PLAN_TEST_SERVER_URL ? {} : parseEnv(await readFile(join(backend, '.env'), 'utf8'));
const base = new URL(process.env.FLOOR_PLAN_TEST_SERVER_URL ?? config.DATABASE_URL ?? '');
if (!['postgres:', 'postgresql:'].includes(base.protocol)
  || !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)
  || [...base.searchParams.keys()].some(key => ['host', 'hostaddr', 'service', 'port', 'dbname', 'database'].includes(key))) {
  throw new Error('Floor-plan fixtures require the existing loopback PostgreSQL17 server without connection overrides.');
}
// node-postgres otherwise defaults from USER. Keep the child environment minimal
// and make the same local identity explicit for pg_dump and migration clients.
if (!base.username) base.username = userInfo().username;
const suffix = `${new Date().toISOString().slice(0, 10).replaceAll('-', '')}_${randomBytes(4).toString('hex')}`;
const sourceName = `floorplan_onboarding_source_test_${suffix}`;
const targetName = `floorplan_onboarding_cow_test_${suffix}`;
const ownName = /^floorplan_onboarding_(source|cow)_test_[0-9]{8}_[a-f0-9]{8}$/;
const artifacts = join(root, 'artifacts', 'floor-plan-onboarding-20261028', suffix);
const privateDir = join(root, '.runtime', 'floor-plan-onboarding-20261028', suffix);
await mkdir(artifacts, { recursive: true });
const connection = name => { const url = new URL(base); url.pathname = `/${name}`; return url.toString(); };
const admin = new Pool({ connectionString: connection('postgres'), max: 1, application_name: 'thatcampus_floorplan_owned_fixture' });
const owned = [];
const report = {
  schema_version: 1, started_at: new Date().toISOString(), server: 'Existing loopback PostgreSQL17 server',
  source_database: sourceName, cow_database: targetName,
  normal_database_touched: false, normal_dist_touched: false, created: [], cleanup: [],
  retained_for_browser: false, result: 'not_started',
};
const saveReport = () => writeFile(join(artifacts, 'runner.json'), JSON.stringify(report, null, 2) + '\n');
const safe = value => String(value).replaceAll(base.toString(), '<normal database URL>')
  .replaceAll(connection(sourceName), '<owned source database URL>')
  .replaceAll(connection(targetName), '<owned COW database URL>');
const run = (label, commandArgs) => new Promise((done, reject) => {
  const env = {
    PATH: `/opt/homebrew/opt/postgresql@17/bin:${process.env.PATH ?? ''}`, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
    NODE_ENV: 'test', DEPLOYMENT_ENVIRONMENT: 'test',
    DATABASE_URL: connection(sourceName), MIGRATION_DATABASE_URL: connection(sourceName),
    EVENT_DATABASE_URL: connection(sourceName), CAMPUS_SIMULATION_DATABASE_URL: connection(targetName),
    FLOOR_PLAN_ONBOARDING_SIMULATION_TEST_TARGET_URL: connection(targetName),
    TEST_DATABASE_ISOLATED: 'true', INVITATION_EMAIL_ENABLED: 'false',
    AI_PROVIDER: 'mock', AGENT_PROVIDER: 'mock', TELEGRAM_BOT_ENABLED: 'false', RAZORPAY_ENABLED: 'false',
    COOKIE_SECRET: 'isolated-floor-plan-test-cookie-secret-2026',
    RESTRICTED_CASE_ENCRYPTION_KEY: 'isolated-floor-plan-test-cipher-key-2026',
  };
  const child = spawn(process.execPath, commandArgs, { cwd: backend, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', value => { output += value; });
  child.stderr.on('data', value => { output += value; });
  child.on('error', reject);
  child.on('close', async code => {
    try {
      const text = safe(output);
      await writeFile(join(artifacts, `${label}.log`), text);
      report[label] = { exit_code: code, log_sha256: createHash('sha256').update(text).digest('hex') };
      if (code !== 0) reject(new Error(`${label} failed (${code}); inspect the bounded fixture log.`));
      else done();
    } catch (error) { reject(error); }
  });
});
let failure;
try {
  const version = Number((await admin.query("SELECT current_setting('server_version_num')::int AS version")).rows[0].version);
  if (version < 170000) throw new Error('The existing PostgreSQL17 server is required.');
  report.server_version_num = version;
  for (const name of [sourceName, targetName]) {
    if (!ownName.test(name)) throw new Error('Refused an unexpected fixture name.');
    const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [name]);
    if (existing.rowCount) throw new Error('The exact new fixture name already exists; refusing to reuse it.');
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
    owned.push(name); report.created.push(name); await saveReport();
  }
  await run('migrations', ['--import', 'tsx', 'src/database/migrate.ts']);
  await run('integration', ['node_modules/vitest/vitest.mjs', 'run', 'test/floor-plan-onboarding-lifecycle.integration.test.ts', '--reporter=json', `--outputFile=${join(artifacts, 'vitest.json')}`]);
  report.result = 'passed';
  if (retain) {
    await mkdir(privateDir, { recursive: true, mode: 0o700 });
    await writeFile(join(privateDir, 'connections.private.json'), JSON.stringify({
      source: connection(sourceName), cow: connection(targetName),
      names: [sourceName, targetName], created_by: 'scripts/test-floor-plan-onboarding.mjs',
    }, null, 2) + '\n', { mode: 0o600 });
    report.retained_for_browser = true;
    report.private_connection_file = join(privateDir, 'connections.private.json');
  }
} catch (error) {
  failure = error; report.result = 'failed'; report.error = safe(error.message ?? error);
} finally {
  if (!report.retained_for_browser) {
    for (const name of [...owned].reverse()) {
      try {
        if (!ownName.test(name)) throw new Error('Refused unexpected cleanup name.');
        let count;
        const deadline = Date.now() + 5_000;
        // Vitest's worker may close just after its parent emits `close`. Give
        // that owned connection a bounded chance to leave naturally; no session
        // is terminated and a continuing connection still retains the fixture.
        do {
          count = Number((await admin.query('SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=$1', [name])).rows[0].count);
          if (count && Date.now() < deadline) await new Promise(done => setTimeout(done, 200));
        } while (count && Date.now() < deadline);
        if (count !== 0) throw new Error(`Retained owned fixture: ${count} connection(s) remain. No forced disconnect was attempted.`);
        await admin.query(`DROP DATABASE "${name}"`);
        report.cleanup.push({ database: name, result: 'dropped', clients_before: 0, force: false });
      } catch (error) {
        report.cleanup.push({ database: name, result: 'retained', reason: safe(error.message ?? error), force: false });
        failure ??= error;
      }
    }
  }
  await admin.end(); report.finished_at = new Date().toISOString(); await saveReport();
}
process.stdout.write(JSON.stringify({ result: report.result, artifacts, retained_for_browser: report.retained_for_browser,
  cleanup: report.cleanup }) + '\n');
if (failure) process.exitCode = 1;
