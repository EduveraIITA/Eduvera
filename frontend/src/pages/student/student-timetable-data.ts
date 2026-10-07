export type SchoolDayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export type TimetableTone = "math" | "science" | "english" | "language" | "humanities" | "lab" | "activity" | "neutral";

export interface TimetablePeriod {
  cancelled?:boolean; materials?:string[];
  id: string;
  period: string;
  time: string;
  endTime?: string;
  subject: string;
  teacher?: string;
  room?: string;
  detail?: string;
  flag?: string;
  tone: TimetableTone;
}

export interface TimetableDay {
  isoDate?:string;
  key: SchoolDayKey;
  shortLabel: string;
  longLabel: string;
  date: number;
  meta: string;
  periods: TimetablePeriod[];
}

export const demoTimetableDays: TimetableDay[] = [
  {
    key: "mon",
    shortLabel: "MON",
    longLabel: "Monday",
    date: 14,
    meta: "7 Periods",
    periods: [
      { id: "mon-1", period: "P1", time: "08:30 AM", subject: "Mathematics", room: "Room 204", tone: "math" },
      { id: "mon-2", period: "P2", time: "09:15 AM", subject: "General Science", room: "Lab B", tone: "science" },
      { id: "mon-3", period: "P3", time: "10:15 AM", subject: "English Lang", room: "Room 204", tone: "english" },
      { id: "mon-4", period: "P4", time: "11:30 AM", subject: "Hindi Sahitya", room: "Room 204", tone: "language" },
      { id: "mon-5", period: "P5", time: "12:15 PM", subject: "Social Studies", room: "Room 204", tone: "humanities" },
      { id: "mon-6", period: "P6", time: "01:00 PM", subject: "Sanskrit / French", room: "Room 208", tone: "language" },
    ],
  },
  {
    key: "tue",
    shortLabel: "TUE",
    longLabel: "Tuesday",
    date: 15,
    meta: "7 Periods",
    periods: [
      { id: "tue-1", period: "P1", time: "08:30 AM", subject: "Biology Theory", room: "Room 204", tone: "science" },
      { id: "tue-2", period: "P2", time: "09:15 AM", subject: "Mathematics", room: "Room 204", tone: "math" },
      { id: "tue-3", period: "P3", time: "10:15 AM", subject: "Geography", room: "Room 204", tone: "humanities" },
      { id: "tue-4", period: "P4", time: "11:30 AM", subject: "Computer Science", room: "IT Lab 1", tone: "lab" },
      { id: "tue-5", period: "P5", time: "12:15 PM", subject: "English Lit", room: "Room 204", tone: "english" },
      { id: "tue-6", period: "P6-7", time: "01:00 PM", subject: "Art & Craft Workshop", room: "Art Studio", tone: "activity" },
    ],
  },
  {
    key: "wed",
    shortLabel: "WED",
    longLabel: "Wednesday",
    date: 16,
    meta: "Active Today",
    periods: [
      { id: "wed-1", period: "P1", time: "08:30 AM", endTime: "09:15 AM", subject: "English Literature", teacher: "Mrs. Catherine Roy", room: "Room 204", detail: "Ch. 4: The Merchant of Venice, Act I", tone: "english" },
      { id: "wed-2", period: "P2", time: "09:15 AM", endTime: "10:00 AM", subject: "Hindi Vyakaran", teacher: "Mr. S. Shastri", room: "Room 204", detail: "Sandhi & Samas worksheet checked", tone: "language" },
      { id: "wed-3", period: "P3", time: "10:15 AM", endTime: "11:00 AM", subject: "Mathematics", teacher: "Prof. Rajesh Mehta", room: "Room 204", detail: "Ongoing: Linear Equations Practice", tone: "math" },
      { id: "wed-4", period: "P4", time: "11:30 AM", endTime: "12:15 PM", subject: "Physics Practicum", teacher: "Dr. Ananya Sen", room: "Science Lab C (Ground Floor)", flag: "Mandatory: Wear White Lab Coat & Carry Manual", tone: "lab" },
      { id: "wed-5", period: "P5", time: "12:15 PM", endTime: "01:00 PM", subject: "Social Science (History)", teacher: "Mr. Nair", room: "Room 204", detail: "The Delhi Sultanate Map Marking", tone: "humanities" },
      { id: "wed-6", period: "P6", time: "01:00 PM", endTime: "01:45 PM", subject: "Computer Science", teacher: "Mrs. Verma", room: "IT Lab 1", detail: "Submit Lab Exercise #4 via School Portal", tone: "lab" },
      { id: "wed-7", period: "P7", time: "01:45 PM", endTime: "02:30 PM", subject: "Games & Physical Education", teacher: "Coach Rawat", room: "Main Sports Field / Turf", flag: "Change into Blue House PE Uniform", tone: "activity" },
    ],
  },
  {
    key: "thu",
    shortLabel: "THU",
    longLabel: "Thursday",
    date: 17,
    meta: "7 Periods",
    periods: [
      { id: "thu-1", period: "P1", time: "08:30 AM", subject: "Chemistry Lab", room: "Chemistry Lab A", tone: "lab" },
      { id: "thu-2", period: "P2", time: "09:15 AM", subject: "Mathematics", room: "Room 204", tone: "math" },
      { id: "thu-3", period: "P3", time: "10:15 AM", subject: "English Prose", room: "Room 204", tone: "english" },
      { id: "thu-4", period: "P4", time: "11:30 AM", subject: "Hindi Writing", room: "Room 204", tone: "language" },
      { id: "thu-5", period: "P5", time: "12:15 PM", subject: "Civics & Polity", room: "Room 204", tone: "humanities" },
      { id: "thu-6", period: "P6", time: "01:00 PM", subject: "Music / Choir", room: "Auditorium", tone: "activity" },
    ],
  },
  {
    key: "fri",
    shortLabel: "FRI",
    longLabel: "Friday",
    date: 18,
    meta: "House Assembly",
    periods: [
      { id: "fri-0", period: "P0", time: "08:00 AM", subject: "Assembly & Yoga", room: "Main Amphitheatre", tone: "activity" },
      { id: "fri-1", period: "P1", time: "08:45 AM", subject: "Mathematics", room: "Room 204", tone: "math" },
      { id: "fri-2", period: "P2", time: "09:30 AM", subject: "Science Quiz", room: "Lab A", tone: "science" },
      { id: "fri-3", period: "P3", time: "10:15 AM", subject: "Library Reading", room: "Central Library", tone: "english" },
      { id: "fri-4", period: "P4", time: "11:30 AM", subject: "Hindi Kavitayein", room: "Room 204", tone: "language" },
      { id: "fri-5", period: "P5-6", time: "12:15 PM", subject: "House Tournaments", room: "Indoor Sports Arena", tone: "activity" },
    ],
  },
  {
    key: "sat",
    shortLabel: "SAT",
    longLabel: "Saturday",
    date: 19,
    meta: "Half Day",
    periods: [
      { id: "sat-1", period: "P1", time: "08:30 AM", subject: "Mathematics", room: "Room 204", tone: "math" },
      { id: "sat-2", period: "P2", time: "09:15 AM", subject: "Quiz", room: "Room 204", tone: "neutral" },
      { id: "sat-3", period: "P3", time: "10:15 AM", subject: "Debate", room: "Auditorium", tone: "english" },
      { id: "sat-4", period: "P4", time: "11:30 AM", subject: "House Activities", room: "House Rooms", tone: "activity" },
    ],
  },
];

export interface WeekGridRow {
  day: SchoolDayKey;
  label: string;
  cells: Array<{
    period?: string;
    time?: string;
    label: string;
    tone: TimetableTone;
    group: "core" | "humanities" | "lab" | "activity" | "other";
  }>;
}

export const weekGridRows: WeekGridRow[] = [
  { day: "mon", label: "Mon", cells: [{ label: "Eng", tone: "english", group: "core" }, { label: "Math", tone: "math", group: "core" }, { label: "Hin", tone: "language", group: "other" }, { label: "☕", tone: "neutral", group: "other" }, { label: "Sci", tone: "science", group: "core" }, { label: "SST", tone: "humanities", group: "humanities" }, { label: "Art", tone: "neutral", group: "other" }, { label: "Lib", tone: "neutral", group: "other" }] },
  { day: "tue", label: "Tue", cells: [{ label: "Math", tone: "math", group: "core" }, { label: "Sci Lab", tone: "lab", group: "lab" }, { label: "Eng", tone: "english", group: "core" }, { label: "☕", tone: "neutral", group: "other" }, { label: "Hin", tone: "language", group: "other" }, { label: "Skt", tone: "neutral", group: "other" }, { label: "PE", tone: "activity", group: "activity" }, { label: "SST", tone: "humanities", group: "humanities" }] },
  { day: "wed", label: "Wed", cells: [{ label: "Eng", tone: "english", group: "core" }, { label: "Hin", tone: "language", group: "other" }, { label: "Math", tone: "math", group: "core" }, { label: "☕", tone: "neutral", group: "other" }, { label: "Phy Lab", tone: "lab", group: "lab" }, { label: "SST", tone: "humanities", group: "humanities" }, { label: "CS", tone: "lab", group: "lab" }, { label: "PE", tone: "activity", group: "activity" }] },
  { day: "thu", label: "Thu", cells: [{ label: "SST", tone: "humanities", group: "humanities" }, { label: "Math", tone: "math", group: "core" }, { label: "Eng", tone: "english", group: "core" }, { label: "☕", tone: "neutral", group: "other" }, { label: "Chem Lab", tone: "lab", group: "lab" }, { label: "Hin", tone: "language", group: "other" }, { label: "Music", tone: "neutral", group: "other" }, { label: "Val.Ed", tone: "neutral", group: "other" }] },
  { day: "fri", label: "Fri", cells: [{ label: "Bio", tone: "science", group: "core" }, { label: "Math", tone: "math", group: "core" }, { label: "Eng", tone: "english", group: "core" }, { label: "☕", tone: "neutral", group: "other" }, { label: "SST", tone: "humanities", group: "humanities" }, { label: "CS", tone: "lab", group: "lab" }, { label: "Club", tone: "neutral", group: "other" }, { label: "Asmbly", tone: "neutral", group: "other" }] },
  { day: "sat", label: "Sat", cells: [{ label: "Math", tone: "math", group: "core" }, { label: "Quiz", tone: "neutral", group: "other" }, { label: "Debate", tone: "english", group: "other" }, { label: "☕", tone: "neutral", group: "other" }, { label: "House Activities", tone: "activity", group: "activity" }, { label: "House Activities", tone: "activity", group: "activity" }, { label: "House Activities", tone: "activity", group: "activity" }, { label: "House Activities", tone: "activity", group: "activity" }] },
];
