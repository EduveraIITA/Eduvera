import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, matchesGlob, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { productionApiOrigin, verifyWebExport } from './verify-web-export.mjs';
import { SIMULATION_CONFORMANCE_EVIDENCE, SIMULATION_SAFETY_EVIDENCE, SIMULATION_SHARED_MATERIAL_FILES } from '../../backend/src/simulation-conformance/simulation-conformance.registry.ts';

const here = dirname(fileURLToPath(import.meta.url));
const dockerfile = await readFile(join(here, 'Dockerfile'), 'utf8');
const instructions = dockerfile.replace(/\\\n/g, ' ').split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));
const ignoreRules = (await readFile(join(here, 'Dockerfile.dockerignore'), 'utf8')).split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));
// The dedicated ignore file uses only root-relative names and ** globs; there
// are no Docker/gitignore directory-matching ambiguities in these assertions.
function contextIncludes(filename) {
  let included = true;
  for (const rule of ignoreRules) {
    const negated = rule.startsWith('!'), pattern = (negated ? rule.slice(1) : rule).replace(/\/$/, '');
    if (matchesGlob(filename, pattern)) included = negated;
  }
  return included;
}

function contextIncludesWithParents(filename) {
  for (let path = filename; path !== '.'; path = posix.dirname(path)) {
    if (!contextIncludes(path)) return false;
  }
  return true;
}

// Resolve the actual stage inheritance, working directory and COPY destinations.
// A proof copied only into web-build or after the strict RUN cannot satisfy this.
async function strictBuildCopies() {
  const stages = new Map(); let stage;
  for (const instruction of instructions) {
    const tokens = instruction.split(/\s+/);
    if (tokens[0] === 'FROM') {
      const inherited = stages.get(tokens[1]);
      stage = { name: tokens.at(-1), workdir: inherited?.workdir ?? '/', copies: [...(inherited?.copies ?? [])] };
      stages.set(stage.name, stage);
    } else if (tokens[0] === 'WORKDIR') {
      stage.workdir = posix.resolve(stage.workdir, tokens[1]);
    } else if (stage?.name === 'backend-build' && instruction === 'RUN npm run build') {
      return stage.copies;
    } else if (tokens[0] === 'COPY' && !tokens.some(token => token.startsWith('--from='))) {
      const sources = tokens.slice(1, -1).filter(token => !token.startsWith('--'));
      const target = posix.resolve(stage.workdir, tokens.at(-1));
      for (const source of sources) {
        const directory = (await stat(resolve(here, '../..', source))).isDirectory();
        const destination = directory || !tokens.at(-1).endsWith('/') ? target : posix.join(target, posix.basename(source));
        stage.copies.push({ source, destination, directory });
      }
    }
  }
  assert.fail('backend-build strict RUN is absent');
}

test('every registered conformance proof and shared material reaches its exact backend-build path through the allowed context', async () => {
  const copies = await strictBuildCopies();
  const required = [...new Set([
    ...SIMULATION_CONFORMANCE_EVIDENCE.map(evidence => evidence.test_file),
    ...SIMULATION_SAFETY_EVIDENCE.map(evidence => evidence.test_file),
    ...SIMULATION_SHARED_MATERIAL_FILES,
  ])];
  const missing = required.filter(file => !contextIncludesWithParents(file) || !copies.some(copy => {
    const child = posix.relative(copy.source, file);
    if (child === '') return copy.destination === `/build/${file}`;
    return copy.directory && child !== '..' && !child.startsWith('../')
      && posix.join(copy.destination, child) === `/build/${file}`;
  }));
  assert.deepEqual(missing, [], 'registered inputs must be available before the unchanged strict verifier runs');
});

test('DT recipe builds the backend through the unchanged strict conformance gate and packages only its runtime outputs', () => {
  assert.match(dockerfile, /FROM backend-dependencies AS backend-build/);
  assert.match(dockerfile, /RUN npm run build\n/);
  assert.doesNotMatch(dockerfile, /conformance:update|--write|SKIP_|tsc\s+-p|\|\|\s*true/);
  for (const input of ['backend/src', 'backend/test', 'backend/migrations', 'frontend/src', 'packages/contracts/src', 'backend/scripts/verify-simulation-conformance.ts'])
    assert.ok(instructions.some(line => line.startsWith('COPY ') && line.split(/\s+/).includes(input)), input);
  const runtime = instructions.slice(instructions.indexOf('FROM node:24-bookworm-slim AS runtime'));
  const runtimeCopies = runtime.filter(line => line.startsWith('COPY '));
  assert.equal(runtimeCopies.length, 6);
  assert.ok(runtimeCopies.every(line => /--from=(?:backend-production-dependencies|backend-build|web-build)\b/.test(line) || line.includes('backend/assets')));
  assert.ok(runtimeCopies.some(line => line.includes('/build/backend/migrations ./migrations')));
  assert.ok(runtimeCopies.some(line => line.includes('/build/web-dist /app/web-dist')));
  assert.doesNotMatch(runtimeCopies.join('\n'), /frontend|\/src\b|\/test\b|\/scripts\b/);
  assert.match(dockerfile, /npm ci --omit=dev/);
  assert.ok(runtime.includes('WORKDIR /app/backend'));
  assert.ok(runtime.includes('USER node'));
  assert.ok(runtime.includes('CMD ["node", "dist/main.js"]'));
});

test('recipe uses the sole Expo web export, correct production origin, and dependency-matched CanvasKit', () => {
  assert.match(dockerfile, /ARG EXPO_PUBLIC_API_URL=https:\/\/app2\.thatcampus\.com/);
  assert.match(dockerfile, /EXPO_NO_DOTENV=1 EAS_BUILD_PROFILE=production NODE_ENV=production/);
  assert.match(dockerfile, /npm run export:web -- --output-dir \/build\/web-dist/);
  assert.match(dockerfile, /verify-web-export\.mjs \/build\/web-dist "\$EXPO_PUBLIC_API_URL"/);
  assert.match(dockerfile, /COPY mobile\/scripts\/prepare-campus-skia-web\.cjs/);
  assert.match(dockerfile, /cp assets\/fonts\/FONT-LICENSE\.txt \/build\/web-dist\/licenses\/DejaVuSans-LICENSE\.txt/);
  assert.doesNotMatch(dockerfile, /frontend\/(?:package|dist)|WORKDIR [^\n]*frontend|npm run (?:dev|web|start)\b|serve-web-preview|trycloudflare/);
  for (const value of ['NODE_ENV=production', 'HOST=0.0.0.0', 'PORT=8080', 'SPA_DIST_DIR=/app/web-dist', 'UPLOAD_DIR=/app/storage/leave-documents', 'SIMULATION_PG_DUMP_PATH=/usr/lib/postgresql/17/bin/pg_dump'])
    assert.ok(dockerfile.includes(value), value);
  assert.match(dockerfile, /ARG RELEASE_SHA\nENV RELEASE_SHA=\$RELEASE_SHA/);
  assert.doesNotMatch(dockerfile, /db:migrate|db:seed|DATABASE_URL=|COOKIE_SECRET=/);
});

test('PG17 comes from the signed official Debian repository with a checked key and exact runtime binary', () => {
  assert.match(dockerfile, /https:\/\/www\.postgresql\.org\/media\/keys\/ACCC4CF8\.asc/);
  assert.match(dockerfile, /B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8/);
  assert.match(dockerfile, /Signed-By: \/usr\/share\/postgresql-common\/pgdg\/apt\.postgresql\.org\.asc/);
  assert.match(dockerfile, /apt-get install -y --no-install-recommends postgresql-client-17/);
  assert.match(dockerfile, /\/usr\/lib\/postgresql\/17\/bin\/pg_dump --version/);
  assert.doesNotMatch(dockerfile, /(?:install|COPY)[^\n]*postgresql-(?:server-)?(?:15|16|18|19)\b/);
});

test('every source COPY has an explicit allowed context root; local secrets, state and old runtimes remain outside it', () => {
  assert.equal(ignoreRules[0], '**');
  const copySources = instructions.filter(line => line.startsWith('COPY ') && !line.includes('--from='))
    .flatMap(line => line.split(/\s+/).slice(1, -1).filter(token => !token.startsWith('--')));
  for (const source of copySources) {
    assert.ok(!['.', './', '/'].includes(source), source);
    assert.ok(contextIncludes(source), `COPY input excluded: ${source}`);
  }
  for (const allowed of ['backend/src/main.ts', 'backend/test/simulation-conformance.test.ts', 'backend/migrations/0001_initial.sql', 'backend/assets/receipt/FONT-LICENSE.txt', 'frontend/src/main.tsx', 'frontend/src/features/people/people.test.ts', 'packages/contracts/src/workspace.ts', 'mobile/app/_layout.tsx', 'mobile/src/lib/api.web.ts', 'mobile/test/more-tool-boundary-mounted.test.ts', 'mobile/assets/icon.png', 'mobile/public/index.html', 'mobile/plugins/withAndroidReleasePolicy.cjs'])
    assert.equal(contextIncludes(allowed), true, allowed);
  for (const denied of ['.env', '.env.production', '.git', '.runtime/live-binding.json', 'artifacts/private.json', 'research/observations.json', 'node_modules/dependency.js', 'backend/.env', 'backend/storage/uploads/private.jpg', 'backend/node_modules/pg/index.js', 'backend/src/nested/.env.local', 'backend/src/private.pem', 'backend/test/private.dump', 'backend/test/private.sql', 'backend/test/private.sql.gz', 'backend/test/private.tar.gz', 'backend/test/private.zip', 'backend/test/private.sqlite3', 'backend/test/private.log', 'mobile/.expo/state.json', 'mobile/.env.production', 'mobile/android/app/release.jks', 'mobile/ios/Pods/private.key', 'mobile/node_modules/react/index.js', 'mobile/dist/index.html', 'mobile/test/unregistered.test.ts', 'mobile/test/nested/unregistered.test.ts', 'frontend/package.json', 'frontend/node_modules/react/index.js', 'frontend/dist/index.html', 'deploy/gcp/release.mjs'])
    assert.equal(contextIncludes(denied), false, denied);
  for (const denied of ['backend/migrations/artifacts/private.sql', 'backend/migrations/.runtime/private.sql'])
    assert.equal(contextIncludes(denied), false, denied);
});

async function exportFixture(run) {
  const directory = await mkdtemp(join(tmpdir(), 'thatcampus-dt-web-'));
  const payload = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]), sha256 = createHash('sha256').update(payload).digest('hex');
  const entry = '_expo/static/js/web/entry-1234.js', wasm = `skia/canvaskit-0.41.0-${sha256.slice(0, 12)}.wasm`;
  const put = async (file, contents) => { await mkdir(dirname(join(directory, file)), { recursive: true }); await writeFile(join(directory, file), contents); };
  await put('index.html', `<html><body><div id="root"></div><script src="/${entry}" defer></script></body></html>`);
  await put(entry, 'globalThis.campusLoaded = true;'); await put(wasm, payload); await put('skia/canvaskit-LICENSE.txt', 'Upstream CanvasKit fixture license');
  try { await run({ directory, entry, wasm, put, sha256 }); } finally { await rm(directory, { recursive: true, force: true }); }
}

test('production origin rejects temporary tunnels, credentials and URL state without echoing values', () => {
  assert.equal(productionApiOrigin('https://app2.thatcampus.com'), 'https://app2.thatcampus.com');
  for (const value of [undefined, 'http://app2.thatcampus.com', 'https://secret:password@app2.thatcampus.com', 'https://app2.thatcampus.com/api', 'https://app2.thatcampus.com?secret=value', 'https://temporary.trycloudflare.com', 'https://127.0.0.1:8080', 'https://[::1]:8080'])
    assert.throws(() => productionApiOrigin(value), cause => cause instanceof Error && !/secret|password|temporary/.test(cause.message));
});
test('a complete sole Expo export verifies local entry and versioned CanvasKit bytes', async () => exportFixture(async f => {
  assert.deepEqual(await verifyWebExport(f.directory, 'https://app2.thatcampus.com'), { origin: 'https://app2.thatcampus.com', entry_scripts: 1, files: 4, canvaskit_sha256: f.sha256 });
}));
test('missing or external entry scripts fail instead of accepting an HTML fallback or Metro document', async () => {
  for (const source of ['/_expo/static/js/web/missing.js', 'https://outside.example/entry.js', '/index.bundle?platform=web', '/assets/old-vite.js'])
    await exportFixture(async f => { await f.put('index.html', `<div id="root"></div><script src="${source}"></script>`); await assert.rejects(verifyWebExport(f.directory, 'https://app2.thatcampus.com'), /entry script/); });
});
test('CanvasKit corruption and duplicated versions fail the build export gate', async () => {
  await exportFixture(async f => { await f.put(f.wasm, Buffer.from('not WASM')); await assert.rejects(verifyWebExport(f.directory, 'https://app2.thatcampus.com'), /CanvasKit payload/); });
  await exportFixture(async f => { await f.put(`skia/canvaskit-0.40.0-${f.sha256.slice(0, 12)}.wasm`, Buffer.from([0, 97, 115, 109, 1, 0, 0, 0])); await assert.rejects(verifyWebExport(f.directory, 'https://app2.thatcampus.com'), /one dependency-matched/); });
});
test('an exported DejaVu font carries its redistribution license', async () => exportFixture(async f => {
  await f.put('assets/fonts/DejaVuSans.fixture.ttf', Buffer.from('fixture font'));
  await assert.rejects(verifyWebExport(f.directory, 'https://app2.thatcampus.com'), /DejaVuSans-LICENSE/);
  await f.put('licenses/DejaVuSans-LICENSE.txt', 'Fixture redistribution notice');
  assert.equal((await verifyWebExport(f.directory, 'https://app2.thatcampus.com')).files, 6);
}));
test('temporary origin leaks, public source maps and symlinked private payloads fail the export gate', async () => {
  await exportFixture(async f => { await f.put(f.entry, 'const origin = "https://old-tunnel.trycloudflare.com";'); await assert.rejects(verifyWebExport(f.directory, 'https://app2.thatcampus.com'), /temporary tunnel origin/); });
  await exportFixture(async f => { await f.put(`${f.entry}.map`, '{}'); await assert.rejects(verifyWebExport(f.directory, 'https://app2.thatcampus.com'), /source maps/); });
  await exportFixture(async f => { await symlink('/outside/private', join(f.directory, 'private-link')); await assert.rejects(verifyWebExport(f.directory, 'https://app2.thatcampus.com'), /symbolic links/); });
});
