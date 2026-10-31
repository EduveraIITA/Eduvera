import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler,
  type CompiledQuery, type DatabaseConnection } from "kysely";
import type { AuthUser } from "../src/common/request.js";
import type { Database } from "../src/database/types.js";
import type { DatabaseService } from "../src/database/database.service.js";
import { DepartureCoordinationService } from "../src/departure-coordination/departure-coordination.service.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import { simulationSessionExecutionEnvironment } from "../src/auth/session-execution-environment.js";
import {
  collectorDutyAttentionHref,
  departurePlanAttentionHref,
  journeyAttentionHref,
} from "../src/requests/requests.service.js";
import { moduleHref } from "../src/attention/attention.service.js";

const migration = await readFile(
  new URL("../migrations/145_canonical_departure_links.sql", import.meta.url),
  "utf8",
);

describe("canonical responsibility-composed departure links", () => {
  it("routes operating and coordinating work without persona prefixes", () => {
    expect(journeyAttentionHref("trip/1"))
      .toBe("/areas/departure/manage/journeys/trip%2F1?focus=reconciliation");
    expect(collectorDutyAttentionHref("trip/1"))
      .toBe("/areas/departure/manage?section=roster&trip=trip%2F1");
    expect(departurePlanAttentionHref("plan/1", "student/1", "2026-10-18"))
      .toBe("/areas/departure/manage?section=pickup&date=2026-10-18&student=student%2F1&plan=plan%2F1");
  });

  it("keeps relationship scope exact for a linked learner", () => {
    expect(moduleHref("parent", "departure", "student/1"))
      .toBe("/areas/departure/plan?scope=dependent&student_id=student%2F1");
    expect(moduleHref("teacher", "transport"))
      .toBe("/areas/departure/operate");
    expect(moduleHref("principal", "departure"))
      .toBe("/areas/departure/manage");
  });

  it("repairs retained navigation without changing domain records", () => {
    expect(migration).toContain("UPDATE notifications");
    expect(migration).toContain("event.published_at IS NULL");
    expect(migration).toContain("UPDATE campus_model_operational_messages");
    expect(migration).toContain("/areas/departure/plan?scope=dependent");
    expect(migration).toContain("/areas/departure/operate");
    expect(migration).toContain("/areas/departure/manage");
  });
});

const schools = ["10000000-0000-4000-8000-000000000001", "10000000-0000-4000-8000-000000000002"] as const;
const learnerIds = ["20000000-0000-4000-8000-000000000001", "20000000-0000-4000-8000-000000000002"] as const;
const learner = { id: "30000000-0000-4000-8000-000000000001", role: "student", is_active: true,
  active_school_id: schools[1] } as AuthUser;

function departureReader(profileIndices = [0, 1]) {
  const queries: { query: CompiledQuery; namespace: string | undefined }[] = [];
  class Driver extends DummyDriver {
    override acquireConnection(): Promise<DatabaseConnection> {
      return Promise.resolve({ executeQuery: <R>(query: CompiledQuery) => {
        queries.push({ query, namespace: executionEnvironmentStorage.getStore()?.namespace_id });
        let rows: unknown[] = [];
        if (query.sql.includes("FROM students s JOIN school_people")) rows = profileIndices.map(index => ({
          id: learnerIds[index], school_id: schools[index], first_name: index === 0 ? "Earlier alphabetically" : "Selected institution learner",
          last_name: "", admission_number: `DEMO-${index}`, avatar_url: "", grade: null, section: null, school_name: `Campus ${index}`,
        }));
        else if (query.sql.includes("AS date FROM schools")) rows = [{ date: "2026-10-25" }];
        else if (query.sql.includes('from "departure_policies"')) rows = [{ enabled: true, enabled_modes: ["independent_departure"], change_cutoff: "13:00" }];
        else if (query.sql.includes("'external_arrangement',p.external_arrangement")) rows = [{ plan: {
          id: "40000000-0000-4000-8000-000000000001", service_date: "2026-10-28", revision: 1,
          mode: "independent_departure", state: "planned", authority_id: null, trip_id: null, stop_id: null,
          external_arrangement: "Synthetic future plan; no departure observed",
        } }];
        else if (query.sql.includes('from "school_memberships"') || query.sql.includes("FROM school_memberships membership")) rows = [{ role: "student" }];
        return Promise.resolve({ rows: rows as R[] });
      }, streamQuery: () => { throw new Error("No streaming in a scope regression"); } });
    }
  }
  const db = new Kysely<Database>({ dialect: { createDriver: () => new Driver(), createAdapter: () => new PostgresAdapter(),
    createQueryCompiler: () => new PostgresQueryCompiler(), createIntrospector: value => new PostgresIntrospector(value) } });
  return { db, queries, service: new DepartureCoordinationService(db as DatabaseService, {} as never, {} as never) };
}

describe("own departure selected-institution boundary", () => {
  // The current schema permits one students.user_id profile. A deliberately
  // overbroad reader also exercises the defensive result boundary here.
  it.each([0, 1] as const)("defensively selects only institution %i from an overbroad profile read", async index => {
    const { db, queries, service } = departureReader();
    try {
      const result = await service.family({ ...learner, active_school_id: schools[index] }, undefined, "2026-10-28", true);
      expect(result.student.id).toBe(learnerIds[index]);
      expect(result.children.map(child => child.id)).toEqual([learnerIds[index]]);
      expect(result.plan).toMatchObject({ mode: "independent_departure", state: "planned", service_date: "2026-10-28" });
      expect(result.can_request).toBe(false);
      expect(result.authorities).toEqual([]);
      const selection = queries.find(entry => entry.query.sql.includes("FROM students s JOIN school_people"))!.query;
      expect(selection.sql).toContain("WHERE s.school_id=");
      expect(selection.parameters).toContain(schools[index]);
      expect(selection.sql).toContain("THEN s.user_id=");
    } finally { await db.destroy(); }
  });

  it("does not borrow an own profile from another campus when only app membership exists in the selected campus", async () => {
    const { db, service } = departureReader([0]);
    try {
      await expect(service.family(learner, undefined, "2026-10-28", true)).rejects.toThrow(/not linked/);
      const own = await service.family({ ...learner, active_school_id: schools[0] }, undefined, "2026-10-28", true);
      expect(own.student.id).toBe(learnerIds[0]);
      expect(own.can_request).toBe(false);
    } finally { await db.destroy(); }
  });

  it("rejects missing institution and another learner without a fallback to the first profile", async () => {
    const { db, queries, service } = departureReader();
    try {
      await expect(service.family({ ...learner, active_school_id: null }, undefined, "2026-10-28", true)).rejects.toThrow(/Choose an institution/);
      expect(queries).toEqual([]);
      for (const requested of [learnerIds[0], "20000000-0000-4000-8000-000000000003"])
        await expect(service.family(learner, requested, "2026-10-28", true)).rejects.toThrow(/not linked/);
      expect(queries.every(entry => entry.query.sql.includes("FROM students s JOIN school_people"))).toBe(true);
    } finally { await db.destroy(); }
  });

  it("keeps guardian explicit learner selection separate from own-profile selection", async () => {
    const { db, service } = departureReader();
    try {
      const result = await service.family({ ...learner, role: "parent" }, learnerIds[0], "2026-10-28", false);
      expect(result.student.id).toBe(learnerIds[0]);
      expect(result.can_request).toBe(true);
    } finally { await db.destroy(); }
  });

  it("does not grant a learner management or future-plan creation", async () => {
    const { db, queries, service } = departureReader();
    try {
      await expect(service.workspace(learner, schools[1])).rejects.toThrow(/management permission is required/);
      await expect(service.createPlan(learner, schools[1], { student_id: learnerIds[1], service_date: "2026-10-28", mode: "independent_departure" }))
        .rejects.toThrow(/management permission is required/);
      expect(queries.some(entry => /^(?:begin|insert|update|delete)/i.test(entry.query.sql))).toBe(false);
      expect(queries.some(entry => entry.query.sql.includes("departure_plans"))).toBe(false);
    } finally { await db.destroy(); }
  });

  it("keeps captured own profiles in the selected Simulation namespace and rejects a mismatched campus", async () => {
    const { db, queries, service } = departureReader();
    const scenario = "50000000-0000-4000-8000-000000000001", run = "60000000-0000-4000-8000-000000000001";
    const selected = simulationSessionExecutionEnvironment({ institution_id: schools[1], scenario_id: scenario, run_id: run,
      namespace_id: `scenario:${scenario}:run:${run}`, virtual_now: "2026-10-25T10:00:00.000Z", time_zone: "Asia/Kolkata",
      source_snapshot_at: "2026-10-25T09:00:00.000Z", source_snapshot_ref: "captured-own-learner",
      expires_at: "2099-01-01T00:00:00.000Z", run_status: "running" }, { manifest_ref: "departure-self-scope", checked_at: "2026-10-25T10:00:00.000Z" });
    try {
      await executionEnvironmentStorage.run(selected.environment!, async () => {
        await expect(service.family({ ...learner, active_school_id: schools[0] }, undefined, "2026-10-28", true)).rejects.toThrow(/environment does not match/);
        expect(queries).toEqual([]);
        const result = await service.family(learner, undefined, "2026-10-28", true);
        expect(result.student.id).toBe(learnerIds[1]);
        expect(result.can_request).toBe(false);
      });
      expect(queries.length).toBeGreaterThan(0);
      expect(queries.every(entry => entry.namespace === selected.environment!.namespace_id)).toBe(true);
    } finally { await db.destroy(); }
  });
});
