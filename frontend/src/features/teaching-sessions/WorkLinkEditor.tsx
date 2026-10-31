import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { useUnsavedChangesGuard } from "../navigation/useUnsavedChangesGuard";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { getTeachingWorkOptions, linkTeachingWork, type SessionWorkOption, type TeachingSessionDetail } from "./api";
import { useTeachingSessionWrite } from "./useTeachingSessionWrite";

export function WorkLinkEditor({ data, schoolId, actorId, refresh, onClose, onAccessLost }: { data: TeachingSessionDetail; schoolId: string; actorId: string; refresh: () => Promise<TeachingSessionDetail>; onClose: () => void; onAccessLost?: () => void }) {
  const environment = useExecutionEnvironment(), [source, setSource] = useState(data), [page, setPage] = useState(1), [selected, setSelected] = useState<SessionWorkOption | null>(null);
  const [reviewing, setReviewing] = useState(false), [current, setCurrent] = useState<TeachingSessionDetail | null>(null), [reviewError, setReviewError] = useState("");
  const list = useQuery({ queryKey: executionEnvironmentQueryKey(environment, ["teaching-session-work-options", schoolId, actorId, source.session.id, source.session.date, source.session.source_fingerprint, page]), queryFn: () => getTeachingWorkOptions(source.session.id, source.session.date, page) });
  const write = useTeachingSessionWrite(refresh, onAccessLost), disabled = write.busy || write.locked || reviewing;
  const guard = useUnsavedChangesGuard(Boolean(selected) || write.busy || write.locked, "Leave this work link? Keep this screen while an unconfirmed link is resolved.");
  const save = async () => {
    if (!selected || disabled) return;
    const input = { expected_revision: source.lesson.revision, source_fingerprint: source.session.source_fingerprint, work_kind: selected.work_kind, work_id: selected.work_id };
    if (await write.run(JSON.stringify(input), command_id => linkTeachingWork(source.session.id, source.session.date, { command_id, ...input }), { sourceId: source.session.id, revision: source.lesson.revision, fingerprint: source.session.source_fingerprint })) onClose();
  };
  const review = async () => {
    setReviewing(true); setReviewError("");
    try { const fresh = await refresh(); if (fresh.capabilities.can_link_work && fresh.session.state === "expected") setCurrent(fresh); else setReviewError("You can no longer link learning work to this session."); }
    catch { setReviewError("The current session could not load. Your selection is kept."); }
    finally { setReviewing(false); }
  };
  return <PlannerDialog title="Link learning work" busy={write.busy || reviewing} onClose={() => { if (!write.busy && !reviewing && guard()) onClose(); }}>
    <div className="teaching-session-form">
      <p className="teaching-caption">Choose published work for {source.session.group_label}. Its audience, submissions and review access stay unchanged.</p>
      {list.isPending ? <p role="status">Loading available work…</p> : list.error || !list.data ? <div role="alert"><p>Available work could not load.</p><button disabled={disabled} onClick={() => void list.refetch()}>Try again</button></div> : !list.data.supported ? <p role="status" className="teaching-caption">{list.data.reason || "This session does not have an eligible learning-work context."}</p> : <>
        {list.data.items.length ? <fieldset disabled={disabled} className="teaching-work-options"><legend className="sr-only">Published work</legend>{list.data.items.map(item => <label key={`${item.work_kind}:${item.work_id}`} className={selected?.work_kind === item.work_kind && selected.work_id === item.work_id ? "is-selected" : undefined}><input type="radio" name="session-learning-work" checked={selected?.work_kind === item.work_kind && selected.work_id === item.work_id} onChange={() => setSelected(item)} /><span><strong>{item.title}</strong><small>{item.work_kind === "assignment" ? "Assignment" : "Practice"}{item.due_at ? ` · Due ${new Date(item.due_at).toLocaleDateString()}` : ""}</small></span></label>)}</fieldset> : <p className="teaching-caption">No eligible published work yet. Create or publish it in the existing learning workspace, then return here.</p>}
        {page > 1 || list.data.has_more ? <nav className="teaching-actions" aria-label="Available work pages"><button disabled={disabled || page <= 1} onClick={() => setPage(page - 1)}>Previous</button><button disabled={disabled || !list.data?.has_more} onClick={() => setPage(page + 1)}>Next</button></nav> : null}
      </>}
      {write.error ? <p className="teaching-error" role="alert">{write.error}</p> : null}
      {write.recovery === "unknown" || write.recovery === "accepted" ? <button type="button" disabled={write.busy} onClick={() => { void write.recover().then(saved => { if (saved) onClose(); }); }}>{write.recovery === "unknown" ? "Retry same action" : "Refresh saved session"}</button> : null}
      {write.recovery === "obsolete" ? <button disabled={reviewing} onClick={() => void review()}>Review current session</button> : null}
      {reviewError ? <p role="alert">{reviewError}</p> : null}
      {current ? <section className="teaching-review"><h3>Current session</h3><strong>{current.session.title}</strong><p className="teaching-caption">{current.session.place_label ?? "Place not assigned"} · {current.session.teacher_name ?? "Teacher not assigned"}</p><button onClick={() => { setSource(current); setCurrent(null); setSelected(null); setPage(1); write.resolveObsolete(); }}>Review available work again</button></section> : null}
      <footer className="teaching-actions"><button disabled={write.busy || reviewing} onClick={() => { if (guard()) onClose(); }}>Cancel</button><button className="is-primary" disabled={disabled || !selected || !list.data?.supported || Boolean(list.error)} onClick={() => void save()}>{write.busy ? "Linking…" : "Link work"}</button></footer>
    </div>
  </PlannerDialog>;
}
