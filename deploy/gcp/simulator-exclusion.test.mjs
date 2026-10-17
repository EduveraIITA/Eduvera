import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function sourceFiles(directory) {
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...sourceFiles(path));
    else if (['.js', '.jsx', '.ts', '.tsx'].includes(extname(entry.name))) result.push(path);
  }
  return result;
}

test('the development simulator is outside the production Docker build context', () => {
  const dockerignore = readFileSync(join(repositoryRoot, '.dockerignore'), 'utf8');
  const ignoredPaths = dockerignore
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
  assert.ok(
    ignoredPaths.includes('devtools/campus-simulator/'),
    'devtools/campus-simulator/ must remain excluded from every production Docker build stage',
  );

  const dockerfile = readFileSync(join(repositoryRoot, 'backend/Dockerfile'), 'utf8');
  assert.doesNotMatch(
    dockerfile,
    /devtools(?:\/|\s).*campus-simulator|campus-simulator/iu,
    'the production Dockerfile must not copy the simulator explicitly',
  );
  assert.doesNotMatch(
    dockerfile,
    /^\s*COPY(?:\s+--[^\s]+)*\s+\.?\/?\s+/gmu,
    'the production Dockerfile must keep explicit source roots instead of copying the repository root',
  );
});

test('production frontend sources cannot statically import Campus Lab or the simulator runtime', () => {
  const frontendSource = join(repositoryRoot, 'frontend/src');
  const devSource = join(frontendSource, 'dev');
  const forbiddenRuntimeReference = /(?:devtools\/campus-simulator|campus-simulator)/iu;
  const staticImport = /(?:import|export)\s+(?:[^'";]*?\s+from\s*)?['"]([^'"]+)['"]/gu;
  const dynamicDevImport = /import\s*\(\s*(['"])([^'"]*(?:\/dev\/campus-lab|\.\/dev\/campus-lab)[^'"]*)\1\s*\)/gu;
  const guardedDevImport = /import\.meta\.env\.DEV\s*\?\s*(?:lazy\s*\(\s*)?(?:\(\s*\)\s*=>\s*)?import\s*\(\s*(['"])([^'"]*(?:\/dev\/campus-lab|\.\/dev\/campus-lab)[^'"]*)\1\s*\)\s*\)?\s*:\s*(?:null|undefined)/gsu;

  for (const path of sourceFiles(frontendSource)) {
    if (path === devSource || path.startsWith(`${devSource}/`)) continue;
    const source = readFileSync(path, 'utf8');
    const displayPath = relative(repositoryRoot, path);

    assert.doesNotMatch(
      source,
      forbiddenRuntimeReference,
      `${displayPath} must not reference the development simulator runtime`,
    );

    for (const match of source.matchAll(staticImport)) {
      assert.doesNotMatch(
        match[1],
        /(?:\/dev\/campus-lab|\.\/dev\/campus-lab)/u,
        `${displayPath} must not statically import the development-only Campus Lab`,
      );
    }

    const allowedRanges = [...source.matchAll(guardedDevImport)].map(match => [
      match.index,
      match.index + match[0].length,
    ]);
    for (const match of source.matchAll(dynamicDevImport)) {
      assert.ok(
        allowedRanges.some(([start, end]) => match.index >= start && match.index < end),
        `${displayPath} may load Campus Lab only through an import.meta.env.DEV guarded lazy import`,
      );
    }
  }
});

test('the permanent Campus View contains no development-persona implementation', () => {
  const campusViewSource = join(repositoryRoot, 'frontend/src/features/campus-view');
  const developmentPersonaLanguage = /\b(?:dummy|simulat(?:e|ed|ion)|synthetic)\b/iu;
  for (const path of sourceFiles(campusViewSource)) {
    const source = readFileSync(path, 'utf8');
    assert.doesNotMatch(
      source,
      developmentPersonaLanguage,
      `${relative(repositoryRoot, path)} must remain a permanent, real-data Campus View; development personas belong under frontend/src/dev`,
    );
  }
});
