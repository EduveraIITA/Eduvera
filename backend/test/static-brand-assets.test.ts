import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as files from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readThatCampusWordmark, thatCampusWordmark } from '../src/common/brand-assets.js';
import { createLiveExecutionEnvironment } from '../src/campus-model-core/execution-environment.runtime.js';
import { executionEnvironmentStorage } from '../src/campus-model-core/execution-time.runtime.js';
import { simulationRequestEnvironment } from '../src/database/simulation-world.service.js';

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof files>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});

const institution = '10000000-0000-4000-8000-000000000001';
const instant = '2030-02-03T04:05:06.000Z';
const expectedPath = new URL('../assets/receipt/thatcampus-wordmark-light-v3.png', import.meta.url);
const inventory = JSON.parse(readFileSync(new URL('../../design/brand/asset-manifest-v3.json', import.meta.url), 'utf8')) as {
  assets: Array<{ path: string; sha256: string }>;
};
const expectedHash = inventory.assets.find(asset => asset.path === 'backend/assets/receipt/thatcampus-wordmark-light-v3.png')!.sha256;
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

afterEach(() => vi.clearAllMocks());

describe('fixed packaged brand artwork boundary', () => {
  it('reads the same approved static bytes in Live and Simulation without clock or campus-file access', async () => {
    const read = vi.mocked(files.readFile);
    const clock = { now: vi.fn(() => new Date(instant)), nowIso: vi.fn(() => instant) };
    const live = createLiveExecutionEnvironment({ institution_id: institution, clock });
    const simulation = simulationRequestEnvironment({ institution_id: institution,
      scenario_id: '20000000-0000-4000-8000-000000000001', run_id: '30000000-0000-4000-8000-000000000001',
      virtual_now: instant, source_snapshot_ref: 'static-artwork-test', manifest_ref: 'static-artwork-test', checked_at: instant });
    const liveBytes = await executionEnvironmentStorage.run(live, () => readThatCampusWordmark());
    const simulatedBytes = await executionEnvironmentStorage.run(simulation, () => readThatCampusWordmark());
    expect(simulatedBytes).toEqual(liveBytes);
    expect(digest(liveBytes)).toBe(expectedHash);
    expect(read.mock.calls.map(([path]) => path instanceof URL ? path.href : path)).toEqual([expectedPath.href, expectedPath.href]);
    expect(clock.now).not.toHaveBeenCalled();
    expect(clock.nowIso).not.toHaveBeenCalled();
  });

  it('takes no caller-selected path and retains versioned public presentation metadata', async () => {
    const read = vi.mocked(files.readFile);
    const callWithIgnoredArguments: (...args: unknown[]) => Promise<Buffer> = readThatCampusWordmark;
    const result = await callWithIgnoredArguments('/private/never-read-campus-file', { school_id: institution });
    expect(readThatCampusWordmark.length).toBe(0);
    expect(read.mock.calls.map(([path]) => path instanceof URL ? path.href : path)).toEqual([expectedPath.href]);
    expect(digest(result)).toBe(expectedHash);
    expect(thatCampusWordmark).toEqual({ filename: 'thatcampus-wordmark-light-v3.png',
      emailPath: '/email-assets/thatcampus-wordmark-light-v3.png', contentType: 'image/png' });
  });
});
