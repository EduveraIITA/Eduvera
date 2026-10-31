import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getOrphanedCareCases, recoverCareOwner, type OrphanedCareCase } from "./api";
import { useCareSave } from "./useCareSave";

function RecoveryRow({ schoolId, scope, item, refresh }: { schoolId: string; scope: readonly unknown[]; item: OrphanedCareCase; refresh: () => Promise<void> }) {
  const [owner, setOwner] = useState(""), [note, setNote] = useState("");
  const save = useCareSave({ schoolId, scope, caseId: item.id, slot: `recovery:${item.id}`, onAccepted: refresh });
  return <article className="care-orphan-row"><div><strong>Protected case · {item.id.slice(-6)}</strong><small>{item.owner_name} · {item.intake_route === "alternate" ? "Alternate" : "Primary"} route</small></div>
    <fieldset className="care-fields" disabled={save.locked}><label>New care lead<select value={owner} onChange={event => setOwner(event.target.value)}><option value="">Choose a care lead</option>{item.candidates.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label>
      {!item.candidates.length && <p className="care-hint">Assign an eligible lead on this protected route first.</p>}
      <label>Reason for recovery<textarea rows={2} value={note} onChange={event => setNote(event.target.value)} placeholder="Why responsibility must be restored" /></label></fieldset>
    {save.error && <p role="alert" className="care-error">{save.error}</p>}
    {save.recovery ? <button className="care-primary" type="button" disabled={save.busy} onClick={() => void save.recover()}>{save.busy ? "Checking…" : save.recovery === "accepted" ? "Refresh saved record" : save.retryReady ? "Retry exact save" : "Check exact result"}</button> : save.reviewNeeded ? <button type="button" className="care-primary" onClick={() => void refresh().then(save.reviewed).catch(() => undefined)}>Review latest queue</button>
      : <button className="care-primary" type="button" disabled={save.busy || !owner || note.trim().length < 20} onClick={() => { const input = { expected_revision: item.revision, owner_user_id: owner, note }; void save.execute(commandId => recoverCareOwner(schoolId, item.id, { ...input, command_id: commandId })); }}>Assign responsibility</button>}
  </article>;
}

export function CareOrphanRecovery({ schoolId, scope, refresh }: { schoolId: string; scope: readonly unknown[]; refresh: () => Promise<void> }) {
  const [open, setOpen] = useState(false), [page, setPage] = useState(1);
  const query = useQuery({ queryKey: [...scope, "orphaned-cases", page], queryFn: () => getOrphanedCareCases(schoolId, page), enabled: open });
  return <section className="care-orphan"><button className="care-secondary" type="button" aria-expanded={open} onClick={() => setOpen(value => !value)}>Restore unassigned responsibility</button>
    {open && <><p className="care-hint">Only cases without an active owner appear. Assigning a lead does not open confidential case content for you.</p>
      {query.isPending && <p role="status">Checking responsibilities…</p>}
      {query.error ? <p role="alert" className="care-error">The recovery queue could not be loaded. <button className="care-link" type="button" onClick={() => void query.refetch()}>Retry</button></p>
        : query.data && <>{!query.data.total ? <p role="status">Every open case has an active owner.</p> : <><p className="care-hint">{query.data.total} {query.data.total === 1 ? "case needs" : "cases need"} responsibility restored</p>{query.data.cases.map(item => <RecoveryRow key={item.id} schoolId={schoolId} scope={scope} item={item} refresh={async () => { await query.refetch({ throwOnError: true }); await refresh(); }} />)}
          {query.data.pages > 1 && <nav className="care-pagination" aria-label="Responsibility recovery pages"><button type="button" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Previous</button><span>Page {query.data.page} of {query.data.pages}</span><button type="button" disabled={page >= query.data.pages} onClick={() => setPage(value => value + 1)}>Next</button></nav>}</>}</>}
    </>}
  </section>;
}
