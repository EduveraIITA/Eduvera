import { describe, expect, it } from "vitest";
import { schoolApiFixture } from "../../test/schoolApiFixtures";
import { adaptTimetable } from "./adapters";
import type { StudentTimetableResponse } from "./api";

function timetable() {
  return structuredClone(schoolApiFixture("/api/v1/screens/student/timetable/week/")) as StudentTimetableResponse;
}

describe("Dated timetable adaptation", () => {
  it("preserves Sunday, named rooms, and published materials", () => {
    const response = timetable();
    const day = response.days[0]!;
    day.weekday = 7;
    day.weekday_label = "Sunday";
    Object.assign(day.periods[0]!, {date:"2026-09-20",room:"Activity Studio",materials:["Graph notebook","Ruler"],day_plan_id:"plan-1"});
    const result = adaptTimetable(response)[0]!;
    expect(result).toMatchObject({key:"sun",date:20,isoDate:"2026-09-20"});
    expect(result.periods[0]).toMatchObject({room:"Activity Studio",materials:["Graph notebook","Ruler"],flag:"Updated plan"});
  });
  it("keeps numeric room labels and cancellation state", () => {
    const response = timetable();
    Object.assign(response.days[0]!.periods[0]!, {room:"204",cancelled:true});
    expect(adaptTimetable(response)[0]!.periods[0]).toMatchObject({room:"Room 204",cancelled:true,flag:"Cancelled"});
  });
});
