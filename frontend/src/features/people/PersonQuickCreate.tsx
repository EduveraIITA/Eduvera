import { useState, type FormEvent } from "react";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { createParticipant } from "./participationApi";
import { PERSON_NAME_MAX_LENGTH, personNameFields } from "./personName";

export function PersonQuickCreate({ schoolId, onClose, onCreated }: {
  schoolId: string; onClose: () => void; onCreated: (person: { id: string; label: string; affiliations?: string[] }) => void;
}) {
  const [name, setName] = useState("");
  const [affiliation, setAffiliation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(() => crypto.randomUUID());
  const changed = () => setRetryKey(crypto.randomUUID());
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!name.trim() || name.trim().length > PERSON_NAME_MAX_LENGTH) { setError(`Enter a name of 1–${PERSON_NAME_MAX_LENGTH} characters.`); return; }
    setError(""); setBusy(true);
    try {
      const person = await createParticipant(schoolId, { ...personNameFields(name),
        ...(affiliation ? { affiliation } : {}), idempotency_key: retryKey });
      onCreated(person);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "This person could not be saved. Your form is still here."); }
    finally { setBusy(false); }
  }
  return <PlannerDialog title="Add person" subtitle="Create once, reuse across campus activities" onClose={onClose} busy={busy}>
    <form className="planner-lesson-form people-editor-form" onSubmit={(event) => void submit(event)}>
      <label>Name<input autoFocus required maxLength={PERSON_NAME_MAX_LENGTH} autoComplete="off" value={name} disabled={busy} onChange={(event) => { changed(); setName(event.target.value); }} /></label>
      <label><span>Connection to campus <small>(optional)</small></span><select value={affiliation} disabled={busy} onChange={(event) => { changed(); setAffiliation(event.target.value); }}>
        <option value="">Not specified</option><option value="learner">Learner</option><option value="worker">Employee</option><option value="contractor">Contractor</option><option value="visitor">Visitor</option><option value="other">Other</option>
      </select></label>
      <p className="planner-form-note">This creates a campus person, not an app account. No email, invitation or access is required. Enrollment and responsibilities stay separate.</p>
      <p className="planner-form-note">Already on campus? Close this form and choose the existing person instead.</p>
      {error ? <p className="planner-form-error" role="alert">{error}</p> : null}
      <footer><button type="button" className="is-secondary" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" disabled={busy || !name.trim()}>{busy ? "Saving…" : "Add person"}</button></footer>
    </form>
  </PlannerDialog>;
}
