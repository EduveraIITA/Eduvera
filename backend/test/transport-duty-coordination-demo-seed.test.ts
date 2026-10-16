import { describe,expect,it } from "vitest";
import { assertTransportDutyCoordinationDemoSeedAllowed } from "../src/database/seed-transport-duty-coordination.js";

describe("transport duty coordination demo seed guard",()=>{
  it("requires explicit demo opt-in and a non-production environment",()=>{
    expect(()=>assertTransportDutyCoordinationDemoSeedAllowed({demoMode:false,explicitOptIn:true,environment:"development"})).toThrow(/DEMO_MODE/);
    expect(()=>assertTransportDutyCoordinationDemoSeedAllowed({demoMode:true,explicitOptIn:false,environment:"development"})).toThrow(/SEED_TRANSPORT/);
    expect(()=>assertTransportDutyCoordinationDemoSeedAllowed({demoMode:true,explicitOptIn:true,environment:"production"})).toThrow(/limited/);
    expect(()=>assertTransportDutyCoordinationDemoSeedAllowed({demoMode:true,explicitOptIn:true,environment:"development"})).not.toThrow();
  });
});
