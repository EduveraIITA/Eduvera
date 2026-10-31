import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { assessBackendLint, checkBackendLint, parseLintProcess } from './check-backend-lint.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const issue = { ruleId: '@typescript-eslint/no-unused-vars', severity: 2, line: 1, column: 7, message: "'unused' is assigned a value but never used." };
const result = (filePath, messages = []) => ({ filePath, messages, errorCount: messages.filter(row => row.severity === 2).length, warningCount: messages.filter(row => row.severity === 1).length });
async function fixture(t) {
  const backendRoot = await mkdtemp(join(tmpdir(), 'dt-lint-'));
  t.after(() => rm(backendRoot, { recursive: true, force: true }));
  await mkdir(join(backendRoot, 'src'));
  const source = 'const unused = 1;\n', file = join(backendRoot, 'src/a.ts'), other = join(backendRoot, 'src/b.ts');
  await writeFile(file, source); await writeFile(other, 'export {};\n');
  const baseline = { schemaVersion: 1, errorCount: 1, entries: [{ path: 'src/a.ts', fileSha256: hash(source), ruleId: issue.ruleId, line: issue.line, column: issue.column, message: issue.message }] };
  return { backendRoot, file, other, baseline, results: [result(file, [issue]), result(other)] };
}

test('one unchanged existing error is accepted only with the exact source bytes and issue identity', async t => {
  const f = await fixture(t), report = await assessBackendLint(f.results, f.baseline, f);
  assert.equal(report.status, 'accepted-existing-debt'); assert.equal(report.filesChecked, 2);
  assert.equal(report.acceptedExistingErrors, 1); assert.equal(report.errorCount, 1); assert.equal(report.warningCount, 0);
  assert.deepEqual(report.failures, []);
});

test('a new error or duplicate occurrence fails even while an unrelated existing error matches', async t => {
  const f = await fixture(t);
  const added = await assessBackendLint([f.results[0], result(f.other, [issue])], f.baseline, f);
  assert.equal(added.status, 'failed'); assert.equal(added.acceptedExistingErrors, 1); assert.equal(added.failures[0].reason, 'new-error');
  const duplicate = await assessBackendLint([result(f.file, [issue, issue]), f.results[1]], f.baseline, f);
  assert.equal(duplicate.status, 'failed'); assert.equal(duplicate.failures.length, 1);
});

test('editing a debt file invalidates its old baseline even when the issue stays at the same location', async t => {
  const f = await fixture(t);
  await writeFile(f.file, 'const unused = 1;\n// changed elsewhere\n');
  const report = await assessBackendLint(f.results, f.baseline, f);
  assert.equal(report.status, 'failed'); assert.equal(report.acceptedExistingErrors, 0);
  assert.equal(report.failures[0].reason, 'changed-source-with-existing-debt');
});

test('fixed or deleted debt may disappear without requiring a new suppression or baseline refresh', async t => {
  const f = await fixture(t);
  await writeFile(f.file, 'export {};\n');
  const fixed = await assessBackendLint([result(f.file), result(f.other)], f.baseline, f);
  assert.equal(fixed.status, 'clean'); assert.equal(fixed.removedExistingErrors, 1);
  await unlink(f.file);
  const deleted = await assessBackendLint([result(f.other)], f.baseline, f);
  assert.equal(deleted.status, 'clean'); assert.equal(deleted.removedExistingErrors, 1);
});

test('every warning blocks, including one with an otherwise identical baseline issue identity', async t => {
  const f = await fixture(t);
  const report = await assessBackendLint([result(f.file, [{ ...issue, severity: 1 }]), result(f.other)], f.baseline, f);
  assert.equal(report.status, 'failed'); assert.equal(report.warningCount, 1); assert.equal(report.acceptedExistingErrors, 0);
  assert.equal(report.failures[0].reason, 'warning');
});

test('changing a rule, line, column or message cannot reuse an existing error allowance', async t => {
  const f = await fixture(t);
  for (const changed of [{ ruleId: 'no-undef' }, { line: 2 }, { column: 8 }, { message: 'A different problem.' }]) {
    const report = await assessBackendLint([result(f.file, [{ ...issue, ...changed }]), result(f.other)], f.baseline, f);
    assert.equal(report.status, 'failed'); assert.equal(report.acceptedExistingErrors, 0);
  }
});

test('parser errors, malformed reports, escaped paths and ambiguous baselines fail closed', async t => {
  const f = await fixture(t);
  const fatal = await assessBackendLint([result(f.file, [{ ...issue, fatal: true, ruleId: null }])], f.baseline, f);
  assert.equal(fatal.status, 'failed'); assert.equal(fatal.failures[0].reason, 'fatal-or-parser-error');
  for (const results of [[], [result('/outside/backend.ts')], [f.results[0], f.results[0]], [{ ...f.results[0], errorCount: 0 }]]) await assert.rejects(assessBackendLint(results, f.baseline, f));
  for (const changed of [{ path: '../outside.ts' }, { fileSha256: 'invalid' }, { line: 0 }, { severity: 1 }]) {
    const baseline = structuredClone(f.baseline); Object.assign(baseline.entries[0], changed);
    await assert.rejects(assessBackendLint(f.results, baseline, f));
  }
  const duplicate = structuredClone(f.baseline); duplicate.entries.push(duplicate.entries[0]); duplicate.errorCount++;
  await assert.rejects(assessBackendLint(f.results, duplicate, f));
});

test('OOM, timeout, configuration failure, invalid JSON or inconsistent exit status cannot become an accepted baseline', () => {
  const file = result('/backend/src/a.ts', [issue]), clean = result('/backend/src/b.ts');
  assert.deepEqual(parseLintProcess({ status: 1, stdout: JSON.stringify([file]) }), [file]);
  assert.deepEqual(parseLintProcess({ status: 0, stdout: JSON.stringify([clean]) }), [clean]);
  for (const processResult of [
    { status: null, signal: 'SIGABRT', stdout: JSON.stringify([file]) },
    { status: null, error: new Error('ETIMEDOUT'), stdout: '' },
    { status: 2, stdout: JSON.stringify([file]) }, { status: 1, stdout: '<not JSON>' },
    { status: 0, stdout: JSON.stringify([file]) }, { status: 1, stdout: JSON.stringify([clean]) },
    { status: 0, stdout: '[]' },
  ]) assert.throws(() => parseLintProcess(processResult));
});

test('the deployment runner invokes whole-backend lint without caches, suppressions, fixes or narrower file patterns', async () => {
  let called = false;
  const report = await checkBackendLint({ execute: (binary, args, options) => {
    called = true; assert.equal(binary, process.execPath);
    assert.deepEqual(args.slice(1), ['.', '--max-warnings=0', '--format=json']);
    assert.ok(args[0].endsWith('/backend/node_modules/eslint/bin/eslint.js'));
    assert.ok(options.cwd.endsWith('/backend')); assert.equal(options.timeout, 300_000);
    assert.equal(options.shell, undefined);
    return { status: 0, stdout: JSON.stringify([result(resolve(options.cwd, 'src/main.ts'))]) };
  } });
  assert.equal(called, true); assert.equal(report.status, 'clean');
});

test('the reviewed baseline contains exactly66 actual errors and excludes all deployment-owned backend paths', async () => {
  const baseline = JSON.parse(await readFile(new URL('./backend-lint-baseline.json', import.meta.url), 'utf8'));
  assert.equal(baseline.errorCount, 66); assert.equal(baseline.entries.length, 66);
  const owned = new Set(['src/main.ts', 'src/spa.controller.ts', 'src/web-assets.ts', 'src/database/simulation-pg-dump.ts', 'src/database/simulation-snapshot-store.ts', 'src/database/simulation-world.service.ts', 'src/database/campus-lab-simulation-environment.service.ts', 'test/web-assets.test.ts', 'test/simulation-pg-dump.test.ts', 'test/simulation-conformance.test.ts', 'src/simulation-conformance/simulation-conformance.registry.ts', 'src/simulation-conformance/simulation-conformance.generated.ts']);
  for (const row of baseline.entries) assert.equal(owned.has(row.path), false, row.path);
  // Do not require old hashes to match files whose debt is now fixed or deleted:
  // the real gate checks hashes only for errors that still occur today.
  for (const row of baseline.entries) assert.match(row.fileSha256, /^[a-f0-9]{64}$/u);
  const workflow = await readFile(new URL('../../.github/workflows/digital-twin-deploy.yml', import.meta.url), 'utf8');
  assert.ok(workflow.includes('node deploy/dt/check-backend-lint.mjs'));
  assert.equal(workflow.includes('npm --prefix backend run lint'), false);
});
