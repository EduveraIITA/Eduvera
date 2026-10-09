// One-time, explicitly dispatched bootstrap. Secret values never enter stdout.
// Pre-create the destination secrets and temporarily grant this identity
// secretVersionAdder on those secrets only. Revoke that grant after migration.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

if (process.env.GITHUB_REPOSITORY !== 'EduveraIITA/Eduvera' || process.env.GITHUB_REF !== 'refs/heads/Stage') {
  throw new Error('Bootstrap is restricted to this repository’s Stage branch');
}
const directory = mkdtempSync(join(tmpdir(), 'eduvera-stage-config-'));
const path = join(directory, 'source.json');
const mapping = {
  DATABASE_URL: 'stage-source-database-url',
  EVENT_DATABASE_URL: 'stage-source-session-url',
  COOKIE_SECRET: 'stage-cookie-secret',
  RESTRICTED_CASE_ENCRYPTION_KEY: 'stage-restricted-case-key',
  METRICS_TOKEN: 'stage-metrics-token',
};
try {
  const capture = 'require("node:fs").writeFileSync(process.argv[1],JSON.stringify(Object.fromEntries(process.argv.slice(2).map(k=>[k,process.env[k]||""]))),{mode:0o600})';
  const result = spawnSync('railway', ['run', '--service', process.env.RAILWAY_SERVICE, '--environment', 'stage', '--', 'node', '-e', capture, path, ...Object.keys(mapping)], { stdio: ['ignore', 'ignore', 'pipe'] });
  if (result.status !== 0) throw new Error('Cannot read current Stage configuration; no secret output was logged');
  const values = JSON.parse(readFileSync(path, 'utf8'));
  for (const [key, secret] of Object.entries(mapping)) {
    if (typeof values[key] !== 'string' || !values[key]) throw new Error(`Source configuration is missing ${key}`);
    const write = spawnSync('gcloud', ['secrets', 'versions', 'add', secret, '--project=eduera-511111', '--data-file=-', '--quiet'], { input: values[key], encoding: 'utf8', stdio: ['pipe', 'ignore', 'pipe'] });
    if (write.status !== 0) throw new Error(`Could not write ${secret}; secret value was not logged`);
    console.log(`Copied ${key} to its private destination secret`);
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
