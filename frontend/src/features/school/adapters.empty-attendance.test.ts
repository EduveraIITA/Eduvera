import {describe,it,expect} from "vitest";
import {adaptParentHome} from "./adapters";
import type {ParentHomeResponse} from "./api";
import {schoolApiFixture} from "../../test/schoolApiFixtures";
describe("Newly enrolled student presentation",()=>{
  it("does not turn missing attendance or a missing gate event into a negative fact",()=>{
    const response=structuredClone(schoolApiFixture("/api/v1/screens/parent/home/")) as ParentHomeResponse;
    response.attendance={total:0,present:0,absent:0,late:0,excused:0,half_day:0,percentage:0};response.campus_presence=null;
    const data=adaptParentHome(response);
    expect(data.idCard.attendanceRecorded).toBe(false);expect(data.metrics.attendance).toBe("N/A");expect(data.metrics.attendanceStatus).toBe("Not recorded");expect(data.presence.status).toBe("Not confirmed");
  });
});
