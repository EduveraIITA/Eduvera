import { ConflictException } from "@nestjs/common";
import type { Pool } from "pg";
import type { GarbageCollectSimulationWorldInput, GarbageCollectSimulationWorldResult, MeasureSimulationWorldResult } from "../simulation/simulation-world.port.js";
import type { PersistedSimulationRun } from "../simulation/simulation.contracts.js";
import { simulationBranchSchema } from "./simulation-branch.driver.js";
import { quoteSimulationIdentifier as identifier } from "./simulation-sql.js";
import { initializeSimulationResources } from "./simulation-resources.store.js";

/** Target-database accounting. Shared immutable data is charged conservatively. */
export async function measureSimulationWorld(pool: Pick<Pool, 'query'>, run: PersistedSimulationRun): Promise<MeasureSimulationWorldResult> {
  const result = await pool.query<{ exclusive_bytes: string; shared_bytes: string }>(`SELECT
    COALESCE((SELECT sum(pg_total_relation_size(c.oid)) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=w.schema_name AND c.relkind IN ('r','m')),0)
      + COALESCE((SELECT sum(size_bytes) FROM dt_simulation.artifacts WHERE run_id=w.run_id),0)
      + COALESCE((SELECT sum(pg_column_size(e)) FROM dt_simulation.effects e WHERE run_id=w.run_id),0)
      + COALESCE((SELECT sum(pg_column_size(c)) FROM dt_simulation.checkpoints c WHERE run_id=w.run_id),0) AS exclusive_bytes,
    COALESCE((SELECT sum(pg_column_size(t)) FROM dt_simulation.snapshot_tables t WHERE snapshot_id=w.snapshot_id),0)
      + COALESCE((SELECT sum(pg_total_relation_size(c.oid)) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='dt_snapshot_'||replace(w.snapshot_id::text,'-','') AND c.relkind IN ('r','m')),0) AS shared_bytes
    FROM dt_simulation.worlds w WHERE w.run_id=$1 AND w.school_id=$2 AND w.namespace_id=$3`,
  [run.id, run.school_id, run.namespace_id]);
  const row = result.rows[0];
  if (!row) throw new ConflictException("The retained Simulation world is unavailable for accounting.");
  return { exclusive_bytes: Number(row.exclusive_bytes), shared_snapshot_bytes: Number(row.shared_bytes), measured_at: new Date().toISOString() };
}

/**
 * Caller must hold the durable control-plane GC lease and run advance lock.
 * Everything below addresses only validated dt_* schemas in the separate store.
 * Deletion and its durable receipt commit together, so retries are idempotent.
 */
export async function garbageCollectSimulationWorld(pool: Pool, input: GarbageCollectSimulationWorldInput): Promise<GarbageCollectSimulationWorldResult> {
  const { run } = input;
  const assertLeaseCurrent = () => {
    if (!run.gc_lease_until || !Number.isFinite(Date.parse(run.gc_lease_until)) || Date.parse(run.gc_lease_until) <= Date.now()) {
      throw new ConflictException("The Simulation cleanup lease expired; a fresh fenced claim must retry.");
    }
  };
  assertLeaseCurrent();
  if (!["completed", "stopped", "failed"].includes(run.status) || run.gc_state !== "deleting"
    || run.gc_lease_token !== input.gc_token || Number(run.gc_lease_fence) !== input.gc_fence
    || run.pinned_at || !run.retention_expires_at || Date.parse(run.retention_expires_at) > Date.parse(input.requested_at)) {
    throw new ConflictException("Simulation cleanup requires a current fenced lease for an expired, unpinned terminal run.");
  }
  // Preparation can fail before World.register has created resource relations.
  // Initialize the reviewed empty store before accounting/deletion, including
  // the no-capture path. Never assume a successful world was once opened.
  await initializeSimulationResources(pool);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    assertLeaseCurrent();
    const prior = (await client.query<{ result: GarbageCollectSimulationWorldResult }>(
      "SELECT result FROM dt_simulation.gc_receipts WHERE run_id=$1 AND school_id=$2", [run.id, run.school_id])).rows[0];
    if (prior) { await client.query("COMMIT"); return prior.result; }
    const world = (await client.query<{ snapshot_id: string; schema_name: string; template_schema: string }>(`SELECT w.snapshot_id,w.schema_name,s.template_schema
      FROM dt_simulation.worlds w JOIN dt_simulation.snapshots s ON s.id=w.snapshot_id
      WHERE w.run_id=$1 AND w.school_id=$2 AND w.namespace_id=$3`, [run.id, run.school_id, run.namespace_id])).rows[0];
    if (world && (world.schema_name !== simulationBranchSchema(run.id)
      || !/^dt_template_[a-f0-9]{16}$/u.test(world.template_schema))) throw new ConflictException("Cleanup could not verify the isolated world's ownership.");
    if (!world && (run.status !== 'failed' || run.world_ref || run.source_snapshot_ref)) {
      throw new ConflictException("A previously prepared Simulation world is unexpectedly missing; cleanup requires reconciliation.");
    }
    // A failed preparation can stop before it has a world. Its immutable
    // capture lineage identifies only its own partial snapshot, never an age-
    // based or tenant-wide guess at orphaned data.
    const capture = world ?? (await client.query<{ snapshot_id: string; template_schema: string }>(
      "SELECT id AS snapshot_id,template_schema FROM dt_simulation.snapshots WHERE school_id=$1 AND origin_run_id=$2", [run.school_id, run.id])).rows[0];
    if (capture && !/^dt_template_[a-f0-9]{16}$/u.test(capture.template_schema)) throw new ConflictException("The failed capture's template identity is invalid.");
    if (capture) {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`snapshot-retention:${capture.snapshot_id}`]);
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [capture.template_schema]);
    }
    // The ordinary request order is COW -> resources -> world key-share.
    // Taking these in the same order avoids DDL / artifact-writer deadlocks.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`cow:${run.id}`]);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`simulation-resources:${run.id}`]);
    if (world) {
      const retainedWorld = (await client.query("SELECT 1 FROM dt_simulation.worlds WHERE run_id=$1 AND school_id=$2 AND snapshot_id=$3 FOR UPDATE", [run.id, run.school_id, world.snapshot_id])).rowCount;
      if (!retainedWorld) throw new ConflictException("The isolated world changed while cleanup was waiting for its locks.");
    }
    const measured = world ? await measureSimulationWorld(client, run) : { exclusive_bytes: 0, shared_snapshot_bytes: capture
      ? Number((await client.query<{ bytes: string }>("SELECT COALESCE(sum(pg_column_size(t)),0) AS bytes FROM dt_simulation.snapshot_tables t WHERE snapshot_id=$1", [capture.snapshot_id])).rows[0]!.bytes) : 0 };
    const retained = capture ? Boolean((await client.query("SELECT 1 FROM dt_simulation.worlds WHERE snapshot_id=$1 AND run_id<>$2 LIMIT 1", [capture.snapshot_id, run.id])).rowCount) : false;
    const result: GarbageCollectSimulationWorldResult = { released_bytes: measured.exclusive_bytes + (retained ? 0 : measured.shared_snapshot_bytes),
      retained_shared_snapshot: retained, receipt_ref: `simulation-gc:${run.id}:${input.gc_fence}` };
    await client.query(`INSERT INTO dt_simulation.gc_receipts(run_id,school_id,snapshot_id,gc_token,gc_fence,result)
      VALUES($1,$2,$3,$4,$5,$6)`, [run.id, run.school_id, capture?.snapshot_id ?? null, input.gc_token, input.gc_fence, JSON.stringify(result)]);
    await client.query("SELECT set_config('thatcampus.simulation_gc_token',$1,true)", [input.gc_token]);
    if (world) await client.query(`DROP SCHEMA ${identifier(world.schema_name)} CASCADE`);
    for (const table of ["artifacts", "effects", "checkpoints", "materialized_tables"]) {
      await client.query(`DELETE FROM dt_simulation.${identifier(table)} WHERE run_id=$1`, [run.id]);
    }
    await client.query("DELETE FROM dt_simulation.worlds WHERE run_id=$1", [run.id]);
    if (capture && !retained) {
      await client.query(`DROP SCHEMA IF EXISTS ${identifier(`dt_snapshot_${capture.snapshot_id.replaceAll("-", "")}`)} CASCADE`);
      await client.query("DELETE FROM dt_simulation.snapshot_tables WHERE snapshot_id=$1", [capture.snapshot_id]);
      await client.query("DELETE FROM dt_simulation.snapshots WHERE id=$1", [capture.snapshot_id]);
      const used = (await client.query("SELECT 1 FROM dt_simulation.snapshots WHERE template_schema=$1 LIMIT 1", [capture.template_schema])).rowCount;
      if (!used) await client.query(`DROP SCHEMA ${identifier(capture.template_schema)} CASCADE`);
    }
    assertLeaseCurrent();
    await client.query("COMMIT");
    return result;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
