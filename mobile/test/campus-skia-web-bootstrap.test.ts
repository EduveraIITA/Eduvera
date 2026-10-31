import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { campusSkiaWebAssetUrl, createCampusSkiaWebBootstrap } from '../src/features/campus/skia/campusSkiaWebBootstrap';

test('concurrent web maps share one initialization and a later map reuses loaded CanvasKit', async () => {
  let loaded: { ready: boolean } | undefined, calls = 0, finish: (value: { ready: boolean }) => void = () => {};
  const prepare = createCampusSkiaWebBootstrap({ loaded: () => loaded, initialize: () => { calls++; return new Promise<{ ready: boolean }>(resolve => { finish = resolve; }); }, publish: value => { loaded = value; } });
  const first = prepare(), second = prepare();
  assert.equal(first, second);
  assert.equal(calls, 1);
  finish({ ready: true });
  await first;
  await prepare();
  assert.equal(calls, 1);
  assert.deepEqual(loaded, { ready: true });
});

test('a failed WASM initialization remains recoverable without reloading campus data', async () => {
  let loaded: string | undefined, calls = 0;
  const prepare = createCampusSkiaWebBootstrap({ loaded: () => loaded, initialize: async () => { calls++; if (calls === 1) throw new Error('WASM download interrupted'); return 'ready'; }, publish: value => { loaded = value; } });
  await assert.rejects(prepare(), /interrupted/);
  assert.equal(loaded, undefined);
  await prepare();
  assert.equal(loaded, 'ready');
  assert.equal(calls, 2);
});

test('WASM URLs remain origin-local on deep campus routes and honor Expo deployment base', () => {
  assert.match(campusSkiaWebAssetUrl(''), /^\/skia\/canvaskit-0\.41\.0-[a-f0-9]{12}\.wasm$/);
  assert.equal(campusSkiaWebAssetUrl('/campus/'), `/campus${campusSkiaWebAssetUrl('')}`);
});

test('asset preparation is reproducible from the installed Skia dependency and retains its license', () => {
  const require = createRequire(import.meta.url), { prepareCampusSkiaWeb } = require('../scripts/prepare-campus-skia-web.cjs') as { prepareCampusSkiaWeb(options: { publicDirectory: string; manifestPath: string }): { version: string; path: string; sha256: string; bytes: number } };
  const directory = mkdtempSync(path.join(tmpdir(), 'thatcampus-skia-assets-'));
  try {
    const publicDirectory = path.join(directory, 'public'), manifestPath = path.join(directory, 'asset.ts'), first = prepareCampusSkiaWeb({ publicDirectory, manifestPath });
    const filename = path.basename(first.path), data = readFileSync(path.join(publicDirectory, filename));
    assert.equal(createHash('sha256').update(data).digest('hex'), first.sha256);
    assert.equal(data.length, first.bytes);
    assert.match(readFileSync(path.join(publicDirectory, 'canvaskit-LICENSE.txt'), 'utf8'), /Copyright/);
    assert.match(readFileSync(manifestPath, 'utf8'), new RegExp(first.sha256));
    writeFileSync(path.join(publicDirectory, 'canvaskit-0.0.1-aaaaaaaaaaaa.wasm'), 'obsolete generator payload');
    writeFileSync(path.join(publicDirectory, 'unrelated.wasm'), 'another feature');
    assert.deepEqual(prepareCampusSkiaWeb({ publicDirectory, manifestPath }), first);
    assert.throws(() => readFileSync(path.join(publicDirectory, 'canvaskit-0.0.1-aaaaaaaaaaaa.wasm')), /ENOENT/);
    assert.equal(readFileSync(path.join(publicDirectory, 'unrelated.wasm'), 'utf8'), 'another feature');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
