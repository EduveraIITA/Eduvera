import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { sql } from 'kysely';
import { Pool, type PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import * as configuration from '../src/config.js';
import { DatabaseService } from '../src/database/database.service.js';
import { DatabasePoolTelemetry, isDatabasePoolAcquisitionFailure, type DatabasePoolSnapshot } from '../src/database/pool-telemetry.js';
import { requireIsolatedTestDatabaseUrl } from './test-database.js';

const enabled = process.env.TEST_DATABASE_ISOLATED === 'true';
const url = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : 'postgresql://invalid.invalid/pool_telemetry_unused_test';

function deferred() {
  let resolve!: () => void, reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe.skipIf(!enabled)('Database pool telemetry with real PostgreSQL admission', () => {
  it('observes four held clients and a genuine queued timeout, then preserves explicit recovery and original Promise/callback semantics', async () => {
    const pool = new Pool({ connectionString: url, max: 4, connectionTimeoutMillis: 300, idleTimeoutMillis: 10_000,
      application_name: 'thatcampus_pool_telemetry_ci' });
    const held = new Map<PoolClient, () => void>(), reported: DatabasePoolSnapshot[] = [];
    const release = (client: PoolClient) => { const callback = held.get(client); held.delete(client); callback?.(); };
    try {
      const identity = (await pool.query<{ name: string; version: number }>('SELECT current_database() AS name,current_setting(\'server_version_num\')::int AS version')).rows[0]!;
      expect(identity.name).toBe(decodeURIComponent(new URL(url).pathname.slice(1)));
      expect(identity.version).toBeGreaterThanOrEqual(170000); expect(identity.version).toBeLessThan(180000);
      const originalConnect: unknown = Reflect.get(pool, 'connect'), telemetry = new DatabasePoolTelemetry(pool, { onAcquisitionFailure: snapshot => reported.push(snapshot) });
      expect(Reflect.get(pool, 'connect')).toBe(originalConnect); expect(pool.options.max).toBe(4);
      const promiseClient = await telemetry.observeAcquisition(() => pool.connect()); held.set(promiseClient, () => promiseClient.release());
      expect((await promiseClient.query<{ value: number }>('SELECT 1::int AS value')).rows).toEqual([{ value: 1 }]); release(promiseClient);
      const callbackClient = await new Promise<PoolClient>((resolve, reject) => {
        pool.connect((error, client, done) => {
          if (error || !client) { reject(error ?? new Error('PostgreSQL did not return the callback client')); return; }
          held.set(client, done); resolve(client);
        });
      });
      expect((await callbackClient.query<{ value: number }>('SELECT 2::int AS value')).rows).toEqual([{ value: 2 }]); release(callbackClient);
      const baseline = telemetry.snapshot();
      expect(baseline).toMatchObject({ acquired_current: 0, acquisitions_total: 2, releases_total: 2, hold_count: 2, acquisition_failures_total: 0 });
      for (let index = 0; index < 4; index++) {
        const client = await telemetry.observeAcquisition(() => pool.connect()); held.set(client, () => client.release());
        expect((await client.query<{ value: number }>('SELECT 1::int AS value')).rows[0]?.value).toBe(1);
      }
      expect(telemetry.snapshot()).toMatchObject({ total: 4, idle: 0, waiting: 0, acquired_current: 4, acquisitions_total: 6, releases_total: 2 });
      let originalFailure: unknown;
      const failedCheckout = telemetry.observeAcquisition(() => pool.connect().catch((error: unknown) => { originalFailure = error; throw error; }));
      expect(telemetry.snapshot().waiting).toBe(1);
      const caught = await failedCheckout.then(client => { client.release(); throw new Error('A fifth held-client checkout unexpectedly succeeded'); }, (error: unknown) => error);
      expect(caught).toBe(originalFailure); expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toBe('timeout exceeded when trying to connect');
      expect(isDatabasePoolAcquisitionFailure(caught)).toBe(true);
      expect(isDatabasePoolAcquisitionFailure(new Error((caught as Error).message))).toBe(false);
      expect(reported).toHaveLength(1);
      expect(reported[0]).toMatchObject({ total: 4, idle: 0, waiting: 0, acquired_current: 4, acquisition_failures_total: 1 });
      expect(reported[0]?.oldest_checkout_ms).toBeGreaterThan(0);
      for (const client of [...held.keys()]) release(client);
      expect(telemetry.snapshot()).toMatchObject({ total: 4, idle: 4, waiting: 0, acquired_current: 0, hold_count: 6, acquisition_failures_total: 1 });
      const recovered = await telemetry.observeAcquisition(() => pool.connect()); held.set(recovered, () => recovered.release());
      expect((await recovered.query<{ value: number }>('SELECT 3::int AS value')).rows).toEqual([{ value: 3 }]); release(recovered);
      const final = telemetry.snapshot();
      expect(final).toMatchObject({ acquired_current: 0, idle: 4, waiting: 0, acquisitions_total: 7, releases_total: 7, hold_count: 7, acquisition_failures_total: 1 });
      expect(final.hold_ms_sum).toBeGreaterThan(0); expect(final.hold_ms_max).toBeGreaterThan(0); expect(final.oldest_checkout_ms).toBe(0);
      expect(Reflect.get(pool, 'connect')).toBe(originalConnect); expect(pool.options.max).toBe(4);
      expect(Object.values(final).every(Number.isFinite)).toBe(true); expect(JSON.stringify(final)).not.toMatch(/SELECT|processID|account|postgresql/);
    } finally {
      try { for (const client of [...held.keys()]) release(client); }
      finally { await pool.end(); }
    }
  }, 10_000);

  it('wires real DatabaseService transactions through observed admission and releases them for explicit SQL recovery', async () => {
    const config = vi.spyOn(configuration, 'config').mockReturnValue({ DATABASE_URL: url, DATABASE_POOL_MAX: 4,
      DEPLOYMENT_ENVIRONMENT: 'test', DATABASE_QUERY_TIMEOUT_MS: 10_000, DATABASE_IDLE_TRANSACTION_TIMEOUT_MS: 20_000,
    } as ReturnType<typeof configuration.config>);
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const releases: ReturnType<typeof deferred>[] = [], transactions: Promise<number>[] = [];
    let database: DatabaseService | undefined;
    try {
      const db = new DatabaseService(); database = db;
      await db.onModuleInit();
      for (let index = 0; index < 4; index++) {
        const entered = deferred(), release = deferred(); releases.push(release);
        const transaction = db.transaction().execute(async tx => {
          const result = await sql<{ value: number }>`SELECT ${index}::int AS value`.execute(tx);
          expect(result.rows).toEqual([{ value: index }]); entered.resolve();
          await release.promise;
          return index;
        });
        transactions.push(transaction);
        void transaction.catch(entered.reject);
        await entered.promise;
      }
      expect(db.poolSnapshot()).toMatchObject({ total: 4, idle: 0, waiting: 0, acquired_current: 4,
        acquisitions_total: 5, releases_total: 1, acquisition_failures_total: 0 });
      const failedQuery = sql<{ value: number }>`SELECT 5::int AS value`.execute(db).then(
        () => { throw new Error('A fifth transaction-bound query unexpectedly acquired a client'); },
        (error: unknown) => error,
      );
      await vi.waitFor(() => expect(db.poolSnapshot().waiting).toBe(1), { interval: 10, timeout: 1_000 });
      const failure: unknown = await failedQuery;
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toBe('timeout exceeded when trying to connect');
      expect(isDatabasePoolAcquisitionFailure(failure)).toBe(true);
      expect(isDatabasePoolAcquisitionFailure(new Error((failure as Error).message))).toBe(false);
      expect(warn).toHaveBeenCalledOnce();
      const report: unknown = warn.mock.calls[0]?.[0];
      expect(report).toMatchObject({ event: 'database_pool_acquisition_failed', total: 4, idle: 0, waiting: 0,
        acquired_current: 4, acquisition_failures_total: 1 });
      expect(Object.entries(report as Record<string, unknown>).every(([key, value]) => key === 'event' || typeof value === 'number' && Number.isFinite(value))).toBe(true);
      expect(JSON.stringify(report)).not.toMatch(/SELECT|processID|account|postgresql|timeout exceeded/);
      expect(db.poolSnapshot()).toMatchObject({ acquired_current: 4, idle: 0, waiting: 0, acquisition_failures_total: 1 });
      for (const release of releases) release.resolve();
      expect(await Promise.all(transactions)).toEqual([0, 1, 2, 3]);
      expect(db.poolSnapshot()).toMatchObject({ acquired_current: 0, idle: 4, releases_total: 5, hold_count: 5 });
      expect((await sql<{ value: number }>`SELECT 6::int AS value`.execute(db)).rows).toEqual([{ value: 6 }]);
      expect(db.poolSnapshot()).toMatchObject({ acquired_current: 0, idle: 4, acquisitions_total: 6, releases_total: 6,
        hold_count: 6, acquisition_failures_total: 1 });
      expect(db.prometheusMetrics()).toContain('thatcampus_database_pool_acquisition_failures_total 1\n');
    } finally {
      for (const release of releases) release.resolve();
      try { await Promise.allSettled(transactions); await database?.destroy(); }
      finally { warn.mockRestore(); config.mockRestore(); }
    }
  }, 15_000);
});
