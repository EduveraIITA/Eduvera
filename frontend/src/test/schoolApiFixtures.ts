const student = {
  id: "10000000-0000-4000-a000-000000000001",
  user: { id: "20000000-0000-4000-a000-000000000001", display_name: "Aarav Sharma" },
  admission_number: "CIS-2023-071",
  avatar_url: "/assets/aarav-sharma.png",
  current_enrollment: {
    class_name: "Class 7A",
    grade: "7",
    section: "A",
    board: "CBSE",
    room_number: "204",
    roll_number: 17,
    term: {
      name: "Term 1",
      academic_year: "2026-27",
      starts_on: "2026-04-01",
      ends_on: "2027-03-31",
    },
  },
};

const slot = {
  id: "30000000-0000-4000-a000-000000000001",
  weekday: 3,
  weekday_label: "Wednesday",
  period_number: 1,
  starts_at: "09:00:00",
  ends_at: "09:45:00",
  display_title: "Mathematics",
  room: "204",
  subject: {
    id: "40000000-0000-4000-a000-000000000001",
    code: "MAT",
    name: "Mathematics",
    short_name: "Maths",
  },
  teacher: {
    id: "50000000-0000-4000-a000-000000000001",
    name: "Kavita Mehta",
    designation: "Homeroom Advisor",
  },
};

const subjectAttendance = {
  id: "60000000-0000-4000-a000-000000000001",
  subject: { ...slot.subject, color: "#1D4ED8" },
  classes_held: 47,
  classes_attended: 45,
  classes_excused: 0,
  percentage: 95.74,
};

const leave = {
  id: "70000000-0000-4000-a000-000000000001",
  student_id: student.id,
  category: "medical",
  category_label: "Medical",
  starts_on: "2026-09-21",
  ends_on: "2026-09-22",
  duration_days: 2,
  reason: "Seasonal viral fever; the doctor advised two days of rest.",
  status: "pending_guardian",
  status_label: "Pending guardian",
  requested_by_name: "Aarav Sharma",
  submitted_at: "2026-09-10T08:30:00.000Z",
  guardian_authorized_by_name: null,
  guardian_authorized_at: null,
  decided_by_name: null,
  decided_at: null,
  documents: [],
  audit_log: [
    {
      id: "80000000-0000-4000-a000-000000000001",
      action: "submitted",
      action_label: "Submitted",
      note: "Submitted for guardian authorization.",
      actor_name: "Aarav Sharma",
      created_at: "2026-09-10T08:30:00.000Z",
    },
  ],
};

const summary = {
  total: 20,
  present: 18,
  absent: 1,
  late: 1,
  excused: 0,
  half_day: 0,
  percentage: 95,
};

const ranking = {
  published: true,
  as_of: "2026-09-16",
  cohort_size: 4,
  minimum_recorded_days: 5,
  methodology: "Daily attendance points: present or late = 1, half day = 0.5, absent or excused = 0; ranked by percentage, then attendance points and recorded days.",
  current_rank: 4,
  current_streak: 9,
  leaders: [
    { rank: 1, name: "Ananya S.", avatar_url: "/assets/ananya-iyer.png", attended: 20, held: 20, streak: 20, percentage: 100 },
    { rank: 2, name: "Kavya N.", avatar_url: "/assets/kavya-nair.png", attended: 19.5, held: 20, streak: 1, percentage: 97.5 },
    { rank: 3, name: "Rohan V.", avatar_url: "/assets/rohan-verma.png", attended: 19, held: 20, streak: 1, percentage: 95 },
  ],
  students: [
    { rank: 1, name: "Ananya S.", avatar_url: "/assets/ananya-iyer.png", attended: 20, held: 20, streak: 20, percentage: 100, is_current: false },
    { rank: 2, name: "Kavya N.", avatar_url: "/assets/kavya-nair.png", attended: 19.5, held: 20, streak: 1, percentage: 97.5, is_current: false },
    { rank: 3, name: "Rohan V.", avatar_url: "/assets/rohan-verma.png", attended: 19, held: 20, streak: 1, percentage: 95, is_current: false },
    { rank: 4, name: "Aarav Sharma", avatar_url: "/assets/aarav-sharma.png", attended: 19, held: 20, streak: 9, percentage: 95, is_current: true },
  ],
};

const contacts = [
  {
    id: "90000000-0000-4000-a000-000000000001",
    label: "Homeroom Advisor",
    name: "Kavita Mehta",
    phone: "+91 80 4567 1200",
    email: "kavita.mehta@cis.example",
    availability: "Weekdays, 3:30-4:30 PM",
  },
];

const home = {
  student,
  ranking,
  siblings: [],
  campus_presence: {
    occurred_at: "2026-09-16T02:34:00.000Z",
    direction: "in",
    gate: "North Gate",
    source: "RFID",
  },
  attendance: summary,
  action_required: leave,
  today_schedule: [slot],
  diary_preview: [],
  unread_notifications: 0,
  homework_items: Array.from({ length: 12 }, (_, index) => ({
    id: `homework-${index + 1}`,
    title: index === 0 ? "Algebra practice" : `Homework assignment ${index + 1}`,
    body: index === 0 ? "Complete exercises 1-5." : "Review classwork.",
    subject_name: "Mathematics",
    due_at: "2026-09-20T10:00:00.000Z",
    published_at: "2026-09-10T10:00:00.000Z",
    completed_at: index === 0 ? null : "2026-09-11T10:00:00.000Z",
  })),
  semester_metrics: {
    attendance_percentage: 95,
    attendance_trend_percent: 5,
    attendance_rank: 4,
    attendance_cohort_size: 32,
    periods_today: 1,
    homework_due: 1,
    homework_total: 12,
    homework_recent: 3,
    homework_previous: 4,
    dues_status: "Clear",
  },
  contacts,
};

const timetable = {
  student,
  mode: "week",
  selected_date: "2026-09-16",
  class_name: "Class 7A",
  days: [{ weekday: 3, weekday_label: "Wednesday", periods: [slot] }],
};

export function schoolApiFixture(path: string): unknown {
  if (path === "/api/v1/notifications/") return { results: [] };
  if (path === "/api/v1/students/") return { results: [student] };
  if (path.startsWith("/api/v1/screens/parent/home/")) return home;
  if (path.startsWith("/api/v1/screens/parent/attendance/")) {
    return {
      student,
      term: { name: "Term 1", academic_year: "2026-27", threshold: 85 },
      summary,
      ranking,
      today: {
        id: "a0000000-0000-4000-a000-000000000001",
        date: "2026-09-16",
        status: "present",
        check_in_at: "2026-09-16T02:35:00.000Z",
        check_out_at: null,
        remarks: "",
      },
      latest_gate_event: home.campus_presence,
      calendar: [],
      contacts,
    };
  }
  if (path.startsWith("/api/v1/students/attendance/subjects/")) return { results: [subjectAttendance] };
  if (path.startsWith("/api/v1/leave-requests/")) return { results: [leave] };
  if (path.startsWith(`/api/v1/screens/parent/leave/${leave.id}/`)) {
    return { student, request: leave, can_authorize: true };
  }
  if (path.startsWith("/api/v1/screens/parent/diary/")) {
    return {
      student,
      date: "2026-09-16",
      guardian: { name: "Pooja Sharma", relationship: "mother", verified_id: "pooja.parent" },
      items: [
        {
          id: "b0000000-0000-4000-a000-000000000001",
          date: "2026-09-16",
          item_type: "homework",
          item_type_label: "Homework",
          subject: slot.subject,
          title: "Algebra practice",
          body: "Complete exercises 6-12 and show each step.",
          author_name: "Kavita Mehta",
          due_at: "2026-09-18T12:00:00.000Z",
          requires_acknowledgement: true,
          acknowledged: false,
          published_at: "2026-09-16T09:00:00.000Z",
          notes: [],
        },
      ],
      schedule: [slot],
    };
  }
  if (path.startsWith("/api/v1/students/timetable/")) return { results: [slot] };
  if (path === "/api/v1/screens/student/home/") {
    return {
      student,
      term: { name: "Term 1", academic_year: "2026-27", threshold: 85 },
      date: "2026-09-16",
      attendance: summary,
      today_attendance: {
        id: "a0000000-0000-4000-a000-000000000001",
        date: "2026-09-16",
        status: "present",
        check_in_at: "2026-09-16T02:35:00.000Z",
        check_out_at: null,
        remarks: "",
      },
      campus_presence: home.campus_presence,
      today_schedule: [slot],
      diary_preview: [],
      active_leave_count: 1,
      unread_notifications: 0,
    };
  }
  if (path === "/api/v1/screens/student/attendance/") {
    return {
      student,
      term: { name: "Term 1", academic_year: "2026-27", threshold: 85 },
      summary,
      subjects: [subjectAttendance],
      ranking,
    };
  }
  if (path === "/api/v1/screens/student/attendance/eligibility/") {
    return {
      student,
      subject: subjectAttendance,
      projection: { additional_missed: 1, projected_percentage: 93.75, eligible: true, threshold: 85 },
      policy: { name: "CBSE attendance policy", minimum_percentage: 85, text: "Maintain 85% attendance." },
    };
  }
  if (path === "/api/v1/screens/student/leave/apply/") {
    return {
      student,
      categories: [
        { value: "medical", label: "Medical / Illness" },
        { value: "family", label: "Family Event" },
      ],
      guardians: [],
      recent_requests: [leave],
      constraints: {
        max_duration_days: 31,
        accepted_documents: ["application/pdf", "image/jpeg", "image/png"],
        max_document_size_bytes: 10 * 1024 * 1024,
      },
    };
  }
  if (path === "/api/v1/screens/student/leave/status/") return { student, active: [leave], history: [] };
  if (path.startsWith("/api/v1/screens/student/timetable/week/") || path.startsWith("/api/v1/screens/parent/timetable/week/")) return timetable;
  throw new Error(`No school API fixture for ${path}`);
}
