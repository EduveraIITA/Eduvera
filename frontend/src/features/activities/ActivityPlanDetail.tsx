import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { TemporalInput } from "../../components/forms/TemporalInput";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { useOptionalAuth } from "../auth/AuthContext";
import type { UnsavedChangesNavigationGuard } from "../navigation/useUnsavedChangesGuard";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { applicationNow } from "../simulation/applicationTime";
import { ActivityPlanEditor } from "./ActivityPlanEditor";
import { activityInterval, campusDate, purposeLabels } from "./activityExperience";
import { getActivityPlan, reviseActivityPlan, transitionActivityPlan, type ActivityCatalogue, type ActivityOccurrence, type ActivityPlan } from "./api";

export function ActivityPlanDetail({ schoolId, catalogue, occurrence, planId, expectedRevision, onReviewCurrent, onSelectPlan, onClose, onSaved, onBeforeLeaveChange }: { schoolId: string; catalogue: ActivityCatalogue; occurrence?: ActivityOccurrence; planId: string; expectedRevision?: number; onReviewCurrent?: (plan: ActivityPlan) => void; onSelectPlan?: (id: string, revision?: number) => void; onClose: () => void; onSaved: (plan: ActivityPlan, message: string) => Promise<void>; onBeforeLeaveChange?: (guard: UnsavedChangesNavigationGuard | null) => void }) {
  const environment = useExecutionEnvironment();
  const auth = useOptionalAuth();
  const query = useQuery({ queryKey: executionEnvironmentQueryKey(environment, ["activities", schoolId, "actor", auth?.user?.id ?? "session", "plan", planId]), queryFn: () => getActivityPlan(schoolId, planId) });
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [changing, setChanging] = useState(false);
  const [changeDate, setChangeDate] = useState(occurrence?.local_date ?? "");
  const [replacement, setReplacement] = useState<ActivityPlan | undefined>();
  const [inspectedPlan, setInspectedPlan] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const commandKey = useRef(crypto.randomUUID());
  const plan = query.data;
  const stale = Boolean(plan && expectedRevision !== undefined && plan.revision !== expectedRevision);
  const editable = replacement ?? plan;
  const inspect = (id: string, revision?: number) => onSelectPlan ? onSelectPlan(id, revision) : setInspectedPlan(id);
  if (inspectedPlan) return <ActivityPlanDetail key={inspectedPlan} schoolId={schoolId} catalogue={catalogue} planId={inspectedPlan} onClose={() => setInspectedPlan(null)} onSaved={onSaved} onBeforeLeaveChange={onBeforeLeaveChange} />;
  if (editing && editable) return <ActivityPlanEditor key={editable.id} schoolId={schoolId} catalogue={catalogue} date={editable.starts_on} plan={editable} onClose={() => setEditing(false)} onSaved={onSaved} onDraftAccepted={onReviewCurrent} onBeforeLeaveChange={onBeforeLeaveChange} />;
  if (stale && plan) return <PlannerDialog title="Activity changed" onClose={onClose}><div className="activity-form"><p role="status">This activity changed since the saved link. Review the current version before editing.</p><p>{plan.title} · {plan.state} · Revision {plan.revision}</p>{onReviewCurrent ? <button type="button" className="activity-primary" onClick={() => onReviewCurrent(plan)}>Review current activity</button> : null}<button type="button" className="activity-secondary" onClick={onClose}>Return to timetable</button></div></PlannerDialog>;
  const prepareChange = async () => {
    if (!plan || !changeDate || reason.trim().length < 3) return;
    setBusy(true); setError("");
    try { const next = await reviseActivityPlan(schoolId, plan, changeDate, reason.trim(), commandKey.current); setReplacement(next); setEditing(true); onSelectPlan?.(next.id, next.revision); commandKey.current = crypto.randomUUID(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The change draft was not confirmed. The published timetable is unchanged."); } finally { setBusy(false); }
  };
  const cancel = async () => {
    if (!plan || !reason.trim()) return;
    setBusy(true); setError("");
    try { const next = await transitionActivityPlan(schoolId, plan, "cancel", reason.trim(), commandKey.current); await onSaved(next, "This plan version was cancelled. Existing attendance, history and separately published changes are retained."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Cancellation was not confirmed. Please review and retry."); } finally { setBusy(false); }
  };
  return <PlannerDialog title={plan?.title ?? occurrence?.title ?? "Activity"} onClose={onClose} busy={busy}>
    <div className="activity-form">{query.isPending ? <p role="status">Loading activity…</p> : query.isError || !plan ? <div role="alert"><p>{query.error?.message ?? "This activity is unavailable."}</p><button type="button" onClick={() => void query.refetch()}>Try again</button><button type="button" onClick={onClose}>Return to timetable</button></div> : <>
      <dl className="activity-review"><div><dt>Purpose / state</dt><dd>{purposeLabels[plan.purpose]} · {plan.state} · Revision {plan.revision}</dd></div><div><dt>When</dt><dd>{occurrence ? activityInterval(occurrence.starts_at, occurrence.ends_at, occurrence.timezone) : `${plan.starts_at}–${plan.ends_at}${plan.end_day_offset ? " (ends next day)" : ""}`}<small>{plan.starts_on}{plan.recurrence === "weekly" ? ` · repeats weekly ${plan.ends_on ? `until ${plan.ends_on}` : "without a last date"}` : ""} · {plan.timezone}</small></dd></div><div><dt>People / groups</dt><dd>{[...catalogue.people.filter((item) => plan.person_ids.includes(item.id)), ...catalogue.groups.filter((item) => plan.group_ids.includes(item.id))].map((item) => item.label).join(", ") || occurrence?.participants.map((item) => item.label).join(", ") || "See the owning schedule"}</dd></div><div><dt>Attendance</dt><dd>{plan.attendance_mode === "none" ? "Not required" : "Participant register"}</dd></div></dl>
      {plan.source === "academic" && plan.source_href ? <Link className="activity-primary" to={plan.source_href}>Open this academic timetable</Link> : null}
      {occurrence?.state === "expected" && occurrence.teaching_session_href?.startsWith("/areas/timetable/session?") ? <Link className="activity-primary" to={occurrence.teaching_session_href}>Open session</Link> : null}
      {occurrence?.can_open_register && occurrence.state === "expected" && occurrence.attendance_mode !== "none" ? <Link className="activity-primary" to={`/areas/attendance/registers?${new URLSearchParams({ date: occurrence.local_date, occurrence_id: occurrence.id }).toString()}`}>Open attendance</Link> : null}
      {catalogue.can_manage && plan.can_edit && plan.state === "draft" ? <button type="button" className="activity-primary" onClick={() => setEditing(true)}>Edit and review draft</button> : null}
      {catalogue.can_manage && replacement ? <button type="button" className="activity-primary" onClick={() => setEditing(true)}>Continue change draft</button> : null}
      {catalogue.can_manage && !replacement && plan.pending_revision_id ? <button type="button" className="activity-primary" onClick={() => inspect(plan.pending_revision_id!)}>Continue change draft</button> : null}
      {plan.superseded_on ? <p>This version is replaced from {plan.superseded_on}. Previous expectations and attendance remain in history.</p> : null}
      {plan.replacement_windows?.length ? <details><summary>Scheduled changes · {plan.replacement_window_count ?? plan.replacement_windows.length}</summary><ul className="activity-history">{plan.replacement_windows.map(window => <li key={window.replacement_plan_id}><button type="button" className="activity-text-button" onClick={() => inspect(window.replacement_plan_id)}>View change from {window.from}</button><p>{window.until ? `Temporary change. This original plan resumes on ${window.until}, unless another published change applies.` : "Replaces the remaining dates of this plan."}</p></li>)}</ul>{(plan.replacement_window_count ?? 0) > plan.replacement_windows.length ? <p>Showing the next {plan.replacement_windows.length} changes. Use the timetable date to view other periods.</p> : null}</details> : null}
      {catalogue.can_manage && !replacement && !plan.pending_revision_id && plan.source === "activity" && plan.state === "published" && (plan.can_plan_change ?? !plan.superseded_on) ? <button type="button" className="activity-primary" onClick={() => { setChanging(!changing); setCancelling(false); setReason(""); setChangeDate(occurrence?.local_date ?? plan.starts_on); commandKey.current = crypto.randomUUID(); }}>Plan a change</button> : null}
      {changing ? <><p>{plan.recurrence === "once" ? "Move this future activity to a new date, then review its time and participants." : "Prepare a dated draft."} The published plan remains in effect until the change passes review and is published. Past and already-started activity evidence is retained.</p><label>{plan.recurrence === "once" ? "New date" : "Change from"}<TemporalInput required type="date" min={plan.recurrence === "once" ? campusDate(applicationNow(), plan.timezone) : plan.starts_on} max={plan.recurrence === "once" ? undefined : plan.ends_on ?? undefined} value={changeDate} onChange={(event) => { setChangeDate(event.target.value); commandKey.current = crypto.randomUUID(); }} /></label><label>Reason for change<textarea minLength={3} maxLength={500} required value={reason} onChange={(event) => { setReason(event.target.value); commandKey.current = crypto.randomUUID(); }} /></label><button type="button" className="activity-primary" disabled={busy || !changeDate || reason.trim().length < 3} onClick={() => void prepareChange()}>Prepare change draft</button></> : null}
      {catalogue.can_manage && plan.source === "activity" && plan.state === "published" ? <button type="button" className="activity-text-button" onClick={() => { setCancelling(!cancelling); setChanging(false); setReason(""); commandKey.current = crypto.randomUUID(); }}>{cancelling ? "Keep this plan" : "Cancel this plan version"}</button> : null}
      {cancelling ? <><p>Future dates scheduled by this plan version stop. Previous attendance is not erased. Separately published changes stay scheduled; review them above.</p><label>Cancellation reason<textarea required minLength={3} maxLength={500} value={reason} onChange={(event) => { setReason(event.target.value); commandKey.current = crypto.randomUUID(); }} /></label><button type="button" className="activity-primary" disabled={busy || reason.trim().length < 3} onClick={() => void cancel()}>Confirm cancellation</button></> : null}
      {error ? <p role="alert" className="activity-error">{error}</p> : null}
    </>}</div>
  </PlannerDialog>;
}
