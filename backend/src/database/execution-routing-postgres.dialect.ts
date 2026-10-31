import type { Dialect, Kysely } from "kysely";
import { PostgresDialect } from "kysely";
import type { Database } from "./types.js";
import type {
  ExecutionDataPlaneRegistry,
  ExecutionDataPlaneScope,
} from "./execution-data-plane.js";
import { ExecutionRoutingDriver } from "./execution-data-plane.js";

type PostgresDialectConfiguration = ConstructorParameters<typeof PostgresDialect>[0];

/** PostgreSQL compiler/adapter with request-bound Live/Simulation driver routing. */
export class ExecutionRoutingPostgresDialect implements Dialect {
  private readonly postgres: PostgresDialect;
  readonly routingDriver: ExecutionRoutingDriver;

  constructor(
    configuration: PostgresDialectConfiguration,
    scope: ExecutionDataPlaneScope,
    registry: ExecutionDataPlaneRegistry,
  ) {
    this.postgres = new PostgresDialect(configuration);
    this.routingDriver = new ExecutionRoutingDriver(
      this.postgres.createDriver(),
      scope,
      registry,
    );
  }

  createDriver() {
    return this.routingDriver;
  }

  createQueryCompiler() {
    return this.postgres.createQueryCompiler();
  }

  createAdapter() {
    return this.postgres.createAdapter();
  }

  createIntrospector(db: Kysely<unknown>) {
    return this.postgres.createIntrospector(db as Kysely<Database>);
  }
}
