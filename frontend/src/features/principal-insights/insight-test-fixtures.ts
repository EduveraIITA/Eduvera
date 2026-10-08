import type { AnalyticsOverview } from "../analytics/api";
import type { PrincipalInsights } from "./api";

const counts = { present: 3, absent: 1, late: 1, half_day: 1, excused: 1, recorded: 7, denominator: 6, attended: 4.5, percentage: 75 };
export const analyticsFixture: AnalyticsOverview = {
  portal: "principal", generated_at: "2026-10-08T12:00:00Z", student: null,
  term: { id: "term", name: "Term 1", starts_on: "2026-08-01", ends_on: "2026-12-31", attendance_threshold: 85 },
  range: { period: "term", from: "2026-08-01", to: "2026-10-08", capped: false }, scope_label: "All classes",
  classes: [{ id: "class-a", name: "Class 7A" }, { id: "class-b", name: "Class 7B" }],
  institution: { as_of: "2026-10-08", enrollment_as_of: "2026-10-08", students: 51, configured_classes: 3, populated_classes: 2, average_class_size: 25.5, teaching_staff: 5, non_teaching_staff: 2, students_per_teacher: 10.2,
    classes: [{ id: "class-a", name: "Class 7A", students: 25 }, { id: "class-b", name: "Class 7B", students: 26 }, { id: "class-c", name: "Class 7C", students: 0 }] },
  registers: { expected: 40, submitted: 20, locked: 10, outstanding: 10, percentage: 75, unscheduled_classes: 0,
    classes: [{ id: "class-a", name: "Class 7A", expected: 40, submitted: 20, locked: 10, outstanding: 10, percentage: 75, latest_unsubmitted: "2026-10-07" }] },
  attendance: { ...counts, trend: [{ ...counts, date: "2026-08-01", end: "2026-08-31" }, { ...counts, percentage: null, date: "2026-09-01", end: "2026-09-30" }, { ...counts, date: "2026-10-01", end: "2026-10-08" }], classes: [{ ...counts, id: "class-a", name: "Class 7A" }],
    subjects: [{ id: "maths", name: "Mathematics", held: 12, attended: 9, excused: 2, counted: 10, percentage: 90 }] },
  assessments: { overall: { average: 80, scored: 3, other: 1, assessments: 4, distribution: [0,0,0,0,3] }, classes: [{ id: "class-a", name: "Class 7A", average: 80, scored: 3, other: 1, assessments: 4 }], subjects: [{ id: "maths", name: "Mathematics", average: 80, scored: 3, other: 1, assessments: 4 }], pipeline: [{ status: "published", count: 3 }, { status: "submitted", count: 1 }] },
};

export const reviewFixture:PrincipalInsights={
  school_id:"school-1",school_name:"Test school",generated_at:"2026-10-07T12:00:00Z",timezone:"Asia/Kolkata",operational_date:"2026-10-07",class_section_id:null,threshold:50,
  period:{start:"2026-09-10",end:"2026-10-07",baseline_start:"2026-08-13",baseline_end:"2026-09-09",days:28},classes:[{id:"class-7",name:"Class 7A"}],
  attendance:{expected:200,recorded:180,scored:180,points:162,percentage:90,completeness:90,daily:[{date:"2026-10-05",expected:100,recorded:90,scored:90,points:81,percentage:90}],classes:[{id:"class-7",name:"Class 7A",expected:200,recorded:180,scored:180,points:162,percentage:90,completeness:90}]},
  engagement:{total:1,combined:1,without_followup:1,without_followup_students:[],students:[{id:"student-1",name:"Anaya Test",class_id:"class-7",class_name:"Class 7A",expected:10,recorded:10,scored:10,points:8,previous_expected:10,previous_recorded:10,previous_scored:10,previous_points:10,missing_homework:2,open_followups:0,current:80,previous:100,change:-20,combined:true}]},
  followups:{awaiting:1,review:0,resolved:2,overdue:1,details:[{id:"followup-1",student_name:"Anaya Test",class_id:"class-7",attendance_date:"2026-10-05",state:"awaiting_response",owner:"Teacher One",overdue:true}]},
  learning:[{id:"assessment-1",title:"Fractions assessment",class_name:"Class 7A",subject:"Mathematics",assessed:20,below:6,roster:22,published_at:"2026-10-05T12:00:00Z"}],
  schedule:[{date:"2026-10-07",planned:5,unassigned:1,cancelled:0}],deadlines:[{date:"2026-10-08",class_id:"class-7",class_name:"Class 7A",homework:2,assessments:1,total:3}],
  fees:[{band:"1–30 days",due_paise:10000,paid_paise:4000,balance_paise:6000}],
};
reviewFixture.engagement.without_followup_students = reviewFixture.engagement.students.filter(student => !student.open_followups);
