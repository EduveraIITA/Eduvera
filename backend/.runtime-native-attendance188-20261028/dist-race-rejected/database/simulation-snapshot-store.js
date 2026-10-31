import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { Pool } from "pg";
import { createSimulationSnapshotCompatibility, } from "../simulation/simulation-runtime-compatibility.js";
import { assertSupportedPostgreSqlVersion, postgresClientConnectionConfig } from "./connection-policy.js";
import { quoteSimulationIdentifier as identifier } from "./simulation-sql.js";
import { privacySafeCampusSceneRows } from "../campus-scenes/campus-scenes.snapshot.js";
const globalTables = new Set([
    "model_semantic_type_definitions", "model_protocol_schema_definitions", "model_capability_manifests",
    "model_snapshot_adapter_definitions", "progressive_onboarding_goal_catalog",
]);
const excludedTable = /^(?:auth_|api_rate_|simulation_|hosted_campus_lab_|matrix_|ai_|agent_|event_maintenance|invitation_email|restricted_care_case_entries|restricted_care_external_reports)/u;
const sensitiveKey = /(?:password|secret|credential|(?:^|_)token(?:_|$)|access_token|refresh_token|api_key|private_key|cookie|csrf_token|webhook_token|ciphertext|encrypted_secret|(?:token|code|proof)_(?:hash|digest))/iu;
function hash(value) {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function privacySafeSimulationRow(value, redactionKey = randomBytes(32).toString("hex")) {
    if (Array.isArray(value))
        return value.map((entry) => privacySafeSimulationRow(entry, redactionKey));
    if (!value || typeof value !== "object")
        return value;
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key,
        sensitiveKey.test(key) ? (typeof entry === "string"
            ? /(?:token|code|proof)_(?:hash|digest)$/iu.test(key) ? createHmac("sha256", redactionKey).update(entry).digest("hex")
                : key === "token_hint" ? "hidden" : "simulation-disabled"
            : null)
            : privacySafeSimulationRow(entry, redactionKey),
    ]));
}
/** Refuse aliases which address the same database, even when URL strings differ. */
export function assertDistinctSimulationDatabase(sourceValue, targetValue) {
    const normalize = (value) => {
        const parsed = new URL(value);
        const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
        return `${["localhost", "127.0.0.1", "::1"].includes(host) ? "loopback" : host}:${parsed.port || "5432"}/${decodeURIComponent(parsed.pathname)}`;
    };
    if (normalize(sourceValue) === normalize(targetValue))
        throw new Error("Simulation storage must address a database separate from Live.");
}
async function schemaDump(url, snapshotId) {
    const parsed = new URL(url);
    const child = spawn("pg_dump", ["--schema-only", "--schema=public", "--no-owner", "--no-privileges", "--no-comments", `--snapshot=${snapshotId}`], {
        env: { ...process.env, PGHOST: parsed.hostname.replace(/^\[|\]$/gu, ""), PGPORT: parsed.port || "5432",
            PGUSER: decodeURIComponent(parsed.username), PGPASSWORD: decodeURIComponent(parsed.password),
            PGDATABASE: decodeURIComponent(parsed.pathname.slice(1)), PGCONNECT_TIMEOUT: "5",
            ...(parsed.searchParams.has("sslmode") ? { PGSSLMODE: parsed.searchParams.get("sslmode") } : {}),
            ...(parsed.searchParams.has("sslrootcert") ? { PGSSLROOTCERT: parsed.searchParams.get("sslrootcert") } : {}) },
        timeout: 60_000,
        stdio: ["ignore", "pipe", "pipe"],
    });
    return new Promise((resolve, reject) => {
        let output = "";
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk) => { output += chunk; });
        // Do not return diagnostics containing connection values or credentials.
        child.stderr.resume();
        child.once("error", () => reject(new Error("The Simulation schema snapshot provider could not start pg_dump.")));
        child.once("exit", (code) => code === 0 ? resolve(output) : reject(new Error("The Simulation schema snapshot could not be captured.")));
    });
}
async function catalogue(client) {
    const tables = (await client.query(`SELECT relation.relname AS name,
      array_agg(attribute.attname::text ORDER BY attribute.attnum) AS columns
    FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
    JOIN pg_attribute attribute ON attribute.attrelid=relation.oid AND attribute.attnum>0 AND NOT attribute.attisdropped
    WHERE namespace.nspname='public' AND relation.relkind IN ('r','p')
    GROUP BY relation.oid,relation.relname ORDER BY relation.relname`)).rows;
    const foreignKeys = (await client.query(`SELECT guard.conname AS name,
      relation.relname AS table,foreign_relation.relname AS referenced_table,
      pg_get_constraintdef(guard.oid) AS definition,
      ARRAY(SELECT attribute.attname::text FROM unnest(guard.conkey) WITH ORDINALITY key(attnum,ordinal)
        JOIN pg_attribute attribute ON attribute.attrelid=guard.conrelid AND attribute.attnum=key.attnum ORDER BY key.ordinal) AS columns,
      ARRAY(SELECT attribute.attname::text FROM unnest(guard.confkey) WITH ORDINALITY key(attnum,ordinal)
        JOIN pg_attribute attribute ON attribute.attrelid=guard.confrelid AND attribute.attnum=key.attnum ORDER BY key.ordinal) AS referenced_columns
    FROM pg_constraint guard JOIN pg_class relation ON relation.oid=guard.conrelid
    JOIN pg_class foreign_relation ON foreign_relation.oid=guard.confrelid
    JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
    WHERE namespace.nspname='public' AND guard.contype='f' ORDER BY relation.relname,guard.conname`)).rows;
    const triggers = (await client.query(`SELECT relation.relname AS table,
      pg_get_triggerdef(trigger.oid) AS definition,procedure.proname AS function_name
    FROM pg_trigger trigger JOIN pg_class relation ON relation.oid=trigger.tgrelid
    JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
    JOIN pg_proc procedure ON procedure.oid=trigger.tgfoid
    WHERE namespace.nspname='public' AND NOT trigger.tgisinternal`)).rows;
    const defaults = (await client.query(`SELECT relation.relname AS table,
      attribute.attname AS column,pg_get_expr(value.adbin,value.adrelid) AS expression
    FROM pg_attrdef value JOIN pg_class relation ON relation.oid=value.adrelid
    JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
    JOIN pg_attribute attribute ON attribute.attrelid=relation.oid AND attribute.attnum=value.adnum
    WHERE namespace.nspname='public' AND attribute.attgenerated=''`)).rows;
    const functions = (await client.query(`SELECT procedure.proname AS name,
      pg_get_functiondef(procedure.oid) AS definition FROM pg_proc procedure
    JOIN pg_namespace namespace ON namespace.oid=procedure.pronamespace
    WHERE namespace.nspname='public' AND procedure.prokind IN ('f','p')
      AND NOT EXISTS(SELECT 1 FROM pg_depend dependency WHERE dependency.classid='pg_proc'::regclass
        AND dependency.objid=procedure.oid AND dependency.deptype='e') ORDER BY procedure.proname,procedure.oid`)).rows;
    const views = (await client.query(`SELECT relation.relname AS name,
    pg_get_viewdef(relation.oid,true) AS definition FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
    WHERE namespace.nspname='public' AND relation.relkind='v' ORDER BY relation.relname`)).rows;
    const extensions = (await client.query("SELECT extname AS name FROM pg_extension WHERE extname<>'plpgsql' ORDER BY extname")).rows.map((row) => row.name);
    const extensionObjects = (await client.query(`SELECT DISTINCT object.name FROM pg_depend dependency
    JOIN pg_extension extension ON dependency.refclassid='pg_extension'::regclass AND dependency.refobjid=extension.oid
    CROSS JOIN LATERAL pg_identify_object(dependency.classid,dependency.objid,dependency.objsubid) object
    WHERE dependency.deptype='e' AND object.schema='public' AND object.name IS NOT NULL`)).rows.map((row) => row.name);
    return { tables: tables.filter((table) => /^[a-z][a-z0-9_]{0,62}$/u.test(table.name)).map((table) => ({ ...table,
            foreign_keys: foreignKeys.filter((key) => key.table === table.name),
            triggers: triggers.filter((trigger) => trigger.table === table.name).map((trigger) => trigger.definition),
            trigger_functions: triggers.filter((trigger) => trigger.table === table.name).map((trigger) => trigger.function_name),
            defaults: defaults.filter((value) => value.table === table.name),
        })), functions, views, extensions, extension_objects: extensionObjects };
}
/**
 * One shared Simulation database. Source connections are opened only for an
 * explicit, repeatable-read capture. Running worlds never retain a Live client.
 */
export class SimulationSnapshotStore {
    sourceUrl;
    pool;
    initialized = null;
    constructor(sourceUrl, targetUrl, poolMax = 5) {
        this.sourceUrl = sourceUrl;
        assertDistinctSimulationDatabase(sourceUrl, targetUrl);
        this.pool = new Pool({ ...postgresClientConnectionConfig(targetUrl, {
                name: "CAMPUS_SIMULATION_DATABASE_URL", purpose: "simulation", requireRemoteTls: false,
            }), max: poolMax, connectionTimeoutMillis: 5_000, idleTimeoutMillis: 30_000, application_name: "thatcampus_simulation_worlds" });
    }
    async initialize() {
        if (!this.initialized)
            this.initialized = this.initializeOnce().catch((error) => { this.initialized = null; throw error; });
        return this.initialized;
    }
    async initializeOnce() {
        const client = await this.pool.connect();
        try {
            const version = (await client.query("SELECT current_setting('server_version_num')::int AS version")).rows[0].version;
            assertSupportedPostgreSqlVersion(version);
            const occupied = (await client.query(`SELECT
        to_regclass('public.schools') IS NOT NULL OR to_regclass('public.users') IS NOT NULL AS occupied`)).rows[0]?.occupied;
            if (occupied)
                throw new Error("Simulation storage must be a dedicated database, not an operational campus database.");
            await client.query("BEGIN");
            await client.query("SELECT pg_advisory_xact_lock(hashtextextended('thatcampus-simulation-schema-v1',0))");
            await client.query(`CREATE SCHEMA IF NOT EXISTS dt_simulation;
      CREATE TABLE IF NOT EXISTS dt_simulation.snapshots (
        id uuid PRIMARY KEY,origin_run_id uuid,school_id uuid NOT NULL,captured_at timestamptz NOT NULL,content_hash text NOT NULL,
        template_schema text NOT NULL,catalogue jsonb NOT NULL,counts jsonb NOT NULL,time_zone text NOT NULL,
        compatibility_manifest jsonb,compatibility_hash char(64));
      CREATE TABLE IF NOT EXISTS dt_simulation.snapshot_tables (
        snapshot_id uuid NOT NULL REFERENCES dt_simulation.snapshots(id),table_name text NOT NULL,
        rows jsonb NOT NULL CHECK(jsonb_typeof(rows)='array'),PRIMARY KEY(snapshot_id,table_name));
      CREATE TABLE IF NOT EXISTS dt_simulation.worlds (
        run_id uuid PRIMARY KEY,school_id uuid NOT NULL,scenario_id uuid NOT NULL,namespace_id text NOT NULL UNIQUE,
        snapshot_id uuid NOT NULL REFERENCES dt_simulation.snapshots(id),schema_name text NOT NULL UNIQUE,
        virtual_now timestamptz NOT NULL,time_zone text NOT NULL,revision bigint NOT NULL DEFAULT 1,
        last_checkpoint_ref text,last_lease_fence bigint NOT NULL DEFAULT 0,last_lease_token uuid,
        created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS dt_simulation.materialized_tables (
        run_id uuid NOT NULL REFERENCES dt_simulation.worlds(run_id),table_name text NOT NULL,
        PRIMARY KEY(run_id,table_name));
      CREATE TABLE IF NOT EXISTS dt_simulation.checkpoints (
        run_id uuid NOT NULL REFERENCES dt_simulation.worlds(run_id),checkpoint_ref text NOT NULL,
        virtual_from timestamptz NOT NULL,virtual_to timestamptz NOT NULL,
        lease_fence bigint NOT NULL DEFAULT 0,lease_token uuid,result jsonb NOT NULL,
        PRIMARY KEY(run_id,checkpoint_ref));
      ALTER TABLE dt_simulation.worlds ADD COLUMN IF NOT EXISTS last_lease_fence bigint NOT NULL DEFAULT 0;
      ALTER TABLE dt_simulation.worlds ADD COLUMN IF NOT EXISTS last_lease_token uuid;
      ALTER TABLE dt_simulation.worlds ADD COLUMN IF NOT EXISTS domain_read_only boolean NOT NULL DEFAULT false;
      ALTER TABLE dt_simulation.worlds ADD COLUMN IF NOT EXISTS terminal_privacy_receipt jsonb;
      ALTER TABLE dt_simulation.checkpoints ADD COLUMN IF NOT EXISTS lease_fence bigint NOT NULL DEFAULT 0;
      ALTER TABLE dt_simulation.checkpoints ADD COLUMN IF NOT EXISTS lease_token uuid;
      ALTER TABLE dt_simulation.snapshots ADD COLUMN IF NOT EXISTS compatibility_manifest jsonb;
      ALTER TABLE dt_simulation.snapshots ADD COLUMN IF NOT EXISTS compatibility_hash char(64);
      ALTER TABLE dt_simulation.snapshots ADD COLUMN IF NOT EXISTS origin_run_id uuid;
      CREATE UNIQUE INDEX IF NOT EXISTS simulation_snapshots_origin_run_unique
        ON dt_simulation.snapshots(origin_run_id) WHERE origin_run_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS simulation_snapshots_school_origin
        ON dt_simulation.snapshots(school_id,origin_run_id);
      CREATE TABLE IF NOT EXISTS dt_simulation.gc_receipts (
        run_id uuid PRIMARY KEY,school_id uuid NOT NULL,snapshot_id uuid,gc_token uuid NOT NULL,
        gc_fence bigint NOT NULL CHECK(gc_fence>0),result jsonb NOT NULL,completed_at timestamptz NOT NULL DEFAULT now());
      ALTER TABLE dt_simulation.gc_receipts ALTER COLUMN snapshot_id DROP NOT NULL;
      CREATE OR REPLACE FUNCTION dt_simulation.reject_snapshot_change() RETURNS trigger LANGUAGE plpgsql AS $body$
        BEGIN
          IF TG_OP='DELETE' AND TG_TABLE_SCHEMA='dt_simulation' AND TG_TABLE_NAME IN ('snapshots','snapshot_tables')
            AND EXISTS(SELECT 1 FROM dt_simulation.gc_receipts receipt
              WHERE receipt.gc_token::text=current_setting('thatcampus.simulation_gc_token',true)
                AND receipt.snapshot_id::text=COALESCE(to_jsonb(OLD)->>'snapshot_id',to_jsonb(OLD)->>'id')
                AND NOT EXISTS(SELECT 1 FROM dt_simulation.worlds world WHERE world.snapshot_id=receipt.snapshot_id)) THEN
            RETURN OLD;
          END IF;
          RAISE EXCEPTION 'Simulation source snapshots are immutable';
        END $body$;
      CREATE OR REPLACE FUNCTION dt_simulation.reject_gc_receipt_change() RETURNS trigger LANGUAGE plpgsql AS $body$
        BEGIN RAISE EXCEPTION 'Simulation garbage-collection receipts are immutable'; END $body$;
      DO $install$ BEGIN
        IF NOT EXISTS(SELECT 1 FROM pg_constraint
          WHERE conname='snapshot_compatibility_shape' AND conrelid='dt_simulation.snapshots'::regclass) THEN
          ALTER TABLE dt_simulation.snapshots ADD CONSTRAINT snapshot_compatibility_shape CHECK(
            (compatibility_manifest IS NULL AND compatibility_hash IS NULL)
            OR (jsonb_typeof(compatibility_manifest)='object'
              AND compatibility_hash ~ '^[0-9a-f]{64}$'));
        END IF;
        IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='snapshot_immutable' AND tgrelid='dt_simulation.snapshots'::regclass) THEN
          CREATE TRIGGER snapshot_immutable BEFORE UPDATE OR DELETE ON dt_simulation.snapshots
            FOR EACH ROW EXECUTE FUNCTION dt_simulation.reject_snapshot_change();
        END IF;
        IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='snapshot_table_immutable' AND tgrelid='dt_simulation.snapshot_tables'::regclass) THEN
          CREATE TRIGGER snapshot_table_immutable BEFORE UPDATE OR DELETE ON dt_simulation.snapshot_tables
            FOR EACH ROW EXECUTE FUNCTION dt_simulation.reject_snapshot_change();
        END IF;
        IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='gc_receipt_immutable' AND tgrelid='dt_simulation.gc_receipts'::regclass) THEN
          CREATE TRIGGER gc_receipt_immutable BEFORE UPDATE OR DELETE ON dt_simulation.gc_receipts
            FOR EACH ROW EXECUTE FUNCTION dt_simulation.reject_gc_receipt_change();
        END IF;
        IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='snapshot_no_truncate' AND tgrelid='dt_simulation.snapshots'::regclass) THEN
          CREATE TRIGGER snapshot_no_truncate BEFORE TRUNCATE ON dt_simulation.snapshots
            FOR EACH STATEMENT EXECUTE FUNCTION dt_simulation.reject_snapshot_change();
        END IF;
        IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='snapshot_tables_no_truncate' AND tgrelid='dt_simulation.snapshot_tables'::regclass) THEN
          CREATE TRIGGER snapshot_tables_no_truncate BEFORE TRUNCATE ON dt_simulation.snapshot_tables
            FOR EACH STATEMENT EXECUTE FUNCTION dt_simulation.reject_snapshot_change();
        END IF;
        IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='gc_receipt_no_truncate' AND tgrelid='dt_simulation.gc_receipts'::regclass) THEN
          CREATE TRIGGER gc_receipt_no_truncate BEFORE TRUNCATE ON dt_simulation.gc_receipts
            FOR EACH STATEMENT EXECUTE FUNCTION dt_simulation.reject_gc_receipt_change();
        END IF;
      END $install$;
      REVOKE ALL ON SCHEMA dt_simulation FROM PUBLIC;
      REVOKE ALL ON ALL TABLES IN SCHEMA dt_simulation FROM PUBLIC;`);
            await client.query("COMMIT");
        }
        catch (error) {
            await client.query("ROLLBACK");
            throw error;
        }
        finally {
            client.release();
        }
    }
    async getSnapshot(id) {
        await this.initialize();
        const row = (await this.pool.query("SELECT * FROM dt_simulation.snapshots WHERE id=$1", [id])).rows[0];
        if (!row)
            throw new Error("The retained Simulation snapshot is unavailable.");
        return { ...row, captured_at: new Date(row.captured_at).toISOString() };
    }
    async capture(schoolId, requestedAt, originRunId = null) {
        await this.initialize();
        const sourcePool = new Pool({ ...postgresClientConnectionConfig(this.sourceUrl, {
                name: "DATABASE_URL", purpose: "application", requireRemoteTls: false,
            }), max: 1, application_name: "thatcampus_simulation_capture" });
        const source = await sourcePool.connect();
        let templateGuard = null;
        let guardedTemplateSchema = null;
        let snapshotCommitted = false;
        try {
            await source.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
            const school = (await source.query("SELECT timezone FROM schools WHERE id=$1", [schoolId])).rows[0];
            if (!school)
                throw new Error("The institution could not be captured.");
            const definition = await catalogue(source);
            const exported = (await source.query("SELECT pg_export_snapshot() AS id")).rows[0].id;
            const ddl = (await schemaDump(this.sourceUrl, exported)).replace(/^\\(?:un)?restrict[^\r\n]*$/gmu, "");
            const templateSchema = `dt_template_${hash(ddl).slice(0, 16)}`;
            guardedTemplateSchema = templateSchema;
            const target = await this.pool.connect();
            templateGuard = target;
            try {
                await target.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [templateSchema]);
                const exists = (await target.query("SELECT 1 FROM pg_namespace WHERE nspname=$1", [templateSchema])).rowCount;
                if (!exists) {
                    await target.query("BEGIN");
                    for (const extension of definition.extensions) {
                        if (!new Set(["pgcrypto", "pg_trgm"]).has(extension))
                            throw new Error(`The Simulation provider has no reviewed adapter for extension ${extension}.`);
                        await target.query(`CREATE EXTENSION IF NOT EXISTS ${identifier(extension)} WITH SCHEMA public`);
                    }
                    await target.query(`CREATE SCHEMA ${identifier(templateSchema)}`);
                    const normalizedDdl = ddl.replace(/^\\(?:un)?restrict[^\r\n]*$/gmu, "");
                    if (/^\\/mu.test(normalizedDdl))
                        throw new Error("The snapshot provider returned an unsupported SQL client directive.");
                    const rewritten = normalizedDdl.replace(/^CREATE SCHEMA public;\s*$/gmu, "")
                        .replace(/\bpublic\.("?[a-z_][a-z_0-9]*"?)/gu, (match, symbol) => definition.extension_objects.includes(symbol.replaceAll('"', "")) ? match : `${identifier(templateSchema)}.${symbol}`)
                        .replace(/\bSCHEMA public\b/gu, `SCHEMA ${identifier(templateSchema)}`)
                        .replace(/SET search_path (?:TO|=) (?:'public'|public)/giu, `SET search_path TO ${identifier(templateSchema)}, public`);
                    await target.query(rewritten);
                    await target.query("COMMIT");
                }
            }
            catch (error) {
                await target.query("ROLLBACK").catch(() => undefined);
                throw error;
            }
            const data = new Map();
            const owned = new Set();
            for (const table of definition.tables) {
                let where = null;
                if (!excludedTable.test(table.name)) {
                    if (table.name === "schools")
                        where = "id=$1::uuid";
                    else if (table.columns.includes("school_id"))
                        where = "school_id=$1::uuid";
                    else if (table.name === "users")
                        where = "id IN (SELECT user_id FROM school_memberships WHERE school_id=$1::uuid AND is_active)";
                    else if (table.name === "parents")
                        where = "id IN (SELECT guardian_id FROM guardian_school_profiles WHERE school_id=$1::uuid)";
                    else if (table.name === "operational_realms")
                        where = "legacy_school_id=$1::uuid";
                    else if (globalTables.has(table.name))
                        where = "$1::uuid IS NOT NULL";
                }
                const rows = where ? (await source.query(`SELECT to_jsonb(row) AS value FROM ${identifier(table.name)} row WHERE ${where} LIMIT 100001`, [schoolId])).rows.map((row) => row.value) : [];
                if (rows.length > 100_000)
                    throw new Error(`The ${table.name} snapshot exceeds this provider's capture budget.`);
                data.set(table.name, rows);
                if (where && !globalTables.has(table.name))
                    owned.add(table.name);
            }
            // Dependent records such as enrolments and diary acknowledgements retain
            // their native ownership edges; shared metadata never broadens tenant scope.
            for (let pass = 0; pass < definition.tables.length; pass += 1) {
                let changed = false;
                for (const table of definition.tables) {
                    if (excludedTable.test(table.name) || owned.has(table.name) || globalTables.has(table.name))
                        continue;
                    const keys = table.foreign_keys.filter((key) => owned.has(key.referenced_table) && data.get(key.referenced_table)?.length);
                    if (!keys.length)
                        continue;
                    const clauses = [];
                    const parameters = [];
                    for (const key of keys) {
                        const rows = data.get(key.referenced_table);
                        const values = rows.map((row) => Object.fromEntries(key.referenced_columns.map((column) => [column, row[column]])));
                        parameters.push(JSON.stringify(values));
                        clauses.push(`(${key.columns.map((column) => `row.${identifier(column)} IS NULL`).join(" OR ")} OR EXISTS(SELECT 1 FROM jsonb_array_elements($${parameters.length}::jsonb) parent WHERE ${key.columns.map((column, index) => `row.${identifier(column)}::text=parent->>'${key.referenced_columns[index]}'`).join(" AND ")}))`);
                    }
                    const rows = (await source.query(`SELECT to_jsonb(row) AS value FROM ${identifier(table.name)} row WHERE ${clauses.join(" AND ")}
            AND (${keys.map((key) => key.columns.map((column) => `row.${identifier(column)} IS NOT NULL`).join(" AND ")).join(" OR ")}) LIMIT 100001`, parameters)).rows.map((row) => row.value);
                    if (rows.length > 100_000)
                        throw new Error(`The ${table.name} snapshot exceeds this provider's capture budget.`);
                    data.set(table.name, rows);
                    owned.add(table.name);
                    changed = true;
                }
                if (!changed)
                    break;
            }
            // Native constraints also require the exact parents of retained records
            // (for example a campus's onboarding directory entry). These references
            // are ancillary data, not new ownership anchors: never walk their other
            // children, and never pull a parent belonging to another campus.
            const tables = new Map(definition.tables.map((table) => [table.name, table]));
            for (let pass = 0; pass < definition.tables.length; pass += 1) {
                let changed = false;
                for (const child of definition.tables) {
                    const children = data.get(child.name) ?? [];
                    if (!children.length)
                        continue;
                    for (const key of child.foreign_keys) {
                        const parent = tables.get(key.referenced_table);
                        if (!parent || excludedTable.test(parent.name))
                            continue;
                        const parents = data.get(parent.name);
                        const existing = new Set(parents.map((row) => JSON.stringify(key.referenced_columns.map((column) => row[column]))));
                        const missing = new Map();
                        for (const row of children) {
                            const values = key.columns.map((column) => row[column]);
                            if (values.some((value) => value === null || value === undefined) || existing.has(JSON.stringify(values)))
                                continue;
                            missing.set(JSON.stringify(values), Object.fromEntries(key.referenced_columns.map((column, index) => [column, values[index]])));
                        }
                        if (!missing.size)
                            continue;
                        const tenantGuard = parent.name === "schools" ? "AND row.id=$2::uuid"
                            : parent.columns.includes("school_id") ? "AND row.school_id=$2::uuid"
                                : parent.name === "operational_realms" ? "AND row.legacy_school_id=$2::uuid" : "AND $2::uuid IS NOT NULL";
                        const fetched = (await source.query(`SELECT to_jsonb(row) AS value
              FROM ${identifier(parent.name)} row WHERE EXISTS(SELECT 1 FROM jsonb_array_elements($1::jsonb) requested
                WHERE ${key.referenced_columns.map((column) => `row.${identifier(column)}::text=requested->>'${column}'`).join(" AND ")})
              ${tenantGuard} LIMIT 100001`, [JSON.stringify([...missing.values()]), schoolId])).rows.map((row) => row.value);
                        if (!fetched.length)
                            continue;
                        const fingerprints = new Set(parents.map((row) => JSON.stringify(row)));
                        for (const row of fetched) {
                            const fingerprint = JSON.stringify(row);
                            if (!fingerprints.has(fingerprint)) {
                                parents.push(row);
                                fingerprints.add(fingerprint);
                                changed = true;
                            }
                        }
                        if (parents.length > 100_000)
                            throw new Error(`The ${parent.name} snapshot exceeds this provider's capture budget.`);
                    }
                }
                if (!changed)
                    break;
            }
            await source.query("COMMIT");
            // One disposable HMAC key preserves unique token-hash constraints without
            // retaining Live invitation/gate/calendar credentials or short-code digests.
            const redactionKey = randomBytes(32).toString("hex");
            const safeData = [...data].map(([name, rows]) => [name, privacySafeCampusSceneRows(name, privacySafeSimulationRow(rows, redactionKey))]);
            const serialized = JSON.stringify(safeData);
            if (Buffer.byteLength(serialized) > 100 * 1024 * 1024)
                throw new Error("This institution exceeds the snapshot provider's 100 MB capture budget.");
            const compatibility = createSimulationSnapshotCompatibility({
                template_schema: templateSchema,
                catalogue: definition,
            });
            const snapshot = {
                id: randomUUID(), origin_run_id: originRunId, school_id: schoolId, captured_at: requestedAt,
                content_hash: hash({ template: templateSchema, tables: safeData }), template_schema: templateSchema,
                catalogue: definition, counts: Object.fromEntries([...data].map(([name, rows]) => [name, rows.length])), time_zone: school.timezone || "UTC",
                compatibility_manifest: compatibility.manifest,
                compatibility_hash: compatibility.hash,
            };
            // Reuse the guarded connection: a deployment with a one-connection pool
            // must not wait for a second connection while holding its only lease.
            const writer = templateGuard;
            try {
                await writer.query("BEGIN");
                await writer.query(`INSERT INTO dt_simulation.snapshots(id,origin_run_id,school_id,captured_at,content_hash,template_schema,catalogue,counts,time_zone,
          compatibility_manifest,compatibility_hash)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [snapshot.id, originRunId, schoolId, requestedAt,
                    snapshot.content_hash, templateSchema, JSON.stringify(definition), JSON.stringify(snapshot.counts), snapshot.time_zone,
                    JSON.stringify(snapshot.compatibility_manifest), snapshot.compatibility_hash]);
                for (const [table, rows] of safeData)
                    await writer.query("INSERT INTO dt_simulation.snapshot_tables(snapshot_id,table_name,rows) VALUES($1,$2,$3)", [snapshot.id, table, JSON.stringify(rows)]);
                await writer.query("COMMIT");
                snapshotCommitted = true;
            }
            catch (error) {
                await writer.query("ROLLBACK");
                throw error;
            }
            return snapshot;
        }
        catch (error) {
            await source.query("ROLLBACK").catch(() => undefined);
            throw error;
        }
        finally {
            if (templateGuard) {
                if (!snapshotCommitted && guardedTemplateSchema && /^dt_template_[a-f0-9]{16}$/u.test(guardedTemplateSchema)) {
                    // Failed capture owns this exact template lease. Delete only when no
                    // committed immutable snapshot references it; never infer safety from
                    // schema age or a wildcard. This also reclaims a prior failed attempt.
                    try {
                        const referenced = (await templateGuard.query("SELECT 1 FROM dt_simulation.snapshots WHERE template_schema=$1 LIMIT 1", [guardedTemplateSchema])).rowCount;
                        if (!referenced)
                            await templateGuard.query(`DROP SCHEMA IF EXISTS ${identifier(guardedTemplateSchema)} CASCADE`);
                    }
                    catch { /* Preserve the capture error; its exact template can be retried under the same lease. */ }
                }
                // Capture keeps the template lease until its snapshot is committed;
                // terminal GC can never drop a template between DDL and snapshot insert.
                let destroy = false;
                await templateGuard.query("SELECT pg_advisory_unlock_all()").catch(() => { destroy = true; });
                templateGuard.release(destroy);
            }
            source.release();
            await sourcePool.end();
        }
    }
}
//# sourceMappingURL=simulation-snapshot-store.js.map