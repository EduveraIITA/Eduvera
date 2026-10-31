import { ConflictException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { SimulationExecutionEnvironment } from "../campus-model-core/execution-environment.contracts.js";
import { executionEffectDigest } from "../campus-model-core/execution-effects.runtime.js";
import { EXECUTION_EFFECT_KINDS, type ExecutionEffectKind,
  type SimulationExecutionEffectReceipt, type SimulationExecutionEffectSink } from "../campus-model-core/execution-effects.contracts.js";
import type { SimulationArtifactPort, SimulationEffectReplayPort } from "../common/simulation-resources.js";

const MAX_ARTIFACT_BYTES = 25 * 1024 * 1024;
const MAX_RUN_ARTIFACT_BYTES = 100 * 1024 * 1024;
const MAX_EFFECT_BYTES = 16 * 1024;
const MAX_RUN_EFFECTS = 100_000;

function resourceLimit(message: string): never {
  throw new ConflictException({ code: "simulation_resource_budget_exceeded", message });
}

function assertKey(value: string): void {
  if (!/^[a-f0-9]{64}$/u.test(value)) throw new Error("Simulation artifact keys must be opaque digests.");
}

export async function initializeSimulationResources(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('simulation-resources-v1',0))");
    await client.query(`CREATE TABLE IF NOT EXISTS dt_simulation.effects (
      id uuid PRIMARY KEY,run_id uuid NOT NULL REFERENCES dt_simulation.worlds(run_id),school_id uuid NOT NULL,
      namespace_id text NOT NULL,kind text NOT NULL,schema_name text NOT NULL,idempotency_key text NOT NULL,
      payload_digest text NOT NULL,intent jsonb NOT NULL,receipt jsonb NOT NULL,recorded_at timestamptz NOT NULL,
      UNIQUE(run_id,kind,idempotency_key));
      CREATE INDEX IF NOT EXISTS simulation_effects_run_recorded ON dt_simulation.effects(run_id,recorded_at,id);
      CREATE TABLE IF NOT EXISTS dt_simulation.artifacts (
      run_id uuid NOT NULL REFERENCES dt_simulation.worlds(run_id),school_id uuid NOT NULL,namespace_id text NOT NULL,
      storage_key text NOT NULL,content bytea NOT NULL,size_bytes bigint NOT NULL CHECK(size_bytes>=0),
      content_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(run_id,storage_key));
      CREATE OR REPLACE FUNCTION dt_simulation.reject_effect_change() RETURNS trigger LANGUAGE plpgsql AS $body$
        BEGIN
          IF TG_OP='DELETE' AND EXISTS(SELECT 1 FROM dt_simulation.gc_receipts receipt
            WHERE receipt.run_id=OLD.run_id AND receipt.school_id=OLD.school_id
              AND receipt.gc_token::text=current_setting('thatcampus.simulation_gc_token',true)) THEN RETURN OLD; END IF;
          RAISE EXCEPTION 'Simulation effect receipts are append-only';
        END $body$;
      DO $install$ BEGIN
        IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='simulation_effect_immutable' AND tgrelid='dt_simulation.effects'::regclass) THEN
          CREATE TRIGGER simulation_effect_immutable BEFORE UPDATE OR DELETE ON dt_simulation.effects
            FOR EACH ROW EXECUTE FUNCTION dt_simulation.reject_effect_change();
        END IF;
        IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='simulation_effect_no_truncate' AND tgrelid='dt_simulation.effects'::regclass) THEN
          CREATE TRIGGER simulation_effect_no_truncate BEFORE TRUNCATE ON dt_simulation.effects
            FOR EACH STATEMENT EXECUTE FUNCTION dt_simulation.reject_gc_receipt_change();
        END IF;
      END $install$;
      REVOKE ALL ON dt_simulation.effects,dt_simulation.artifacts FROM PUBLIC;`);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export class SimulationResourceStore implements SimulationArtifactPort, SimulationEffectReplayPort {
  constructor(private readonly pool: Pool, readonly environment: SimulationExecutionEnvironment) {}

  private async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`simulation-resources:${this.environment.run_id}`]);
      const world = (await client.query(`SELECT 1 FROM dt_simulation.worlds
        WHERE run_id=$1 AND school_id=$2 AND namespace_id=$3 FOR KEY SHARE`,
      [this.environment.run_id, this.environment.institution_id, this.environment.namespace_id])).rowCount;
      if (world !== 1) throw new ConflictException("This Simulation's isolated resource store no longer exists.");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  sink(kind: ExecutionEffectKind): SimulationExecutionEffectSink {
    const environment = this.environment;
    const sinkId = `persistent:${environment.run_id}:${kind}`;
    return { mode: "sink_only", kind, sink_id: sinkId, namespace_id: environment.namespace_id,
      scenario_id: environment.scenario_id, run_id: environment.run_id,
      capture: async ({ environment: selected, intent }) => {
        if (selected.run_id !== environment.run_id || selected.institution_id !== environment.institution_id
          || selected.scenario_id !== environment.scenario_id || selected.namespace_id !== environment.namespace_id
          || intent.kind !== kind || intent.namespace_id !== selected.namespace_id || intent.institution_id !== selected.institution_id) {
          throw new ConflictException("The effect does not belong to this Simulation sink.");
        }
        const digest = executionEffectDigest(intent);
        if (Buffer.byteLength(JSON.stringify(intent)) > MAX_EFFECT_BYTES) resourceLimit("This simulated effect exceeds its safe payload budget.");
        return this.transaction(async (client) => {
          const prior = (await client.query<{ payload_digest: string; receipt: SimulationExecutionEffectReceipt }>(
            "SELECT payload_digest,receipt FROM dt_simulation.effects WHERE run_id=$1 AND kind=$2 AND idempotency_key=$3",
            [selected.run_id, kind, intent.idempotency_key])).rows[0];
          if (prior) {
            if (prior.payload_digest !== digest) throw new ConflictException("This Simulation effect key was already used for a different payload.");
            return { ...prior.receipt, status: "deduplicated" as const };
          }
          const count = Number((await client.query<{ count: string }>("SELECT count(*) FROM dt_simulation.effects WHERE run_id=$1", [selected.run_id])).rows[0]!.count);
          if (count >= MAX_RUN_EFFECTS) resourceLimit("This run reached its simulated-effect budget. Pause and review its resource policy.");
          const id = randomUUID();
          const receipt: SimulationExecutionEffectReceipt = { environment_kind: "simulation", effect_kind: kind,
            effect_id: intent.effect_id, idempotency_key: intent.idempotency_key, namespace_id: selected.namespace_id,
            scenario_id: selected.scenario_id, run_id: selected.run_id, sink_id: sinkId, sink_record_id: id,
            status: "captured", recorded_at: intent.requested_at };
          await client.query(`INSERT INTO dt_simulation.effects(id,run_id,school_id,namespace_id,kind,schema_name,
            idempotency_key,payload_digest,intent,receipt,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [id, selected.run_id, selected.institution_id, selected.namespace_id, kind, intent.schema_name,
            intent.idempotency_key, digest, JSON.stringify(intent), JSON.stringify(receipt), receipt.recorded_at]);
          return receipt;
        });
      } };
  }

  async lookupEffectTiming(kind: ExecutionEffectKind, idempotencyKey: string): Promise<{ requested_at: string } | null> {
    const row = (await this.pool.query<{ requested_at: string }>(`SELECT intent->>'requested_at' AS requested_at
      FROM dt_simulation.effects WHERE run_id=$1 AND school_id=$2 AND namespace_id=$3 AND kind=$4 AND idempotency_key=$5`,
    [this.environment.run_id, this.environment.institution_id, this.environment.namespace_id, kind, idempotencyKey])).rows[0];
    if (!row) return null;
    if (!Number.isFinite(Date.parse(row.requested_at))) {
      throw new ConflictException("This Simulation effect replay receipt is invalid.");
    }
    return { requested_at: row.requested_at };
  }

  async write(key: string, data: Buffer, exclusive: boolean): Promise<void> {
    assertKey(key);
    if (data.length > MAX_ARTIFACT_BYTES) resourceLimit("Simulation files are limited to 25 MB each.");
    await this.transaction(async (client) => {
      const prior = (await client.query<{ size_bytes: string }>("SELECT size_bytes FROM dt_simulation.artifacts WHERE run_id=$1 AND storage_key=$2", [this.environment.run_id, key])).rows[0];
      if (exclusive && prior) throw Object.assign(new Error("The isolated file already exists."), { code: "EEXIST" });
      const usage = Number((await client.query<{ bytes: string }>("SELECT COALESCE(sum(size_bytes),0) AS bytes FROM dt_simulation.artifacts WHERE run_id=$1", [this.environment.run_id])).rows[0]!.bytes);
      if (usage - Number(prior?.size_bytes ?? 0) + data.length > MAX_RUN_ARTIFACT_BYTES) resourceLimit("This run reached its 100 MB isolated-file budget.");
      await client.query(`INSERT INTO dt_simulation.artifacts(run_id,school_id,namespace_id,storage_key,content,size_bytes,content_hash)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(run_id,storage_key) DO UPDATE SET content=excluded.content,
        size_bytes=excluded.size_bytes,content_hash=excluded.content_hash`,
      [this.environment.run_id, this.environment.institution_id, this.environment.namespace_id, key, data, data.length,
        createHash("sha256").update(data).digest("hex")]);
    });
  }

  async read(key: string): Promise<Buffer | null> {
    assertKey(key);
    const row = (await this.pool.query<{ content: Buffer }>(`SELECT content FROM dt_simulation.artifacts
      WHERE run_id=$1 AND school_id=$2 AND namespace_id=$3 AND storage_key=$4`,
    [this.environment.run_id, this.environment.institution_id, this.environment.namespace_id, key])).rows[0];
    return row ? Buffer.from(row.content) : null;
  }

  async rename(from: string, to: string): Promise<void> {
    assertKey(from); assertKey(to);
    await this.transaction(async (client) => {
      const result = await client.query("UPDATE dt_simulation.artifacts SET storage_key=$3 WHERE run_id=$1 AND storage_key=$2", [this.environment.run_id, from, to]);
      if (result.rowCount !== 1) throw Object.assign(new Error("The isolated file does not exist."), { code: "ENOENT" });
    });
  }

  async remove(key: string): Promise<void> {
    assertKey(key);
    await this.transaction(async (client) => {
      await client.query("DELETE FROM dt_simulation.artifacts WHERE run_id=$1 AND storage_key=$2", [this.environment.run_id, key]);
    });
  }

  async list(page: number, pageSize: number) {
    const runId = this.environment.run_id;
    const [effectCounts, artifacts, results] = await Promise.all([
      this.pool.query<{ kind: ExecutionEffectKind; count: string }>("SELECT kind,count(*) FROM dt_simulation.effects WHERE run_id=$1 GROUP BY kind", [runId]),
      this.pool.query<{ count: string; bytes: string }>("SELECT count(*),COALESCE(sum(size_bytes),0) AS bytes FROM dt_simulation.artifacts WHERE run_id=$1", [runId]),
      this.pool.query(`SELECT id,kind,schema_name,'captured' AS status,recorded_at,intent->'logical_target' AS logical_target,payload_digest
        FROM dt_simulation.effects WHERE run_id=$1 ORDER BY recorded_at DESC,id DESC LIMIT $2 OFFSET $3`, [runId, pageSize, (page - 1) * pageSize]),
    ]);
    const counts = Object.fromEntries(EXECUTION_EFFECT_KINDS.map((kind) => [kind, Number(effectCounts.rows.find((row) => row.kind === kind)?.count ?? 0)]));
    return { schema_version: 1 as const, run_id: runId,
      counts: { effects: counts, artifacts: Number(artifacts.rows[0]!.count), artifact_bytes: Number(artifacts.rows[0]!.bytes) },
      effects: { page, page_size: pageSize, total: Object.values(counts).reduce((sum, count) => sum + count, 0), results: results.rows } };
  }
}
