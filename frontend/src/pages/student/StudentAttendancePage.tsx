import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  ArrowUp,
  Bot,
  BookOpenText,
  Calculator,
  Camera,
  Check,
  ClipboardCheck,
  FileCheck2,
  Flame,
  FlaskConical,
  Medal,
  Microscope,
  Minus,
  Plus,
  ShieldCheck,
  Sigma,
  Sparkles,
  Trophy,
  UserCheck,
} from "lucide-react";

import { StudentShell, type StudentNavKey, type StudentRouteMap } from "./StudentShell";
import { AttendanceCopilotSheet, type AttendanceCopilotHandler } from "./AttendanceCopilotSheet";
import { AttendanceRankingDialog, type AttendanceRankingData } from "../../features/school/AttendanceRankingDialog";
import "./student-pages.css";
import '../../features/attendance/attendance-simple.css';

export type AttendanceSubjectGroup = "core" | "language" | "activity";

export interface StudentAttendanceSubject {
  id: string;
  name: string;
  teacher?: string;
  location?: string;
  percent: number;
  attended: number;
  held: number;
  status: string;
  note: string;
  group: AttendanceSubjectGroup;
  nextClass?: string;
}

export interface AttendanceLeader {
  rank: number;
  name: string;
  avatar_url?: string | null;
  attended: number;
  held: number;
  streak?: number;
  percent: number;
  current?: boolean;
}

function RankedAvatar({ name, avatarUrl, rank, current = false }: { name: string; avatarUrl?: string | null; rank: number; current?: boolean }) {
  const [imageFailed, setImageFailed] = useState(false);
  const fallback = name.split(/\s+/).map((part) => part[0]).filter(Boolean).join("").slice(0, 2).toUpperCase();
  const rankLabel = rank === 1 ? "1st" : rank === 2 ? "2nd" : rank === 3 ? "3rd" : `#${rank}`;
  return (
    <span className={`leader-avatar leader-avatar--rank-${Math.min(rank, 4)}${current ? " leader-avatar--current" : ""}`}>
      {avatarUrl && !imageFailed ? <img src={avatarUrl} alt="" onError={() => setImageFailed(true)} /> : fallback}
      <i aria-label={`Rank ${rank}`}>{rankLabel}</i>
    </span>
  );
}

export interface StudentAttendanceData {
  ranking?: AttendanceRankingData;
  studentName: string;
  avatarUrl?: string;
  className: string;
  rollNumber: string;
  studentId: string;
  termLabel: string;
  minimumPercent: number;
  aggregate: number;
  trend?: number;
  attended: number;
  held: number;
  halfDays?: number;
  streak?: number;
  excused: number;
  unexcused: number;
  safeBuffer: number;
  leaders?: AttendanceLeader[];
  currentRank?: number;
  rankingCohortSize?: number;
  rankingAsOf?: string;
  rankingMethodology?: string;
  honorsLabel?: string;
  idLabel?: string;
  subjects: StudentAttendanceSubject[];
}

export interface StudentAttendancePageProps {
  data?: StudentAttendanceData;
  routes?: Partial<StudentRouteMap>;
  onApplyMedicalExcuse?: () => void;
  onAskCopilot?: AttendanceCopilotHandler;
  initialCopilotOpen?: boolean;
  onCopilotClose?: () => void;
  activeNav?: StudentNavKey;
}

const demoSubjects: StudentAttendanceSubject[] = [
  {
    id: "computer-science",
    name: "Computer Science & AI Lab",
    teacher: "Prof. Alan Zhao",
    location: "Turing Lab 1",
    percent: 98,
    attended: 49,
    held: 50,
    status: "Flawless",
    note: "+4 leaves safe buffer",
    group: "core",
    nextClass: "Today at 03:00 PM",
  },
  {
    id: "mathematics",
    name: "Mathematics",
    teacher: "Prof. Mehta",
    location: "Honors Advanced",
    percent: 96,
    attended: 24,
    held: 25,
    status: "Safe Zone",
    note: "+3 leaves buffer",
    group: "core",
  },
  {
    id: "physical-education",
    name: "Physical Education",
    teacher: "Coach Daniel",
    location: "Sports Complex",
    percent: 100,
    attended: 15,
    held: 15,
    status: "Perfect Attendance 🏆",
    note: "Optimal Quota",
    group: "activity",
  },
  {
    id: "chemistry",
    name: "Chemistry Theory",
    teacher: "Mrs. Kapoor",
    location: "Lecture Hall B",
    percent: 95,
    attended: 19,
    held: 20,
    status: "Safe Zone",
    note: "+2 leaves buffer",
    group: "core",
  },
  {
    id: "physics",
    name: "Physics Laboratory",
    teacher: "Dr. Alan Vance",
    location: "Optics Lab",
    percent: 92,
    attended: 23,
    held: 25,
    status: "Good",
    note: "Need +2 for 95% mark",
    group: "core",
  },
  {
    id: "english",
    name: "English Literature",
    teacher: "Ms. Rachel Finch",
    location: "Room 204",
    percent: 90,
    attended: 18,
    held: 20,
    status: "Passing Threshold",
    note: "Min. required: 85%",
    group: "language",
  },
];

export const demoStudentAttendanceData: StudentAttendanceData = {
  studentName: "Aarav Sharma",
  avatarUrl: "/assets/aarav-sharma.png",
  className: "Class 7A",
  rollNumber: "01",
  studentId: "7041",
  termLabel: "Term 1 (Jul - Dec 2026)",
  minimumPercent: 85,
  aggregate: 94.4,
  trend: 1.4,
  attended: 119,
  held: 126,
  streak: 14,
  halfDays: 0,
  excused: 5,
  unexcused: 2,
  safeBuffer: 14,
  leaders: [
    { rank: 1, name: "Ananya Iyer", avatar_url: "/assets/ananya-iyer.png", attended: 125, held: 126, streak: 42, percent: 99.2 },
    { rank: 2, name: "Rohan Verma", avatar_url: "/assets/rohan-verma.png", attended: 124, held: 126, streak: 28, percent: 98.4 },
    { rank: 3, name: "Kavya Nair", avatar_url: "/assets/kavya-nair.png", attended: 122, held: 126, streak: 19, percent: 96.8 },
  ],
  ranking: { cohortSize: 7, students: [
    { rank: 1, name: "Ananya I.", avatarUrl: "/assets/ananya-iyer.png", attended: 125, held: 126, streak: 42, percent: 99.2, current: false },
    { rank: 2, name: "Rohan V.", avatarUrl: "/assets/rohan-verma.png", attended: 124, held: 126, streak: 28, percent: 98.4, current: false },
    { rank: 3, name: "Kavya N.", avatarUrl: "/assets/kavya-nair.png", attended: 122, held: 126, streak: 19, percent: 96.8, current: false },
    { rank: 4, name: "Aarav Sharma", avatarUrl: "/assets/aarav-sharma.png", attended: 119, held: 126, streak: 14, percent: 94.4, current: true },
    { rank: 5, name: "Ishaan M.", avatarUrl: null, attended: 118, held: 126, streak: 7, percent: 93.7, current: false },
    { rank: 6, name: "Sara K.", avatarUrl: null, attended: 116.5, held: 126, streak: 5, percent: 92.5, current: false },
    { rank: 7, name: "Vihaan R.", avatarUrl: null, attended: 115, held: 126, streak: 3, percent: 91.3, current: false },
  ] },
  currentRank: 4,
  honorsLabel: "Honors Track",
  idLabel: "CIS-ID",
  subjects: demoSubjects,
};

function SubjectGlyph({ id }: { id: string }) {
  const props = { size: 21, strokeWidth: 2 };
  if (id.includes("computer")) return <Bot {...props} />;
  if (id.includes("math")) return <Sigma {...props} />;
  if (id.includes("physical")) return <Trophy {...props} />;
  if (id.includes("chem")) return <FlaskConical {...props} />;
  if (id.includes("physics")) return <Microscope {...props} />;
  return <BookOpenText {...props} />;
}

function StatTile({ icon, label, value, tone = "blue" }: { icon: ReactNode; label: string; value: string; tone?: string }) {
  return (
    <div className={`attendance-stat attendance-stat--${tone}`}>
      <span className="attendance-stat__icon">{icon}</span>
      <span>
        <small>{label}</small>
        <strong>{value}</strong>
      </span>
    </div>
  );
}

type SubjectFilter = "all" | "near" | "core" | "language";

export function StudentAttendancePage({
  data = demoStudentAttendanceData,
  routes,
  onApplyMedicalExcuse,
  onAskCopilot,
  initialCopilotOpen = false,
  onCopilotClose,
  activeNav = "attendance",
}: StudentAttendancePageProps) {
  const navigate = useNavigate();
  const [projectedAbsences, setProjectedAbsences] = useState(1);
  const [filter, setFilter] = useState<SubjectFilter>("all");
  const [copilotOpen, setCopilotOpen] = useState(initialCopilotOpen);
  const [rankingFocusIndex, setRankingFocusIndex] = useState<number | null>(null);
  const [rankingOpen, setRankingOpen] = useState(false);
  const openRanking = (index?: number) => { setRankingFocusIndex(index ?? null); setRankingOpen(true); };
  const projectedTotal = data.held + projectedAbsences;
  const projected = projectedTotal > 0 ? (data.attended / projectedTotal) * 100 : 0;
  const delta = projected - data.aggregate;
  const projectionStatus = projected >= data.minimumPercent + 5
    ? "Safe & Eligible"
    : projected >= data.minimumPercent
      ? "Near Threshold"
      : "Below Threshold";
  const leaders = data.leaders ?? [];
  const nextRank = data.currentRank !== undefined ? leaders.find((leader) => leader.rank === data.currentRank! - 1) : undefined;
  const attendanceDaysToOvertake = nextRank && nextRank.percent < 100
    ? Math.max(1, Math.floor(((nextRank.percent / 100) * data.held - data.attended) / (1 - nextRank.percent / 100)) + 1)
    : undefined;
  const attendanceSummary = data.aggregate >= data.minimumPercent
    ? `Eligible across ${data.subjects.length} subjects`
    : "Below the attendance minimum";

  const visibleSubjects = useMemo(() => {
    if (filter === "core") return data.subjects.filter((subject) => subject.group === "core");
    if (filter === "language") return data.subjects.filter((subject) => subject.group === "language");
    if (filter === "near") return data.subjects.filter((subject) => subject.percent < data.minimumPercent + 5);
    return data.subjects;
  }, [data.minimumPercent, data.subjects, filter]);

  return (
    <StudentShell activeNav={activeNav} routes={routes} className={data.className}>
      <div className="student-page-stack attendance-page attendance-family-simple">
        <section className="attendance-hero" aria-labelledby="overall-attendance-heading">
          <h1 className="sr-only">{data.studentName}</h1>
          <div className="attendance-hero__headline">
            <div>
              <p className="eyebrow" id="overall-attendance-heading">Overall Aggregate</p>
              <button className="attendance-hero__number attendance-hero__number--open" type="button" aria-label="View all class attendance from your percentage" onClick={() => openRanking(data.ranking?.students.findIndex((item) => item.current) ?? undefined)}>
                <strong>{data.aggregate.toFixed(1)}</strong><span>%</span>
                {data.trend !== undefined && <span className="trend-pill"><ArrowUp size={12} />{data.trend >= 0 ? "+" : ""}{data.trend.toFixed(1)}%</span>}
              </button>
              <p>{attendanceSummary}</p>
            </div>
            <div className="attendance-ring">
              <svg viewBox="0 0 36 36" aria-hidden="true"><circle className="attendance-ring__track" cx="18" cy="18" r="15.9155" /><circle className="attendance-ring__value" cx="18" cy="18" r="15.9155" pathLength="100" strokeDasharray={`${Math.max(0, Math.min(100, data.aggregate))} 100`} /></svg>
              <span className="attendance-ring__label"><ShieldCheck size={24} /></span>
            </div>
          </div>

          <div className="safe-zone-panel">
            <div><ShieldCheck size={17} /><strong>Attendance Policy Cushion</strong><span>{data.safeBuffer > 0 ? `+${data.safeBuffer} Lectures` : "No buffer"}</span></div>
            <div className="safe-zone-track"><i style={{ width: `${Math.max(0, Math.min(100, data.aggregate))}%` }} /></div>
            <small><span>Min. required: {data.minimumPercent}%</span><span>Current status: {data.aggregate >= data.minimumPercent ? "Eligible" : "Below minimum"}</span></small>
          </div>

          <details className="attendance-simple-disclosure"><summary>Attendance breakdown</summary><div className="attendance-stat-grid">
            <StatTile icon={<UserCheck size={18} />} label="Attended" value={`${data.attended}/${data.held}`} tone="green" />
            {data.streak !== undefined
              ? <StatTile icon={<Flame size={18} />} label="Active Streak" value={`${data.streak} Days`} tone="amber" />
              : <StatTile icon={<Flame size={18} />} label="Half Days" value={`${data.halfDays ?? 0} Recorded`} tone="amber" />}
            <StatTile icon={<FileCheck2 size={18} />} label="Excused Leaves" value={`${data.excused} Recorded`} />
            <StatTile icon={<ClipboardCheck size={18} />} label="Unexcused" value={`${data.unexcused} Recorded`} tone="rose" />
          </div></details>
        </section>

        <section className="subject-health" aria-labelledby="subject-health-heading">
          <header className="subject-health__header">
            <h2 id="subject-health-heading">Subject attendance</h2>
          </header>
          <div className="horizontal-pills" role="tablist" aria-label="Filter subjects">
            {([
              ["all", `All Subjects (${data.subjects.length})`],
              ["near", `Near Threshold (${data.subjects.filter((subject) => subject.percent < data.minimumPercent + 5).length})`],
              ["core", "Core STEM"],
              ["language", "Languages"],
            ] as const).map(([value, label]) => (
              <button key={value} type="button" role="tab" aria-selected={filter === value} className={filter === value ? "is-active" : ""} onClick={() => setFilter(value)}>{label}</button>
            ))}
          </div>
          <div className="subject-card-list" aria-live="polite">
            {visibleSubjects.length === 0 && <div className="student-empty-state"><Check size={20} /><strong>No subjects are near the threshold.</strong></div>}
            {visibleSubjects.map((subject) => (
              <article className="student-card subject-card" key={subject.id}>
                <div className="subject-card__top">
                  <span className={`subject-icon subject-icon--${subject.percent >= 98 ? "green" : "blue"}`}><SubjectGlyph id={subject.id} /></span>
                  <span className="subject-copy"><strong>{subject.name}</strong><small>{subject.nextClass ? `Next: ${subject.nextClass}` : [subject.teacher, subject.location].filter(Boolean).join(" - ") || "Teacher and room not yet published"}</small></span>
                  <strong className={subject.percent >= 98 ? "positive" : ""}>{subject.percent}%</strong>
                </div>
                <div className="subject-progress" aria-label={`${subject.percent}% attendance`}><i style={{ width: `${subject.percent}%` }} /></div>
                <div className="subject-card__meta"><span>{subject.attended}/{subject.held} Attended - <strong>{subject.status}</strong></span><em>{subject.note}</em></div>
              </article>
            ))}
          </div>
        </section>

        <div className="student-action-stack">
          <button className="primary-action" type="button" onClick={onApplyMedicalExcuse ?? (() => navigate("/student/leave/new"))}><Camera size={19} />Apply Leave / Upload Slip</button>
          <button className="secondary-action" type="button" onClick={() => setCopilotOpen(true)}><Sparkles size={19} />Ask AI Copilot about Attendance Policy <ArrowRight size={16} /></button>
        </div>
        <details className="attendance-simple-disclosure"><summary>Class attendance</summary><section className="student-card attendance-leaderboard" aria-labelledby="leaderboard-heading">
          <header className="section-heading">
            <span className="section-heading__icon"><Medal size={18} /></span>
            <div><h2 id="leaderboard-heading"><button className="attendance-leaderboard__open" type="button" onClick={() => openRanking()}>Top Attendees - {data.className} <span aria-hidden="true">↗</span></button></h2></div>
            <span className={`status-chip ${leaders.length > 0 ? "status-chip--green" : ""}`}>{leaders.length > 0 ? data.termLabel.split(" (")[0] : "Not published"}</span>
          </header>
          <p className="section-subcopy">{leaders.length > 0 ? `Punctual attendance and active on-time streaks for ${data.className}${data.rankingAsOf ? ` - Updated ${data.rankingAsOf}` : ""}.` : "A ranking appears after at least two classmates have five recorded school days."}</p>
          <div className="leader-list">
            {leaders.map((leader) => (
              <button className="leader-row leader-row--clickable" type="button" key={leader.rank} aria-label={`View all class attendance, starting at rank ${leader.rank}`} onClick={() => openRanking(data.ranking?.students.findIndex((item) => item.rank === leader.rank) ?? undefined)}>
                <RankedAvatar name={leader.name} avatarUrl={leader.avatar_url} rank={leader.rank} />
                <span className="leader-copy"><strong>{leader.name}</strong><small>{leader.attended}/{leader.held} days{leader.streak !== undefined ? ` - ${leader.streak}d streak` : ""}</small></span>
                <strong className="leader-percent">{leader.percent.toFixed(1)}%</strong>
              </button>
            ))}
          </div>
          {data.currentRank !== undefined && <div className="current-standing">
            <div className="current-standing__label"><strong>Your Current Standing</strong><span>#{data.currentRank} in {data.className}</span><em>{data.rankingCohortSize ?? leaders.length + 1} eligible</em></div>
            <button className="leader-row leader-row--current leader-row--clickable" type="button" aria-label="View all class attendance, starting at your standing" onClick={() => openRanking(data.ranking?.students.findIndex((item) => item.current) ?? undefined)}>
              <RankedAvatar name={data.studentName} avatarUrl={data.avatarUrl} rank={data.currentRank} current />
              <span className="leader-copy"><strong>{data.studentName}</strong><small>{data.attended}/{data.held} days{data.streak !== undefined ? ` - ${data.streak}d streak` : ""}</small></span>
              <strong className="leader-percent">{data.aggregate.toFixed(1)}%</strong>
            </button>
            {nextRank ? <div className="current-standing__next"><span>Next milestone: Rank #{nextRank.rank}</span><strong>{attendanceDaysToOvertake ? `+${attendanceDaysToOvertake} consecutive days to overtake` : "Keep your attendance streak active"}</strong></div> : null}
          </div>}
          {data.rankingMethodology && leaders.length > 0 ? <p className="ranking-methodology">{data.rankingMethodology}</p> : null}
        </section></details>

        {rankingOpen && <AttendanceRankingDialog ranking={data.ranking} className={data.className} focusIndex={rankingFocusIndex !== null && rankingFocusIndex >= 0 ? rankingFocusIndex : undefined} onClose={() => setRankingOpen(false)} />}

        <details className="attendance-simple-disclosure"><summary>Plan an absence</summary><section className="student-card simulator-card" aria-labelledby="simulator-heading">
          <header className="section-heading">
            <span className="section-heading__icon"><Calculator size={18} /></span>
            <h2 id="simulator-heading">What-If Simulator</h2>
            <span className="status-chip">Interactive</span>
          </header>
          <p className="section-subcopy">Project missed lecture impacts instantly before requesting upcoming leave.</p>
          <div className="simulator-well">
            <div className="simulator-stepper-row">
              <strong>Projected Absences:</strong>
              <div className="number-stepper" role="group" aria-label="Projected absences">
                <button type="button" aria-label="Decrease projected absences" disabled={projectedAbsences === 0} onClick={() => setProjectedAbsences((value) => Math.max(0, value - 1))}><Minus size={17} /></button>
                <output aria-live="polite">{projectedAbsences}</output>
                <button type="button" aria-label="Increase projected absences" disabled={projectedAbsences === 15} onClick={() => setProjectedAbsences((value) => Math.min(15, value + 1))}><Plus size={17} /></button>
              </div>
            </div>
            <div className="projection-result">
              <span><small>Resulting Aggregate</small><strong>{projected.toFixed(1)}% <em>({delta.toFixed(1)}%)</em></strong></span>
              <span className={`projection-status projection-status--${projectionStatus === "Safe & Eligible" ? "safe" : projectionStatus === "Near Threshold" ? "near" : "critical"}`}><Check size={14} />{projectionStatus}</span>
            </div>
          </div>
        </section></details>

      </div>
      <AttendanceCopilotSheet open={copilotOpen} onClose={() => { setCopilotOpen(false); onCopilotClose?.(); }} onAsk={onAskCopilot} />
    </StudentShell>
  );
}
