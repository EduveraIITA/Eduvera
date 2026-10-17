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
import { describe, expect, it, vi } from "vitest";
import { recordAttendanceModelObservations } from "../src/attendance/attendance-model-observation.js";
import type { ObservationIngressPort } from "../src/campus-model-core/observation-ingress.port.js";
import type { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import { SchoolEventService } from "../src/school/school-event.service.js";

const attendanceModelSource = readFileSync(new URL("../src/attendance-model/attendance-model.service.ts", import.meta.url), "utf8");
const attendanceModelModuleSource = readFileSync(new URL("../src/attendance-model/attendance-model.module.ts", import.meta.url), "utf8");
const campusModelCoreSource = readFileSync(new URL("../src/campus-model-core/campus-model-core.service.ts", import.meta.url), "utf8");

const ids = {
  school: "00000000-0000-4000-8000-000000000001",
  actor: "00000000-0000-4000-8000-000000000002",
  student: "00000000-0000-4000-8000-000000000003",
  studentUser: "00000000-0000-4000-8000-000000000004",
  guardian: "00000000-0000-4000-8000-000000000005",
  staff: "00000000-0000-4000-8000-000000000006",
  classSection: "00000000-0000-4000-8000-000000000007",
  term: "00000000-0000-4000-8000-000000000008",
  session: "00000000-0000-4000-8000-000000000009",
  source: "00000000-0000-4000-8000-000000000010",
  sourceRecord: "00000000-0000-4000-8000-000000000011",
  domainEvent: "00000000-0000-4000-8000-000000000012",
  classEvent: "00000000-0000-4000-8000-000000000013",
  registerEvent: "00000000-0000-4000-8000-000000000014",
};

type QueryHandler = (query: CompiledQuery) => QueryResult<unknown> | Promise<QueryResult<unknown>>;

class ScriptedConnection implements DatabaseConnection {
  constructor(private readonly handler: QueryHandler) {}
  async executeQuery<R>(query: CompiledQuery): Promise<QueryResult<R>> {
    return await this.handler(query) as QueryResult<R>;
  }
  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    await Promise.resolve();
    yield { rows: [] };
  }
}

class ScriptedDriver implements Driver {
  readonly connection: DatabaseConnection;
  begins = 0;
  commits = 0;
  rollbacks = 0;
  constructor(handler: QueryHandler) { this.connection = new ScriptedConnection(handler); }
  init() { return Promise.resolve(); }
  acquireConnection() { return Promise.resolve(this.connection); }
  beginTransaction() { this.begins += 1; return Promise.resolve(); }
  commitTransaction() { this.commits += 1; return Promise.resolve(); }
  rollbackTransaction() { this.rollbacks += 1; return Promise.resolve(); }
  releaseConnection() { return Promise.resolve(); }
  destroy() { return Promise.resolve(); }
}

function scriptedDatabase(handler: QueryHandler) {
  const driver = new ScriptedDriver(handler);
  const db = new Kysely<Database>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (database) => new PostgresIntrospector(database),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
  return { db, driver };
}

function observationRows(query: CompiledQuery): QueryResult<unknown> {
  if (query.sql.includes('from "students" as "student"')) {
    return { rows: [{
      id: ids.student,
      admission_number: "S-001",
      first_name: "Aarav",
      last_name: "Sharma",
      person_revision: 4,
    }] };
  }
  if (query.sql.includes('from "class_sections"')) {
    return { rows: [{ id: ids.classSection, grade: "7", section: "A", revision: 3 }] };
  }
  return { rows: [] };
}

describe("attendance Campus Model convergence", () => {
  it("records a provenance-bearing accepted session observation without a room-presence claim", async () => {
    const { db } = scriptedDatabase(observationRows);
    const recordObservations = vi.fn((_transaction, observations) => {
      expect(observations).toHaveLength(1);
      return Promise.resolve(["observation-1"]);
    });
    const ingress = { recordObservations, transitionObservations: vi.fn() } as unknown as ObservationIngressPort;
    try {
      await db.transaction().execute((transaction) => recordAttendanceModelObservations({
        ingress,
        transaction,
        schoolId: ids.school,
        classSectionId: ids.classSection,
        date: "2026-10-16",
        sessionId: ids.session,
        actorUserId: ids.actor,
        sourceType: "attendance.session",
        sourceRef: ids.source,
        state: "accepted",
        receivedAt: new Date("2026-10-16T04:01:00.000Z"),
        participationScope: "scheduled_session",
        records: [{
          studentId: ids.student,
          sourceRecordId: ids.sourceRecord,
          status: "present",
          observedAt: new Date("2026-10-16T04:00:00.000Z"),
          captureSource: "staff_roll_call",
          evidenceRefs: [`attendance_session_entry_revision:${ids.sourceRecord}`],
          domainEventId: ids.domainEvent,
          decisionProvenance: "human_attendance_decision",
        }],
      }));
      expect(recordObservations).toHaveBeenCalledWith(expect.anything(), [expect.objectContaining({
        actor_user_id: ids.actor,
        kind: "attendance.status_observed",
        source_type: "attendance.session",
        source_ref: ids.source,
        source_record_id: ids.sourceRecord,
        state: "accepted",
        domain_event_id: ids.domainEvent,
        subject: expect.objectContaining({ domain: "people", domain_id: ids.student, source_revision: 4 }),
        context: expect.objectContaining({ domain: "academic_structure", domain_id: ids.classSection, source_revision: 3 }),
        payload: {
          attendance_status: "present",
          attendance_date: "2026-10-16",
          class_section_id: ids.classSection,
          session_id: ids.session,
          participation_scope: "scheduled_session",
          evidence_scope: "attendance_participation_only",
          capture_source: "staff_roll_call",
          decision_provenance: "human_attendance_decision",
        },
      })]);
      const observation = recordObservations.mock.calls[0]![1][0]!;
      expect(observation.payload).not.toHaveProperty("room");
      expect(observation.payload).not.toHaveProperty("location");
    } finally {
      await db.destroy();
    }
  });

  it("propagates ingress failure so the owning attendance transaction rolls back", async () => {
    const { db, driver } = scriptedDatabase(observationRows);
    const ingress = {
      recordObservations: vi.fn().mockRejectedValue(new Error("model ingress unavailable")),
      transitionObservations: vi.fn(),
    } as unknown as ObservationIngressPort;
    try {
      await expect(db.transaction().execute((transaction) => recordAttendanceModelObservations({
        ingress,
        transaction,
        schoolId: ids.school,
        classSectionId: ids.classSection,
        date: "2026-10-16",
        actorUserId: ids.actor,
        sourceType: "attendance.daily",
        sourceRef: ids.source,
        state: "accepted",
        receivedAt: new Date("2026-10-16T04:01:00.000Z"),
        participationScope: "daily_class",
        records: [{
          studentId: ids.student,
          sourceRecordId: "42",
          status: "late",
          observedAt: new Date("2026-10-16T04:00:00.000Z"),
          captureSource: "staff_roll_call",
          evidenceRefs: ["attendance_record_revision:42"],
          domainEventId: ids.domainEvent,
          decisionProvenance: "human_attendance_decision",
        }],
      }))).rejects.toThrow("model ingress unavailable");
      expect(driver).toMatchObject({ begins: 1, commits: 0, rollbacks: 1 });
    } finally {
      await db.destroy();
    }
  });

  it("returns durable event IDs and includes session/cache invalidation context", async () => {
    const compiled: CompiledQuery[] = [];
    const { db } = scriptedDatabase((query) => {
      compiled.push(query);
      if (query.sql.includes("FROM students st")) return { rows: [{
        student_id: ids.student,
        student_user_id: ids.studentUser,
        student_name: "Aarav Sharma",
        guardian_user_ids: [ids.guardian],
        staff_user_ids: [ids.staff],
      }] };
      if (query.sql.includes("SELECT DISTINCT audience.user_id")) return { rows: [{ user_id: ids.studentUser }, { user_id: ids.guardian }] };
      if (query.sql.includes("SELECT DISTINCT m.user_id")) return { rows: [{ user_id: ids.staff }] };
      if (query.sql.startsWith('insert into "event_outbox"')) {
        return query.parameters.includes("attendance.updated")
          ? { rows: [
            { id: ids.domainEvent, aggregate_type: "student", aggregate_id: ids.student, idempotency_key: "student-event" },
            { id: ids.classEvent, aggregate_type: "class_section", aggregate_id: ids.classSection, idempotency_key: "class-event" },
          ] }
          : { rows: [{ id: ids.registerEvent }] };
      }
      return { rows: [] };
    });
    const events = new SchoolEventService({} as DatabaseService);
    try {
      const attendance = await events.enqueueAttendanceUpdates(db, {
        schoolId: ids.school,
        classSectionId: ids.classSection,
        termId: ids.term,
        date: "2026-10-16",
        sessionId: ids.session,
        requestId: "00000000-0000-4000-8000-000000000099",
        records: [{ student_id: ids.student, status: "present", previous_status: null, revision: 2 }],
      });
      const registerId = await events.enqueueRegisterEvent(db, {
        schoolId: ids.school,
        classSectionId: ids.classSection,
        termId: ids.term,
        date: "2026-10-16",
        sessionId: ids.session,
        requestId: "00000000-0000-4000-8000-000000000099",
        state: "submitted",
        revision: 2,
        actorId: ids.actor,
      });
      expect(attendance.studentEventIds.get(ids.student)).toBe(ids.domainEvent);
      expect(attendance.classEventId).toBe(ids.classEvent);
      expect(registerId).toBe(ids.registerEvent);
      const payloads = compiled.flatMap((query) => query.parameters)
        .filter((value): value is Record<string, unknown> => value !== null && typeof value === "object" && "refresh" in value);
      expect(payloads).toEqual(expect.arrayContaining([
        expect.objectContaining({
          student_id: ids.student,
          class_section_id: ids.classSection,
          date: "2026-10-16",
          session_id: ids.session,
          refresh: expect.arrayContaining(["attendance-model", "attendance-continuity", "campus-view", "student.home", "parent.home"]),
        }),
        expect.objectContaining({
          class_section_id: ids.classSection,
          date: "2026-10-16",
          session_id: ids.session,
          refresh: expect.arrayContaining(["attendance-model", "attendance-continuity", "campus-view"]),
        }),
      ]));
    } finally {
      await db.destroy();
    }
  });

  it("keeps Campus View activity limited to intended attendance evidence sources", () => {
    for (const sourceType of ["attendance.capture", "attendance.daily", "attendance.session", "attendance.self_check_in"]) {
      expect(campusModelCoreSource).toContain(sourceType);
    }
    expect(campusModelCoreSource).toContain("observation.source_type AS action");
    expect(campusModelCoreSource).toContain("observation.state IN ('accepted','pending')");
  });

  it("keeps scheduled attendance behind the narrow port and serializes QR writes with register lifecycle", () => {
    expect(attendanceModelModuleSource).toContain("SchoolModule");
    expect(attendanceModelModuleSource).toContain("CampusModelCoreModule");
    expect(attendanceModelSource).toContain("OBSERVATION_INGRESS_PORT");
    expect(attendanceModelSource).toContain("CAMPUS_MODEL_CORE_PORT");
    expect(attendanceModelSource).toContain('commandType: "attendance.register.submit"');
    expect(attendanceModelSource).toContain('commandType: "attendance.self_check_in.accept_automatically"');
    expect(attendanceModelSource).toContain('commandType: `attendance.evidence.${input.decision}`');
    expect(attendanceModelSource).toContain("operating_rule_version_ref");
    expect(attendanceModelSource).toContain("decision_idempotency_key");
    expect(attendanceModelModuleSource).toContain('sessions/:sessionId/evidence/:evidenceId/decision');
    expect(attendanceModelSource).toContain("attendance-session:${row.session_id}");
    expect(attendanceModelSource).toContain("this.sessionRow(db, row.session_id, true)");
    expect(attendanceModelSource).toContain('lockedSession.state === "locked"');
    expect(attendanceModelSource).toContain("attendance_session_evidence.state='accepted'");
    expect(attendanceModelSource).not.toMatch(/(?:selectFrom|insertInto|updateTable)\(["']campus_model_/);
  });
});
