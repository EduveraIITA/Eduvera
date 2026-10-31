import { createHash } from "node:crypto";
import { ConflictException } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import type { CompiledQuery, DatabaseConnection, Driver, QueryResult, TransactionSettings } from "kysely";
import { executionEnvironmentStorage } from "../campus-model-core/execution-time.runtime.js";
import { bindSimulationSql, quoteSimulationIdentifier as identifier, writtenSimulationTables } from "./simulation-sql.js";
import type { StoredSimulationSnapshot } from "./simulation-snapshot-store.js";

export interface SimulationBranch {
  run_id: string;
  school_id: string;
  scenario_id: string;
  namespace_id: string;
  schema_name: string;
  snapshot_id: string;
  virtual_now: string;
  time_zone: string;
  revision: number;
}

export function simulationBranchSchema(runId: string): string {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(runId)) throw new Error("Invalid Simulation run identity.");
  return `dt_run_${runId.replaceAll("-", "")}`;
}

function deterministicId(value: string): string {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}

function orderedViews(snapshot: StoredSimulationSnapshot): StoredSimulationSnapshot["catalogue"]["views"] {
  const views = snapshot.catalogue.views ?? [];
  const ordered: typeof views = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (view: (typeof views)[number]) => {
    if (visited.has(view.name)) return;
    if (visiting.has(view.name)) throw new Error("A captured Simulation view has a cyclic dependency.");
    visiting.add(view.name);
    for (const dependency of views) {
      if (dependency.name !== view.name && new RegExp(`\\b${dependency.name}\\b`, "u").test(view.definition)) visit(dependency);
    }
    visiting.delete(view.name);
    visited.add(view.name);
    ordered.push(view);
  };
  for (const view of views) visit(view);
  return ordered;
}

/** Large immutable source relations share indexed read storage across forks. */
async function indexedSnapshotRelation(client: PoolClient, snapshot: StoredSimulationSnapshot, tableName: string): Promise<string | null> {
  if ((snapshot.counts[tableName] ?? 0) < 500) return null;
  const snapshotSchema = identifier(`dt_snapshot_${snapshot.id.replaceAll("-", "")}`);
  const table = identifier(tableName);
  const qualified = `${snapshotSchema}.${table}`;
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`snapshot-index:${snapshot.id}`]);
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${snapshotSchema}`);
  const existing = (await client.query("SELECT to_regclass($1) AS relation", [qualified])).rows[0]?.relation;
  if (!existing) {
    await client.query(`CREATE TABLE ${qualified} (LIKE ${identifier(snapshot.template_schema)}.${table} INCLUDING ALL)`);
    await client.query(`INSERT INTO ${qualified} OVERRIDING SYSTEM VALUE
      SELECT (jsonb_populate_record(NULL::${identifier(snapshot.template_schema)}.${table},value)).*
      FROM dt_simulation.snapshot_tables capture,LATERAL jsonb_array_elements(capture.rows) value
      WHERE capture.snapshot_id=$1 AND capture.table_name=$2`, [snapshot.id, tableName]);
    await client.query(`CREATE TRIGGER immutable_snapshot_rows BEFORE INSERT OR UPDATE OR DELETE ON ${qualified}
      FOR EACH ROW EXECUTE FUNCTION dt_simulation.reject_snapshot_change()`);
    await client.query(`CREATE TRIGGER immutable_snapshot_truncate BEFORE TRUNCATE ON ${qualified}
      FOR EACH STATEMENT EXECUTE FUNCTION dt_simulation.reject_snapshot_change()`);
    await client.query(`ANALYZE ${qualified}`);
    await client.query(`REVOKE ALL ON SCHEMA ${snapshotSchema} FROM PUBLIC`);
    await client.query(`REVOKE ALL ON ${qualified} FROM PUBLIC`);
  }
  return qualified;
}

export function simulationFunctionDefinition(source: string, branch: SimulationBranch, extensionObjects: readonly string[] = []): string {
  const schema = identifier(branch.schema_name);
  const sourceFunction = /^CREATE(?:\s+OR\s+REPLACE)?\s+FUNCTION\s+(?:public\.)?("?[a-z_][a-z_0-9]*"?)\s*\(/iu.exec(source.trim())?.[1]?.replaceAll('"', "");
  const namespaceProjectors = new Set([
    "ensure_live_responsibility_scope",
    "reconcile_campus_responsibility_binding_source",
    "reconcile_campus_responsibility_substitution",
  ]);
  const liveNamespaceLookup = /\bnamespace\.environment_kind\s*=\s*'live'(?:::text)?/giu;
  const lookups = [...source.matchAll(liveNamespaceLookup)];
  if (sourceFunction && namespaceProjectors.has(sourceFunction)) {
    if (lookups.length !== 1) {
      throw new Error(`Simulation cannot bind the unreviewed namespace lookup in ${sourceFunction}.`);
    }
    // These owning Core projectors still check realm/status, source assignment,
    // person, capability, dates and scope. Only their namespace selector binds
    // to the server-owned branch, just as their stores and clock already do.
    source = source.replace(liveNamespaceLookup, "namespace.namespace_id=current_setting('thatcampus.namespace_id')");
  } else if (lookups.length) {
    throw new Error("Simulation cannot copy an unreviewed Live namespace lookup.");
  }
  return source.replace(/\bpublic\.("?[a-z_][a-z_0-9]*"?)/gu, (match, symbol: string) => extensionObjects.includes(symbol.replaceAll('"', "")) ? match : `${schema}.${symbol}`)
    .replace(/SET search_path (?:TO|=) (?:'public'|public)/giu, `SET search_path TO ${schema}, public`)
    .replace(/'live:'\s*\|\|\s*[a-z_][a-z_0-9.]*\s*::\s*text/giu, "current_setting('thatcampus.namespace_id')")
    .replace(/\bCURRENT_TIMESTAMP(?:\(\d+\))?/giu, `${schema}.simulation_now()`)
    .replace(/\bCURRENT_DATE\b/giu, `${schema}.simulation_now()::date`)
    .replace(/(?<![a-z_0-9.])(?:pg_catalog\.)?(?:now|transaction_timestamp|statement_timestamp|clock_timestamp)\s*\(\s*\)/giu, `${schema}.simulation_now()`);
}

export async function createSimulationBranch(pool: Pool, snapshot: StoredSimulationSnapshot, address: {
  run_id: string; school_id: string; scenario_id: string; namespace_id: string;
}): Promise<SimulationBranch> {
  const client = await pool.connect();
  const schemaName = simulationBranchSchema(address.run_id);
  const schema = identifier(schemaName);
  const template = identifier(snapshot.template_schema);
  const branch: SimulationBranch = { ...address, schema_name: schemaName, snapshot_id: snapshot.id,
    virtual_now: snapshot.captured_at, time_zone: snapshot.time_zone, revision: 1 };
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`snapshot-retention:${snapshot.id}`]);
    const retainedSnapshot = (await client.query("SELECT 1 FROM dt_simulation.snapshots WHERE id=$1 FOR KEY SHARE", [snapshot.id])).rowCount;
    if (!retainedSnapshot) throw new Error("The source Simulation snapshot has reached its retention boundary.");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [schemaName]);
    const exists = (await client.query<SimulationBranch>("SELECT * FROM dt_simulation.worlds WHERE run_id=$1", [address.run_id])).rows[0];
    if (exists) {
      if (exists.school_id !== address.school_id || exists.scenario_id !== address.scenario_id
        || exists.namespace_id !== address.namespace_id || exists.snapshot_id !== snapshot.id) {
        throw new Error("The Simulation world identity conflicts with a retained branch.");
      }
      await client.query("COMMIT"); return exists;
    }
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`CREATE FUNCTION ${schema}.simulation_now() RETURNS timestamptz LANGUAGE sql STABLE AS $clock$
      SELECT current_setting('thatcampus.virtual_now')::timestamptz $clock$`);
    await client.query(`SELECT set_config('search_path',$1,true),set_config('thatcampus.virtual_now',$2,true),
      set_config('thatcampus.namespace_id',$3,true)`, [`${schemaName}, public`, snapshot.captured_at, address.namespace_id]);
    const realmRows = (await client.query<{ rows: Array<{ id: string }> }>("SELECT rows FROM dt_simulation.snapshot_tables WHERE snapshot_id=$1 AND table_name='operational_realms'", [snapshot.id])).rows[0]?.rows ?? [];
    const realmId = realmRows[0]?.id;
    const snapshotId = deterministicId(`${address.run_id}:execution-snapshot`);
    for (const table of snapshot.catalogue.tables) {
      const tableName = identifier(table.name);
      let rowExpression = "row";
      if (table.columns.includes("environment_namespace_id")) rowExpression = `(CASE WHEN row->>'environment_namespace_id'='live:${address.school_id}' THEN row||jsonb_build_object('environment_namespace_id','${address.namespace_id}') ELSE row END)`;
      let source = `SELECT ${rowExpression} AS value FROM dt_simulation.snapshot_tables capture,
        LATERAL jsonb_array_elements(capture.rows) row WHERE capture.snapshot_id='${snapshot.id}'::uuid AND capture.table_name='${table.name}'`;
      // Current identity, frozen authority and source lineage are different
      // contracts. Historical Live actor bindings are never reused as actors.
      if (table.name === "campus_model_execution_actor_bindings") source = `SELECT ${rowExpression}||jsonb_build_object(
        'execution_actor_id',md5('${address.run_id}:history:'||(row->>'execution_actor_id'))::uuid,
        'actor_mode','simulation_counterpart','snapshot_id',COALESCE(row->>'snapshot_id','${snapshotId}'),
        'binding_key','history:'||(row->>'id')) AS value FROM dt_simulation.snapshot_tables capture,
        LATERAL jsonb_array_elements(capture.rows) row WHERE capture.snapshot_id='${snapshot.id}'::uuid
          AND capture.table_name='campus_model_execution_actor_bindings'
        UNION ALL SELECT jsonb_build_object(
        'id',md5('${address.run_id}:binding:'||(row->>'id'))::uuid,
        'school_id','${address.school_id}','realm_id','${realmId}','environment_namespace_id','${address.namespace_id}',
        'source_agent_id',row->>'id','execution_actor_id',md5('${address.run_id}:counterpart:'||(row->>'id'))::uuid,
        'actor_mode','simulation_counterpart','binding_key','counterpart:'||(row->>'id'),
        'snapshot_id','${snapshotId}','behaviour_policy_version_ref',NULL,'authority_snapshot_ref','sha256:${snapshot.content_hash}',
        'status','active','effective_from','${snapshot.captured_at}','effective_until',NULL,'created_at','${snapshot.captured_at}') AS value
        FROM dt_simulation.snapshot_tables capture,LATERAL jsonb_array_elements(capture.rows) row
        WHERE capture.snapshot_id='${snapshot.id}'::uuid AND capture.table_name='campus_model_agents' AND row->>'status'='active'`;
      if (table.name === "campus_model_execution_snapshots") source += ` UNION ALL SELECT jsonb_build_object(
        'id','${snapshotId}','school_id','${address.school_id}','realm_id','${realmId}',
        'environment_namespace_id','${address.namespace_id}','snapshot_kind','simulation_fork',
        'source_snapshot_ref','sha256:${snapshot.content_hash}','core_contract_version','1',
        'configuration_hash','${snapshot.content_hash}','source_recorded_at','${snapshot.captured_at}',
        'sealed_at','${snapshot.captured_at}','sealed_by_authority','simulation-snapshot-adapter/v1',
        'metadata',jsonb_build_object('run_id','${address.run_id}','evidence_mode','simulation'),
        'created_at','${snapshot.captured_at}') AS value WHERE '${realmId ?? ""}'<>''`;
      if (table.name === "campus_model_authority_receipts") source = `SELECT ${rowExpression}||
        CASE WHEN row->>'execution_actor_id' IS NOT NULL THEN jsonb_build_object(
          'execution_actor_id',md5('${address.run_id}:history:'||(row->>'execution_actor_id'))::uuid) ELSE '{}'::jsonb END AS value
        FROM dt_simulation.snapshot_tables capture,LATERAL jsonb_array_elements(capture.rows) row
        WHERE capture.snapshot_id='${snapshot.id}'::uuid AND capture.table_name='campus_model_authority_receipts'`;
      if (table.name === "campus_model_authority_snapshot_grants") source += ` UNION ALL SELECT row||jsonb_build_object(
        'id',md5('${address.run_id}:grant:'||(row->>'id'))::uuid,'snapshot_id','${snapshotId}',
        'realm_id','${realmId}','environment_namespace_id','${address.namespace_id}',
        'source_authority_id',row->>'id','content_hash',md5(row::text)||md5(row::text),'created_at','${snapshot.captured_at}') AS value
        FROM dt_simulation.snapshot_tables capture,LATERAL jsonb_array_elements(capture.rows) row
        WHERE capture.snapshot_id='${snapshot.id}'::uuid AND capture.table_name='campus_model_agent_authorities'
          AND (row->>'revoked_at') IS NULL`;
      if (table.name === "execution_environment_namespaces" && realmId) source += ` UNION ALL SELECT jsonb_build_object(
        'namespace_id','${address.namespace_id}','realm_id','${realmId}','environment_kind','simulation',
        'source_namespace_id','live:${address.school_id}','status','active',
        'expires_at','9999-12-31T23:59:59.999Z','created_at','${snapshot.captured_at}')`;
      if (table.name === "event_maintenance_leases") source = `SELECT jsonb_build_object('task_name',name,'last_claimed_at',NULL) AS value
        FROM unnest(ARRAY['attendance_register_overdue_scan','event_retention_cleanup','attendance_register_auto_finalize']) name`;
      if (table.name === "event_delivery_cursor") source = `SELECT jsonb_build_object('singleton',true,'replay_floor',0,
        'last_sequence',COALESCE(max((row->>'delivery_sequence')::bigint),0)) AS value
        FROM dt_simulation.snapshot_tables capture,LATERAL jsonb_array_elements(capture.rows) row
        WHERE capture.snapshot_id='${snapshot.id}'::uuid AND capture.table_name='event_outbox'`;
      const transformedTables = new Set(["campus_model_execution_actor_bindings", "campus_model_execution_snapshots",
        "campus_model_authority_receipts", "campus_model_authority_snapshot_grants", "execution_environment_namespaces",
        "event_maintenance_leases", "event_delivery_cursor"]);
      const shared = transformedTables.has(table.name) ? null : await indexedSnapshotRelation(client, snapshot, table.name);
      if (shared) {
        const columns = table.columns.map((column) => column === "environment_namespace_id"
          ? `CASE WHEN ${identifier(column)}='live:${address.school_id}' THEN '${address.namespace_id}' ELSE ${identifier(column)} END AS ${identifier(column)}`
          : identifier(column));
        await client.query(`CREATE VIEW ${schema}.${tableName} AS SELECT ${columns.join(",")} FROM ${shared}`);
      } else {
        await client.query(`CREATE VIEW ${schema}.${tableName} AS SELECT (jsonb_populate_record(NULL::${template}.${tableName},value)).* FROM (${source}) captured`);
      }
    }
    // Domain functions and triggers run against the same frozen views/native
    // branch tables. Their explicit public search paths must never escape them.
    await client.query("SET LOCAL check_function_bodies=off");
    for (const procedure of snapshot.catalogue.functions) await client.query(simulationFunctionDefinition(procedure.definition, branch, snapshot.catalogue.extension_objects));
    for (const view of orderedViews(snapshot)) {
      await client.query(`CREATE VIEW ${schema}.${identifier(view.name)} AS ${simulationFunctionDefinition(view.definition, branch, snapshot.catalogue.extension_objects)}`);
    }
    if (realmId) {
      // Entities created through normal editors inside a scenario receive a
      // counterpart too. This provisions identity only: no credentials, inferred
      // behaviour, or authority are manufactured for the new agent.
      await client.query(`CREATE FUNCTION ${schema}.provision_simulation_counterpart() RETURNS trigger LANGUAGE plpgsql
        SET search_path TO ${schema},public AS $counterpart$
        BEGIN
          IF NEW.status='active' THEN
            INSERT INTO campus_model_execution_actor_bindings(school_id,realm_id,environment_namespace_id,
              source_agent_id,execution_actor_id,actor_mode,binding_key,snapshot_id,authority_snapshot_ref,status,effective_from)
            VALUES(NEW.school_id,'${realmId}'::uuid,'${address.namespace_id}',NEW.id,
              md5('${address.run_id}:counterpart:'||NEW.id::text)::uuid,'simulation_counterpart','counterpart:'||NEW.id::text,
              '${snapshotId}'::uuid,'sha256:${snapshot.content_hash}','active',${schema}.simulation_now())
            ON CONFLICT(realm_id,environment_namespace_id,binding_key) DO NOTHING;
          END IF;
          RETURN NEW;
        END $counterpart$`);
    }
    await client.query(`INSERT INTO dt_simulation.worlds(run_id,school_id,scenario_id,namespace_id,snapshot_id,schema_name,virtual_now,time_zone)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [address.run_id, address.school_id, address.scenario_id, address.namespace_id, snapshot.id, schemaName, snapshot.captured_at, snapshot.time_zone]);
    await client.query("COMMIT");
    return branch;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export class SimulationBranchMaterializer {
  private readonly tables;
  private readonly tableNames: ReadonlySet<string>;
  constructor(private readonly branch: SimulationBranch, private readonly snapshot: StoredSimulationSnapshot) {
    this.tables = new Map(snapshot.catalogue.tables.map((table) => [table.name, table]));
    this.tableNames = new Set(this.tables.keys());
  }

  targets(sql: string): string[] {
    const targets = new Set(writtenSimulationTables(sql, this.tableNames));
    // Native PostgreSQL projections use primary-key functional dependencies in
    // GROUP BY. Views have no primary keys, so those projections materialize
    // their referenced tables with the original keys before executing.
    if (/\bgroup\s+by\b/iu.test(sql)) {
      for (const table of this.tableNames) if (new RegExp(`\\b${table}\\b`, "u").test(sql)) targets.add(table);
    }
    for (const procedure of this.snapshot.catalogue.functions) {
      if (new RegExp(`\\b${procedure.name}\\s*\\(`, "u").test(sql)) {
        for (const target of this.functionWrites(procedure.name)) targets.add(target);
      }
    }
    return [...targets];
  }

  mutations(sql: string): string[] {
    const targets = new Set(writtenSimulationTables(sql, this.tableNames, false));
    for (const procedure of this.snapshot.catalogue.functions) {
      if (new RegExp(`\\b${procedure.name}\\s*\\(`, "u").test(sql)) {
        for (const target of this.functionWrites(procedure.name)) targets.add(target);
      }
    }
    return [...targets];
  }

  private functionWrites(name: string, visited = new Set<string>()): string[] {
    if (visited.has(name)) return [];
    visited.add(name);
    const definitions = this.snapshot.catalogue.functions.filter((procedure) => procedure.name === name);
    const result = new Set<string>();
    for (const procedure of definitions) {
      for (const table of writtenSimulationTables(procedure.definition, this.tableNames, false)) result.add(table);
      for (const nested of this.snapshot.catalogue.functions) {
        if (!visited.has(nested.name) && new RegExp(`\\b${nested.name}\\s*\\(`, "u").test(procedure.definition)) {
          for (const table of this.functionWrites(nested.name, visited)) result.add(table);
        }
      }
    }
    return [...result];
  }

  async ensure(client: PoolClient, targets: readonly string[]): Promise<void> {
    if (!targets.length) return;
    const schema = identifier(this.branch.schema_name);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`cow:${this.branch.run_id}`]);
    const materialized = new Set((await client.query<{ table_name: string }>("SELECT table_name FROM dt_simulation.materialized_tables WHERE run_id=$1", [this.branch.run_id])).rows.map((row) => row.table_name));
    const pending: string[] = [];
    const visit = (name: string) => {
      if (materialized.has(name)) return;
      const table = this.tables.get(name);
      if (!table) throw new Error(`A Simulation command referenced an uncaptured table: ${name}.`);
      materialized.add(name);
      pending.push(name);
      for (const key of table.foreign_keys) visit(key.referenced_table);
      for (const fn of table.trigger_functions) for (const target of this.functionWrites(fn)) visit(target);
      if (name === "campus_model_agents" && this.tables.has("campus_model_execution_actor_bindings")) visit("campus_model_execution_actor_bindings");
    };
    for (const target of targets) visit(target);
    if (!pending.length) return;
    // Derived domain views depend on the frozen relations' OIDs. Replace them
    // atomically with the COW swaps, then bind them to the new native relations.
    // Deliberately omit CASCADE: an unexpected dependency must fail closed, not
    // silently delete a domain function, trigger, or invariant.
    const views = orderedViews(this.snapshot);
    if (views.length) await client.query(`DROP VIEW ${views.map((view) => `${schema}.${identifier(view.name)}`).join(",")}`);
    // A few native helpers accept a table's composite row type. PostgreSQL
    // binds that signature to the frozen view's OID, not merely its name.
    // Rebind only these known application helpers when the relation changes.
    const rowTypeFunctions = (await client.query<{ name: string; arguments: string }>(`SELECT DISTINCT
      procedure.proname AS name,pg_get_function_identity_arguments(procedure.oid) AS arguments
      FROM pg_proc procedure JOIN pg_namespace function_namespace ON function_namespace.oid=procedure.pronamespace
      JOIN pg_depend dependency ON dependency.classid='pg_proc'::regclass AND dependency.objid=procedure.oid
      JOIN pg_class relation ON relation.relnamespace=procedure.pronamespace
      JOIN pg_type row_type ON row_type.oid=relation.reltype
      WHERE function_namespace.nspname=$1 AND relation.relname=ANY($2::text[])
        AND dependency.refclassid='pg_type'::regclass AND dependency.refobjid IN (row_type.oid,row_type.typarray)`,
    [this.branch.schema_name, pending])).rows;
    for (const procedure of rowTypeFunctions) {
      if (!this.snapshot.catalogue.functions.some((definition) => definition.name === procedure.name)) {
        throw new Error("An uncaptured function depends on this Simulation relation.");
      }
      await client.query(`DROP FUNCTION ${schema}.${identifier(procedure.name)}(${procedure.arguments})`);
    }
    // Copy only tables touched by a command (plus invariant dependencies).
    // All other reads continue to share the immutable snapshot.
    for (const name of pending) {
      const table = this.tables.get(name)!;
      const qualified = `${schema}.${identifier(name)}`;
      const temporary = `${schema}.${identifier(`cow_${name}`.slice(0, 63))}`;
      await client.query(`CREATE TABLE ${temporary} (LIKE ${identifier(this.snapshot.template_schema)}.${identifier(name)} INCLUDING ALL)`);
      const insertColumns = table.columns.filter((column) => !table.defaults.some((value) => value.column === column && /GENERATED/iu.test(value.expression)));
      await client.query(`INSERT INTO ${temporary} (${insertColumns.map(identifier).join(",")}) OVERRIDING SYSTEM VALUE SELECT ${insertColumns.map(identifier).join(",")} FROM ${qualified}`);
      await client.query(`DROP VIEW ${qualified}`);
      await client.query(`ALTER TABLE ${temporary} RENAME TO ${identifier(name)}`);
      for (const value of table.defaults) {
        const sequence = /nextval\('(?:[^']+\.)?([^'.]+)'::regclass\)/u.exec(value.expression);
        if (sequence) {
          const sequenceName = `seq_${name}_${value.column}`.slice(0, 63);
          await client.query(`CREATE SEQUENCE IF NOT EXISTS ${schema}.${identifier(sequenceName)}`);
          await client.query(`SELECT setval('${this.branch.schema_name}.${sequenceName}',COALESCE((SELECT max(${identifier(value.column)}) FROM ${qualified}),0)+1,false)`);
          await client.query(`ALTER TABLE ${qualified} ALTER COLUMN ${identifier(value.column)} SET DEFAULT nextval('${this.branch.schema_name}.${sequenceName}'::regclass)`);
        } else {
          await client.query(`ALTER TABLE ${qualified} ALTER COLUMN ${identifier(value.column)} SET DEFAULT ${bindSimulationSql(value.expression.replaceAll(`${this.snapshot.template_schema}.`, `${this.branch.schema_name}.`), this.branch.schema_name)}`);
        }
      }
      // Identity sequences are independent of the template and must start above
      // captured evidence IDs, including GENERATED ALWAYS audit journals.
      const identities = (await client.query<{ column: string; sequence: string }>(`SELECT attribute.attname AS column,
        pg_get_serial_sequence($1,attribute.attname) AS sequence FROM pg_attribute attribute
        WHERE attribute.attrelid=$1::regclass AND attribute.attidentity<>''`, [`${this.branch.schema_name}.${name}`])).rows;
      for (const identity of identities) {
        await client.query(`SELECT setval($1::regclass,COALESCE((SELECT max(${identifier(identity.column)}) FROM ${qualified}),0)+1,false)`, [identity.sequence]);
      }
    }
    for (const name of pending) {
      const table = this.tables.get(name)!;
      const qualified = `${schema}.${identifier(name)}`;
      for (const key of table.foreign_keys) {
        const definition = key.definition.replace(/REFERENCES\s+(?:public\.)?"?([a-z_][a-z_0-9]*)"?/iu, (_match, target: string) => `REFERENCES ${schema}.${identifier(target)}`);
        await client.query(`ALTER TABLE ${qualified} ADD CONSTRAINT ${identifier(key.name)} ${definition}`);
      }
      for (const definition of table.triggers) await client.query(simulationFunctionDefinition(definition, this.branch));
      if (name === "campus_model_agents") {
        const provisioner = (await client.query<{ found: boolean }>("SELECT to_regprocedure($1) IS NOT NULL AS found", [`${this.branch.schema_name}.provision_simulation_counterpart()`])).rows[0]?.found;
        if (provisioner) await client.query(`CREATE TRIGGER simulation_agent_counterpart AFTER INSERT OR UPDATE OF status ON ${qualified}
          FOR EACH ROW EXECUTE FUNCTION ${schema}.provision_simulation_counterpart()`);
      }
      await client.query("INSERT INTO dt_simulation.materialized_tables(run_id,table_name) VALUES($1,$2)", [this.branch.run_id, name]);
    }
    if (rowTypeFunctions.length) {
      await client.query("SET LOCAL check_function_bodies=off");
      for (const procedure of this.snapshot.catalogue.functions) {
        if (rowTypeFunctions.some((dependent) => dependent.name === procedure.name)) {
          await client.query(simulationFunctionDefinition(procedure.definition, this.branch, this.snapshot.catalogue.extension_objects));
        }
      }
    }
    for (const view of views) {
      await client.query(`CREATE VIEW ${schema}.${identifier(view.name)} AS ${simulationFunctionDefinition(view.definition, this.branch, this.snapshot.catalogue.extension_objects)}`);
    }
  }
}

class BranchConnection implements DatabaseConnection {
  transaction = false;
  enteringTransaction = false;
  closed = false;
  clientReleased = false;
  constructor(readonly client: PoolClient, private readonly branch: SimulationBranch, private readonly materializer: SimulationBranchMaterializer) {}
  async bind(): Promise<void> {
    if (this.closed) throw new Error("This Simulation connection has been released.");
    const environment = executionEnvironmentStorage.getStore();
    if (environment?.kind === "simulation" && environment.run_id !== this.branch.run_id) throw new Error("Simulation connection identity mismatch.");
    const instant = environment?.kind === "simulation" ? environment.virtual_clock.nowIso() : new Date(this.branch.virtual_now).toISOString();
    await this.client.query("SELECT set_config('search_path',$1,false),set_config('thatcampus.virtual_now',$2,false),set_config('thatcampus.namespace_id',$3,false),set_config('TimeZone',$4,false)", [this.branch.schema_name + ", public", instant, this.branch.namespace_id, this.branch.time_zone]);
  }
  async executeQuery<R>(query: CompiledQuery): Promise<QueryResult<R>> {
    if (this.closed) throw new Error("This Simulation connection has been released.");
    const targets = this.materializer.targets(query.sql);
    // A reader must join the schema lock before taking any relation locks.
    // Otherwise a COW view swap can deadlock against a later relation read in
    // the same statement/transaction (notably notifications and realtime).
    const implicit = !this.transaction;
    if (implicit) { await this.client.query("BEGIN"); this.transaction = true; }
    try {
      await this.bind();
      if (implicit) await this.client.query(`SELECT ${targets.length ? "pg_advisory_xact_lock" : "pg_advisory_xact_lock_shared"}(hashtextextended($1,0))`, [`cow:${this.branch.run_id}`]);
      // Serialize the terminal seal with every logical domain write, including
      // GET handlers and requests authorized before another tab stopped a run.
      // COW materialization is internal storage work and may still serve reads.
      if (this.materializer.mutations(query.sql).length) {
        const state = (await this.client.query<{ domain_read_only: boolean }>(
          "SELECT domain_read_only FROM dt_simulation.worlds WHERE run_id=$1 AND school_id=$2",
          [this.branch.run_id, this.branch.school_id])).rows[0];
        const selected = executionEnvironmentStorage.getStore();
        if (!state || state.domain_read_only || selected?.kind === "simulation" && selected.domain_read_only) {
          throw new ConflictException({ code: "simulation_run_read_only", message: "This Simulation has ended. Its campus records are read-only." });
        }
      }
      await this.materializer.ensure(this.client, targets);
      const parameters = [...query.parameters];
      if (/\bpg_(?:try_)?advisory/iu.test(query.sql)) {
        for (const match of query.sql.matchAll(/hashtextextended\(\$(\d+)/giu)) {
          const offset = Number(match[1]) - 1;
          if (typeof parameters[offset] === "string") parameters[offset] = `${this.branch.namespace_id}:${parameters[offset]}`;
        }
      }
      const result = await this.client.query(bindSimulationSql(query.sql, this.branch.schema_name), parameters);
      if (implicit) { await this.client.query("COMMIT"); this.transaction = false; }
      return { rows: result.rows as R[], ...(result.command === "INSERT" || result.command === "UPDATE" || result.command === "DELETE" ? { numAffectedRows: BigInt(result.rowCount ?? 0) } : {}) };
    } catch (error) {
      if (implicit) { await this.client.query("ROLLBACK"); this.transaction = false; }
      throw error;
    }
  }
  async *streamQuery<R>(query: CompiledQuery): AsyncIterableIterator<QueryResult<R>> {
    yield await this.executeQuery<R>(query);
  }
}

/** All run drivers share one bounded pool. destroy never shuts down other runs. */
export class SimulationBranchDriver implements Driver {
  private readonly connections = new Set<BranchConnection>();
  private readonly releasedConnections = new WeakSet<DatabaseConnection>();
  private destroyed = false;
  private readonly materializer: SimulationBranchMaterializer;
  constructor(private readonly pool: Pool, readonly branch: SimulationBranch, snapshot: StoredSimulationSnapshot) {
    this.materializer = new SimulationBranchMaterializer(branch, snapshot);
  }
  init(): Promise<void> {
    return this.destroyed ? Promise.reject(new Error("This Simulation driver has been closed.")) : Promise.resolve();
  }
  async acquireConnection(): Promise<DatabaseConnection> {
    if (this.destroyed) throw new Error("This Simulation driver has been closed.");
    const connection = new BranchConnection(await this.pool.connect(), this.branch, this.materializer);
    this.connections.add(connection);
    try { await connection.bind(); return connection; }
    catch (error) { await this.discardConnection(connection); throw error; }
  }
  private connection(value: DatabaseConnection): BranchConnection {
    if (!(value instanceof BranchConnection) || !this.connections.has(value) || value.closed) throw new Error("The connection belongs to a different Simulation driver.");
    return value;
  }
  private forgetConnection(connection: BranchConnection): void {
    connection.closed = true;
    this.connections.delete(connection);
    this.releasedConnections.add(connection);
  }
  private async releaseClient(connection: BranchConnection, destroy: boolean): Promise<void> {
    if (connection.clientReleased) return;
    connection.clientReleased = true;
    try { connection.client.release(destroy); }
    catch (error) {
      // Never leave a possibly locked backend alive when pool release fails.
      try { await connection.client.end(); } catch { /* The closed lease cannot be reused. */ }
      if (!destroy) throw error;
    }
  }
  private async discardConnection(connection: BranchConnection): Promise<void> {
    this.forgetConnection(connection);
    connection.transaction = false;
    // Disconnect rolls back partial BEGIN work and releases both advisory-lock
    // lifetimes. Do not attempt a session unlock in a possibly aborted transaction.
    await this.releaseClient(connection, true);
  }
  async beginTransaction(value: DatabaseConnection, settings: TransactionSettings): Promise<void> {
    const connection = this.connection(value);
    const level = settings.isolationLevel;
    if (level && !["read uncommitted", "read committed", "repeatable read", "serializable"].includes(level)) throw new Error("Invalid isolation level.");
    if (settings.accessMode && !["read only", "read write"].includes(settings.accessMode)) throw new Error("Invalid transaction access mode.");
    if (connection.transaction || connection.enteringTransaction) throw new Error("A Simulation transaction is already active. Use savepoints for nested work.");
    connection.enteringTransaction = true;
    const gate = [`cow:${this.branch.run_id}`];
    try {
      // BEGIN followed by a waiting SELECT lock can freeze an RR/Serializable
      // snapshot before a concurrent COW swap commits. Wait in autocommit first,
      // then bridge the same leased backend/key to its transaction-owned gate.
      await connection.client.query("SELECT pg_advisory_lock(hashtextextended($1,0))", gate);
      await connection.client.query(`BEGIN${level ? ` ISOLATION LEVEL ${level}` : ""}${settings.accessMode ? ` ${settings.accessMode.toUpperCase()}` : ""}`);
      connection.transaction = true;
      await connection.client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", gate);
      const released = await connection.client.query<{ released: boolean }>("SELECT pg_advisory_unlock(hashtextextended($1,0)) AS released", gate);
      if (connection.closed || released.rows[0]?.released !== true) throw new Error("The Simulation transaction entry gate was lost.");
    } catch (error) {
      // Kysely does not roll back when beginTransaction itself rejects. Destroy
      // this lease immediately; a later releaseConnection must be harmless.
      await this.discardConnection(connection);
      throw error;
    } finally { connection.enteringTransaction = false; }
  }
  async commitTransaction(value: DatabaseConnection): Promise<void> { const connection = this.connection(value); await connection.client.query("COMMIT"); connection.transaction = false; }
  async rollbackTransaction(value: DatabaseConnection): Promise<void> { const connection = this.connection(value); await connection.client.query("ROLLBACK"); connection.transaction = false; }
  async savepoint(value: DatabaseConnection, name: string): Promise<void> { await this.connection(value).client.query(`SAVEPOINT ${identifier(name)}`); }
  async rollbackToSavepoint(value: DatabaseConnection, name: string): Promise<void> { await this.connection(value).client.query(`ROLLBACK TO SAVEPOINT ${identifier(name)}`); }
  async releaseSavepoint(value: DatabaseConnection, name: string): Promise<void> { await this.connection(value).client.query(`RELEASE SAVEPOINT ${identifier(name)}`); }
  async releaseConnection(value: DatabaseConnection): Promise<void> {
    if (this.releasedConnections.has(value)) return;
    const connection = this.connection(value);
    this.forgetConnection(connection);
    if (connection.enteringTransaction) { await this.discardConnection(connection); return; }
    try {
      if (connection.transaction) await connection.client.query("ROLLBACK");
      connection.transaction = false;
      await connection.client.query("RESET ALL");
      await this.releaseClient(connection, false);
    } catch (error) { await this.discardConnection(connection); throw error; }
  }
  destroy(): Promise<void> { this.destroyed = true; return Promise.resolve(); }
}
