import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { userInfo } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { spawn } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backend = join(root, 'backend');
const require = createRequire(join(backend, 'package.json'));
const { Pool } = require('pg');
const configured = parseEnv(await readFile(join(backend, '.env'), 'utf8'));
const server = new URL(configured.DATABASE_URL);
if (!['localhost', '127.0.0.1', '[::1]'].includes(server.hostname) || server.search || server.hash) throw new Error('Exact loopback server without overrides required');
if (!server.username) server.username = userInfo().username;
const stamp = `${new Date().toISOString().slice(0, 10).replaceAll('-', '')}_${randomBytes(4).toString('hex')}`;
const names = [`simulation_requests_source_test_${stamp}`, `simulation_requests_cow_test_${stamp}`];
const valid = /^simulation_requests_(source|cow)_test_[0-9]{8}_[a-f0-9]{8}$/;
const url = name => { const copy = new URL(server); copy.pathname = `/${name}`; return copy.toString(); };
const directory = join(root, 'artifacts/simulation-phone-recovery-20261028', `cold-requests-${stamp}`);
await mkdir(directory, { recursive: true });
const report = { normal_database_touched: false, names, migrations: 277, created: [], cleanup: [], result: 'running' };
const admin = new Pool({ connectionString: url('postgres'), max: 1 });
const save = () => writeFile(join(directory, 'runner.json'), JSON.stringify(report, null, 2) + '\n');
const run = (label, args) => new Promise((done, reject) => {
  const child = spawn(process.execPath, args, { cwd: backend, env: {
    PATH: `/opt/homebrew/opt/postgresql@17/bin:${process.env.PATH ?? ''}`, USER: userInfo().username,
    NODE_ENV: 'test', DEPLOYMENT_ENVIRONMENT: 'test', DATABASE_URL: url(names[0]), MIGRATION_DATABASE_URL: url(names[0]),
    EVENT_DATABASE_URL: url(names[0]), CAMPUS_SIMULATION_DATABASE_URL: url(names[1]),
    SIMULATION_REQUESTS_TARGET_DATABASE_URL: url(names[1]), SIMULATION_REQUESTS_DATABASE_TEST_ISOLATED: 'true',
    TEST_DATABASE_ISOLATED: 'true', AI_PROVIDER: 'mock', AGENT_PROVIDER: 'mock', TELEGRAM_BOT_ENABLED: 'false', INVITATION_EMAIL_ENABLED: 'false',
    COOKIE_SECRET: 'isolated-cold-requests-test-cookie-secret-2026',
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  child.on('error', reject);
  child.on('close', async code => {
    const sanitized = output.replaceAll(url(names[0]), '<owned source URL>').replaceAll(url(names[1]), '<owned COW URL>');
    await writeFile(join(directory, `${label}.log`), sanitized);
    report[label] = { exit_code: code };
    if (code === 0) done(); else reject(new Error(`${label} failed; inspect ${directory}/${label}.log`));
  });
});
try {
  for (const name of names) {
    if (!valid.test(name) || (await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [name])).rowCount) throw new Error('Refused non-new fixture target');
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
    report.created.push(name); await save();
  }
  await run('migrate', ['--import', 'tsx', 'src/database/migrate.ts']);
  await run('native', ['node_modules/vitest/vitest.mjs', 'run', 'test/requests-cold-cow.integration.test.ts', '--reporter=dot']);
  report.result = 'passed';
} catch (error) { report.result = 'failed'; report.error = error.message; throw error; }
finally {
  for (const name of report.created.slice().reverse()) {
    if (!valid.test(name) || !names.includes(name)) throw new Error('Refused unexpected cleanup target');
    const active = Number((await admin.query('SELECT count(*) count FROM pg_stat_activity WHERE datname=$1', [name])).rows[0].count);
    if (active !== 0) { report.cleanup.push({ name, removed: false, active }); continue; }
    await admin.query(`DROP DATABASE "${name}"`);
    report.cleanup.push({ name, removed: true, active });
  }
  await save(); await admin.end();
  console.log(JSON.stringify({ result: report.result, artifacts: directory, cleanup: report.cleanup }));
}
