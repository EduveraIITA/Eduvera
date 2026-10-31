import { useEffect, useMemo, useRef, useState } from "react";
import { AttendanceParticipantRow } from "../attendance/AttendanceParticipantRow";
import { AttendanceRegisterFooter, AttendanceRegisterHeader, AttendanceRegisterProgress, AttendanceRegisterRoster, AttendanceRegisterTools, AttendanceRegisterView } from "../attendance/AttendanceRegisterView";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { useUnsavedChangesGuard, type UnsavedChangesNavigationGuard } from "../navigation/useUnsavedChangesGuard";
import { ActivityPagination } from "./ActivityPagination";
import { ActivityEvidenceReview } from "./ActivityEvidenceReview";
import { ActivityRegisterHistory } from "./ActivityRegisterHistory";
import { activityInterval } from "./activityExperience";
import { getActivityRegister, saveActivityMarks, submitActivityRegister, transitionActivityRegister, type ActivityRegister, type ParticipationStatus } from "./api";

const statusLabels: Record<ParticipationStatus, string> = { present: "Present", absent: "Absent", late: "Late", excused: "Excused", half_day: "Half day" };
type Mark = { person_id: string; status: ParticipationStatus | null; remarks: string };
const rosterPageSize = 25;
export function ActivityRegisterEditor({ schoolId, initial, onAccepted, onBack, showBackButton = true, onBeforeLeaveChange }: { schoolId: string; initial: ActivityRegister; onAccepted: (register: ActivityRegister) => Promise<void>; onBack: () => void; showBackButton?: boolean; onBeforeLeaveChange?: (guard: UnsavedChangesNavigationGuard | null) => void }) {
  const environment = useExecutionEnvironment();
  const [baseline, setBaseline] = useState(initial);
  const [records, setRecords] = useState<Record<string, Mark>>(() => Object.fromEntries(initial.roster.map((row) => [row.person_id, { person_id: row.person_id, status: row.status, remarks: row.remarks }])));
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [findOpen, setFindOpen] = useState(false);
  const [rosterPage, setRosterPage] = useState(1);
  const [reason, setReason] = useState("");
  const [historyPage, setHistoryPage] = useState<number | null>(null);
  const [bulkReview, setBulkReview] = useState(false);
  const [saving, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const participantSearch = useRef<HTMLInputElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => { if (findOpen) participantSearch.current?.focus(); }, [findOpen]);
  const key = useRef(crypto.randomUUID());
  const transitionKey = useRef(crypto.randomUUID());
  const changed = baseline.roster.filter((row) => records[row.person_id]?.status !== row.status || records[row.person_id]?.remarks !== row.remarks).map((row) => records[row.person_id]!);
  const editing=changed.length>0 || reason.trim().length>0;
  const confirmLeave = useUnsavedChangesGuard(editing, "Leave this register? Your unsaved marks, notes or reason will be lost.");
  useEffect(() => {
    onBeforeLeaveChange?.(confirmLeave);
    return () => onBeforeLeaveChange?.(null);
  }, [confirmLeave, onBeforeLeaveChange]);
  const remoteConflict=editing && initial.register.revision>baseline.register.revision;
  const endedSimulation=environment.mode==='simulation' && (environment.unavailable || environment.runStatus==='completed' || environment.runStatus==='stopped');
  const busy=saving || remoteConflict || endedSimulation;
  // Adjust only this component's clean draft before rendering the new server
  // snapshot. A conflicting dirty draft remains intact until explicitly reviewed.
  if(!saving && initial!==baseline && initial.register.revision>=baseline.register.revision && !remoteConflict) {
    setBaseline(initial);
    if(!changed.length) setRecords(Object.fromEntries(initial.roster.map(row=>[row.person_id,{person_id:row.person_id,status:row.status,remarks:row.remarks}])));
  }
  const correction = changed.some((mark) => baseline.roster.find((row) => row.person_id === mark.person_id)?.status !== null);
  const unrecorded = Object.values(records).filter((row) => row.status === null);
  const requiredUnrecorded = unrecorded.filter((mark) => baseline.roster.find((row) => row.person_id === mark.person_id)?.requirement === "required");
  const rows = baseline.roster.filter((row) => row.name.toLowerCase().includes(search.toLowerCase()) && (filter !== "unrecorded" || records[row.person_id]?.status === null));
  const rosterPages = Math.max(1, Math.ceil(rows.length / rosterPageSize));
  const currentRosterPage = Math.min(rosterPage, rosterPages);
  const visibleRows = rows.slice((currentRosterPage - 1) * rosterPageSize, currentRosterPage * rosterPageSize);
  const showFilters = baseline.roster.length > 8 || findOpen;
  const registerDate = new Intl.DateTimeFormat("en", { timeZone: baseline.register.time_zone, day: "numeric", month: "short", year: "numeric" }).format(new Date(baseline.register.starts_at));
  const stateLabel = baseline.register.state === "draft" ? "Draft" : baseline.register.state === "locked" ? "Final" : "Submitted";
  const showSave = baseline.capabilities.can_record && changed.length > 0;
  const showSubmit = baseline.register.state === "draft" && (baseline.capabilities.can_submit || baseline.capabilities.can_record);
  const showFooter = showSave || showSubmit || baseline.capabilities.can_finalize || baseline.capabilities.can_reopen;
  const canBulkMark = !busy && baseline.capabilities.can_record && unrecorded.length > 0 && baseline.allowed_statuses.includes("present");
  const options = useMemo(() => baseline.allowed_statuses.map((status) => ({ value: status, label: statusLabels[status] })), [baseline.allowed_statuses]);
  const accept = async (next: ActivityRegister, message: string) => {
    setBaseline(next); setRecords(Object.fromEntries(next.roster.map((row) => [row.person_id, { person_id: row.person_id, status: row.status, remarks: row.remarks }]))); setReason(""); setNotice(message); key.current = crypto.randomUUID(); transitionKey.current = crypto.randomUUID(); await onAccepted(next);
  };
  const loadLatest=()=>{
    if(editing && !window.confirm("Replace these unsaved edits with the latest saved register?")) return;
    setBusy(true);
    void getActivityRegister(schoolId,baseline.register.id).then(latest=>accept(latest,"Latest register loaded."))
      .then(()=>setError("")).catch((cause:unknown)=>setError(cause instanceof Error ? cause.message : "The latest register could not be loaded."))
      .finally(()=>setBusy(false));
  };
  const commit = async (action: "save" | "submit" | "finalize" | "reopen") => {
    if (correction && !reason.trim() || action === "reopen" && !reason.trim()) return setError("Add a reason so the correction can be explained later.");
    setBusy(true); setError(""); setNotice("");
    try {
      let next = baseline;
      if (action === "submit") {
        next = await submitActivityRegister(schoolId, baseline.register.id, baseline.register.revision, changed, reason.trim() || undefined, transitionKey.current);
        await accept(next, "Register submitted."); transitionKey.current = crypto.randomUUID(); return;
      }
      if (changed.length && action !== "reopen") {
        next = await saveActivityMarks(schoolId, baseline.register.id, baseline.register.revision, changed, reason.trim() || undefined, key.current);
        await accept(next, correction ? "Correction saved." : "Attendance draft saved.");
      }
      if (action !== "save") {
        next = await transitionActivityRegister(schoolId, next.register.id, next.register.revision, action, reason.trim() || undefined, transitionKey.current);
        await accept(next, action === "finalize" ? "Register finalized. Its history is retained." : "Register reopened with a reason. Previous decisions remain in history.");
        transitionKey.current = crypto.randomUUID();
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The action was not confirmed. Your edits are still here; review the latest state before retrying."); } finally { setBusy(false); }
  };
  const back = () => { if (confirmLeave()) onBack(); };
  const evidence = <details className="attendance-register-options" open={baseline.pending_evidence.length > 0}>
    <summary>{baseline.pending_evidence.length ? `Reported evidence · ${baseline.pending_evidence.length}` : "Paper reports & register help"}</summary>
    <p className="activity-caption">Not recorded means no decision yet. Planned participation and recorded attendance remain separate.</p>
    <ActivityEvidenceReview schoolId={schoolId} register={baseline} disabled={busy || changed.length > 0} onAccepted={(next, message) => accept(next, message)} />
  </details>;
  return <AttendanceRegisterView>
    {showBackButton ? <button type="button" className="activity-text-button" onClick={back}>Back to registers</button> : null}
    <AttendanceRegisterHeader title={baseline.register.title} headingRef={heading} state={stateLabel}
      action={<button type="button" onClick={() => setHistoryPage(1)}>History</button>}
      context={<>{baseline.register.source_kind === "daily_class" ? `Daily register · ${registerDate}` : `${registerDate} · ${activityInterval(baseline.register.starts_at, baseline.register.ends_at, baseline.register.time_zone)}`}{baseline.register.place_label ? ` · ${baseline.register.place_label}` : ""}</>} />
    {baseline.register.state === "submitted" && baseline.register.finalization?.state === "automatic_pending" ? <p role="status">Automatic finalization scheduled.</p>
      : baseline.register.state === "submitted" && baseline.register.finalization?.reason === "overdue" ? <p role="status">Automatic finalization is overdue. Review this register.</p> : null}
    {baseline.availability_reason ? <p className="activity-notice">{baseline.availability_reason}</p> : null}
    {remoteConflict ? <div role="alert" className="activity-notice"><p>This register changed elsewhere. Your unsaved marks are preserved; review the latest register before saving.</p><button type="button" disabled={saving} onClick={loadLatest}>Review latest register</button></div> : null}
    {endedSimulation ? <p className="activity-notice">This simulation has ended. Its saved register is read-only.</p> : null}
    <AttendanceRegisterProgress recorded={baseline.roster.length - unrecorded.length} total={baseline.roster.length}>
      {baseline.roster.length > 1 && baseline.roster.length <= 8 ? <button type="button" className="attendance-register-action attendance-register-action--text" aria-expanded={findOpen} aria-controls="register-participant-filters" onClick={() => { setFindOpen(!findOpen); if (findOpen) { setSearch(""); setFilter("all"); setRosterPage(1); } }}>{findOpen ? "Hide filters" : "Find & filter"}</button> : null}
      {baseline.roster.length > 1 ? <button type="button" className="attendance-register-action attendance-register-action--text" aria-label="Mark remaining present" disabled={!canBulkMark} onClick={() => setBulkReview(true)}>Mark present</button> : null}
    </AttendanceRegisterProgress>
    {showFilters ? <AttendanceRegisterTools id="register-participant-filters"><label><span className="sr-only">Find participant</span><input ref={participantSearch} type="search" placeholder="Find a participant" value={search} onChange={(event) => { setSearch(event.target.value); setRosterPage(1); }} /></label><select aria-label="Filter participants" value={filter} onChange={(event) => { setFilter(event.target.value); setRosterPage(1); }}><option value="all">All · {baseline.roster.length}</option><option value="unrecorded">Not recorded · {unrecorded.length}</option></select></AttendanceRegisterTools> : null}
    {baseline.pending_evidence.length ? evidence : null}
    <AttendanceRegisterRoster>{visibleRows.map((row) => <AttendanceParticipantRow<ParticipationStatus> key={row.person_id} participant={{ id: row.person_id, name: row.name }} context={[...row.roles, row.requirement === "optional" ? "Optional participation" : ""].filter(Boolean).join(" · ")} status={records[row.person_id]?.status ?? null} remarks={records[row.person_id]?.remarks ?? ""} disabled={busy || !baseline.capabilities.can_record} conflict={false} emptyLabel="Not recorded" statusOptions={options} quickStatuses={options.filter((item) => item.value === "present" || item.value === "absent").map((item) => ({ ...item, tone: item.value === "absent" ? "negative" : "positive" }))} onChange={(value) => { setRecords((current) => ({ ...current, [row.person_id]: { ...current[row.person_id]!, ...(value.status !== undefined ? { status: value.status } : {}), ...(value.remarks !== undefined ? { remarks: value.remarks } : {}) } })); key.current = crypto.randomUUID(); transitionKey.current = crypto.randomUUID(); }} />)}{!rows.length ? <p>No participants match this view.</p> : null}</AttendanceRegisterRoster>
    {rosterPages > 1 ? <ActivityPagination page={currentRosterPage} pages={rosterPages} total={rows.length} label="participants" singularLabel="participant" onPage={setRosterPage} /> : null}
    {!baseline.pending_evidence.length ? evidence : null}
    {(correction || baseline.capabilities.can_reopen) ? <label className="activity-correction">{correction ? "Correction reason" : "Reason for reopening"}<textarea value={reason} onChange={(event) => { setReason(event.target.value); key.current = crypto.randomUUID(); transitionKey.current = crypto.randomUUID(); }} placeholder="Explain what changed and why" /></label> : null}
    {error ? <div role="alert" className="activity-error"><p>{error}</p><button type="button" onClick={loadLatest}>Review latest register</button></div> : null}{notice ? <p role="status" className="activity-notice">{notice}</p> : null}
    {showFooter ? <AttendanceRegisterFooter status={changed.length ? `${changed.length} unsaved ${changed.length === 1 ? "change" : "changes"}` : editing ? "Unsaved reason" : "Saved"}>
      {showSave ? <button type="button" className="attendance-register-action" disabled={busy || correction && reason.trim().length < 3} onClick={() => void commit("save")}>Save {correction || baseline.register.state!=='draft' ? "correction" : "draft"}</button> : null}
      {showSubmit ? <button type="button" className="attendance-register-action attendance-register-action--primary" aria-label="Submit register" disabled={busy || requiredUnrecorded.length > 0 || correction && reason.trim().length < 3} onClick={() => void commit("submit")}>{saving ? "Working…" : "Submit"}</button> : null}
      {baseline.capabilities.can_finalize ? <button type="button" className="attendance-register-action attendance-register-action--primary" aria-label="Finalize register" disabled={busy || changed.length > 0} onClick={() => void commit("finalize")}>Finalize</button> : null}
      {baseline.capabilities.can_reopen ? <button type="button" className="attendance-register-action" disabled={busy || reason.trim().length < 3} onClick={() => void commit("reopen")}>Reopen for correction</button> : null}
    </AttendanceRegisterFooter> : null}
    {bulkReview ? <PlannerDialog title="Mark remaining participants present?" onClose={() => setBulkReview(false)}><div className="activity-form"><p>This changes only the {unrecorded.length} unrecorded {unrecorded.length === 1 ? "participant" : "participants"} in this register, including those hidden by your current filter or page. Existing decisions are unchanged.</p><button type="button" className="activity-primary" disabled={!canBulkMark} onClick={() => { if (!canBulkMark) return; setRecords((current) => Object.fromEntries(Object.entries(current).map(([id, mark]) => [id, mark.status === null ? { ...mark, status: "present" } : mark]))); key.current = crypto.randomUUID(); transitionKey.current = crypto.randomUUID(); setBulkReview(false); }}>Mark {unrecorded.length} present in draft</button></div></PlannerDialog> : null}
    {historyPage !== null ? <ActivityRegisterHistory schoolId={schoolId} register={baseline.register} onClose={() => setHistoryPage(null)} /> : null}
  </AttendanceRegisterView>;
}
