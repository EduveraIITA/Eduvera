import { describe,expect,it } from "vitest";
import { engagementProjection,engagementSignals,percentage,shiftDate,type AttendanceStudent } from "../src/principal-insights/insight-rules.js";
const student:AttendanceStudent={id:"a",name:"Learner",class_id:"c",class_name:"7A",expected:10,recorded:10,scored:10,points:8,previous_expected:10,previous_recorded:10,previous_scored:10,previous_points:10,missing_homework:2,open_followups:0};
describe("principal insight rules",()=>{
  it("preserves unknown denominators and fractional attendance",()=>{expect(percentage(0,0)).toBeNull();expect(percentage(2.5,4)).toBe(62.5);});
  it("requires a meaningful decline, two observed windows and adequate completeness",()=>{expect(engagementSignals([student])).toMatchObject([{change:-20,combined:true}]);for(const change of [{scored:4},{previous_scored:4},{expected:20},{previous_expected:20},{points:9.5},{previous_points:7}]) expect(engagementSignals([{...student,...change}])).toEqual([]);});
  it("does not equate one missing homework record to repeated missing work",()=>{expect(engagementSignals([{...student,missing_homework:1}])[0]?.combined).toBe(false);});
  it("keeps an exact attention target available beyond the bounded overview list",()=>{
    const signals=engagementSignals(Array.from({length:51},(_,index)=>({
      ...student,id:`student-${String(index).padStart(2,"0")}`,name:`Student ${String(index).padStart(2,"0")}`,
    })));
    const projection=engagementProjection(signals,"student-50");
    expect(projection.students).toHaveLength(50);
    expect(projection.students.some(item=>item.id==="student-50")).toBe(false);
    expect(projection.focused_student).toMatchObject({id:"student-50",change:-20});
  });
  it("handles calendar boundaries",()=>{expect(shiftDate("2026-03-01",-1)).toBe("2026-02-28");expect(shiftDate("2024-03-01",-1)).toBe("2024-02-29");});
});
