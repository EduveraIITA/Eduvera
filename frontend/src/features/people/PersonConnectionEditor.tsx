import { useState, type FormEvent } from "react";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { TemporalInput } from "../../components/forms/TemporalInput";
import { PersonSelector, type PersonSelection } from "./PersonSelector";
import { createPersonConnection, endPersonConnection, savePersonContact, type ParticipantDetail, type PersonConnection } from "./participationApi";

export function PersonContactEditor({ schoolId, person, onClose, onSaved }: { schoolId: string; person: ParticipantDetail; onClose: () => void; onSaved: () => void }) {
  const [email, setEmail] = useState(person.profile?.contact_email ?? ""), [phone, setPhone] = useState(person.profile?.contact_phone ?? "");
  const [reason, setReason] = useState(""), [key, setKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [revision] = useState(person.revision);
  const changed = () => setKey(crypto.randomUUID());
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { await savePersonContact(schoolId, person.id, { contact_email: email.trim(), contact_phone: phone.trim(), expected_revision: revision, reason: reason.trim(), idempotency_key: key }); onSaved(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Contact details were not confirmed. Your changes are retained."); }
    finally { setBusy(false); }
  }
  return <PlannerDialog title="Edit contact details" subtitle={person.label} onClose={onClose} busy={busy}><form className="planner-lesson-form people-editor-form" onSubmit={event => void save(event)}>
    <fieldset disabled={busy} className="onboarding-fields"><label><span>Contact email <small>(optional)</small></span><input type="email" maxLength={254} value={email} onChange={event => { changed(); setEmail(event.target.value); }} /></label>
      <label><span>Contact phone <small>(optional)</small></span><input type="tel" maxLength={32} value={phone} onChange={event => { changed(); setPhone(event.target.value); }} /></label>
      <label>Reason for change<textarea required minLength={3} maxLength={500} value={reason} onChange={event => { changed(); setReason(event.target.value); }} /></label>
      <p>Contact information does not change login credentials, send invitations or establish someone’s identity.</p>
      {error ? <p role="alert" className="planner-form-error">{error}</p> : null}<footer><button type="button" className="is-secondary" onClick={onClose}>Cancel</button><button type="submit" disabled={reason.trim().length < 3}>Save contact details</button></footer>
    </fieldset>
  </form></PlannerDialog>;
}

export function PersonConnectionEditor({ schoolId, person, connection, onClose, onSaved }: {
  schoolId: string; person: ParticipantDetail; connection?: PersonConnection; onClose: () => void; onSaved: () => void;
}) {
  const [target, setTarget] = useState<PersonSelection | null>(null);
  const [start, setStart] = useState(""), [end, setEnd] = useState("");
  const [reason, setReason] = useState(""), [key, setKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const changed = () => setKey(crypto.randomUUID());
  async function save(event: FormEvent) {
    event.preventDefault(); if (!connection && !target) return; setBusy(true); setError("");
    try {
      if (connection) await endPersonConnection(schoolId, connection.id, { expected_revision: connection.revision, ends_on: end, reason: reason.trim(), idempotency_key: key });
      else await createPersonConnection(schoolId, person.id, { type: "mentor_of", target_person_id: target!.id, starts_on: start, ends_on: end || null, reason: reason.trim(), idempotency_key: key });
      onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The connection was not saved. Your choices are retained."); }
    finally { setBusy(false); }
  }
  return <PlannerDialog title={connection ? "End mentoring connection" : "Add mentoring connection"} subtitle={person.label} onClose={onClose} busy={busy}><form className="planner-lesson-form people-editor-form" onSubmit={event => void save(event)}>
    <p>{connection ? `End the connection with ${connection.related_person.label}. Its earlier history remains available.` : `${person.label} will be recorded as mentor of the selected person. This does not grant access, responsibility or safeguarding authority.`}</p>
    {!connection ? <PersonSelector schoolId={schoolId} label="Person being mentored" value={target} onChange={value => { changed(); setTarget(value); }} excludeId={person.id} disabled={busy} /> : null}
    <fieldset disabled={busy} className="onboarding-fields"><div className="planner-form-pair">{!connection ? <label>Starts on<TemporalInput type="date" required value={start} onChange={event => { changed(); setStart(event.target.value); }} /></label> : null}
      <label>{connection ? "Last day of connection" : "Ends on (optional)"}<TemporalInput type="date" required={Boolean(connection)} min={start || connection?.starts_on || undefined} value={end} onChange={event => { changed(); setEnd(event.target.value); }} /></label></div>
      <label>Reason<textarea required minLength={3} maxLength={500} value={reason} onChange={event => { changed(); setReason(event.target.value); }} /></label>
      <p>Dates include the last day shown. Ending this link does not end another connection or change past records.</p>
      {error ? <p role="alert" className="planner-form-error">{error}</p> : null}<footer><button type="button" className="is-secondary" onClick={onClose}>Cancel</button><button type="submit" disabled={reason.trim().length < 3 || !connection && (!target || !start)}>{connection ? "End connection" : "Save connection"}</button></footer>
    </fieldset>
  </form></PlannerDialog>;
}
