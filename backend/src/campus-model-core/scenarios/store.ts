import type { ScenarioRunResult, ScenarioRunStore } from "./contracts.js";

export interface InMemoryScenarioRunStoreOptions {
  now: () => Date;
  max_total_runs: number;
  max_runs_per_institution: number;
  max_result_bytes: number;
  max_ttl_ms?: number;
}

interface StoredRun {
  result: ScenarioRunResult;
  inserted_at: number;
  expires_at: number;
}

export class ScenarioRunStoreCapacityError extends Error {
  readonly code = "scenario_run_store_capacity";

  constructor(message: string) {
    super(message);
    this.name = "ScenarioRunStoreCapacityError";
  }
}

export class ScenarioRunStoreConflictError extends Error {
  readonly code = "scenario_run_store_conflict";

  constructor() {
    super("A different scenario result already uses this institution and run ID.");
    this.name = "ScenarioRunStoreConflictError";
  }
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
}

/**
 * Process-local, TTL-bound scenario storage. It deliberately has no database or
 * connector dependency and returns defensive copies so scenario state cannot leak
 * into or alias an operational object graph.
 */
export class InMemoryScenarioRunStore implements ScenarioRunStore {
  static readonly DEFAULT_MAX_TTL_MS = 24 * 60 * 60 * 1_000;
  private readonly entries = new Map<string, StoredRun>();
  private readonly options: InMemoryScenarioRunStoreOptions;

  constructor(options: InMemoryScenarioRunStoreOptions) {
    assertPositiveInteger(options.max_total_runs, "max_total_runs");
    assertPositiveInteger(options.max_runs_per_institution, "max_runs_per_institution");
    assertPositiveInteger(options.max_result_bytes, "max_result_bytes");
    if (options.max_ttl_ms !== undefined) assertPositiveInteger(options.max_ttl_ms, "max_ttl_ms");
    this.options = options;
  }

  private key(institutionId: string, runId: string): string {
    return `${institutionId}\u0000${runId}`;
  }

  private now(): number {
    const value = this.options.now().getTime();
    if (!Number.isFinite(value)) throw new Error("Scenario store clock returned an invalid date.");
    return value;
  }

  save(result: ScenarioRunResult): void {
    const now = this.now();
    this.sweepExpiredAt(now);
    const expiresAt = Date.parse(result.expires_at);
    if (!Number.isFinite(expiresAt) || expiresAt <= now) {
      throw new Error("Scenario run expiry must be in the future when it is stored.");
    }
    const maxTtl = this.options.max_ttl_ms ?? InMemoryScenarioRunStore.DEFAULT_MAX_TTL_MS;
    if (expiresAt - now > maxTtl) {
      throw new Error(`Scenario run expiry exceeds the transient store TTL limit of ${maxTtl} ms.`);
    }
    const bytes = Buffer.byteLength(JSON.stringify(result), "utf8");
    if (bytes > this.options.max_result_bytes) {
      throw new ScenarioRunStoreCapacityError(
        `Scenario result uses ${bytes} bytes; the transient store limit is ${this.options.max_result_bytes}.`,
      );
    }
    const key = this.key(result.institution_id, result.run_id);
    const replacing = this.entries.has(key);
    const existing = this.entries.get(key);
    if (existing) {
      if (JSON.stringify(existing.result) !== JSON.stringify(result)) {
        throw new ScenarioRunStoreConflictError();
      }
      return;
    }
    if (!replacing && this.entries.size >= this.options.max_total_runs) {
      throw new ScenarioRunStoreCapacityError("Transient scenario store total-run quota reached.");
    }
    if (!replacing) {
      const institutionCount = [...this.entries.values()]
        .filter((entry) => entry.result.institution_id === result.institution_id)
        .length;
      if (institutionCount >= this.options.max_runs_per_institution) {
        throw new ScenarioRunStoreCapacityError("Transient scenario store institution-run quota reached.");
      }
    }
    this.entries.set(key, {
      result: structuredClone(result),
      inserted_at: now,
      expires_at: expiresAt,
    });
  }

  get(institutionId: string, runId: string): ScenarioRunResult | null {
    const now = this.now();
    const key = this.key(institutionId, runId);
    const stored = this.entries.get(key);
    if (!stored) return null;
    if (stored.expires_at <= now) {
      this.entries.delete(key);
      return null;
    }
    return structuredClone(stored.result);
  }

  delete(institutionId: string, runId: string): boolean {
    return this.entries.delete(this.key(institutionId, runId));
  }

  sweepExpired(): number {
    return this.sweepExpiredAt(this.now());
  }

  size(): number {
    this.sweepExpired();
    return this.entries.size;
  }

  private sweepExpiredAt(now: number): number {
    let removed = 0;
    for (const [key, stored] of this.entries) {
      if (stored.expires_at <= now) {
        this.entries.delete(key);
        removed += 1;
      }
    }
    return removed;
  }
}
