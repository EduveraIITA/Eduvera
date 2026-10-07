import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath=fileURLToPath(new URL("../migrations/043_departure_and_transport_coordination.sql",import.meta.url));

describe("departure and transport coordination migration",()=>{
  it("keeps authority, plans, requests, execution and transport observations separate",async()=>{
    const sql=await readFile(migrationPath,"utf8");
    for(const table of ["departure_collection_authorities","departure_plans","departure_change_requests","departure_handovers","transport_trips","transport_trip_roster","transport_location_samples"]){
      expect(sql).toContain(`CREATE TABLE ${table}`);
    }
    expect(sql).toContain("CREATE UNIQUE INDEX departure_plan_current_idx");
    expect(sql).toContain("CREATE UNIQUE INDEX departure_request_open_idx");
    expect(sql).toContain("CHECK((guardian_relationship_id IS NOT NULL)::integer + (collector_person_id IS NOT NULL)::integer = 1)");
  });

  it("enforces scoped transport records and short-lived precise location storage",async()=>{
    const sql=await readFile(migrationPath,"utf8");
    expect(sql).toContain("FOREIGN KEY(school_id,student_id) REFERENCES students(school_id,id)");
    expect(sql).toContain("FOREIGN KEY(route_id,stop_id) REFERENCES transport_stops(route_id,id)");
    expect(sql).toContain("location_retention_hours integer NOT NULL DEFAULT 24");
    expect(sql).toContain("ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("REVOKE ALL ON TABLE public.%I FROM PUBLIC");
  });

  it("models frozen trips and unresolved rider states explicitly",async()=>{
    const sql=await readFile(migrationPath,"utf8");
    expect(sql).toContain("roster_frozen_at timestamptz");
    expect(sql).toContain("state IN ('expected','boarded','dropped','not_riding','exception')");
    expect(sql).toContain("CHECK(state<>'dropped' OR (boarded_at IS NOT NULL AND dropped_at IS NOT NULL))");
    expect(sql).toContain("'departure.manage','departure.collect'");
  });
});
