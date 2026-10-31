import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, type DatabaseConnection } from "kysely";
import { describe, expect, it } from "vitest";
import type { Database } from "../src/database/types.js";
import type { DatabaseService } from "../src/database/database.service.js";
import type { CoordinationRuntimePort } from "../src/campus-model-core/coordination-runtime.port.js";
import { SchoolEventService } from "../src/school/school-event.service.js";

describe("one authoritative attendance worker after academic cutover", () => {
  it("has no archival finalizer and excludes active contexts from archival reminders and coordination", async () => {
    const statements: string[] = [];
    class Driver extends DummyDriver {
      override acquireConnection(): Promise<DatabaseConnection> {
        return Promise.resolve({ executeQuery: <R>(query: { sql: string }) => {
          statements.push(query.sql);
          return Promise.resolve({ rows: (query.sql.includes("RETURNING lease.task_name") ? [{ task_name: "attendance_register_auto_finalize" }] : []) as R[] });
        }, streamQuery: async function* () { yield await Promise.reject(new Error("No streams")); } });
      }
    }
    const db = new Kysely<Database>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new Driver(),
      createIntrospector: value => new PostgresIntrospector(value), createQueryCompiler: () => new PostgresQueryCompiler() } });
    const events = new SchoolEventService(db as DatabaseService, undefined, {
      listOperationalMessageWork: () => Promise.resolve([]),
    } as unknown as CoordinationRuntimePort) as unknown as {
      enqueueOverdueRegisters: () => Promise<number>;
    };
    try {
      await events.enqueueOverdueRegisters();
      expect(events).not.toHaveProperty("finalizeDueAttendanceRegisters");
      const dailyReminder = statements.find(statement => statement.includes("SELECT prepared.school_id, 'attendance.register.overdue'"))!;
      const sessionReminder = statements.find(statement => statement.includes("SELECT due.school_id,'attendance.session.overdue'"))!;
      const coordination = statements.find(statement => statement.includes("outbox.id AS outbox_id,outbox.school_id"))!;
      for (const statement of [dailyReminder, sessionReminder, coordination]) {
        expect(statement).toContain("NOT EXISTS(SELECT 1 FROM activity_attendance_source_contexts migrated");
        expect(statement).toContain("migrated.state='active'");
        expect(statement).toContain("migrated.school_id=");
      }
      expect(statements.some(statement => /UPDATE\s+attendance_(?:session_)?registers\s+SET/iu.test(statement))).toBe(false);
    } finally { await db.destroy(); }
  });
});
