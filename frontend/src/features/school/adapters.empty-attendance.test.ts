import {describe,it,expect} from "vitest";
import {adaptParentHome,adaptStudentAttendance} from "./adapters";
import type {ParentHomeResponse,StudentAttendanceResponse} from "./api";
import {schoolApiFixture} from "../../test/schoolApiFixtures";
describe("Newly enrolled student presentation",()=>{
  it("does not turn missing attendance or a missing gate event into a negative fact",()=>{
    const response=structuredClone(schoolApiFixture("/api/v1/screens/parent/home/")) as ParentHomeResponse;
    response.attendance={total:0,present:0,absent:0,late:0,excused:0,half_day:0,percentage:0};response.campus_presence=null;
    const data=adaptParentHome(response);
    expect(data.idCard.attendanceRecorded).toBe(false);expect(data.metrics.attendance).toBe("N/A");expect(data.metrics.attendanceStatus).toBe("Not recorded");expect(data.presence.status).toBe("Not confirmed");
    expect(data.schedule?.[0]).toMatchObject({ subject: "Mathematics", subjectIcon: "calculator", subjectColor: "#1D4ED8" });
  });
  it('supplies structured subject buffer estimates without treating missing records as zero buffer',()=>{
    const response=structuredClone(schoolApiFixture('/api/v1/screens/student/attendance/')) as StudentAttendanceResponse;
    response.term.threshold=85;
    const subject=response.subjects[0]!;
    response.subjects=[
      {...subject,classes_attended:24,classes_held:25,percentage:96},
      {...subject,classes_attended:17,classes_held:20,percentage:85},
      {...subject,classes_attended:16,classes_held:20,percentage:80},
      {...subject,classes_attended:0,classes_held:0,percentage:0},
    ];
    expect(adaptStudentAttendance(response).subjects.map(item=>item.safeBuffer)).toEqual([3,0,0,undefined]);
  });
});
