import { Injectable, Logger, OnApplicationShutdown, Optional,type OnModuleInit } from "@nestjs/common";
import { Kysely } from "kysely";
import { Pool, types as pgTypes } from "pg";
import { config } from "../config.js";
import { assertSupportedPostgreSqlVersion,postgresClientConnectionConfig } from "./connection-policy.js";
import {
  ExecutionDataPlaneRegistry,
  ExecutionDataPlaneScope,
} from "./execution-data-plane.js";
import { ExecutionRoutingPostgresDialect } from "./execution-routing-postgres.dialect.js";
import type { Database } from "./types.js";
import { DatabaseQueryMetrics } from "./query-metrics.js";
import { DatabasePoolTelemetry, type DatabasePoolSnapshot } from "./pool-telemetry.js";

@Injectable()
export class DatabaseService extends Kysely<Database> implements OnApplicationShutdown,OnModuleInit {
  private readonly pool: Pool;
  private readonly queries: DatabaseQueryMetrics;
  private readonly poolTelemetry: DatabasePoolTelemetry;

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
      statement_timeout:settings.DATABASE_QUERY_TIMEOUT_MS,
      idle_in_transaction_session_timeout:settings.DATABASE_IDLE_TRANSACTION_TIMEOUT_MS,
    });
    const executionScope = scope ?? new ExecutionDataPlaneScope();
    const dataPlaneRegistry = registry ?? new ExecutionDataPlaneRegistry();
    const queries=new DatabaseQueryMetrics();
    const logger = new Logger(DatabaseService.name);
    const poolTelemetry = new DatabasePoolTelemetry(pool, {
      onAcquisitionFailure: snapshot => logger.warn({ event: "database_pool_acquisition_failed", ...snapshot }),
    });
    super({
      dialect: new ExecutionRoutingPostgresDialect(
        // Kysely's structural adapter uses Promise acquisition. The original pg
        // Pool and its Promise/callback overloads remain untouched.
        { pool: {
          connect: () => poolTelemetry.observeAcquisition(() => pool.connect()),
          end: () => pool.end(),
        } },
        executionScope,
        dataPlaneRegistry,
      ),
      log(event){queries.record(event.queryDurationMillis,event.level==='error');},
    });
    this.pool = pool;
    this.queries=queries;
    this.poolTelemetry=poolTelemetry;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.destroy();
  }

  async onModuleInit():Promise<void>{
    const result=await this.pool.query<{version:number}>("SELECT current_setting('server_version_num')::int AS version");
    assertSupportedPostgreSqlVersion(result.rows[0]!.version);
  }

  async ping(): Promise<void> {
    await this.pool.query("SELECT 1");
  }
  poolSnapshot(): DatabasePoolSnapshot { return this.poolTelemetry.snapshot(); }
  prometheusMetrics():string{return this.queries.prometheus()+this.poolTelemetry.prometheus();}
}
