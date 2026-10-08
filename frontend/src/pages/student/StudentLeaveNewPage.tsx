import { useId, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  FileText,
  HeartPulse,
  History,
  HomeIcon,
  Plane,
  Save,
  Trash2,
  Upload,
  UsersRound,
  Workflow,
} from "lucide-react";

import { StudentShell, type StudentRouteMap } from "./StudentShell";
import "./student-pages.css";

export type LeaveCategory = "medical" | "family" | "travel" | "urgent";

export interface StudentLeaveDraft {
  category: LeaveCategory;
  startDate: string;
  endDate: string;
  reason: string;
  attachment: File | null;
}

export interface StudentLeaveNewPageProps {
  context?: {
    studentName: string;
    className: string;
    termLabel: string;
    categories: Array<{ value: LeaveCategory; label: string }>;
    guardian?: { name: string; relationship: string };
    maxDurationDays: number;
    medicalDocumentAfterDays: number | null;
    acceptedDocumentTypes: string[];
    maxDocumentSizeBytes: number;
  };
  initialDraft?: Partial<StudentLeaveDraft>;
  routes?: Partial<StudentRouteMap>;
  onBack?: () => void;
  onOpenStatus?: () => void;
  onSubmit?: (draft: StudentLeaveDraft) => void | Promise<void>;
  onSaveDraft?: (draft: StudentLeaveDraft) => void | Promise<void>;
}

const categoryOptions: Array<{ value: LeaveCategory; label: string; hint: string; icon: typeof HeartPulse }> = [
  { value: "medical", label: "Medical / Illness", hint: "Doctor visit, rest", icon: HeartPulse },
  { value: "family", label: "Family Event", hint: "Ceremonies, rituals", icon: UsersRound },
  { value: "travel", label: "Out of Station", hint: "Travel, relocation", icon: Plane },
  { value: "urgent", label: "Urgent Work", hint: "Emergency home duty", icon: HomeIcon },
];

const suggestionText = ["Viral Fever", "Doctor Visit", "Family Travel", "Eye Checkup"];
const draftStorageKey = "omnischool.student.leave-draft";
const acceptedDocumentTypes = new Set(["application/pdf", "image/jpeg", "image/png"]);
const maxDocumentSizeBytes = 10 * 1024 * 1024;

function readStoredDraft(): Partial<StudentLeaveDraft> | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(draftStorageKey);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<StudentLeaveDraft>;
    return {
      category: categoryOptions.some((option) => option.value === parsed.category)
        ? parsed.category
        : undefined,
      startDate: typeof parsed.startDate === "string" ? parsed.startDate : undefined,
      endDate: typeof parsed.endDate === "string" ? parsed.endDate : undefined,
      reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
      attachment: null,
    };
  } catch {
    window.localStorage.removeItem(draftStorageKey);
    return undefined;
  }
}

function inclusiveDays(from: string, to: string) {
  if (!from || !to) return 0;
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1);
}

function formatLeaveDate(value: string) {
  if (!value) return "Select date";
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", weekday: "short" }).format(new Date(`${value}T00:00:00`));
}

export function StudentLeaveNewPage({
  context,
  initialDraft,
  routes,
  onBack,
  onOpenStatus,
  onSubmit,
  onSaveDraft,
}: StudentLeaveNewPageProps) {
  const navigate = useNavigate();
  const availableCategoryOptions = context?.categories.length
    ? categoryOptions
        .filter((option) => context.categories.some((category) => category.value === option.value))
        .map((option) => ({
          ...option,
          label: context.categories.find((category) => category.value === option.value)?.label ?? option.label,
        }))
    : categoryOptions;
  const [draftSeed] = useState<Partial<StudentLeaveDraft>>(() => initialDraft ?? readStoredDraft() ?? {});
  const [category, setCategory] = useState<LeaveCategory>(draftSeed.category ?? availableCategoryOptions[0]?.value ?? "medical");
  const [startDate, setStartDate] = useState(draftSeed.startDate ?? "");
  const [endDate, setEndDate] = useState(draftSeed.endDate ?? "");
  const [reason, setReason] = useState(draftSeed.reason ?? "");
  const [attachment, setAttachment] = useState<File | null>(draftSeed.attachment ?? null);
  const [attachmentLabel, setAttachmentLabel] = useState(draftSeed.attachment?.name ?? "");
  const [submitState, setSubmitState] = useState<"idle" | "loading" | "success">("idle");
  const [draftSaved, setDraftSaved] = useState(false);
  const [error, setError] = useState("");
  const fileInputId = useId();
  const duration = useMemo(() => inclusiveDays(startDate, endDate), [startDate, endDate]);
  const draft: StudentLeaveDraft = { category, startDate, endDate, reason, attachment };
  const allowedDocumentTypes = new Set(context?.acceptedDocumentTypes ?? [...acceptedDocumentTypes]);
  const documentSizeLimit = context?.maxDocumentSizeBytes ?? maxDocumentSizeBytes;
  const maxDurationDays = context?.maxDurationDays ?? 31;
  const medicalDocumentAfterDays = context ? context.medicalDocumentAfterDays : 2;
  const requiresDocument = category === "medical" && medicalDocumentAfterDays !== null && duration > medicalDocumentAfterDays;

  function addSuggestion(value: string) {
    if (reason.toLocaleLowerCase().includes(value.toLocaleLowerCase())) return;
    setReason((current) => `${current.trim()}${current.trim() ? " " : ""}${value}.`.slice(0, 300));
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null;
    if (!nextFile) return;
    if (!allowedDocumentTypes.has(nextFile.type)) {
      event.target.value = "";
      setError("Upload a PDF, JPEG, or PNG supporting document.");
      return;
    }
    if (nextFile.size > documentSizeLimit) {
      event.target.value = "";
      setError(`The supporting document must be ${Math.round(documentSizeLimit / 1024 / 1024)} MB or smaller.`);
      return;
    }
    setAttachment(nextFile);
    setAttachmentLabel(nextFile.name);
    setError("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reason.trim() || !startDate || !endDate || startDate > endDate) {
      setError("Add a valid leave period and reason before submitting.");
      return;
    }
    if (duration > maxDurationDays) {
      setError(`A single request cannot exceed ${maxDurationDays} calendar days.`);
      return;
    }
    if (requiresDocument && medicalDocumentAfterDays !== null && !attachment) {
      setError(`Add a supporting document for medical leave longer than ${medicalDocumentAfterDays} calendar days.`);
      return;
    }
    setError("");
    setSubmitState("loading");
    try {
      if (!onSubmit) throw new Error("Leave submission is unavailable.");
      await onSubmit(draft);
      window.localStorage.removeItem(draftStorageKey);
      setSubmitState("success");
    } catch {
      setError("We couldn't submit the request. Please try again.");
      setSubmitState("idle");
    }
  }

  async function saveDraft() {
    if (onSaveDraft) await onSaveDraft(draft);
    else {
      window.localStorage.setItem(draftStorageKey, JSON.stringify({
        category: draft.category,
        startDate: draft.startDate,
        endDate: draft.endDate,
        reason: draft.reason,
      }));
    }
    setDraftSaved(true);
    window.setTimeout(() => setDraftSaved(false), 2800);
  }

  return (
    <StudentShell activeNav="launcher" variant="edura" routes={routes} pageTitle="Apply leave" onBack={onBack}>
      <form className="student-page-stack leave-new-page" onSubmit={submit}>
        <button className="workspace-text-action" type="button" onClick={onOpenStatus ?? (() => navigate("/student/leave"))}><History size={16} />View requests</button>

        <section className="form-section" aria-labelledby="leave-category-heading">
          <header className="form-section__heading"><h2 id="leave-category-heading">Category</h2><span>Select primary reason</span></header>
          <div className="category-grid" role="radiogroup" aria-labelledby="leave-category-heading">
            {availableCategoryOptions.map(({ value, label, hint, icon: Icon }) => (
              <button key={value} className={category === value ? "category-option is-selected" : "category-option"} type="button" role="radio" aria-checked={category === value} onClick={() => setCategory(value)}>
                <span><Icon size={18} /></span><span><strong>{label}</strong><small>{hint}</small></span>{category === value && <i><Check size={11} /></i>}
              </button>
            ))}
          </div>
        </section>

        <section className="student-card leave-timeline" aria-labelledby="leave-timeline-heading">
          <header className="form-section__heading"><h2 id="leave-timeline-heading">Leave Timeline</h2><span>{context?.termLabel ?? "Academic term"}</span></header>
          <div className="leave-date-grid">
            <label><small>From Date</small><span><CalendarDays size={18} /><strong>{formatLeaveDate(startDate)}</strong></span><input type="date" value={startDate} onChange={(event) => { setStartDate(event.target.value); if (event.target.value > endDate) setEndDate(event.target.value); }} required /><em>Session 1 (Morning)</em></label>
            <label><small>To Date</small><span><CalendarDays size={18} /><strong>{formatLeaveDate(endDate)}</strong></span><input type="date" min={startDate} value={endDate} onChange={(event) => setEndDate(event.target.value)} required /><em>Session 2 (End of Day)</em></label>
          </div>
          <div className="duration-row"><span><Clock3 size={18} /><strong>Total Duration</strong></span><span><b>{duration} Calendar {duration === 1 ? "Day" : "Days"}</b><small>School days are confirmed during review</small></span></div>
          <div className="conflict-alert"><CheckCircle2 size={18} /><span><strong>Schedule review included</strong><small>The school verifies classes and assessments before final approval.</small></span></div>
        </section>

        <section className="student-card reason-card">
          <header className="form-section__heading"><label htmlFor="leave-reason">Detailed Reason / Symptoms</label><span>Character Count: {reason.length}/300</span></header>
          <textarea id="leave-reason" rows={3} maxLength={300} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Provide clarity for homeroom attendance records..." required />
          <small>Quick Suggestions</small>
          <div className="suggestion-row">{suggestionText.map((suggestion) => <button type="button" key={suggestion} onClick={() => addSuggestion(suggestion)}>+ {suggestion}</button>)}</div>
        </section>

        <section className="student-card attachment-card">
          <header className="form-section__heading"><h2>Supporting Document</h2>{requiresDocument && medicalDocumentAfterDays !== null && <span className="required-chip">Required for {medicalDocumentAfterDays + 1}+ Days</span>}</header>
          {attachmentLabel ? (
            <div className="attachment-file">
              <span className="attachment-file__icon"><FileText size={22} /></span>
              <span><strong>{attachmentLabel}</strong><small>{attachment ? `${(attachment.size / 1024 / 1024).toFixed(1)} MB` : "Ready"} - <em>Selected just now</em></small></span>
              <button type="button" aria-label="Remove supporting document" onClick={() => { setAttachment(null); setAttachmentLabel(""); }}><Trash2 size={18} /></button>
            </div>
          ) : null}
          <label className="soft-action upload-action" htmlFor={fileInputId}><Upload size={18} />Add Supporting Slip / Note (+ Upload)<input id={fileInputId} type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/*" onChange={onFileChange} /></label>
        </section>

        <section className="student-card approval-journey" aria-labelledby="approval-heading">
          <header><Workflow size={18} /><h2 id="approval-heading">Approval Journey</h2></header>
          <div className="approval-step"><i>1</i><span><strong>Parent Digital Verification</strong><small>{context?.guardian ? <>Sent to registered {context.guardian.relationship.toLowerCase()} <b>({context.guardian.name})</b> for consent authorization.</> : "Sent to an eligible registered guardian for consent authorization."}</small></span></div>
          <div className="approval-step"><i>2</i><span><strong>School Attendance Review</strong><small>The authorized request is forwarded to the school attendance team for a register decision.</small></span></div>
        </section>

        {error && <p className="form-message form-message--error" role="alert">{error}</p>}
        <div className="student-action-stack leave-submit-actions">
          <button className={`primary-action ${submitState === "success" ? "is-success" : ""}`} type="submit" disabled={submitState !== "idle"}>
            {submitState === "loading" ? <><span className="button-spinner" />Routing to Parent...</> : submitState === "success" ? <><Check size={19} />Sent for Digital Signature!</> : <>Submit for Parent Verification <ArrowRight size={19} /></>}
          </button>
          <button className="quiet-action" type="button" onClick={saveDraft}><Save size={16} />{draftSaved ? "Draft Saved" : "Save Application as Draft"}</button>
        </div>
      </form>
    </StudentShell>
  );
}
