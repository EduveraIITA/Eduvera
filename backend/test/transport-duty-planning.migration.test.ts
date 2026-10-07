import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath=fileURLToPath(new URL("../migrations/044_transport_duty_planning_and_swaps.sql",import.meta.url));

describe("transport duty planning migration",()=>{
  it("models reusable schedules and dated accepted duties separately",async()=>{
    const sql=await readFile(migrationPath,"utf8");
    expect(sql).toContain("CREATE TABLE transport_service_patterns");
    expect(sql).toContain("weekdays smallint[] NOT NULL");
    expect(sql).toContain("collector_assignment_status varchar(12) NOT NULL");
    expect(sql).toContain("transport_trip_scheduled_run_unique");
    expect(sql).toContain("backup_collector_user_id");
  });

  it("keeps mutual acceptance separate from school approval",async()=>{
    const sql=await readFile(migrationPath,"utf8");
    expect(sql).toContain("CREATE TABLE transport_duty_swap_requests");
    expect(sql).toContain("request_type IN ('cover','exchange')");
    expect(sql).toContain("status IN ('submitted','accepted','rejected','approved','declined_by_school','cancelled')");
    expect(sql).toContain("decided_by uuid REFERENCES users(id)");
    expect(sql).toContain("transport_duty_swap_open_request_idx");
  });

  it("secures every new public table for server-mediated access",async()=>{
    const sql=await readFile(migrationPath,"utf8");
    expect(sql).toContain("ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("REVOKE ALL ON TABLE public.%I FROM PUBLIC");
    expect(sql).toContain("'transport_service_patterns','transport_duty_swap_requests'");
  });
});
