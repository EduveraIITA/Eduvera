import { describe,expect,it } from "vitest";
import { assertRiderTransition,assertTripTransition } from "../src/departure-coordination/journey-rules.js";
const trip={state:"in_progress",direction:"from_institution"};
describe("journey state rules",()=>{
  it("accepts explicit routine boarding, non-travel and handover without written notes",()=>{
    expect(()=>assertRiderTransition({...trip,state:"boarding"},{state:"expected",boarded_at:null},"boarded","")).not.toThrow();
    expect(()=>assertRiderTransition({...trip,state:"boarding"},{state:"expected",boarded_at:null},"not_riding","")).not.toThrow();
    expect(()=>assertRiderTransition(trip,{state:"boarded",boarded_at:new Date()},"dropped","")).not.toThrow();
    expect(()=>assertRiderTransition({...trip,direction:"to_institution"},{state:"boarded",boarded_at:new Date()},"dropped","")).not.toThrow();
  });
  it("still requires a meaningful explanation for every concern and its resolution",()=>{
    expect(()=>assertRiderTransition(trip,{state:"boarded",boarded_at:new Date()},"exception","")).toThrow(/Describe/);
    expect(()=>assertRiderTransition(trip,{state:"exception",boarded_at:new Date()},"boarded","   ")).toThrow(/Describe/);
    expect(()=>assertRiderTransition(trip,{state:"exception",boarded_at:null},"not_riding","")).toThrow(/Describe/);
  });
  it.each(["planned","completed","cancelled"])("does not record riders in %s journeys",state=>{
    expect(()=>assertRiderTransition({...trip,state},{state:"expected",boarded_at:null},"boarded","Observed boarding")).toThrow();
  });
  it.each(["dropped","not_riding"] as const)("does not silently reopen %s",state=>{
    expect(()=>assertRiderTransition(trip,{state,boarded_at:new Date()},"boarded","Retry")).toThrow(/final/);
  });
  it("allows an actually boarded exception to reach handover with evidence",()=>{
    expect(()=>assertRiderTransition(trip,{state:"exception",boarded_at:new Date()},"dropped","Verified receiver at stop")).not.toThrow();
    expect(()=>assertRiderTransition(trip,{state:"exception",boarded_at:new Date()},"dropped","")).toThrow(/Describe/);
    expect(()=>assertRiderTransition(trip,{state:"exception",boarded_at:null},"dropped","Could not find learner")).toThrow(/boarding/);
  });
  it("never converts boarded to not riding",()=>{
    expect(()=>assertRiderTransition(trip,{state:"boarded",boarded_at:new Date()},"not_riding","Correction")).toThrow(/cannot/);
  });
  it("requires boarding before departure and accounts for afternoon riders",()=>{
    expect(()=>assertTripTransition({...trip,state:"planned"},"start",[{state:"expected"}],"")).toThrow();
    expect(()=>assertTripTransition({...trip,state:"boarding"},"start",[{state:"expected"}],"")).toThrow(/Account/);
    expect(()=>assertTripTransition({state:"boarding",direction:"to_institution"},"start",[{state:"expected"}],"")).not.toThrow();
  });
  it.each(["expected","boarded","exception"])("blocks closure with %s rider",state=>{
    expect(()=>assertTripTransition(trip,"complete",[{state}],"")).toThrow(/Resolve/);
  });
  it("keeps cancellation explicit and cannot cancel an occupied vehicle",()=>{
    expect(()=>assertTripTransition({...trip,state:"boarding"},"cancel",[{state:"boarded"}],"Breakdown")).toThrow();
    expect(()=>assertTripTransition({...trip,state:"planned"},"cancel",[{state:"expected"}],"")).toThrow(/reason/);
    expect(()=>assertTripTransition({...trip,state:"planned"},"cancel",[{state:"expected"}],"Service cancelled")).not.toThrow();
  });
});
