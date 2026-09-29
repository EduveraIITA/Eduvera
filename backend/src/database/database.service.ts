import { Injectable, OnApplicationShutdown } from "@nestjs/common";
import { Kysely, PostgresDialect } from "kysely";
import { Pool, types as pgTypes } from "pg";
import { config } from "../config.js";
import type { Database } from "./types.js";

@Injectable()
export class DatabaseService extends Kysely<Database> implements OnApplicationShutdown {
  private readonly pool: Pool;

  constructor() {
    const settings = config();
    // PostgreSQL DATE is a calendar value, not an instant. Keep it as YYYY-MM-DD
    // so timezone conversion cannot move attendance and leave dates by one day.
    pgTypes.setTypeParser(1082, (value) => value);
    const pool = new Pool({
      connectionString: settings.DATABASE_URL,
      max: settings.DATABASE_POOL_MAX,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      application_name: "omnischool_node_api",
    });
    super({ dialect: new PostgresDialect({ pool }) });
    this.pool = pool;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.destroy();
  }

  async ping(): Promise<void> {
    await this.pool.query("SELECT 1");
  }
}
