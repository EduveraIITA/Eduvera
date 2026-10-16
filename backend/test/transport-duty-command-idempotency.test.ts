import { readFileSync } from "node:fs";
import { describe,expect,it } from "vitest";
import { transportDutyCommandHash } from "../src/departure-coordination/departure-coordination.service.js";

describe("transport duty command idempotency",()=>{
  it("hashes canonical material independently of object key order",()=>{
    const a=transportDutyCommandHash("respond","00000000-0000-4000-8000-000000000001",{decision:"accepted",expected_revision:1,nested:{b:2,a:1}});
    const b=transportDutyCommandHash("respond","00000000-0000-4000-8000-000000000001",{nested:{a:1,b:2},expected_revision:1,decision:"accepted"});
    expect(a).toBe(b);
  });

  it("installs actor-scoped receipts with tenant-safe references",()=>{
    const migration=readFileSync(new URL("../migrations/109_transport_duty_model_coordination.sql",import.meta.url),"utf8");
    expect(migration).toContain("CREATE TABLE transport_duty_change_commands");
    expect(migration).toContain("UNIQUE(school_id,actor_id,command_id)");
    expect(migration).toContain("REFERENCES transport_duty_swap_requests(id,school_id)");
    expect(migration).toContain("REFERENCES event_outbox(id,school_id)");
    expect(migration).toContain("REFERENCES campus_model_events(id,school_id)");
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
  });
});
