import { useId, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowUp,
  CalendarDays,
  Check,
  ChevronRight,
  CloudUpload,
  FileText,
  Flame,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";

import { StudentShell, type StudentRouteMap } from "./StudentShell";
import { schoolDateToday, shiftSchoolDate } from "../../lib/schoolTime";
import { AttendanceCopilotSheet, type AttendanceCopilotHandler } from "./AttendanceCopilotSheet";
import "./student-pages.css";

export interface AbsenceDocumentPayload {
  startDate: string;
  endDate: string;
  file: File;
}

export interface StudentEligibilityData {
  studentName: string;
  className?: string;
  month?: string;
  periodLabel: string;
  subjectName: string;
  policyName: string;
  policyText: string;
  threshold: number;
  streak?: number;
  aggregate: number;
  trend?: number;
  safeLeaves: number;
  attended: number;
  missed: number;
  exempted: number;
  nextClass?: {
    name: string;
    time: string;
    startsIn: string;
    room: string;
    block: string;
    teacher: string;
  };
}

export interface StudentEligibilityPageProps {
  proFeaturesEnabled?: boolean;
  data?: StudentEligibilityData;
  routes?: Partial<StudentRouteMap>;
  onAskCopilot?: AttendanceCopilotHandler;
  onViewTimetable?: () => void;
  onSubmitDocument?: (payload: AbsenceDocumentPayload) => void | Promise<void>;
}

export const demoEligibilityData: StudentEligibilityData = {
  studentName: "Aarav",
  className: "Class 7A",
  month: "2026-09",
  periodLabel: "Sep 2026",
  subjectName: "Physics",
  policyName: "Exam eligibility policy",
  policyText: "Maintain at least 85% attendance to remain eligible for examinations.",
  threshold: 85,
  streak: 14,
  aggregate: 94.4,
  trend: 1.4,
  safeLeaves: 14,
  attended: 119,
  missed: 7,
  exempted: 2,
  nextClass: {
    name: "Computer Science & AI Lab",
    time: "03:00 PM - 04:15 PM",
    startsIn: "In 25 Min",
    room: "Turing Lab 1",
    block: "Science Block",
    teacher: "Prof. Alan Zhao",
  },
};

export function StudentEligibilityPage({
  data = demoEligibilityData,
  routes,
  onAskCopilot,
  proFeaturesEnabled = false,
  onViewTimetable,
  onSubmitDocument,
}: StudentEligibilityPageProps) {
  const navigate = useNavigate();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const attendanceQuestion = `How will 2 missed ${data.subjectName} classes affect my attendance eligibility?`;
  const [copilotQuestion, setCopilotQuestion] = useState(attendanceQuestion);
  const [startDate, setStartDate] = useState(schoolDateToday);
  const [endDate, setEndDate] = useState(() => shiftSchoolDate(1));
  const [file, setFile] = useState<File | null>(null);
  const [submitState, setSubmitState] = useState<"idle" | "loading" | "success">("idle");
  const [formError, setFormError] = useState("");
  const fileInputId = useId();
  const formErrorId = useId();
  const periodLabel = useMemo(
    () => data.month
      ? new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric" }).format(new Date(`${data.month}-01T00:00:00`))
      : data.periodLabel,
    [data.month, data.periodLabel],
  );

  function pickFile(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null;
    if (!nextFile) return;
    const acceptedTypes = new Set(["application/pdf", "image/jpeg", "image/png"]);
    const hasAcceptedExtension = /\.(pdf|jpe?g|png)$/i.test(nextFile.name);
    if ((!acceptedTypes.has(nextFile.type) && !(nextFile.type === "" && hasAcceptedExtension))) {
      event.target.value = "";
      setFile(null);
      setFormError("Upload a PDF, JPEG, or PNG supporting document.");
      return;
    }
    if (nextFile.size > 10 * 1024 * 1024) {
      event.target.value = "";
      setFile(null);
      setFormError("The supporting document must be 10 MB or smaller.");
      return;
    }
    setFile(nextFile);
    setFormError("");
  }

  async function submitDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      setFormError("Choose a supporting document before submitting.");
      return;
    }
    if (!startDate || !endDate || startDate > endDate) {
      setFormError("Choose a valid absence period before submitting.");
      return;
    }
    if (!onSubmitDocument) {
      setFormError("Document submission is not available for this account.");
      return;
    }
    setFormError("");
    setSubmitState("loading");
    try {
      await onSubmitDocument({ startDate, endDate, file });
      setSubmitState("success");
      window.setTimeout(() => {
        setSheetOpen(false);
        setSubmitState("idle");
        setFile(null);
      }, 900);
    } catch (error) {
      setFormError(error instanceof Error && error.message.trim()
        ? error.message
        : "We couldn't submit the document. Please try again.");
      setSubmitState("idle");
    }
  }

  return (
    <StudentShell activeNav="attendance" routes={routes} className={data.className}>
      <div className="student-page-stack eligibility-page">
        <section className="eligibility-greeting">
          <div className="eligibility-greeting__meta">
            <span className="streak-pill">{data.streak !== undefined ? <><Flame size={17} />{data.streak}-Day On-Time Streak</> : <><ShieldCheck size={17} />{data.subjectName} Eligibility</>}</span>
            <span className="month-picker" aria-label={`Attendance summary for ${periodLabel}`}>
              <CalendarDays size={17} />
              <span>{periodLabel}</span>
            </span>
          </div>
        </section>

        <section className="eligibility-hero" aria-labelledby="semester-health-heading">
          <div className="eligibility-hero__headline">
            <div><p className="eyebrow" id="semester-health-heading">{data.subjectName} Attendance</p><strong>{data.aggregate.toFixed(1)}%</strong>{data.trend !== undefined && <span><ArrowUp size={15} />{data.trend >= 0 ? "+" : ""}{data.trend.toFixed(1)}%</span>}</div>
            <div className="eligibility-ring"><svg viewBox="0 0 36 36" aria-hidden="true"><circle className="attendance-ring__track" cx="18" cy="18" r="15.9155" /><circle className="attendance-ring__value" cx="18" cy="18" r="15.9155" pathLength="100" strokeDasharray={`${Math.max(0, Math.min(100, data.aggregate))} 100`} /></svg><span className="attendance-ring__label"><ShieldCheck size={21} /></span></div>
          </div>
          <div className="eligibility-safe-zone">
            <ShieldCheck size={20} />
            <span><strong>{data.aggregate >= data.threshold ? "Eligible" : "Below threshold"} <em>{data.safeLeaves > 0 ? `+${data.safeLeaves} classes` : "No buffer"}</em></strong><p>{data.threshold}% minimum required</p></span>
          </div>
          <div className="eligibility-stats">
            <span><small>Attended</small><strong>{data.attended}</strong></span>
            <span><small>Missed</small><strong>{data.missed}</strong></span>
            <span><small>Exempted</small><strong>{data.exempted}</strong></span>
          </div>
        </section>

        <button className="soft-action" type="button" onClick={onViewTimetable ?? (() => navigate("/student/timetable"))}><CalendarDays size={19} />{data.nextClass ? `Next: ${data.nextClass.name} · ${data.nextClass.time}` : "View timetable"}</button>
        {data.nextClass ? <p className="workspace-context">{data.nextClass.room} · {data.nextClass.block} · {data.nextClass.teacher} · {data.nextClass.startsIn}</p> : null}
        {proFeaturesEnabled && <button className="copilot-question" type="button" onClick={() => { setCopilotQuestion(attendanceQuestion); setCopilotOpen(true); }}>
          <span><Sparkles size={18} /></span>
          <span><small>Ask about attendance</small><strong>{attendanceQuestion}</strong></span>
          <ChevronRight size={20} />
        </button>}
        <section className="medical-document-card">
          <div className="medical-document-card__copy">
            <span><FileText size={23} /></span>
            <div><h2>Absence documents</h2><p>{data.policyText || `${data.policyName} applies to submitted absence documents.`}</p></div>
          </div>
          <div className="medical-document-card__actions">
            <button className="primary-action primary-action--container" type="button" onClick={() => setSheetOpen(true)}><CloudUpload size={18} />Submit Document</button>
            {proFeaturesEnabled && <button className="secondary-action" type="button" onClick={() => { setCopilotQuestion("What documents make a medical absence excused?"); setCopilotOpen(true); }}>Policy Info</button>}
          </div>
        </section>
      </div>

      {sheetOpen && (
        <div className="student-sheet-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setSheetOpen(false)}>
          <section className="student-sheet" role="dialog" aria-modal="true" aria-labelledby="absence-sheet-title">
            <div className="student-sheet__handle" />
            <header><div><h2 id="absence-sheet-title">Submit Absence Document</h2><p>Upload doctor note or formal parent slip</p></div><button type="button" className="student-icon-button" aria-label="Close document form" onClick={() => setSheetOpen(false)}><X size={20} /></button></header>
            <form onSubmit={submitDocument}>
              <fieldset className="date-range-fields">
                <legend>Absence Period</legend>
                <label><span>From</span><input type="date" value={startDate} onChange={(event) => { setStartDate(event.target.value); setFormError(""); }} required /></label>
                <label><span>To</span><input type="date" value={endDate} min={startDate} onChange={(event) => { setEndDate(event.target.value); setFormError(""); }} required /></label>
              </fieldset>
              <label className="file-dropzone" htmlFor={fileInputId} aria-describedby={formError ? formErrorId : undefined}>
                <input id={fileInputId} type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={pickFile} aria-invalid={Boolean(formError)} />
                <span><CloudUpload size={24} /></span>
                <strong>{file ? file.name : "Tap to scan or attach file"}</strong>
                <small>{file ? `${(file.size / 1024 / 1024).toFixed(1)} MB selected` : "Supports PDF, JPG, PNG up to 10MB"}</small>
              </label>
              {formError && <p className="form-message form-message--error" id={formErrorId} role="alert">{formError}</p>}
              <button className={`primary-action primary-action--container ${submitState === "success" ? "is-success" : ""}`} type="submit" disabled={!file || !startDate || !endDate || startDate > endDate || submitState !== "idle"}>
                {submitState === "loading" ? <><span className="button-spinner" />Submitting...</> : submitState === "success" ? <><Check size={18} />Document Uploaded!</> : "Confirm & Send for Approval"}
              </button>
            </form>
          </section>
        </div>
      )}
      <AttendanceCopilotSheet
        key={copilotQuestion}
        open={proFeaturesEnabled&&copilotOpen}
        initialQuestion={copilotQuestion}
        onClose={() => setCopilotOpen(false)}
        onAsk={onAskCopilot}
      />
    </StudentShell>
  );
}
