import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Check,
  CircleX,
  Clock3,
  FileText,
  History,
  Hourglass,
  Info,
  Pill,
  RefreshCw,
  Send,
  Stethoscope,
} from "lucide-react";

import { StudentShell, type StudentRouteMap } from "./StudentShell";
import "./student-pages.css";

export interface LeaveStatusStep {
  id: string;
  title: string;
  detail: string;
  state: "complete" | "active" | "pending";
  badge?: string;
  note?: string;
}

export interface LeaveHistoryRecord {
  id: string;
  title: string;
  dates: string;
  duration: string;
  statusDetail: string;
  status: string;
  statusLabel: string;
}

export interface StudentLeaveStatusData {
  activeCount: number;
  requestId: string | null;
  title: string;
  dates: string;
  duration: string;
  stages: LeaveStatusStep[];
  documentName?: string;
  documentUrl?: string;
  history: LeaveHistoryRecord[];
}

export interface StudentLeaveStatusPageProps {
  data?: StudentLeaveStatusData;
  routes?: Partial<StudentRouteMap>;
  onBack?: () => void;
  onApplyLeave?: () => void;
  onViewPrescription?: (documentUrl: string, requestId: string) => void;
  onWithdraw?: (requestId: string) => void | Promise<void>;
}

export const demoLeaveStatusData: StudentLeaveStatusData = {
  activeCount: 1,
  requestId: "REQ-2026-884",
  title: "Viral Fever & Recovery",
  dates: "28 Oct - 29 Oct 2026 - Full School Days",
  duration: "2 Days",
  stages: [
    { id: "submitted", title: "Submitted by Student", detail: "27 Oct, 08:30 PM", state: "complete", note: "Application generated via Edura Student Portal" },
    { id: "parent", title: "Parent Sign-Off", detail: "Pooja Sharma (Mother) - 27 Oct, 09:15 PM", state: "complete", badge: "Verified", note: "Doctor prescribed complete bed rest and viral medication for 48 hours." },
    { id: "teacher", title: "Class Teacher Review", detail: "Mrs. K. Sharma (Homeroom Advisor)", state: "active", badge: "In Review" },
    { id: "register", title: "Official Attendance Record", detail: "Auto-syncs 'Excused Medical (EM)' code to portal upon teacher approval", state: "pending" },
  ],
  history: [
    { id: "leave-dental", title: "Dental Appointment", dates: "12 Sep 2026", duration: "1 Day Excused", statusDetail: "Decision by Mrs. K. Sharma", status: "school_approved", statusLabel: "School approved" },
    { id: "leave-wedding", title: "Sister's Wedding", dates: "18 Aug - 19 Aug 2026", duration: "2 Days", statusDetail: "Decision by Mrs. K. Sharma", status: "school_approved", statusLabel: "School approved" },
  ],
};

function pipelineStage(stages: LeaveStatusStep[]) {
  if (stages.length === 0) return 0;
  const activeIndex = stages.findIndex((stage) => stage.state === "active");
  if (activeIndex >= 0) return activeIndex + 1;
  const lastCompleteIndex = stages.reduce(
    (latest, stage, index) => stage.state === "complete" ? index : latest,
    -1,
  );
  return Math.max(1, lastCompleteIndex + 1);
}

function historyTone(status: string) {
  if (status === "school_approved") return "approved";
  if (["declined", "school_rejected"].includes(status)) return "rejected";
  if (status === "withdrawn") return "withdrawn";
  return "pending";
}

function safeDocumentUrl(value?: string) {
  if (!value || typeof window === "undefined") return undefined;
  try {
    const url = new URL(value, window.location.origin);
    return ["http:", "https:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function StudentLeaveStatusPage({
  data = demoLeaveStatusData,
  routes,
  onBack,
  onApplyLeave,
  onViewPrescription,
  onWithdraw,
}: StudentLeaveStatusPageProps) {
  const navigate = useNavigate();
  const [toast, setToast] = useState("");
  const [confirmingWithdraw, setConfirmingWithdraw] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState("");
  const currentPipelineStage = pipelineStage(data.stages);
  const documentUrl = useMemo(() => safeDocumentUrl(data.documentUrl), [data.documentUrl]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  async function withdrawRequest() {
    if (!data.requestId || !onWithdraw) return;
    setWithdrawError("");
    setWithdrawing(true);
    try {
      await onWithdraw(data.requestId);
      setConfirmingWithdraw(false);
      setToast("Leave request withdrawn. Your parent has been notified.");
    } catch (error) {
      setWithdrawError(error instanceof Error && error.message.trim()
        ? error.message
        : "We couldn't withdraw this request. Please try again.");
    } finally {
      setWithdrawing(false);
    }
  }

  return (
    <StudentShell activeNav="attendance" variant="edura" routes={routes} pageTitle="Leave Tracker" onBack={onBack}>
      <div className="student-page-stack leave-status-page">
        <div className="page-context-row">
          <span className="title-with-badge"><b>{data.activeCount} Active</b></span>
          <button className="square-soft-button" type="button" aria-label="Leave policy information" onClick={() => navigate("/student/attendance/eligibility")}><Info size={20} /></button>
        </div>

        <div className="segmented-control" role="tablist" aria-label="Leave tracker views">
          <button type="button" role="tab" aria-selected="false" onClick={onApplyLeave ?? (() => navigate("/student/leave/new"))}><Send size={16} />Apply Leave</button>
          <button className="is-active" type="button" role="tab" aria-selected="true"><History size={16} />Status &amp; Log {data.activeCount > 0 ? <i /> : null}</button>
        </div>

        {data.requestId ? (
          <section className="active-request" aria-labelledby="active-request-heading">
            <header><h2 id="active-request-heading">{data.activeCount > 1 ? "Latest Active Request" : "Active Request in Progress"}</h2><span>{data.requestId}</span></header>
            <div className="student-card active-request__card">
              <div className="request-summary">
                <span><Pill size={22} /></span>
                <div><span><h3>{data.title}</h3><b>{data.duration}</b></span><p>{data.dates}</p></div>
              </div>
              <div className="verification-pipeline">
                <header><span>Verification Pipeline</span><strong>Stage {currentPipelineStage} of {data.stages.length}</strong></header>
                <ol>
                  {data.stages.map((stage) => (
                    <li className={`pipeline-step pipeline-step--${stage.state}`} key={stage.id}>
                      <span className="pipeline-step__marker">{stage.state === "complete" ? <Check size={14} /> : stage.state === "active" ? <Hourglass size={14} /> : <RefreshCw size={14} />}</span>
                      <div><span><strong>{stage.title}</strong>{stage.badge && <b>{stage.badge}</b>}</span><p>{stage.detail}</p>{stage.note && <em>{stage.note}</em>}</div>
                    </li>
                  ))}
                </ol>
              </div>
              <div className="request-actions">
                {documentUrl ? (
                  <button type="button" onClick={() => {
                    if (onViewPrescription) onViewPrescription(documentUrl, data.requestId!);
                    else window.open(documentUrl, "_blank", "noopener,noreferrer");
                    setToast(`Opening ${data.documentName ?? "supporting document"}`);
                  }}><FileText size={18} />View Supporting Document</button>
                ) : null}
                {onWithdraw && <button className="danger-text" type="button" onClick={() => { setWithdrawError(""); setConfirmingWithdraw(true); }}><CircleX size={18} />Withdraw</button>}
              </div>
              {confirmingWithdraw && (
                <div className="inline-confirm" role="alertdialog" aria-labelledby="withdraw-title">
                  <div><strong id="withdraw-title">Withdraw this request?</strong><p>This will stop the current review and notify your parent.</p>{withdrawError && <p className="inline-confirm__error" role="alert">{withdrawError}</p>}</div>
                  <span><button type="button" onClick={() => setConfirmingWithdraw(false)}>Keep request</button><button type="button" disabled={withdrawing} onClick={withdrawRequest}>{withdrawing ? "Withdrawing..." : "Withdraw"}</button></span>
                </div>
              )}
            </div>
          </section>
        ) : (
          <section className="student-empty-state student-card"><Check size={22} /><div><strong>No active leave requests</strong><p>New requests and school decisions will appear here.</p></div></section>
        )}

        <section className="leave-history" aria-labelledby="leave-history-heading">
          <header><span><History size={19} /><h2 id="leave-history-heading">Past Excusal Ledger</h2></span><strong>{data.history.length} Records in Term 1</strong></header>
          <div className="student-card leave-history__list">
            {data.history.length === 0 ? (
              <div className="student-empty-state"><History size={20} /><div><strong>No past requests</strong><p>Your completed leave requests will appear here.</p></div></div>
            ) : data.history.map((record, index) => {
              const tone = historyTone(record.status);
              return (
              <article key={record.id}>
                <span className="history-icon">{index === 0 ? <Stethoscope size={19} /> : <Clock3 size={19} />}</span>
                <div><h3>{record.title}</h3><p>{record.dates} - {record.duration}</p></div>
                <span className={`history-status history-status--${tone}`}><b>{tone === "approved" ? <Check size={12} /> : tone === "pending" ? <Hourglass size={12} /> : <CircleX size={12} />}{record.statusLabel}</b><small>{record.statusDetail}</small></span>
              </article>
              );
            })}
          </div>
        </section>
      </div>
      {toast && <div className="student-toast" role="status"><Send size={18} /><span>{toast}</span></div>}
    </StudentShell>
  );
}
