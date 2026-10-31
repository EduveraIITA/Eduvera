import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { PeopleBulkAddDialog } from "../people/PeopleBulkAddDialog";
import { getParticipant } from "../people/participationApi";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { WorkspaceState } from "../workspace/WorkspaceState";
import { LearningPersonPicker } from "./LearningOfferingSetup";
import { appointOfferingInstructor, endOfferingResponsibility, enrollOfferingPeople, getLearningOffering, type LearningOfferingDetail, type OfferingPerson } from "./offeringApi";
import { useAssignmentWrite } from "./useAssignmentWrite";
import { useUnsavedChangesGuard } from "../navigation/useUnsavedChangesGuard";
import { assignmentAccessLost } from "./assignmentReadState";

export function LearningOfferingWorkspace({ id, schoolId, actorId, children }: { id: string; schoolId: string; actorId: string; children: ReactNode }) {
  const environment = useExecutionEnvironment(), client = useQueryClient(), [managing, setManaging] = useState(false);
  const query = useQuery({ queryKey: executionEnvironmentQueryKey(environment, ["learning-assignments", schoolId, actorId, "offering", id]), queryFn: () => getLearningOffering(id) });
  const readOnly = environment.mode === "simulation" && (environment.unavailable || environment.runStatus === "stopped" || environment.runStatus === "completed");
  const refresh = async () => {
    await query.refetch({ throwOnError: true });
    await client.invalidateQueries({ queryKey: executionEnvironmentQueryKey(environment, ["learning-assignments", schoolId, actorId]) });
    await client.invalidateQueries({ queryKey: ["responsibility-workspace"] });
  };
  if (query.isPending) return <WorkspaceState state="loading" />;
  if (!query.data || assignmentAccessLost(query.error)) return <WorkspaceState state="error" error={query.error} onRetry={query.refetch} />;
  const data = query.data;
  return <div className="learning-assignments">
    {query.error ? <p role="alert">This group could not refresh. Your open work is kept. <button onClick={() => void query.refetch()}>Refresh group</button></p> : null}
    <div className="learning-assignment-heading"><Link className="learning-offering-own" to="/areas/messages/assignments">All learning groups</Link>{data.can_manage && !readOnly ? <button className="learning-offering-manage" onClick={() => setManaging(true)}>Manage group</button> : null}</div>
    {data.can_publish || data.can_review ? children : <section className="learning-offering-empty"><h2>{data.name}</h2><p className="learning-assignment-caption">{data.current_instructor ? `${data.current_instructor.name} teaches this group.` : "Choose an instructor to publish new work."}</p><p className="learning-assignment-caption">{data.learner_count !== undefined ? `${data.learner_count} learners` : "Your learning group"}</p>{data.can_manage ? <p className="learning-assignment-caption">You can manage the group. Private submissions stay with their learner and assigned reviewer.</p> : null}</section>}
    {managing ? <LearningOfferingManagement schoolId={schoolId} data={data} refresh={refresh} onClose={() => setManaging(false)} /> : null}
  </div>;
}
type Change = { kind: "enroll" | "appoint"; people: OfferingPerson[] } | { kind: "end"; target: "enrollments" | "instructors"; id: string; revision: number; name: string };
function LearningOfferingManagement({ schoolId, data, refresh, onClose }: { schoolId: string; data: LearningOfferingDetail; refresh: () => Promise<unknown>; onClose: () => void }) {
  const [picker, setPicker] = useState<"enroll" | "appoint" | null>(null), [adding, setAdding] = useState(false), [change, setChange] = useState<Change | null>(null);
  const [reason, setReason] = useState(""), [error, setError] = useState(""), [selecting, setSelecting] = useState(false);
  const active = useRef(true), selectingRef = useRef(false), accepted = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const write = useAssignmentWrite(async () => { await refresh(); if (active.current && accepted.current) { setChange(null); setReason(""); accepted.current = false; } }, "offering");
  const guard = useUnsavedChangesGuard(Boolean(change) || selecting || write.busy || write.locked, "Leave this group change? Keep this screen until an unconfirmed action is resolved.");
  const disabled = selecting || write.busy || write.locked;
  const choose = async (ids: string[], kind: "enroll" | "appoint") => {
    if (disabled || selectingRef.current) return;
    if (!ids.length) { setAdding(false); setError("These people are already in this group."); return; }
    selectingRef.current = true; setSelecting(true); setError("");
    try {
      const people = await Promise.all(ids.map(id => getParticipant(schoolId, id)));
      if (active.current) { setChange({ kind, people: people.map(person => ({ id: person.id, name: person.label, revision: person.revision })) }); setPicker(null); setAdding(false); }
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : "People could not be checked."); }
    finally { selectingRef.current = false; if (active.current) setSelecting(false); }
  };
  const save = () => {
    if (!change || disabled) return;
    const revision = change.kind === "end" ? change.revision : data.revision;
    void write.run(JSON.stringify({ offering: data.id, revision, change, reason }), command_id => {
      if (change.kind === "end") return endOfferingResponsibility(data.id, change.target, change.id, { command_id, expected_revision: revision, reason });
      const refs = change.people.map(person => ({ id: person.id, expected_revision: person.revision }));
      return change.kind === "enroll" ? enrollOfferingPeople(data.id, { command_id, expected_revision: revision, participants: refs, starts_on: data.today }) : appointOfferingInstructor(data.id, { command_id, expected_revision: revision, instructor: refs[0]!, starts_on: data.today });
    }, () => { accepted.current = true; }, { sourceId: data.id, expectedRevision: revision, selectedPersons: change.kind === "end" ? [] : change.people.map(person => ({ id: person.id, expected_revision: person.revision })) });
  };
  return <PlannerDialog title={change ? change.kind === "end" ? "End responsibility" : change.kind === "appoint" ? "Appoint instructor" : "Add learners" : data.name} busy={disabled} onClose={() => { if (!disabled && guard()) onClose(); }}>
    <div className="learning-assignment-form learning-offering-form">
      {change ? <><section className="learning-assignment-review">{change.kind === "end" ? <><h3>{change.name}</h3><p className="learning-assignment-caption">{change.target === "instructors" ? "Teaching access ends today. Existing assignments are not transferred to someone else." : "Learning registration ends today. Submitted history stays; rejoining does not reopen old assignments."}</p><label>Reason<textarea rows={3} required minLength={3} maxLength={500} disabled={disabled} value={reason} onChange={event => setReason(event.target.value)} /></label></> : <><h3>{change.kind === "enroll" ? `${change.people.length} ${change.people.length === 1 ? "learner" : "learners"}` : change.people[0]?.name}</h3><p className="learning-assignment-caption">{change.kind === "enroll" ? "Included in future publications. Already-published work stays unchanged." : "Can publish new assignments and review their assigned work. Existing assignments are not reassigned."}</p><div className="learning-offering-chips">{change.people.map(person => <span key={person.id} className="learning-offering-review-name">{person.name}</span>)}</div></>}</section>
        <footer className="learning-assignment-actions"><button disabled={disabled} onClick={() => { setChange(null); setReason(""); }}>Back</button><button disabled={disabled || change.kind === "end" && reason.trim().length < 3} onClick={save}>{write.busy ? "Saving…" : change.kind === "end" ? "End today" : change.kind === "appoint" ? "Appoint instructor" : "Add learners"}</button></footer>
      </> : <><section><h3>Instructor</h3>{data.current_instructor ? <div className="learning-assignment-label"><span>{data.current_instructor.name}</span><button disabled={disabled} onClick={() => setChange({ kind: "end", target: "instructors", id: data.current_instructor!.id, revision: data.current_instructor!.revision, name: data.current_instructor!.name })}>End teaching responsibility</button></div> : <button disabled={disabled} onClick={() => setPicker("appoint")}>Choose instructor</button>}</section>
        <section><div className="learning-assignment-label"><h3>Learners · {data.enrollments.length}</h3><button disabled={disabled} onClick={() => setPicker("enroll")}>Choose people</button></div><button disabled={disabled} onClick={() => setAdding(true)}>Add people</button>
          <div className="learning-offering-roster">{data.enrollments.map(person => <div className="learning-assignment-label" key={person.id}><Link to={`/areas/people/participants/${encodeURIComponent(person.person_id)}`} state={{ peopleReturnTo: `/areas/messages/assignments?scope=offering&offering_id=${data.id}` }}>{person.name}</Link><button disabled={disabled} onClick={() => setChange({ kind: "end", target: "enrollments", id: person.id, revision: person.revision, name: person.name })} aria-label={`End registration for ${person.name}`}>End</button></div>)}</div></section>
      </>}
      {error ? <p role="alert">{error}</p> : null}{write.error ? <p role="alert">{write.error}</p> : null}
      {write.locked ? <button disabled={write.busy} onClick={() => void write.recover()}>{write.recovery === "unknown" ? "Retry same action" : "Refresh saved group"}</button> : null}
      {write.recovery === "obsolete" ? <button disabled={write.busy || selecting} onClick={() => {
        setSelecting(true); setError(""); void refresh().then(() => { if (active.current) { setChange(null); write.resolveObsolete(); } }).catch(cause => { if (active.current) setError(cause instanceof Error ? cause.message : "Current group could not be loaded."); }).finally(() => { if (active.current) setSelecting(false); });
      }}>Review current group</button> : null}
    </div>
    {picker ? <LearningPersonPicker schoolId={schoolId} multiple={picker === "enroll"} selected={[]} excludeIds={picker === "enroll" ? [...data.enrollments.map(person => person.person_id), ...(data.current_instructor ? [data.current_instructor.person_id] : [])] : data.enrollments.map(person => person.person_id)} busy={disabled} error={error} onClose={() => setPicker(null)} onDone={ids => { void choose(ids, picker); }} /> : null}
    {adding ? <PeopleBulkAddDialog schoolId={schoolId} onClose={() => setAdding(false)} onDone={people => { void choose(people.map(person => person.id).filter(id => !data.enrollments.some(enrollment => enrollment.person_id === id)), "enroll"); }} /> : null}
  </PlannerDialog>;
}
