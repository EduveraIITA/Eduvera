import { afterEach, expect, it, vi } from 'vitest';
import { assertAgentEnabled } from '../src/agent/limits.js';

afterEach(() => vi.unstubAllEnvs());

function enableTrial() {
  vi.stubEnv('AGENT_ENABLED', 'true');
  vi.stubEnv('AGENT_PROVIDER', 'vertex');
  vi.stubEnv('AGENT_ENABLED_UNTIL', '2020-01-01T00:00:00Z');
  vi.stubEnv('AGENT_DAILY_BUDGET_MICROS', '500000');
  vi.stubEnv('AGENT_MONTHLY_BUDGET_MICROS', '5000000');
  vi.stubEnv('CAMPUS_MAP_AI_ENABLED_UNTIL', '2099-01-01T00:00:00Z');
  vi.stubEnv('CAMPUS_MAP_AI_DAILY_BUDGET_MICROS', '10000000');
  vi.stubEnv('CAMPUS_MAP_AI_MONTHLY_BUDGET_MICROS', '70000000');
}

it('permits the $10 campus test allowance during the approved trial without reopening the Assistant', () => {
  enableTrial();
  expect(assertAgentEnabled('campus_map_review')).toMatchObject({ dailyMicros: 10_000_000, monthlyMicros: 70_000_000 });
  expect(() => assertAgentEnabled()).toThrow(/paused/);
  vi.stubEnv('AGENT_ENABLED_UNTIL', '2099-01-01T00:00:00Z');
  expect(assertAgentEnabled()).toMatchObject({ dailyMicros: 500_000, monthlyMicros: 5_000_000 });
});

it('ignores trial budget overrides without an approved campus window and stops at expiry', () => {
  enableTrial();
  vi.stubEnv('CAMPUS_MAP_AI_ENABLED_UNTIL', '2020-01-01T00:00:00Z');
  expect(() => assertAgentEnabled('campus_map_review')).toThrow(/paused/);
  vi.stubEnv('CAMPUS_MAP_AI_ENABLED_UNTIL', undefined);
  vi.stubEnv('AGENT_ENABLED_UNTIL', '2099-01-01T00:00:00Z');
  expect(assertAgentEnabled('campus_map_review')).toMatchObject({ dailyMicros: 500_000, monthlyMicros: 5_000_000 });
});

it('refuses a campus trial ceiling above the approved range or a switched-off provider', () => {
  enableTrial();
  vi.stubEnv('CAMPUS_MAP_AI_DAILY_BUDGET_MICROS', '10000001');
  expect(() => assertAgentEnabled('campus_map_review')).toThrow();
  vi.stubEnv('AGENT_ENABLED', 'false');
  expect(() => assertAgentEnabled('campus_map_review')).toThrow(/switched off/);
});
