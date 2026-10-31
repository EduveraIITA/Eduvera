import { PostgresDialect } from "kysely";
import { ExecutionRoutingDriver } from "./execution-data-plane.js";
/** PostgreSQL compiler/adapter with request-bound Live/Simulation driver routing. */
export class ExecutionRoutingPostgresDialect {
    postgres;
    routingDriver;
    constructor(configuration, scope, registry) {
        this.postgres = new PostgresDialect(configuration);
        this.routingDriver = new ExecutionRoutingDriver(this.postgres.createDriver(), scope, registry);
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
    createIntrospector(db) {
        return this.postgres.createIntrospector(db);
    }
}
//# sourceMappingURL=execution-routing-postgres.dialect.js.map