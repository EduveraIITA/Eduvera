import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { ProductIcon } from "../../components/ProductIcon";
import { useOptionalAuth } from "../auth/AuthContext";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { useWorkspaceManifest } from "../workspace/useWorkspaceManifest";
import { manifestMatchesEnvironment } from "../workspace/ResponsibilityWorkspace";
import { WorkspaceState } from "../workspace/WorkspaceState";
import { AssignmentComposer } from "./AssignmentComposer";
import { AssignmentWorkView } from "./AssignmentWorkView";
import { getAssignment, getAssignments, type AssignmentItem } from "./assignmentApi";
import { LearningAssignmentsHub } from "./LearningAssignmentsHub";
import { LearningOfferingWorkspace } from "./LearningOfferingWorkspace";
import { assignmentAccessLost } from "./assignmentReadState";
import "./learning-assignments.css";

export function LearningAssignmentsRoute() {
  const environment = useExecutionEnvironment(), auth = useOptionalAuth(), manifest = useWorkspaceManifest();
  const [params] = useSearchParams();
  if (environment.mode === "simulation" && environment.unavailable) return <OperationsShell active="areas" title="Assignments" backTo="/areas/messages"><WorkspaceState state="unavailable" /></OperationsShell>;
  if (manifest.isPending) return <OperationsShell active="areas" title="Assignments" backTo="/areas/messages"><WorkspaceState state="loading" /></OperationsShell>;
  if (manifest.error) return <OperationsShell active="areas" title="Assignments" backTo="/areas/messages"><WorkspaceState state="error" error={manifest.error} onRetry={manifest.refetch} /></OperationsShell>;
  if (!manifest.data || !manifestMatchesEnvironment(manifest.data, environment)) return <OperationsShell active="areas" title="Assignments" backTo="/areas/messages"><WorkspaceState state="revoked" /></OperationsShell>;
  const classId = params.get("scope") === "class" ? params.get("class_section_id") : null, studentId = params.get("scope") !== "class" ? params.get("student_id") : null;
  const offeringId = params.get("scope") === "offering" ? params.get("offering_id") : null, personId = params.get("scope") === "person" ? params.get("person_id") : null;
  const key = JSON.stringify([manifest.data.context.institution_id, auth?.user?.id ?? manifest.data.context.actor_user_id, environment.mode,
    environment.mode === "simulation" ? environment.namespaceId : "live", classId, studentId, offeringId, personId]);
  const actorId = auth?.user?.id ?? manifest.data.context.actor_user_id ?? "session", schoolId = manifest.data.context.institution_id;
  const workspace = <AssignmentWorkspace key={key} classId={classId} studentId={studentId} offeringId={offeringId} personId={personId} actorId={actorId} schoolId={schoolId} />;
  return <OperationsShell active="areas" title="Assignments" backTo="/areas/messages">{!classId && !studentId && !offeringId && !personId ? params.has("scope") ? <WorkspaceState state="revoked" /> : <LearningAssignmentsHub key={key} schoolId={schoolId} actorId={actorId} manifest={manifest.data} /> : offeringId ? <LearningOfferingWorkspace key={key} id={offeringId} schoolId={schoolId} actorId={actorId}>{workspace}</LearningOfferingWorkspace> : workspace}</OperationsShell>;
}

export function AssignmentWorkspace({ classId, studentId, offeringId = null, personId = null, actorId, schoolId }: { classId: string | null; studentId: string | null; offeringId?: string | null; personId?: string | null; actorId: string; schoolId: string }) {
  const environment = useExecutionEnvironment(), client = useQueryClient(), [params, setParams] = useSearchParams();
  const id = params.get("assignment"), learner = classId || offeringId ? params.get("learner") : personId ?? studentId, page = Math.max(1, Number(params.get("page")) || 1);
  const [composing, setComposing] = useState(false), [editing, setEditing] = useState<AssignmentItem | undefined>();
  const active = useRef(true); useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const root = executionEnvironmentQueryKey(environment, ["learning-assignments", schoolId, actorId, classId, studentId, offeringId, personId]);
  const list = useQuery({ queryKey: [...root, "list", page], queryFn: () => getAssignments(offeringId ? { offering_id: offeringId } : personId ? { person_id: personId } : classId ? { class_section_id: classId } : { student_id: studentId! }, page) });
  const detail = useQuery({ queryKey: [...root, "detail", id, learner, page], queryFn: () => getAssignment(id!, learner ?? undefined, page, offeringId || personId ? "person" : "student"), enabled: Boolean(id) });
  const refresh = async () => { await client.invalidateQueries({ queryKey: root, refetchType: "none" }); await Promise.all([list.refetch({ throwOnError: true }), ...(id ? [detail.refetch({ throwOnError: true })] : [])]); await client.invalidateQueries({ queryKey: ["responsibility-workspace"] }); };
  const change = (values: Record<string, string | undefined>) => { const next = new URLSearchParams(params); for (const [key, value] of Object.entries(values)) if (value) next.set(key, value); else next.delete(key); setParams(next); };
  const readOnly = environment.mode === "simulation" && (environment.unavailable || environment.runStatus === "stopped" || environment.runStatus === "completed");
  if (list.isPending) return <WorkspaceState state="loading" />;
  if (!list.data || assignmentAccessLost(list.error)) return <WorkspaceState state="error" error={list.error} onRetry={list.refetch} />;
  const data = list.data;
  return <div className="learning-assignments">
    {list.error ? <p role="alert">The list could not refresh. Your open work is kept. <button onClick={() => void list.refetch()}>Refresh list</button></p> : null}
    {!id ? <><header className="learning-assignment-heading"><p className="learning-assignment-caption">{data.offering?.name ?? data.class_section?.label ?? data.learner?.name ?? data.student?.name}</p>{data.can_create && !readOnly ? <button onClick={() => { setEditing(undefined); setComposing(true); }}><Plus size={18} aria-hidden="true" />New assignment</button> : null}</header>
      {data.items.length ? <div className="learning-assignment-list">{data.items.map(item => <button key={item.id} onClick={() => change({ assignment: item.id, page: undefined })}><ProductIcon name="learning" size={28} /><span><strong>{item.title}</strong><small>{item.state === "draft" ? "Draft · only you" : item.due_at ? `Due ${new Date(item.due_at).toLocaleDateString()}` : "No due date"}</small></span><ChevronRight size={18} aria-hidden="true" /></button>)}</div> : <p className="learning-assignment-caption">{data.can_create ? `Create one assignment for this ${offeringId ? "group" : "class"}. Learners can save and submit their own work.` : "No assignments published for you yet."}</p>}
      <nav className="learning-assignment-pages" aria-label="Assignment pages">{page > 1 ? <button onClick={() => change({ page: String(page - 1) })}>Previous</button> : null}{data.has_more ? <button onClick={() => change({ page: String(page + 1) })}>Next</button> : null}</nav>
    </> : <>{detail.data?.context === "class" || detail.data?.context === "offering" ? <button className="learning-assignment-back" onClick={() => change({ assignment: undefined, learner: undefined, page: undefined })}><ChevronLeft size={18} aria-hidden="true" />All assignments</button> : null}
      {detail.isPending ? <WorkspaceState state="loading" /> : !detail.data || assignmentAccessLost(detail.error) ? <WorkspaceState state="error" error={detail.error} onRetry={detail.refetch} /> : <>
        {detail.error ? <p role="alert">The assignment could not refresh. Your local work is kept. <button onClick={() => void detail.refetch()}>Refresh assignment</button></p> : null}
        <h2>{detail.data.item.title}</h2>
        {!("progress" in detail.data) ? <AssignmentWorkView key={`${id}:${learner}`} data={detail.data} readOnly={readOnly} refresh={refresh} onLeave={() => classId || offeringId ? change({ learner: undefined, page: undefined }) : change({ assignment: undefined, page: undefined })} /> : <>
          <p className="learning-assignment-prose">{detail.data.item.instructions}</p>
          {detail.data.can_edit && !readOnly ? <button onClick={() => { setEditing(detail.data.item); setComposing(true); }}>Edit draft</button> : <><div className="learning-assignment-progress"><strong>{detail.data.progress.needs_review} to review</strong><span>{detail.data.progress.submitted} of {detail.data.progress.total} submitted</span></div>
            <div className="learning-assignment-list">{detail.data.progress.items.map(person => <button key={person.id} disabled={!detail.data || (detail.data.context !== "class" && detail.data.context !== "offering") || !detail.data.can_review} onClick={() => change({ learner: person.id, page: undefined })}><span><strong>{person.name}</strong><small>{person.status.replaceAll("_", " ")}</small></span><ChevronRight size={18} aria-hidden="true" /></button>)}</div>
            <nav className="learning-assignment-pages" aria-label="Learner pages">{page > 1 ? <button onClick={() => change({ page: String(page - 1) })}>Previous</button> : null}{detail.data.progress.has_more ? <button onClick={() => change({ page: String(page + 1) })}>Next</button> : null}</nav></>}
        </>}
      </>}
    </>}
    {composing ? <AssignmentComposer key={editing?.id ?? "new"} list={data} initial={editing} actorId={actorId} refresh={refresh} onClose={() => setComposing(false)} onSaved={accepted => { if (!active.current) return; setComposing(false); change({ assignment: accepted, learner: undefined, page: undefined }); }} /> : null}
  </div>;
}
export default LearningAssignmentsRoute;
