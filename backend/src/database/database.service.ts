import { Injectable, OnApplicationShutdown, Optional } from "@nestjs/common";
import { Kysely } from "kysely";
import { Pool, types as pgTypes } from "pg";
import { config } from "../config.js";
import { postgresClientConnectionConfig } from "./connection-policy.js";
import {
  ExecutionDataPlaneRegistry,
  ExecutionDataPlaneScope,
} from "./execution-data-plane.js";
import { ExecutionRoutingPostgresDialect } from "./execution-routing-postgres.dialect.js";
import type { Database } from "./types.js";

@Injectable()
export class DatabaseService extends Kysely<Database> implements OnApplicationShutdown {
  private readonly pool: Pool;

  constructor(
    @Optional() scope?: ExecutionDataPlaneScope,
    @Optional() registry?: ExecutionDataPlaneRegistry,
  ) {
    const settings = config();
    // PostgreSQL DATE is a calendar value, not an instant. Keep it as YYYY-MM-DD
    // so timezone conversion cannot move attendance and leave dates by one day.
    pgTypes.setTypeParser(1082, (value) => value);
    const connection = postgresClientConnectionConfig(settings.DATABASE_URL, {
      name: "DATABASE_URL",
      purpose: "application",
      requireRemoteTls: settings.DEPLOYMENT_ENVIRONMENT === "stage" || settings.DEPLOYMENT_ENVIRONMENT === "production",
    });
    const pool = new Pool({
      ...connection,
      max: settings.DATABASE_POOL_MAX,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      application_name: "omnischool_node_api",
    });
    const executionScope = scope ?? new ExecutionDataPlaneScope();
    const dataPlaneRegistry = registry ?? new ExecutionDataPlaneRegistry();
    super({
      dialect: new ExecutionRoutingPostgresDialect(
        { pool },
        executionScope,
        dataPlaneRegistry,
      ),
    });
    this.pool = pool;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.destroy();
  }

  async ping(): Promise<void> {
    await this.pool.query("SELECT 1");
  }
}
