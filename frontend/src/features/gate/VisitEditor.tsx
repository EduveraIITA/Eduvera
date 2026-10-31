import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { InfoSummary } from "../../components/InfoSummary";
import { TemporalInput } from "../../components/forms/TemporalInput";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { useUnsavedChangesGuard } from "../navigation/useUnsavedChangesGuard";
import { resourceInputInstant, resourceInputTime, resourceInputZone } from "../resources/resourceTime";
import { applicationNow } from "../simulation/applicationTime";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { createVisit, getVisit, getVisitOptions, updateVisit, type ArrangedVisit, type VisitDetail, type VisitInput, type VisitPerson, type VisitPlace } from "./visitApi";
import { VisitPicker } from "./VisitPicker";
import { VisitReadError, visitWindow } from "./VisitPrimitives";
import { useVisitCommand, VisitWriteFeedback } from "./useVisitCommand";

export function VisitEditor({ schoolId, actorId, initial, onClose, onSaved }: {
  schoolId: string; actorId: string; initial?: ArrangedVisit; onClose: () => void; onSaved: (result: VisitDetail) => Promise<unknown>;
}) {
  const environment = useExecutionEnvironment(), [base, setBase] = useState(initial), [latest, setLatest] = useState<ArrangedVisit | null>(null);
  const [mode, setMode] = useState<"guest" | "person">(initial?.person ? "person" : "guest"), [person, setPerson] = useState(initial?.person ?? null);
  const [guest, setGuest] = useState(initial?.guest_name ?? ""), [partySize, setPartySize] = useState(initial?.party_size ?? 1), [title, setTitle] = useState(initial?.title ?? "");
  const [starts, setStarts] = useState(() => resourceInputTime(initial?.starts_at ?? applicationNow())), [ends, setEnds] = useState(() => initial ? resourceInputTime(initial.ends_at) : "");
  const [place, setPlace] = useState<VisitPlace | null>(initial?.place ?? null), [contact, setContact] = useState<VisitPerson | null>(initial?.contact ?? null);
  const [selecting, setSelecting] = useState<"person" | "place" | "contact" | null>(null), [error, setError] = useState(""), [reviewing, setReviewing] = useState(false);
  const options = useQuery({ queryKey: executionEnvironmentQueryKey(environment, ["gate-visits", schoolId, actorId, "editor-options", initial?.id ?? "new"]), queryFn: ({ signal }) => getVisitOptions(schoolId, { ...(person ? { person_id: person.id } : {}), ...(contact ? { contact_person_id: contact.id } : {}), ...(place ? { place_id: place.id } : {}) }, signal), retry: false });
  const responsible = contact ?? (options.data?.actor ? { id: options.data.actor.person_id, label: options.data.actor.label, revision: options.data.actor.revision } : null);
  const identityLocked = Boolean(base?.last_movement);
  const write = useVisitCommand({ schoolId, sourceId: initial?.id, onAccepted: onSaved });
  const dirty = initial ? title !== initial.title || guest !== (initial.guest_name ?? "") || person?.id !== initial.person?.id || partySize !== initial.party_size || starts !== resourceInputTime(initial.starts_at) || ends !== resourceInputTime(initial.ends_at) || place?.id !== initial.place.id || responsible?.id !== initial.contact.id
    : Boolean(title || guest || person || partySize !== 1 || ends || place || contact);
  const guardClose = useUnsavedChangesGuard(dirty && !write.locked, "Discard this unfinished visit? Your changes have not been saved.");
  const close = () => { if (!write.busy && !write.recovery && !reviewing && guardClose()) onClose(); };
  const submit = (event: FormEvent) => {
    event.preventDefault(); setError(""); if (!place || !responsible || mode === "person" && !person) return;
    try {
      const starts_at = resourceInputInstant(starts), ends_at = resourceInputInstant(ends);
      if (ends_at <= starts_at) throw new Error("End must be after the start.");
      const payload: VisitInput = { person_id: mode === "person" ? person!.id : null, person_revision: mode === "person" ? person!.revision : null, guest_name: mode === "guest" ? guest.trim() : null, party_size: partySize, title: title.trim(), starts_at, ends_at, place_id: place.id, contact_person_id: responsible.id, contact_revision: responsible.revision };
      void write.execute(command_id => initial ? updateVisit(schoolId, initial.id, { ...payload, command_id, expected_revision: base!.revision }) : createVisit(schoolId, { ...payload, command_id, expected_revision: 0 }), base?.revision ?? 0);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Choose valid visit details."); }
  };
  const reviewLatest = async () => {
    setReviewing(true); setError("");
    try {
      if (initial) { const result = await getVisit(schoolId, initial.id); if (!result.can_edit) throw new Error("This visit can no longer be changed. Close this sheet to see its current state."); setBase(result.visit); setLatest(result.visit); if (result.visit.last_movement) { setMode(result.visit.person ? "person" : "guest"); setPerson(result.visit.person); setGuest(result.visit.guest_name ?? ""); } }
      await options.refetch({ throwOnError: true }); write.reviewed();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The current visit could not load."); }
    finally { setReviewing(false); }
  };
  const choose = (choice: VisitPerson | VisitPlace) => { if (selecting === "place") setPlace(choice as VisitPlace); else if (selecting === "person") setPerson(choice as VisitPerson); else setContact(choice as VisitPerson); setSelecting(null); };
  return <PlannerDialog title={initial ? "Edit visit" : "Arrange visit"} busy={write.busy || Boolean(write.recovery) || reviewing} onClose={close}>
    <form className="visits-form" onSubmit={submit}>
      {options.isPending ? <p role="status" className="visits-caption">Loading choices…</p> : options.error ? <VisitReadError error={options.error} onRetry={options.refetch} /> : null}
      {latest ? <section className="visits-summary" aria-label="Current saved visit"><h3>Current saved visit</h3><p>{latest.guest_label} · {latest.title} · {latest.party_size} planned</p><p className="visits-caption">{visitWindow(latest, options.data?.timezone ?? "UTC")} · {latest.place.label} · Contact: {latest.contact.label}</p><p className="visits-caption">Your edits are kept below. Check them before saving over this version.</p></section> : null}
      <fieldset disabled={write.locked || reviewing || options.isPending || Boolean(options.error)}>
        <div className="visits-mode" role="group" aria-label="Visitor identity"><button type="button" className="is-secondary" aria-pressed={mode === "guest"} disabled={identityLocked} onClick={() => setMode("guest")}>Guest or group</button><button type="button" className="is-secondary" aria-pressed={mode === "person"} disabled={identityLocked} onClick={() => setMode("person")}>Campus person</button></div>
        {mode === "guest" ? <label>{partySize > 1 ? "Group contact name" : "Guest name"}<input required autoComplete="off" maxLength={150} disabled={identityLocked} value={guest} onChange={event => setGuest(event.target.value)} /></label> : <div className="visits-field"><span>Person</span><button type="button" className="is-secondary visits-select" disabled={identityLocked} onClick={() => setSelecting("person")}>{person?.label ?? "Choose person"}</button></div>}
        <div className="visits-pair visits-purpose-pair"><label>Visit for<input required maxLength={160} value={title} onChange={event => setTitle(event.target.value)} placeholder="e.g. Laboratory demonstration" /></label><label>People<input required type="number" min={1} max={5000} step={1} value={partySize} onChange={event => setPartySize(Number(event.target.value))} /></label></div>
        {identityLocked ? <p className="visits-caption">Guest identity is retained with the movement record. Updating the planned count does not change earlier observations.</p> : null}
        <div className="visits-pair visits-time-pair"><label>From<TemporalInput required type="datetime-local" value={starts} onChange={event => setStarts(event.target.value)} /></label><label>Until<TemporalInput required type="datetime-local" value={ends} onChange={event => setEnds(event.target.value)} /></label></div>
        <div className="visits-field"><span>Meeting place</span><button type="button" className="is-secondary visits-select" onClick={() => setSelecting("place")}>{place?.label ?? "Choose place"}</button></div>
        <div className="visits-field"><span>Campus contact</span><button type="button" className="is-secondary visits-select" onClick={() => setSelecting("contact")}>{responsible?.label ?? "Choose contact"}</button></div>
        <details><InfoSummary>Visit details</InfoSummary><p className="visits-caption">Times entered in {resourceInputZone()}. This confirms the plan, not arrival or a room booking. No account is created for a guest.</p></details>
      </fieldset>
      {error ? <p className="visits-error" role="alert">{error}</p> : null}<VisitWriteFeedback write={write} onReview={reviewLatest} />
      <footer><button type="button" className="is-secondary" disabled={write.busy || Boolean(write.recovery) || reviewing} onClick={close}>Cancel</button><button type="submit" disabled={write.locked || reviewing || !options.data || Boolean(options.error) || !title.trim() || !ends || !place || !responsible || mode === "guest" && !guest.trim() || mode === "person" && !person}>{write.busy ? "Saving…" : initial ? "Save changes" : "Confirm visit"}</button></footer>
    </form>
    {selecting ? <VisitPicker schoolId={schoolId} actorId={actorId} kind={selecting === "place" ? "places" : "people"} title={selecting === "place" ? "Choose meeting place" : selecting === "contact" ? "Choose campus contact" : "Choose person"} onClose={() => setSelecting(null)} onSelected={choose} /> : null}
  </PlannerDialog>;
}
