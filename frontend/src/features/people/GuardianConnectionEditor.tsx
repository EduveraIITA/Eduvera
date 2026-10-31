import { useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { PersonSelector, type PersonSelection } from "./PersonSelector";
import { getParticipant, type ParticipantDetail } from "./participationApi";
import { linkPersonGuardian } from "./api";

export function GuardianConnectionEditor({ schoolId, person, studentId, onClose, onSaved }: {
  schoolId: string; person: ParticipantDetail; studentId?: string; onClose: () => void; onSaved: () => void;
}) {
  const [target, setTarget] = useState<PersonSelection | null>(null), [relationship, setRelationship] = useState<"guardian" | "mother" | "father">("guardian");
  const [primary, setPrimary] = useState(false), [key, setKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [needsEnrollment, setNeedsEnrollment] = useState<PersonSelection | null>(null);
  const command = useRef<Parameters<typeof linkPersonGuardian>[0] | null>(null);
  const changed = () => { command.current = null; setKey(crypto.randomUUID()); };
  async function save(event: FormEvent) {
    event.preventDefault(); if (!target) return; setBusy(true); setError(""); setNeedsEnrollment(null);
    try {
      if (!command.current) {
        const selected = await getParticipant(schoolId, target.id);
        const learnerId = studentId ?? selected.source_profiles?.find(source => source.kind === "learning")?.id;
        if (!learnerId) { setNeedsEnrollment(target); throw new Error("The selected person has no learner record. Enroll them first, then link the guardian here."); }
        const guardian = studentId ? selected : person;
        command.current = { school_id: schoolId, student_id: learnerId, person: { id: guardian.id, expected_revision: guardian.revision }, relationship, is_primary: primary, idempotency_key: key };
      }
      await linkPersonGuardian(command.current);
      onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The family connection was not confirmed. Your choices are retained."); }
    finally { setBusy(false); }
  }
  return <PlannerDialog title="Add family connection" subtitle={person.label} onClose={onClose} busy={busy}><form className="planner-lesson-form people-editor-form" onSubmit={event => void save(event)}>
    <p>{studentId ? `Choose a guardian for ${person.label}.` : `Record ${person.label} as guardian of an enrolled learner.`} This adds a contact relationship, not app access, leave signing or collection authority.</p>
    <PersonSelector schoolId={schoolId} label={studentId ? "Guardian" : "Learner"} value={target} onChange={value => { changed(); setNeedsEnrollment(null); setTarget(value); }} excludeId={person.id} disabled={busy} />
    <fieldset className="onboarding-fields" disabled={busy}><label>Relationship to learner<select value={relationship} onChange={event => { changed(); setRelationship(event.target.value as typeof relationship); }}><option value="guardian">Guardian</option><option value="mother">Mother</option><option value="father">Father</option></select></label>
      <label className="people-confirm"><input type="checkbox" checked={primary} onChange={event => { changed(); setPrimary(event.target.checked); }} />Primary contact</label>
      {error ? <p role="alert" className="planner-form-error">{error}</p> : null}{needsEnrollment ? <Link to={`/areas/people/participants/${encodeURIComponent(needsEnrollment.id)}`} onClick={onClose}>Open {needsEnrollment.label} to enroll</Link> : null}<footer><button type="button" className="is-secondary" onClick={onClose}>Cancel</button><button type="submit" disabled={!target}>Save family connection</button></footer>
    </fieldset>
  </form></PlannerDialog>;
}
