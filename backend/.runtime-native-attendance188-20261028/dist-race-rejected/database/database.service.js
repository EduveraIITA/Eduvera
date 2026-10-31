var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { Injectable, Optional } from "@nestjs/common";
import { Kysely } from "kysely";
import { Pool, types as pgTypes } from "pg";
import { config } from "../config.js";
import { assertSupportedPostgreSqlVersion, postgresClientConnectionConfig } from "./connection-policy.js";
import { ExecutionDataPlaneRegistry, ExecutionDataPlaneScope, } from "./execution-data-plane.js";
import { ExecutionRoutingPostgresDialect } from "./execution-routing-postgres.dialect.js";
import { DatabaseQueryMetrics } from "./query-metrics.js";
let DatabaseService = class DatabaseService extends Kysely {
    pool;
    queries;
    constructor(scope, registry) {
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
            statement_timeout: settings.DATABASE_QUERY_TIMEOUT_MS,
            idle_in_transaction_session_timeout: settings.DATABASE_IDLE_TRANSACTION_TIMEOUT_MS,
        });
        const executionScope = scope ?? new ExecutionDataPlaneScope();
        const dataPlaneRegistry = registry ?? new ExecutionDataPlaneRegistry();
        const queries = new DatabaseQueryMetrics();
        super({
            dialect: new ExecutionRoutingPostgresDialect({ pool }, executionScope, dataPlaneRegistry),
            log(event) { queries.record(event.queryDurationMillis, event.level === 'error'); },
        });
        this.pool = pool;
        this.queries = queries;
    }
    async onApplicationShutdown() {
        await this.destroy();
    }
    async onModuleInit() {
        const result = await this.pool.query("SELECT current_setting('server_version_num')::int AS version");
        assertSupportedPostgreSqlVersion(result.rows[0].version);
    }
    async ping() {
        await this.pool.query("SELECT 1");
    }
    prometheusMetrics() { return this.queries.prometheus(); }
};
DatabaseService = __decorate([
    Injectable(),
    __param(0, Optional()),
    __param(1, Optional()),
    __metadata("design:paramtypes", [ExecutionDataPlaneScope,
        ExecutionDataPlaneRegistry])
], DatabaseService);
export { DatabaseService };
//# sourceMappingURL=database.service.js.map