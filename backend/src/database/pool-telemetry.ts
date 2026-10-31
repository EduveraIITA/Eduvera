import { performance } from "node:perf_hooks";
import type { Pool } from "pg";

type ObservedPool = Pick<Pool, "on" | "totalCount" | "idleCount" | "waitingCount">;

/** Numeric admission evidence only: no SQL, binds, client or account identifiers. */
export interface DatabasePoolSnapshot {
  readonly total: number;
  readonly idle: number;
  readonly waiting: number;
  readonly acquired_current: number;
  readonly oldest_checkout_ms: number;
  readonly acquisitions_total: number;
  readonly releases_total: number;
  readonly removed_total: number;
  readonly acquisition_failures_total: number;
  readonly hold_count: number;
  readonly hold_ms_sum: number;
  readonly hold_ms_max: number;
}

const holdBucketsMs = [5, 20, 100, 500, 1000, 5000, 30_000, 60_000, 300_000] as const;
const failureReportIntervalMs = 5000;
const acquisitionFailures = new WeakSet<object>();

/** Only an error observed at the owning acquisition boundary is classified. */
export function isDatabasePoolAcquisitionFailure(error: unknown): boolean {
  return error !== null && (typeof error === "object" || typeof error === "function") && acquisitionFailures.has(error);
}

/**
 * Public pg events own a lease only between acquire and release/remove. An idle
 * PostgreSQL backend may still hold such an application lease. The map contains
 * at most the pool's checked-out clients and does not retain released clients.
 * No timer, query, connection setting or admission policy is introduced here.
 */
export class DatabasePoolTelemetry {
  private readonly held = new Map<object, number>();
  private readonly now: () => number;
  private readonly holdBuckets = holdBucketsMs.map(() => 0);
  private acquisitions = 0;
  private releases = 0;
  private removed = 0;
  private acquisitionFailures = 0;
  private holdCount = 0;
  private holdMsSum = 0;
  private holdMsMax = 0;
  private lastFailureReportAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly pool: ObservedPool,
    private readonly options: {
      now?: () => number;
      onAcquisitionFailure?: (snapshot: DatabasePoolSnapshot) => void;
    } = {},
  ) {
    this.now = options.now ?? (() => performance.now());
    pool.on("acquire", client => {
      this.acquisitions++;
      this.held.set(client, this.now());
    });
    pool.on("release", (_error, client) => {
      this.releases++;
      this.endHold(client);
    });
    pool.on("remove", client => {
      this.removed++;
      this.endHold(client);
    });
  }

  /** Wrap only the caller's acquisition, never a SQL statement or transaction. */
  async observeAcquisition<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error !== null && (typeof error === "object" || typeof error === "function")) acquisitionFailures.add(error);
      this.acquisitionFailures++;
      const at = this.now();
      if (at - this.lastFailureReportAt >= failureReportIntervalMs) {
        this.lastFailureReportAt = at;
        // Diagnostics must never replace the original admission failure.
        try { this.options.onAcquisitionFailure?.(this.snapshot()); } catch { /* Best-effort telemetry. */ }
      }
      throw error;
    }
  }

  snapshot(): DatabasePoolSnapshot {
    const at = this.now();
    let oldestCheckoutMs = 0;
    for (const start of this.held.values()) oldestCheckoutMs = Math.max(oldestCheckoutMs, this.elapsed(start, at));
    return Object.freeze({
      total: this.pool.totalCount,
      idle: this.pool.idleCount,
      waiting: this.pool.waitingCount,
      acquired_current: this.held.size,
      oldest_checkout_ms: oldestCheckoutMs,
      acquisitions_total: this.acquisitions,
      releases_total: this.releases,
      removed_total: this.removed,
      acquisition_failures_total: this.acquisitionFailures,
      hold_count: this.holdCount,
      hold_ms_sum: this.holdMsSum,
      hold_ms_max: this.holdMsMax,
    });
  }

  prometheus(): string {
    const value = this.snapshot();
    const metric = (suffix: string, type: "gauge" | "counter", help: string, amount: number) => [
      `# HELP thatcampus_database_pool_${suffix} ${help}`,
      `# TYPE thatcampus_database_pool_${suffix} ${type}`,
      `thatcampus_database_pool_${suffix} ${amount}`,
    ];
    return [
      ...metric("total", "gauge", "Clients currently existing in the Live application pool.", value.total),
      ...metric("idle", "gauge", "Clients returned to the pool and available for checkout.", value.idle),
      ...metric("waiting", "gauge", "Requests currently waiting for an application pool client.", value.waiting),
      ...metric("acquired", "gauge", "Clients checked out and not yet released or removed.", value.acquired_current),
      ...metric("oldest_checkout_seconds", "gauge", "Age of the oldest current checkout including time between SQL statements.", value.oldest_checkout_ms / 1000),
      ...metric("acquisitions_total", "counter", "Completed application pool checkouts.", value.acquisitions_total),
      ...metric("releases_total", "counter", "Application pool client release events.", value.releases_total),
      ...metric("removed_total", "counter", "Application pool client removal events.", value.removed_total),
      ...metric("acquisition_failures_total", "counter", "Failed Kysely application pool acquisitions before a SQL statement executes.", value.acquisition_failures_total),
      "# HELP thatcampus_database_pool_checkout_duration_seconds Completed checkout duration including transaction callback time.",
      "# TYPE thatcampus_database_pool_checkout_duration_seconds histogram",
      ...holdBucketsMs.map((limit, index) => `thatcampus_database_pool_checkout_duration_seconds_bucket{le="${limit / 1000}"} ${this.holdBuckets[index]}`),
      `thatcampus_database_pool_checkout_duration_seconds_bucket{le="+Inf"} ${value.hold_count}`,
      `thatcampus_database_pool_checkout_duration_seconds_sum ${value.hold_ms_sum / 1000}`,
      `thatcampus_database_pool_checkout_duration_seconds_count ${value.hold_count}`,
      ...metric("checkout_duration_seconds_max", "gauge", "Longest completed application pool checkout since process start.", value.hold_ms_max / 1000),
      "",
    ].join("\n");
  }

  private elapsed(start: number, at: number): number {
    const duration = at - start;
    return Number.isFinite(duration) ? Math.max(0, duration) : 0;
  }

  private endHold(client: object): void {
    const start = this.held.get(client);
    if (start === undefined) return;
    this.held.delete(client);
    const duration = this.elapsed(start, this.now());
    this.holdCount++;
    this.holdMsSum += duration;
    this.holdMsMax = Math.max(this.holdMsMax, duration);
    for (let index = 0; index < holdBucketsMs.length; index++) {
      if (duration <= holdBucketsMs[index]!) this.holdBuckets[index]!++;
    }
  }
}
