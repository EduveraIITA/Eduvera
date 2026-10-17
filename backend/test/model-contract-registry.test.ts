import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
  type DatabaseConnection,
  type Driver,
  type QueryResult,
} from "kysely";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CampusModelCoreService } from "../src/campus-model-core/campus-model-core.service.js";
import type { ModelObservationContractRefs } from "../src/campus-model-core/contracts.js";
import type { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";

const migration = readFileSync(
  new URL("../migrations/125_model_contract_registry_governance.sql", import.meta.url),
  "utf8",
);
const realmId = "00000000-0000-4000-8000-000000000001";
const subjectId = "00000000-0000-4000-8000-000000000002";
const contextId = "00000000-0000-4000-8000-000000000003";
const protocolId = "00000000-0000-4000-8000-000000000004";
const capabilityId = "00000000-0000-4000-8000-000000000005";
const refs: ModelObservationContractRefs = {
  subject_type: { namespace: "thatcampus.people", type_key: "student", version: 1 },
  context_type: { namespace: "thatcampus.academic_structure", type_key: "class", version: 1 },
  observation_schema: { namespace: "thatcampus.attendance", schema_key: "attendance.status_observed", version: 1 },
  capability_manifest: { namespace: "thatcampus.attendance", capability_key: "attendance", version: 1 },
};

class Connection implements DatabaseConnection {
  constructor(private readonly row: Record<string, unknown>) {}
  executeQuery<R>(query: CompiledQuery): Promise<QueryResult<R>> {
    expect(query.sql).toContain("realm_model_contract_activations");
    expect(query.parameters).toContain(realmId);
    return Promise.resolve({ rows: [this.row] as R[] });
  }
  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    await Promise.resolve();
    yield { rows: [] };
  }
}

class OneQueryDriver implements Driver {
  constructor(private readonly row: Record<string, unknown>) {}
  init() { return Promise.resolve(); }
  acquireConnection() { return Promise.resolve(new Connection(this.row)); }
  beginTransaction() { return Promise.resolve(); }
  commitTransaction() { return Promise.resolve(); }
  rollbackTransaction() { return Promise.resolve(); }
  releaseConnection() { return Promise.resolve(); }
  destroy() { return Promise.resolve(); }
}

function database(row: Record<string, unknown>) {
  return new Kysely<Database>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new OneQueryDriver(row),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
}

describe("realm model contract registry", () => {
  it("makes reviewed definitions immutable and stores exact contract identities", () => {
    expect(migration).toContain("CREATE TABLE realm_model_contract_activations");
    expect(migration).toContain("contract_key varchar(241) NOT NULL");
    expect(migration).toContain("realm_model_contract_activation_guard");
    expect(migration).toContain("publish a new version");
    expect(migration).toContain("protocol_schema_definition_id");
    expect(migration).toContain("capability_manifest_version");
  });

  it("resolves only a realm-activated observation contract set", async () => {
    const db = database({
      subject_definition_id: subjectId,
      context_definition_id: contextId,
      protocol_definition_id: protocolId,
      capability_manifest_id: capabilityId,
    });
    const service = new CampusModelCoreService(db as unknown as DatabaseService);
    try {
      const resolved = await db.transaction().execute((transaction) => service.resolveObservationContracts(
        transaction,
        { realm_id: realmId, environment_namespace_id: "live:school-1", environment_kind: "live" },
        refs,
      ));
      expect(resolved).toMatchObject({
        subject_type: { id: subjectId, type_key: "student", version: 1 },
        context_type: { id: contextId, type_key: "class", version: 1 },
        observation_schema: { id: protocolId, schema_key: "attendance.status_observed", version: 1 },
        capability_manifest: { id: capabilityId, capability_key: "attendance", version: 1 },
      });
    } finally {
      await db.destroy();
    }
  });

  it("fails closed when the realm has not activated every required contract", async () => {
    const db = database({
      subject_definition_id: subjectId,
      context_definition_id: contextId,
      protocol_definition_id: null,
      capability_manifest_id: capabilityId,
    });
    const service = new CampusModelCoreService(db as unknown as DatabaseService);
    try {
      await expect(db.transaction().execute((transaction) => service.resolveObservationContracts(
        transaction,
        { realm_id: realmId, environment_namespace_id: "live:school-1", environment_kind: "live" },
        refs,
      ))).rejects.toThrow("not activated for this operational realm");
    } finally {
      await db.destroy();
    }
  });
});
