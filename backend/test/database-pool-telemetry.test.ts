import 'reflect-metadata';
import { EventEmitter } from 'node:events';
import type { Pool } from 'pg';
import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AppController } from '../src/app.controller.js';
import * as configuration from '../src/config.js';
import { DatabasePoolTelemetry, isDatabasePoolAcquisitionFailure, type DatabasePoolSnapshot } from '../src/database/pool-telemetry.js';

class ObservedPool extends EventEmitter {
  totalCount = 4;
  idleCount = 4;
  waitingCount = 0;
}
function fixture() {
  const pool = new ObservedPool(); let time = 0;
  const failures: DatabasePoolSnapshot[] = [];
  const telemetry = new DatabasePoolTelemetry(pool as unknown as Pick<Pool, 'on' | 'totalCount' | 'idleCount' | 'waitingCount'>,
    { now: () => time, onAcquisitionFailure: snapshot => failures.push(snapshot) });
  return { pool, telemetry, failures, at(value: number) { time = value; } };
}
const fields = ['total', 'idle', 'waiting', 'acquired_current', 'oldest_checkout_ms', 'acquisitions_total', 'releases_total',
  'removed_total', 'acquisition_failures_total', 'hold_count', 'hold_ms_sum', 'hold_ms_max'].sort();

describe('Database pool telemetry owns only bounded checkout evidence', () => {
  it('reads pool gauges without treating existing idle clients as checked-out leases', () => {
    const f = fixture(); f.pool.waitingCount = 2;
    expect(f.telemetry.snapshot()).toEqual({ total: 4, idle: 4, waiting: 2, acquired_current: 0, oldest_checkout_ms: 0,
      acquisitions_total: 0, releases_total: 0, removed_total: 0, acquisition_failures_total: 0, hold_count: 0, hold_ms_sum: 0, hold_ms_max: 0 });
    expect(f.pool.listenerCount('acquire')).toBe(1); expect(f.pool.listenerCount('release')).toBe(1); expect(f.pool.listenerCount('remove')).toBe(1);
    f.pool.totalCount = 3; f.pool.idleCount = 1; f.pool.waitingCount = 5;
    expect(f.telemetry.snapshot()).toMatchObject({ total: 3, idle: 1, waiting: 5, acquired_current: 0 });
  });

  it('tracks oldest concurrent checkout, closes its duration once and starts a fresh lease when a client is reused', () => {
    const f = fixture(), first = {}, second = {};
    f.pool.emit('acquire', first); f.at(25); f.pool.emit('acquire', second); f.at(80);
    const before = f.telemetry.snapshot(); expect(before).toMatchObject({ acquired_current: 2, oldest_checkout_ms: 80, acquisitions_total: 2 });
    f.at(100); f.pool.emit('release', undefined, first);
    expect(f.telemetry.snapshot()).toMatchObject({ acquired_current: 1, oldest_checkout_ms: 75, hold_count: 1, hold_ms_sum: 100, hold_ms_max: 100 });
    f.at(125); f.pool.emit('release', undefined, second);
    expect(f.telemetry.snapshot()).toMatchObject({ acquired_current: 0, oldest_checkout_ms: 0, hold_count: 2, hold_ms_sum: 200, releases_total: 2 });
    f.at(200); f.pool.emit('acquire', first); f.at(215); f.pool.emit('release', undefined, first);
    expect(f.telemetry.snapshot()).toMatchObject({ acquisitions_total: 3, hold_count: 3, hold_ms_sum: 215, hold_ms_max: 100 });
    expect(before.acquired_current).toBe(2); expect(Object.isFrozen(before)).toBe(true);
  });

  it('clears failed releases and direct removals without counting a removed or unknown client twice', () => {
    const f = fixture(), failed = {}, removed = {};
    f.pool.emit('acquire', failed); f.at(40); f.pool.emit('release', new Error('Private connection failure'), failed);
    f.at(100); f.pool.emit('remove', failed);
    expect(f.telemetry.snapshot()).toMatchObject({ acquired_current: 0, hold_count: 1, hold_ms_sum: 40, releases_total: 1, removed_total: 1 });
    f.pool.emit('acquire', removed); f.at(160); f.pool.emit('remove', removed);
    f.at(250); f.pool.emit('release', undefined, removed); f.pool.emit('release', undefined, {}); f.pool.emit('remove', {});
    expect(f.telemetry.snapshot()).toMatchObject({ acquired_current: 0, oldest_checkout_ms: 0, hold_count: 2, hold_ms_sum: 100, hold_ms_max: 60 });
  });

  it('reports the first acquisition failure immediately and throttles only reports, retaining every original error and failure count', async () => {
    const f = fixture(), held = { sql: 'SELECT PRIVATE', account: 'private-person' };
    f.pool.idleCount = 0; f.pool.waitingCount = 3; f.pool.emit('acquire', held);
    for (const [time, reports] of [[0, 1], [4_999, 1], [5_000, 2], [5_001, 2], [10_000, 3]]) {
      f.at(time!); const failure = new Error(`Original admission error at ${time}`);
      await expect(f.telemetry.observeAcquisition(() => Promise.reject(failure))).rejects.toBe(failure);
      expect(f.failures).toHaveLength(reports!);
    }
    expect(f.telemetry.snapshot().acquisition_failures_total).toBe(5);
    expect(f.telemetry.prometheus()).toContain('thatcampus_database_pool_acquisition_failures_total 5\n');
    expect(f.failures[0]).toMatchObject({ total: 4, idle: 0, waiting: 3, acquired_current: 1, acquisition_failures_total: 1 });
    expect(f.failures[2]).toMatchObject({ oldest_checkout_ms: 10_000, acquisition_failures_total: 5 });
    expect(JSON.stringify(f.failures)).not.toMatch(/PRIVATE|private-person|Original admission|sql|account/);
    f.pool.emit('release', undefined, held); expect(f.failures[0]?.acquired_current).toBe(1);
  });

  it('preserves resolved identity and synchronous/asynchronous failures even when the diagnostic callback throws', async () => {
    const pool = new ObservedPool(), logger = vi.fn(() => { throw new Error('Diagnostic callback failed'); });
    const telemetry = new DatabasePoolTelemetry(pool as unknown as Pick<Pool, 'on' | 'totalCount' | 'idleCount' | 'waitingCount'>, { onAcquisitionFailure: logger });
    const value = { original: true }, operation = vi.fn(() => Promise.resolve(value));
    expect(await telemetry.observeAcquisition(operation)).toBe(value); expect(operation).toHaveBeenCalledOnce(); expect(logger).not.toHaveBeenCalled();
    const original = new Error('Original synchronous failure');
    await expect(telemetry.observeAcquisition(() => { throw original; })).rejects.toBe(original);
    const asynchronous = new Error('Original asynchronous rejection');
    await expect(telemetry.observeAcquisition(() => Promise.reject(asynchronous))).rejects.toBe(asynchronous);
    expect(telemetry.snapshot()).toMatchObject({ acquisition_failures_total: 2, acquired_current: 0, acquisitions_total: 0, hold_count: 0 });
    expect(logger).toHaveBeenCalledOnce();
  });

  it('classifies only the exact observed acquisition error, without matching copied messages or following causes', async () => {
    const f = fixture(), message = 'timeout exceeded when trying to connect', cause = new Error('Original connection cause');
    const original = new Error(message, { cause }), unrelated = new Error('Unrelated SQL failure');
    expect(isDatabasePoolAcquisitionFailure(original)).toBe(false);
    expect(isDatabasePoolAcquisitionFailure(new Error(message))).toBe(false);
    await expect(f.telemetry.observeAcquisition(() => Promise.reject(original))).rejects.toBe(original);
    expect(isDatabasePoolAcquisitionFailure(original)).toBe(true); expect(original.cause).toBe(cause);
    expect(isDatabasePoolAcquisitionFailure(cause)).toBe(false);
    expect(isDatabasePoolAcquisitionFailure(new Error(original.message))).toBe(false);
    expect(isDatabasePoolAcquisitionFailure(new Error(original.message, { cause: original }))).toBe(false);
    expect(isDatabasePoolAcquisitionFailure(unrelated)).toBe(false);
    for (const value of [undefined, null, false, 0, message]) {
      expect(isDatabasePoolAcquisitionFailure(value)).toBe(false);
    }
  });

  it('keeps duration observations finite and nonnegative across a backward or invalid injected clock', () => {
    const f = fixture(), client = {};
    f.at(100); f.pool.emit('acquire', client); f.at(90); expect(f.telemetry.snapshot().oldest_checkout_ms).toBe(0);
    f.pool.emit('release', undefined, client); f.at(200); f.pool.emit('acquire', client); f.at(Number.NaN); f.pool.emit('remove', client);
    expect(f.telemetry.snapshot()).toMatchObject({ acquired_current: 0, hold_count: 2, hold_ms_sum: 0, hold_ms_max: 0 });
    expect(Object.values(f.telemetry.snapshot()).every(value => Number.isFinite(value) && value >= 0)).toBe(true);
  });

  it('exports cumulative checkout histograms in seconds and only numeric, identifier-free gauges and counters', () => {
    const f = fixture(), client = { processID: 12345, sql: 'SELECT PRIVATE', token: 'private-secret', account: 'private-person' };
    for (const [start, end, event] of [[0, 5, 'release'], [10, 60, 'release'], [100, 7_100, 'remove']] as const) {
      f.at(start); f.pool.emit('acquire', client); f.at(end);
      if (event === 'release') f.pool.emit(event, undefined, client); else f.pool.emit(event, client);
    }
    f.at(7_200); f.pool.emit('acquire', client); f.at(7_450); f.pool.idleCount = 3; f.pool.waitingCount = 2;
    const snapshot = f.telemetry.snapshot(), output = f.telemetry.prometheus();
    expect(Object.keys(snapshot).sort()).toEqual(fields); expect(Object.values(snapshot).every(Number.isFinite)).toBe(true);
    for (const line of ['thatcampus_database_pool_acquired 1', 'thatcampus_database_pool_waiting 2', 'thatcampus_database_pool_oldest_checkout_seconds 0.25',
      'thatcampus_database_pool_acquisitions_total 4', 'thatcampus_database_pool_releases_total 2', 'thatcampus_database_pool_removed_total 1',
      'thatcampus_database_pool_checkout_duration_seconds_bucket{le="0.005"} 1', 'thatcampus_database_pool_checkout_duration_seconds_bucket{le="0.1"} 2',
      'thatcampus_database_pool_checkout_duration_seconds_bucket{le="5"} 2', 'thatcampus_database_pool_checkout_duration_seconds_bucket{le="30"} 3',
      'thatcampus_database_pool_checkout_duration_seconds_bucket{le="+Inf"} 3', 'thatcampus_database_pool_checkout_duration_seconds_sum 7.055',
      'thatcampus_database_pool_checkout_duration_seconds_count 3', 'thatcampus_database_pool_checkout_duration_seconds_max 7']) expect(output.split('\n')).toContain(line);
    expect(output).toContain('# TYPE thatcampus_database_pool_checkout_duration_seconds histogram');
    expect(output).not.toMatch(/PRIVATE|private-secret|private-person|12345|tenant|account|processID|NaN/);
    expect(output.split('\n').filter(line => line && !line.startsWith('#')).every(line => /^thatcampus_database_pool_[a-z_]+(?:\{le="(?:[\d.]+|\+Inf)"\})? [\d.]+$/u.test(line))).toBe(true);
  });

  it('keeps actual monitoring authorization ahead of all metric reads and plaintext headers', async () => {
    const token = 'isolated-monitoring-token-not-a-real-secret';
    const config = vi.spyOn(configuration, 'config').mockReturnValue({ METRICS_TOKEN: token } as ReturnType<typeof configuration.config>);
    const f = fixture(), databaseMetrics = vi.fn(() => f.telemetry.prometheus()), eventMetrics = vi.fn(() => Promise.resolve('omnischool_event_broker_ready 1\n')), header = vi.fn();
    const controller = new AppController({ prometheusMetrics: databaseMetrics } as never, { prometheusMetrics: eventMetrics } as never);
    try {
      for (const authorization of [undefined, 'Bearer invalid', `Bearer ${'x'.repeat(token.length)}`]) {
        await expect(controller.metrics(authorization, { header } as never)).rejects.toBeInstanceOf(UnauthorizedException);
      }
      expect(header).not.toHaveBeenCalled(); expect(eventMetrics).not.toHaveBeenCalled(); expect(databaseMetrics).not.toHaveBeenCalled();
      const response = await controller.metrics(`Bearer ${token}`, { header } as never);
      expect(header).toHaveBeenCalledWith('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
      expect(eventMetrics).toHaveBeenCalledOnce(); expect(databaseMetrics).toHaveBeenCalledOnce();
      expect(response).toContain('omnischool_event_broker_ready 1\n'); expect(response).toContain('thatcampus_database_pool_acquired 0\n');
      expect(response).not.toContain(token);
    } finally { config.mockRestore(); }
  });
});
