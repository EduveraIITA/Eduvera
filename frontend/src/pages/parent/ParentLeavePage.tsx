import { useId, useMemo, useState, type ChangeEvent } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  Check,
  CheckCircle2,
  FileText,
  HelpCircle,
  History,
  LoaderCircle,
  PenLine,
  Stethoscope,
  Trash2,
  Upload,
  UsersRound,
} from "lucide-react";
import { fallbackLeaveData } from "./parentDemoData";
import { ParentShell } from "./ParentShell";
import type { ParentLeaveData, ParentPageAction } from "./parentTypes";
import "./parent-pages.css";

export interface ParentLeaveDraft {
  category: "medical" | "family" | "travel" | "other";
  fromDate: string;
  toDate: string;
  reason: string;
  attachment: File | null;
}

export interface ParentLeavePageProps {
  data?: ParentLeaveData;
  onSelectChild?: (childId: string) => ParentPageAction;
  onAuthorize?: (requestId: string, guardianRemark: string) => ParentPageAction;
  onRequestClarification?: (requestId: string, note: string) => ParentPageAction;
  onOpenDocument?: (documentId: string) => ParentPageAction;
  onCreateLeave?: (draft: ParentLeaveDraft) => ParentPageAction;
  leaveConstraints?: {
    maxDurationDays: number;
    medicalDocumentAfterDays: number | null;
    acceptedDocumentTypes: string[];
    maxDocumentSizeBytes: number;
  };
}

type LeaveTab = "pending" | "history" | "apply";
type SubmissionState = "idle" | "submitting" | "success" | "error";

function LeaveHistory({ data }: { data: ParentLeaveData }) {
  return (
    <section className="leave-history" aria-labelledby="leave-history-heading">
      <div className="leave-history__heading">
        <h2 id="leave-history-heading"><History size={18} />Recent leave requests</h2>
        <span>{data.academicYearLabel}</span>
      </div>
      <div className="leave-history__list">
        {data.history.length === 0 ? (
          <div className="surface-card parent-empty-state">
            <History size={22} />
            <div><strong>No past leave requests</strong><span>Completed requests will appear here.</span></div>
          </div>
        ) : data.history.map((item) => {
          const Icon = item.kind === "medical" ? Stethoscope : UsersRound;
          return (
            <article key={item.id} className="surface-card leave-history-item">
              <span className="leave-history-item__icon"><Icon size={20} /></span>
              <span className="leave-history-item__content">
                <span className="leave-history-item__title">{item.title}<small>{item.durationLabel}</small></span>
                <span>{item.dateLabel}</span>
                <strong><Check size={14} />Processed by {item.approvedBy}</strong>
              </span>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function ParentLeavePage({
  data = fallbackLeaveData,
  onSelectChild,
  onAuthorize,
  onRequestClarification,
  onOpenDocument,
  onCreateLeave,
  leaveConstraints,
}: ParentLeavePageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const tab: LeaveTab = requestedTab === "apply" || requestedTab === "history" ? requestedTab : "pending";
  const setTab = (nextTab: LeaveTab) => {
    const next = new URLSearchParams(searchParams);
    if (nextTab === "pending") next.delete("tab");
    else next.set("tab", nextTab);
    setSearchParams(next, { replace: false });
  };
  const [consent, setConsent] = useState(true);
  const request = data.request;
  const [guardianRemark, setGuardianRemark] = useState(request?.initialGuardianRemark ?? "");
  const [authorizationState, setAuthorizationState] = useState<SubmissionState>("idle");
  const [clarificationOpen, setClarificationOpen] = useState(searchParams.get("clarify") === "1");
  const [clarification, setClarification] = useState("");
  const [clarificationState, setClarificationState] = useState<SubmissionState>("idle");
  const [draft, setDraft] = useState<ParentLeaveDraft>({ category: "medical", fromDate: "", toDate: "", reason: "", attachment: null });
  const [draftState, setDraftState] = useState<SubmissionState>("idle");
  const [draftError, setDraftError] = useState("");
  const fileInputId = useId();
  const medicalDocumentAfterDays = leaveConstraints ? leaveConstraints.medicalDocumentAfterDays : 2;
  const duration = useMemo(() => {
    if (!draft.fromDate || !draft.toDate || draft.fromDate > draft.toDate) return 0;
    const start = Date.parse(`${draft.fromDate}T00:00:00Z`);
    const end = Date.parse(`${draft.toDate}T00:00:00Z`);
    return Math.round((end - start) / 86_400_000) + 1;
  }, [draft.fromDate, draft.toDate]);
  const requiresDocument = draft.category === "medical" && medicalDocumentAfterDays !== null && duration > medicalDocumentAfterDays;

  const isDraftValid = useMemo(
    () => Boolean(
      draft.fromDate &&
      draft.toDate &&
      draft.reason.trim() &&
      draft.fromDate <= draft.toDate &&
      duration <= (leaveConstraints?.maxDurationDays ?? 31) &&
      (!requiresDocument || draft.attachment),
    ),
    [draft, duration, leaveConstraints?.maxDurationDays, requiresDocument],
  );

  const authorize = async () => {
    if (!consent || !request || !data.canAuthorize) return;
    setAuthorizationState("submitting");
    try {
      await onAuthorize?.(request.id, guardianRemark.trim());
      setAuthorizationState("success");
    } catch {
      setAuthorizationState("error");
    }
  };

  const sendClarification = async () => {
    if (!clarification.trim() || !request) return;
    setClarificationState("submitting");
    try {
      await onRequestClarification?.(request.id, clarification.trim());
      setClarificationState("success");
    } catch {
      setClarificationState("error");
    }
  };

  const createLeave = async () => {
    if (!isDraftValid) return;
    setDraftError("");
    setDraftState("submitting");
    try {
      if (!onCreateLeave) throw new Error("Leave submission is unavailable for this account.");
      await onCreateLeave?.(draft);
      setDraftState("success");
    } catch (error) {
      setDraftError(error instanceof Error ? error.message : "The leave request could not be submitted.");
      setDraftState("error");
    }
  };

  const chooseAttachment = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    if (!file) return;
    const accepted = new Set(leaveConstraints?.acceptedDocumentTypes ?? ["application/pdf", "image/jpeg", "image/png"]);
    if (!accepted.has(file.type)) {
      event.target.value = "";
      setDraftError("Upload a PDF, JPEG, or PNG supporting document.");
      return;
    }
    const maxBytes = leaveConstraints?.maxDocumentSizeBytes ?? 10 * 1024 * 1024;
    if (file.size > maxBytes) {
      event.target.value = "";
      setDraftError(`The supporting document must be ${Math.round(maxBytes / 1024 / 1024)} MB or smaller.`);
      return;
    }
    setDraft((current) => ({ ...current, attachment: file }));
    setDraftError("");
  };

  return (
    <ParentShell active="leave" pageLabel="Leave" child={data.child} onSelectChild={onSelectChild}>
      <div className="parent-stack leave-page">
        <div className="leave-tabs" role="tablist" aria-label="Leave views">
          <button className={tab === "pending" ? "is-active" : ""} type="button" role="tab" aria-selected={tab === "pending"} onClick={() => setTab("pending")}>
            {request ? <span className="alert-dot" /> : null}Pending ({request ? 1 : 0})
          </button>
          <button className={tab === "history" ? "is-active" : ""} type="button" role="tab" aria-selected={tab === "history"} onClick={() => setTab("history")}>History ({data.history.length})</button>
          <button className={tab === "apply" ? "is-active" : ""} type="button" role="tab" aria-selected={tab === "apply"} onClick={() => setTab("apply")}>+ Apply leave</button>
        </div>

        {tab === "pending" && request ? (
          <>
            <p className="workspace-context">{data.canAuthorize ? "Your sign-off is needed" : "View only"} · {data.guardian.name} ({data.guardian.relationship})</p>

            <article className="surface-card leave-request-card">
              <div className="leave-request-card__intro">
                <div className="leave-request-card__status"><span>Awaiting guardian approval</span><strong>Ref {request.id.replaceAll("-", "").slice(-6).toUpperCase()}</strong></div>
                <h2>{request.title}</h2>
                <p>Class {data.child.grade.replace("Grade ", "")}{data.child.section} - Roll No. {data.child.rollNumber} - {request.submittedLabel}</p>
              </div>

              <div className="leave-request-card__body">
                <div className="leave-fact-grid">
                  <div><small>Reason</small><strong>{request.category}</strong></div>
                  <div><small>Duration</small><strong className="blue-text">{request.durationLabel}</strong></div>
                </div>
                <div className="leave-range-row">
                  <CalendarDays size={17} />
                  <div><strong>{request.rangeLabel}</strong>{request.impactedPeriods !== undefined ? <span>{request.impactedPeriods} periods may be impacted</span> : <span>School review will confirm affected periods</span>}</div>
                </div>

                <section className="leave-note-block">
                  <h2>{data.child.name.split(" ")[0]}'s Submitted Note</h2>
                  <blockquote>"{request.studentNote}"</blockquote>
                </section>

                <section className="leave-document-block">
                  <h2>Supporting Document</h2>
                  {request.document ? (
                    <div className="document-row">
                      <span className="pdf-icon"><FileText size={19} /></span>
                      <div><strong>{request.document.name}</strong><small>{request.document.sizeLabel}{request.document.issuer ? ` - ${request.document.issuer}` : ""}</small></div>
                      <button type="button" disabled={!request.document.canOpen || !onOpenDocument} onClick={() => void onOpenDocument?.(request.document!.id)}>
                        {request.document.canOpen && onOpenDocument ? "Open file" : "File unavailable"}
                      </button>
                    </div>
                  ) : (
                    <div className="document-empty"><FileText size={18} /><span><strong>No document attached</strong><small>This request was submitted without a supporting file.</small></span></div>
                  )}
                  {request.document?.advice ? <div className="doctor-advice"><Stethoscope size={17} /><p><strong>Document note:</strong> {request.document.advice}</p></div> : null}
                </section>

                <section className="authorization-panel" aria-labelledby="authorization-heading">
                  {authorizationState === "success" ? (
                    <div className="authorization-success" role="status">
                      <CheckCircle2 size={28} />
                      <strong>Authorization submitted</strong>
                      <span>Successfully forwarded to the school attendance team for review.</span>
                    </div>
                  ) : (
                    <>
                      <div className="authorization-panel__heading">
                        <h2 id="authorization-heading"><PenLine size={18} />Guardian authorization</h2>
                        <span>School review follows</span>
                      </div>
                      <label htmlFor="guardian-remark">Parent Remark to Class Teacher (Editable)</label>
                      <textarea id="guardian-remark" rows={3} value={guardianRemark} maxLength={300} onChange={(event) => setGuardianRemark(event.target.value)} />
                      <label className="consent-check" htmlFor="leave-consent">
                        <input id="leave-consent" type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
                        <span>I authorize {data.child.name}'s absence for {request.durationLabel.toLowerCase()}. On submission, this will be forwarded to the <strong>school attendance team</strong> for register review.</span>
                      </label>
                      <button className="button button--primary authorization-button" type="button" disabled={!data.canAuthorize || !consent || authorizationState === "submitting"} onClick={() => void authorize()}>
                        {authorizationState === "submitting" ? <LoaderCircle className="spin" size={18} /> : null}
                        {authorizationState === "submitting" ? "Transmitting Authorization..." : data.canAuthorize ? "Authorize & Forward to School" : "Authorization unavailable"}
                        {authorizationState !== "submitting" ? <ArrowRight size={18} /> : null}
                      </button>
                      {authorizationState === "error" ? <p className="form-error" role="alert">Authorization could not be sent. Please try again.</p> : null}
                      <button className="decline-link" type="button" aria-expanded={clarificationOpen} onClick={() => setClarificationOpen((current) => !current)}>
                        <HelpCircle size={15} />Ask Clarification
                      </button>
                      {clarificationOpen ? (
                        <div className="clarification-panel">
                          <label htmlFor="clarification-note">Clarification note</label>
                          <textarea id="clarification-note" rows={2} value={clarification} onChange={(event) => setClarification(event.target.value)} placeholder={`What should ${data.child.name.split(" ")[0] ?? "the student"} or the teacher clarify?`} />
                          <button className="button button--soft" type="button" disabled={!clarification.trim() || clarificationState === "submitting" || clarificationState === "success"} onClick={() => void sendClarification()}>
                            {clarificationState === "submitting" ? <LoaderCircle className="spin" size={16} /> : clarificationState === "success" ? <CheckCircle2 size={16} /> : null}
                            {clarificationState === "success" ? "Clarification sent" : "Send clarification"}
                          </button>
                          {clarificationState === "error" ? <p className="form-error" role="alert">The note could not be sent.</p> : null}
                        </div>
                      ) : null}
                    </>
                  )}
                </section>
              </div>
            </article>

            <LeaveHistory data={data} />
          </>
        ) : null}

        {tab === "pending" && !request ? (
          <section className="surface-card parent-empty-state parent-empty-state--large" aria-labelledby="no-pending-leave-heading">
            <CheckCircle2 size={28} />
            <div><h2 id="no-pending-leave-heading">No sign-off waiting</h2></div>
            <button className="button button--soft" type="button" onClick={() => setTab("history")}>View leave history</button>
          </section>
        ) : null}

        {tab === "history" ? <LeaveHistory data={data} /> : null}

        {tab === "apply" ? (
          <section className="surface-card parent-leave-form" aria-labelledby="parent-apply-heading">
            {draftState === "success" ? (
              <div className="authorization-success" role="status">
                <BadgeCheck size={30} />
                <strong>Leave request submitted</strong>
                <span>The school will review the request and update {data.child.name.split(" ")[0]}'s attendance.</span>
                <button className="button button--soft" type="button" onClick={() => { setDraftState("idle"); setTab("history"); }}>View status</button>
              </div>
            ) : (
              <>
                <div className="parent-leave-form__heading"><span><CalendarDays size={21} /></span><div><h2 id="parent-apply-heading">Apply leave for {data.child.name.split(" ")[0]}</h2></div></div>
                <label htmlFor="parent-leave-category">Primary reason</label>
                <select id="parent-leave-category" value={draft.category} onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value as ParentLeaveDraft["category"] }))}>
                  <option value="medical">Medical / Illness</option>
                  <option value="family">Family Event</option>
                  <option value="travel">Out of Station</option>
                  <option value="other">Urgent Work</option>
                </select>
                <div className="parent-leave-form__dates">
                  <label htmlFor="parent-leave-from">From date<input id="parent-leave-from" type="date" value={draft.fromDate} onChange={(event) => setDraft((current) => ({ ...current, fromDate: event.target.value }))} /></label>
                  <label htmlFor="parent-leave-to">To date<input id="parent-leave-to" type="date" value={draft.toDate} min={draft.fromDate} onChange={(event) => setDraft((current) => ({ ...current, toDate: event.target.value }))} /></label>
                </div>
                <label htmlFor="parent-leave-reason">Reason or symptoms</label>
                <textarea id="parent-leave-reason" rows={4} maxLength={300} value={draft.reason} onChange={(event) => setDraft((current) => ({ ...current, reason: event.target.value }))} placeholder="Add details for the school attendance record..." />
                <div className="field-counter">{draft.reason.length}/300</div>
                {duration > (leaveConstraints?.maxDurationDays ?? 31) ? <p className="form-error" role="alert">A single request cannot exceed {leaveConstraints?.maxDurationDays ?? 31} calendar days.</p> : null}
                <div className="parent-leave-upload">
                  <span><strong>Supporting document</strong>{requiresDocument && medicalDocumentAfterDays !== null ? <em>Required for {medicalDocumentAfterDays + 1}+ day medical leave</em> : <small>Optional PDF, JPEG, or PNG</small>}</span>
                  {draft.attachment ? (
                    <span className="parent-leave-upload__file"><FileText size={17} /><b>{draft.attachment.name}</b><button type="button" aria-label="Remove supporting document" onClick={() => setDraft((current) => ({ ...current, attachment: null }))}><Trash2 size={15} /></button></span>
                  ) : (
                    <label htmlFor={fileInputId}><Upload size={16} />Add document<input id={fileInputId} type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={chooseAttachment} /></label>
                  )}
                </div>
                <button className="button button--primary" type="button" disabled={!isDraftValid || draftState === "submitting"} onClick={() => void createLeave()}>
                  {draftState === "submitting" ? <LoaderCircle className="spin" size={18} /> : <ArrowRight size={18} />}
                  {draftState === "submitting" ? "Submitting..." : "Submit Leave Request"}
                </button>
                {draftError ? <p className="form-error" role="alert">{draftError}</p> : null}
              </>
            )}
          </section>
        ) : null}
      </div>
    </ParentShell>
  );
}
