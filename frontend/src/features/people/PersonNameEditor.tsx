import { useId, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { useAuth } from "../auth/AuthContext";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { correctParticipantName, getParticipant, type ParticipantDetail } from "./participationApi";
import { PERSON_NAME_MAX_LENGTH, personDisplayName, personNameFields } from "./personName";

function NameForm({ schoolId, person, onClose, onSaved, onBusy }: { schoolId: string; person: ParticipantDetail; onClose: () => void; onSaved: (label: string) => void; onBusy: (busy: boolean) => void }) {
  const [originalName] = useState(() => personDisplayName(person));
  const [name, setName] = useState(originalName);
  const nameLimitId = useId();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [revision] = useState(person.revision);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const changed = () => setKey(crypto.randomUUID());
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!name.trim() || name.trim().length > PERSON_NAME_MAX_LENGTH) { setError(`Enter a name of 1–${PERSON_NAME_MAX_LENGTH} characters.`); return; }
    if (name.trim() === originalName) return;
    setError(""); setBusy(true); onBusy(true);
    try { const result = await correctParticipantName(schoolId, person.id, { ...personNameFields(name),
      expected_revision: revision, reason: reason.trim(), idempotency_key: key }); onSaved(result.label); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The correction was not confirmed. Your changes are retained."); }
    finally { setBusy(false); onBusy(false); }
  }
  return <form className="planner-lesson-form people-editor-form" onSubmit={(event) => void submit(event)}>
    <label>Name<input autoFocus required maxLength={Math.max(PERSON_NAME_MAX_LENGTH, originalName.length)} value={name} disabled={busy} aria-describedby={name.trim().length > PERSON_NAME_MAX_LENGTH ? nameLimitId : undefined} onChange={(event) => { changed(); setName(event.target.value); }} /></label>
    {name.trim().length > PERSON_NAME_MAX_LENGTH ? <p id={nameLimitId} className="planner-form-note">This saved name is shown in full. A corrected name must be {PERSON_NAME_MAX_LENGTH} characters or fewer.</p> : null}
    <label>Reason for correction<textarea required minLength={3} maxLength={500} value={reason} disabled={busy} onChange={(event) => { changed(); setReason(event.target.value); }} /></label>
    <p className="planner-form-note">This corrects this campus person only. It does not change account names, app access, employment or enrollment. Published timetable and attendance snapshots retain their recorded names.</p>
    <details><summary>Campus connections (read only)</summary>{person.affiliation_sources.length ? <ul>{person.affiliation_sources.map((item) => <li key={`${item.affiliation}:${item.source}`}>{item.affiliation} · {item.source}</li>)}</ul> : <p>No connection recorded.</p>}<p>These labels come from their owning records and do not grant access.</p></details>
    {error ? <p role="alert" className="planner-form-error">{error}</p> : null}
    <footer><button type="button" className="is-secondary" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" disabled={busy || !name.trim() || name.trim().length > PERSON_NAME_MAX_LENGTH || reason.trim().length < 3 || name.trim() === originalName}>{busy ? "Saving…" : "Save correction"}</button></footer>
  </form>;
}

export function PersonNameEditor({ schoolId, personId, onClose, onSaved }: { schoolId: string; personId: string; onClose: () => void; onSaved: (label: string) => void }) {
  const environment = useExecutionEnvironment();
  const auth = useAuth();
  const [busy, setBusy] = useState(false);
  const detail = useQuery({ queryKey: executionEnvironmentQueryKey(environment, ["people.participants", schoolId, "detail", personId]),
    queryFn: () => getParticipant(schoolId, personId), refetchOnWindowFocus: false });
  return <PlannerDialog title="Correct person name" onClose={onClose} busy={busy}>
    {detail.isPending ? <p role="status">Loading person…</p> : detail.isError ? <div role="alert"><p>{detail.error.message}</p><button type="button" onClick={() => void detail.refetch()}>Try again</button></div>
      : <NameForm key={JSON.stringify(executionEnvironmentQueryKey(environment, ["person-name-form", auth.user?.id, schoolId, personId]))} schoolId={schoolId} person={detail.data} onClose={onClose} onSaved={onSaved} onBusy={setBusy} />}
  </PlannerDialog>;
}
