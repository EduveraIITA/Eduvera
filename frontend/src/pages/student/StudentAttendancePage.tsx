import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Calculator,
  Check,
  ChevronDown,
  ChevronRight,
  Minus,
  Plus,
} from "lucide-react";

import { StudentShell, type StudentNavKey, type StudentRouteMap } from "./StudentShell";
import { AttendanceCopilotSheet, type AttendanceCopilotHandler } from "./AttendanceCopilotSheet";
import { AttendanceRankingDialog, type AttendanceRankingData } from "../../features/school/AttendanceRankingDialog";
import "./student-pages.css";
import '../../features/attendance/attendance-simple.css';
import './student-attendance.css';

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
  /** Estimated additional missed classes before falling below the minimum. */
  safeBuffer?: number;
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
    note: "+7 classes safe buffer",
    safeBuffer: 7,
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
    safeBuffer: 3,
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
    safeBuffer: 2,
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
    safeBuffer: 2,
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
    safeBuffer: 2,
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
    safeBuffer: 1,
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

function SubjectAttendanceRow({subject,minimum}:{subject:StudentAttendanceSubject;minimum:number}) {
  const recorded=subject.held>0;
  const warning=recorded&&subject.percent<minimum?`Below ${minimum}% minimum`:recorded&&subject.percent<minimum+5?"Near minimum":null;
  const buffer=recorded&&subject.safeBuffer!==undefined&&Number.isFinite(subject.safeBuffer)?subject.safeBuffer:undefined;
  const bufferTone=subject.percent<minimum?'is-below':buffer===0?'is-near':'is-safe';
  return <details className="student-attendance-subject">
    <summary>
      <span className="student-attendance-subject__name"><strong>{subject.name}</strong><small>{recorded?`${subject.attended} of ${subject.held} classes attended`:"No attendance recorded"}</small>{warning?<em className={subject.percent<minimum?'is-below':'is-near'}>{warning}</em>:null}</span>
      <strong className="student-attendance-subject__percent">{recorded?`${subject.percent}%`:"—"}</strong><ChevronDown size={16} aria-hidden="true"/>
    </summary>
    <div className="student-attendance-subject__details">
    <dl className="student-attendance-subject__metrics">
      {buffer!==undefined?<div className={bufferTone}><dt>Safe buffer</dt><dd><strong>{buffer}</strong> <span>{buffer===1?'class':'classes'}</span></dd></div>:null}
      <div><dt>Minimum required</dt><dd><strong>{minimum}%</strong></dd></div>
    </dl>
    {recorded&&(buffer!==undefined||subject.note)?<p className="student-attendance-planning-note">{buffer===undefined?<strong>{subject.note}</strong>:null}<small>Planning estimate only; the school's attendance policy still applies.</small></p>:null}
    <dl className="student-attendance-subject__context">
      {recorded?<div><dt>Status</dt><dd>{subject.status}</dd></div>:null}
      {subject.teacher?<div><dt>Teacher</dt><dd>{subject.teacher}</dd></div>:null}
      {subject.location?<div><dt>Room</dt><dd>{subject.location}</dd></div>:null}
      {subject.nextClass?<div><dt>Next class</dt><dd>{subject.nextClass}</dd></div>:null}
    </dl></div>
  </details>;
}

type SubjectFilter = "all" | "near" | "core" | "language" | "activity";

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
  const [params,setParams]=useSearchParams();
  const [projectedAbsences, setProjectedAbsences] = useState(1);
  const filter:SubjectFilter=(['near','core','language','activity'] as const).find(value=>value===params.get('subjects'))??'all';
  const [copilotOpen, setCopilotOpen] = useState(initialCopilotOpen);
  const [rankingOpen, setRankingOpen] = useState(false);
  const overallRecorded = data.held > 0;
  const overallTone = !overallRecorded ? 'unrecorded' : data.aggregate < data.minimumPercent ? 'below' : data.aggregate < data.minimumPercent + 5 ? 'near' : 'above';
  const overallStatus = {unrecorded:'Not recorded',below:'Below minimum',near:'Near minimum',above:'Above minimum'}[overallTone];
  const projectedTotal = data.held + projectedAbsences;
  const projected = projectedTotal > 0 ? (data.attended / projectedTotal) * 100 : 0;
  const delta = projected - data.aggregate;
  const projectionStatus = projected >= data.minimumPercent + 5
    ? "Above minimum"
    : projected >= data.minimumPercent
      ? "Near Threshold"
      : "Below Threshold";
  const attentionCount=data.subjects.filter(subject=>subject.held>0&&subject.percent<data.minimumPercent+5).length;

  const visibleSubjects = useMemo(() => {
    if (filter === "core") return data.subjects.filter((subject) => subject.group === "core");
    if (filter === "language") return data.subjects.filter((subject) => subject.group === "language");
    if (filter === "activity") return data.subjects.filter((subject) => subject.group === "activity");
    if (filter === "near") return data.subjects.filter((subject) => subject.held>0&&subject.percent < data.minimumPercent + 5);
    return data.subjects;
  }, [data.minimumPercent, data.subjects, filter]);

  return (
    <StudentShell activeNav={activeNav} routes={routes} className={data.className}>
      <div className="student-page-stack student-attendance-page">
        <section className="student-attendance-overview" aria-labelledby="overall-attendance-heading">
          <h2 id="overall-attendance-heading"><span className="sr-only">Overall attendance · </span>{data.termLabel}</h2>
          <div className="student-attendance-overview__main">
            <strong>{overallRecorded?`${data.aggregate.toFixed(1)}%`:"—"}</strong>
            <div className={`student-attendance-overview__status is-${overallTone}`}><span>{overallStatus}</span><small>{data.minimumPercent}% required</small></div>
          </div>
          <p className="student-attendance-overview__context">{overallRecorded?<><strong>{data.attended}</strong> of <strong>{data.held}</strong> days attended</>:"No attendance recorded"}</p>
          <details className="student-attendance-breakdown"><summary>Breakdown<ChevronDown size={16} aria-hidden="true"/></summary><dl>
            <div><dt>Excused</dt><dd><strong>{data.excused}</strong> recorded</dd></div>
            <div><dt>Unexcused absence</dt><dd><strong>{data.unexcused}</strong> recorded</dd></div>
            <div><dt>Half days</dt><dd><strong>{data.halfDays??0}</strong> recorded</dd></div>
            {data.streak!==undefined?<div><dt>Current streak</dt><dd><strong>{data.streak}</strong> days</dd></div>:null}
            {data.trend!==undefined?<div><dt>Trend</dt><dd><strong>{data.trend>=0?"+":""}{data.trend.toFixed(1)}%</strong></dd></div>:null}
          </dl></details>
        </section>

        <section className="student-attendance-subjects" aria-label="Subject attendance">
          <div className="attendance-queue-toolbar"><label><span className="sr-only">Filter subjects</span><select value={filter} onChange={event=>setParams(current=>{if(event.target.value==="all")current.delete("subjects");else current.set("subjects",event.target.value);return current;})}>
            <option value="all">All subjects · {data.subjects.length}</option>
            <option value="near">Needs attention · {attentionCount}</option>
            <option value="core">Core subjects</option>
            <option value="language">Languages</option>
            <option value="activity">Activities</option>
          </select></label></div>
          <div className="student-attendance-subject-list">
            {visibleSubjects.length?visibleSubjects.map(subject=><SubjectAttendanceRow key={subject.id} subject={subject} minimum={data.minimumPercent}/>):<p className="student-attendance-empty" role="status">{!data.subjects.length?"No subject attendance is available yet.":filter==="near"?"No recorded subjects are below or near the minimum.":"No subjects in this group."}</p>}
          </div>
        </section>

        <section className="student-attendance-tools" aria-label="Attendance options">
          <button type="button" onClick={onApplyMedicalExcuse??(()=>navigate("/student/leave/new"))}>Apply for leave<ChevronRight size={17} aria-hidden="true"/></button>
          <button type="button" onClick={()=>setCopilotOpen(true)}>Attendance help<ChevronRight size={17} aria-hidden="true"/></button>
          <button type="button" onClick={event=>{event.currentTarget.focus();setRankingOpen(true);}}>Class attendance<ChevronRight size={17} aria-hidden="true"/></button>

        {rankingOpen&&<AttendanceRankingDialog ranking={data.ranking} className={data.className} onClose={()=>setRankingOpen(false)}/>}

        <details className="attendance-simple-disclosure"><summary>Plan an absence<ChevronDown size={16} aria-hidden="true"/></summary>{data.held>0?<section className="student-card simulator-card" aria-labelledby="simulator-heading">
          <header className="section-heading">
            <span className="section-heading__icon"><Calculator size={18} /></span>
            <h2 id="simulator-heading">What-If Simulator</h2>
            <span className="status-chip">Interactive</span>
          </header>
          <p className="section-subcopy">An estimate from recorded attendance, not approval to miss classes.</p>
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
              <span className={`projection-status projection-status--${projectionStatus === "Above minimum" ? "safe" : projectionStatus === "Near Threshold" ? "near" : "critical"}`}><Check size={14} />{projectionStatus}</span>
            </div>
          </div>
        </section>:<p className="student-attendance-empty">An estimate needs recorded attendance first.</p>}</details>
        </section>
      </div>
      <AttendanceCopilotSheet open={copilotOpen} onClose={() => { setCopilotOpen(false); onCopilotClose?.(); }} onAsk={onAskCopilot} />
    </StudentShell>
  );
}
