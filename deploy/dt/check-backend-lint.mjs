import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const fields = ['path', 'fileSha256', 'ruleId', 'line', 'column', 'message'];
const issueKey = row => JSON.stringify(fields.map(key => row[key]));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function validateBaseline(baseline) {
  if (baseline?.schemaVersion !== 1 || !Array.isArray(baseline.entries) || baseline.errorCount !== baseline.entries.length) throw new Error('Invalid exact backend lint baseline.');
  const keys = new Set(), hashes = new Map();
  for (const row of baseline.entries) {
    if (Object.keys(row).sort().join(',') !== [...fields].sort().join(',')
      || typeof row.path !== 'string' || !/^(?:src|test|scripts)\/.+\.(?:ts|mjs)$/u.test(row.path)
      || row.path.split('/').some(part => !part || part === '.' || part === '..') || row.path.includes('\\')
      || !/^[a-f0-9]{64}$/u.test(row.fileSha256 ?? '') || typeof row.ruleId !== 'string' || !row.ruleId
      || !Number.isSafeInteger(row.line) || row.line < 1 || !Number.isSafeInteger(row.column) || row.column < 1
      || typeof row.message !== 'string' || !row.message) throw new Error('A baseline entry must identify one exact, hash-bound existing rule error.');
    const key = issueKey(row);
    if (keys.has(key) || hashes.has(row.path) && hashes.get(row.path) !== row.fileSha256) throw new Error('Duplicate or conflicting backend lint baseline entries.');
    keys.add(key); hashes.set(row.path, row.fileSha256);
  }
  return keys;
}

function reportPath(file, backendRoot) {
  if (typeof file !== 'string' || !isAbsolute(file)) throw new Error('ESLint must identify an absolute source path.');
  const path = relative(backendRoot, file);
  if (!path || path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) throw new Error('ESLint reported a file outside the backend.');
  return path.split(sep).join('/');
}

/** Full lint still runs. Only the reviewed, byte-identical pre-existing errors
 * can pass this deployment gate. Changed debt files must become clean; newly
 * introduced errors, every warning and parser/config failures remain blocking.
 * There is intentionally no command to regenerate or extend this baseline. */
export async function assessBackendLint(results, baseline, {
  backendRoot = resolve(repository, 'backend'),
  readSource = path => readFile(resolve(backendRoot, path)),
} = {}) {
  const accepted = validateBaseline(baseline);
  if (!Array.isArray(results) || !results.length) throw new Error('ESLint did not provide a complete nonempty JSON report.');
  const matched = new Set(), seen = new Set(), failures = [];
  let errorCount = 0, warningCount = 0;
  for (const result of results) {
    const path = reportPath(result.filePath, backendRoot);
    if (seen.has(path) || !Array.isArray(result.messages)) throw new Error('ESLint returned duplicate or malformed file results.');
    seen.add(path);
    const errors = result.messages.filter(row => row.severity === 2).length;
    const warnings = result.messages.filter(row => row.severity === 1).length;
    if (errors !== result.errorCount || warnings !== result.warningCount || errors + warnings !== result.messages.length) throw new Error('ESLint issue counts disagree with its messages.');
    errorCount += errors; warningCount += warnings;
    const hash = errors ? sha256(await readSource(path)) : undefined;
    for (const message of result.messages) {
      const row = { path, fileSha256: hash, ruleId: message.ruleId, line: message.line, column: message.column, message: message.message };
      let reason;
      if (message.severity === 1) reason = 'warning';
      else if (message.fatal || !message.ruleId || !Number.isSafeInteger(message.line) || !Number.isSafeInteger(message.column)) reason = 'fatal-or-parser-error';
      else if (accepted.has(issueKey(row)) && !matched.has(issueKey(row))) { matched.add(issueKey(row)); continue; }
      else reason = baseline.entries.some(prior => prior.path === path && prior.fileSha256 !== hash) ? 'changed-source-with-existing-debt' : 'new-error';
      failures.push({ path, ruleId: message.ruleId, line: message.line, column: message.column, message: message.message, reason });
    }
  }
  return {
    status: failures.length ? 'failed' : matched.size ? 'accepted-existing-debt' : 'clean',
    filesChecked: seen.size, errorCount, warningCount,
    acceptedExistingErrors: matched.size, removedExistingErrors: baseline.entries.length - matched.size,
    failures,
  };
}

export function parseLintProcess(result) {
  if (result.error || result.signal || ![0, 1].includes(result.status)) throw new Error('Whole-backend ESLint did not finish successfully; configuration, process and memory failures cannot be baselined.');
  let results;
  try { results = JSON.parse(result.stdout); } catch { throw new Error('Whole-backend ESLint did not return valid JSON.'); }
  if (!Array.isArray(results) || !results.length) throw new Error('Whole-backend ESLint returned an empty report.');
  const count = results.reduce((sum, row) => sum + (row.errorCount ?? 0) + (row.warningCount ?? 0), 0);
  if (result.status === 0 && count !== 0 || result.status === 1 && count === 0) throw new Error('ESLint exit status disagrees with its report.');
  return results;
}

export async function checkBackendLint({ execute = spawnSync } = {}) {
  const backendRoot = resolve(repository, 'backend');
  const baseline = JSON.parse(await readFile(new URL('./backend-lint-baseline.json', import.meta.url), 'utf8'));
  const result = execute(process.execPath, [resolve(backendRoot, 'node_modules/eslint/bin/eslint.js'), '.', '--max-warnings=0', '--format=json'], {
    cwd: backendRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 300_000,
    env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  return assessBackendLint(parseLintProcess(result), baseline, { backendRoot });
}

async function main() {
  try {
    const report = await checkBackendLint();
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    if (report.status === 'failed') process.exitCode = 1;
    else if (report.acceptedExistingErrors) process.stdout.write(`Deployment lint gate accepted ${report.acceptedExistingErrors} unchanged existing errors. Ordinary npm --prefix backend run lint remains nonzero; this is not clean-lint acceptance.\n`);
  } catch (error) {
    process.stderr.write((error instanceof Error ? error.message : 'Backend lint gate failed.') + '\n');
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
