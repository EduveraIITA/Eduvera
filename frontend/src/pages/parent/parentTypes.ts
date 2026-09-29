import type { AttendanceRankingData } from "../../features/school/AttendanceRankingDialog";

export type ParentPageAction = void | Promise<void>;

export interface ParentChildSummary {
  id: string;
  name: string;
  grade: string;
  section: string;
  board: string;
  rollNumber: string;
  avatarUrl?: string;
}

export interface ParentHomeData {
  dayPlan?:import('../../features/day-plans/DayPlanNotice').PublishedDayNotice|null;
  ranking?: AttendanceRankingData;
  homeworkItems?: Array<{ id: string; title: string; body: string; subject: string | null; dueAt: string | null; completedAt: string | null }>;
  child: ParentChildSummary;
  idCard: {
    studentName: string;
    avatarUrl?: string;
    className: string;
    rollNumber: string;
    studentId: string;
    termLabel: string;
    dateLabel: string;
    attendancePercent: number;
    attendanceRecorded?: boolean;
    attendanceThreshold: number;
  };
  sibling?: { id: string; name: string; grade: string; section: string };
  presence: { status: string; detail: string };
  pendingLeave?: {
    id: string;
    title: string;
    submittedLabel: string;
    summary: string;
    durationLabel: string;
  };
  unreadDiaryCount: number;
  diarySender: string;
  currentPeriod?: {
    number: number;
    startsAt: string;
    endsAt: string;
    remainingLabel: string;
    subject: string;
    topic: string;
    room: string;
    teacher: string;
    progressPercent: number;
  };
  nextPeriod?: { number: number; subject: string; room: string; startsAt: string };
  metrics: {
    attendance: string;
    attendanceStatus: string;
    attendanceTrend?: number | null;
    attendanceRank?: number | null;
    attendanceCohortSize?: number | null;
    threshold: string;
    periodsToday: number;
    dismissal: string;
    homeworkTasks: number;
    homeworkTotal?: number;
    homeworkRecent?: number;
    homeworkPrevious?: number;
    homeworkDetail: string;
    duesStatus: string;
    duesDetail: string;
    termLabel: string;
  };
  homeroomTeacher: {
    name: string;
    availability: string;
    phone?: string | null;
    email?: string | null;
  };
  transport: { passLabel: string; pickupWindow: string };
}

export type AttendanceCalendarStatus = "present" | "excused" | "unexcused" | "weekend" | "future" | "not_recorded";

export interface AttendanceCalendarDay {
  id: string;
  day: number;
  status: AttendanceCalendarStatus;
  ariaLabel: string;
}

export interface ParentAttendanceData {
  ranking?: AttendanceRankingData;
  child: ParentChildSummary;
  termLabel: string;
  aggregatePercent: number;
  trendPercent?: number;
  safeCushionDays: number;
  minimumPercent: number;
  stats: {
    attended: number;
    totalDays: number;
    dailyRatePercent: number;
    activeStreakDays: number;
    streakDetail: string;
    excusedCount: number;
    excusedDetail: string;
    pendingCount: number;
    pendingDetail: string;
  };
  today: {
    checkInTime: string;
    checkInLocation: string;
    checkInSource: string;
    checkInVerified: boolean;
    dismissalTime: string;
    dismissalDetail: string;
  };
  month: {
    label: string;
    summary: { present: number; excused: number; unexcused: number };
    days: AttendanceCalendarDay[];
  };
  subjects: Array<{
    id: string;
    name: string;
    percent: number;
    status: string;
    tone: "excellent" | "safe" | "good" | "warning";
  }>;
  homeroomContact?: {
    name: string;
    phone?: string | null;
    email?: string | null;
  };
}

export interface LeaveHistoryItem {
  id: string;
  title: string;
  dateLabel: string;
  durationLabel: string;
  approvedBy: string;
  kind: "medical" | "family";
}

export interface ParentLeaveData {
  child: ParentChildSummary;
  guardian: { name: string; relationship: string };
  request?: {
    id: string;
    title: string;
    submittedLabel: string;
    category: string;
    durationLabel: string;
    rangeLabel: string;
    impactedPeriods?: number;
    studentNote: string;
    document?: {
      id: string;
      name: string;
      sizeLabel: string;
      issuer?: string;
      advice?: string;
      canOpen: boolean;
    };
    initialGuardianRemark: string;
  };
  canAuthorize: boolean;
  academicYearLabel: string;
  history: LeaveHistoryItem[];
}

export interface DiaryDayOption {
  id: string;
  weekday: string;
  day: number;
  isToday?: boolean;
}

export interface ParentDiaryData {
  child: ParentChildSummary;
  termLabel: string;
  weekLabel: string;
  dateHeading: string;
  selectedDayId: string;
  days: DiaryDayOption[];
  currentPeriod?: {
    number: number;
    stateLabel: string;
    dayRangeLabel: string;
    subject: string;
    room: string;
    teacher: string;
    untilLabel: string;
  };
  packingItems: Array<{
    id: string;
    label: string;
    detail: string;
    status: "required" | "pending" | "normal";
    packed: boolean;
  }>;
  schedule: Array<{
    id: string;
    period: number;
    timeLabel: string;
    subject: string;
    location: string;
    teacher: string;
    state?: "complete" | "current";
  }>;
  diaryEntries: Array<{
    id: string;
    subject: string;
    kind: string;
    tone: "primary" | "danger" | "neutral";
    body: string;
    author: string;
    timeLabel?: string;
    verified?: boolean;
    attachmentLabel?: string;
  }>;
  guardian: { name: string; relationship: string; verifiedId: string };
  requiresAcknowledgement: boolean;
  isAcknowledged: boolean;
}
