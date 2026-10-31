import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronRight, Plus, Search, X } from "lucide-react";
import { InfoSummary } from "../../components/InfoSummary";
import { TemporalInput } from "../../components/forms/TemporalInput";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { useUnsavedChangesGuard } from "../navigation/useUnsavedChangesGuard";
import { PeopleBulkAddDialog } from "../people/PeopleBulkAddDialog";
import { getParticipant, listParticipants } from "../people/participationApi";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { createLearningOffering, type LearningOfferingList, type OfferingPerson } from "./offeringApi";
import { useAssignmentWrite } from "./useAssignmentWrite";

const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("");
export function LearningOfferingSetup({ schoolId, source, refresh, onClose, onCreated }: {
  schoolId: string; source: LearningOfferingList; refresh: () => Promise<unknown>; onClose: () => void; onCreated: (id: string) => void;
}) {
  const [offeringId] = useState(() => crypto.randomUUID()), [name, setName] = useState(""), [reviewing, setReviewing] = useState(false);
  const [people, setPeople] = useState<OfferingPerson[]>([]), [instructor, setInstructor] = useState<OfferingPerson | null>(null);
  const [startsOn, setStartsOn] = useState(source.today), [picker, setPicker] = useState<"people" | "instructor" | null>(null);
  const [adding, setAdding] = useState(false), [selectionError, setSelectionError] = useState(""), [selecting, setSelecting] = useState(false);
  const active = useRef(true), selectingRef = useRef(false), created = useRef<string | null>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const write = useAssignmentWrite(async () => { await refresh(); if (active.current && created.current) onCreated(created.current); }, "offering");
  const guard = useUnsavedChangesGuard(Boolean(name || people.length || instructor) || write.busy || write.locked, "Leave this learning group? Unsaved choices will be lost.");
  const disabled = selecting || write.busy || write.locked;
  const addSelected = async (ids: string[]) => {
    if (disabled || selectingRef.current) return;
    if (instructor && ids.includes(instructor.id)) { setAdding(false); setPicker(null); setSelectionError("The instructor cannot also be a learner in this assignment group."); return; }
    selectingRef.current = true; setSelecting(true); setSelectionError("");
    try {
      const resolved = await Promise.all(ids.map(id => getParticipant(schoolId, id)));
      if (!active.current) return;
      const next = [...new Map([...people, ...resolved.map(person => ({ id: person.id, name: person.label, revision: person.revision }))].map(person => [person.id, person])).values()];
      if (next.length > 100) throw new Error("Choose up to 100 people for this group.");
      setPeople(next); setAdding(false); setPicker(null);
    } catch (cause) { if (active.current) setSelectionError(cause instanceof Error ? cause.message : "These people could not be checked."); }
    finally { selectingRef.current = false; if (active.current) setSelecting(false); }
  };
  const save = () => {
    if (!instructor || !name.trim() || !people.length || disabled) return;
    const payload = { offering_id: offeringId, name: name.trim(), starts_on: startsOn,
      instructor: { id: instructor.id, expected_revision: instructor.revision }, participants: people.map(person => ({ id: person.id, expected_revision: person.revision })) };
    void write.run(JSON.stringify(payload), command_id => createLearningOffering({ ...payload, command_id }), result => { created.current = result.id; }, { sourceId: offeringId, expectedRevision: 0, selectedPersons: [...payload.participants, payload.instructor] });
  };
  return <PlannerDialog title="Set up a learning group" busy={write.busy || selecting} onClose={() => { if (!disabled && guard()) onClose(); }}>
    <form className="learning-assignment-form learning-offering-form" onSubmit={event => { event.preventDefault(); if (reviewing) save(); else setReviewing(true); }}>
      {reviewing ? <section className="learning-assignment-review"><h3>{name}</h3><p><strong>{instructor?.name}</strong> will publish assignments and review this group’s work.</p><p className="learning-assignment-caption">{people.length} {people.length === 1 ? "learner" : "learners"} · From {startsOn}</p><div className="learning-offering-chips">{people.map(person => <span key={person.id} className="learning-offering-review-name">{person.name}</span>)}</div></section> : <fieldset disabled={disabled}>
        <label>Group name<input autoFocus required maxLength={150} value={name} placeholder="e.g. Saturday robotics" onChange={event => setName(event.target.value)} /></label>
        <section aria-label="Learners"><div className="learning-assignment-label"><h3>Learners <small>{people.length || ""}</small></h3><button type="button" onClick={() => setAdding(true)}><Plus size={18} aria-hidden="true" />Add people</button></div>
          <button type="button" className="learning-offering-choice" onClick={() => setPicker("people")}><Search size={20} aria-hidden="true" /><span>{people.length ? "Find more people" : "Choose existing people"}</span><ChevronRight size={18} aria-hidden="true" /></button>
          {people.length ? <div className="learning-offering-chips">{people.map(person => <span key={person.id}>{person.name}<button type="button" aria-label={`Remove ${person.name}`} onClick={() => setPeople(people.filter(item => item.id !== person.id))}><X size={16} /></button></span>)}</div> : null}
        </section>
        <section aria-label="Teaching responsibility"><h3>Who will teach?</h3><button type="button" className="learning-offering-choice" onClick={() => setPicker("instructor")}>
          <span className="learning-offering-avatar" aria-hidden="true">{instructor ? initials(instructor.name) : "?"}</span><span><strong>{instructor?.name ?? "Choose an instructor"}</strong><small>Can publish assignments and review this group’s work</small></span><ChevronRight size={18} aria-hidden="true" /></button></section>
        <details><InfoSummary>Start date</InfoSummary><label>From <span className="learning-assignment-caption">{source.timezone}</span><TemporalInput type="date" required max={source.today} value={startsOn} onChange={event => setStartsOn(event.target.value)} /></label></details>
      </fieldset>}
      {selectionError ? <p role="alert">{selectionError}</p> : null}{write.error ? <p role="alert">{write.error}</p> : null}
      {write.locked && write.recovery !== "obsolete" ? <button type="button" disabled={write.busy} onClick={() => void write.recover()}>{write.recovery === "unknown" ? "Retry same action" : "Refresh saved group"}</button> : null}
      {write.recovery === "obsolete" ? <button type="button" disabled={write.busy || selecting} onClick={() => {
        setSelecting(true); setSelectionError("");
        void Promise.all([...people, ...(instructor ? [instructor] : [])].map(person => getParticipant(schoolId, person.id))).then(current => {
          if (!active.current) return;
          const refs = current.map(person => ({ id: person.id, name: person.label, revision: person.revision }));
          setPeople(refs.slice(0, people.length)); setInstructor(refs[people.length] ?? null); setReviewing(false); write.resolveObsolete();
        }).catch(cause => { if (active.current) setSelectionError(cause instanceof Error ? cause.message : "Current choices could not be loaded."); }).finally(() => { if (active.current) setSelecting(false); });
      }}>Review current people</button> : null}
      <footer className="learning-assignment-actions"><button type="button" disabled={disabled} onClick={() => { if (reviewing) setReviewing(false); else if (guard()) onClose(); }}>{reviewing ? "Back" : "Cancel"}</button><button type="submit" disabled={disabled || !name.trim() || !people.length || !instructor || !startsOn}>{write.busy ? "Saving…" : reviewing ? "Create group" : "Review group"}</button></footer>
    </form>
    {adding ? <PeopleBulkAddDialog schoolId={schoolId} onClose={() => setAdding(false)} onDone={selected => { void addSelected(selected.map(person => person.id)); }} /> : null}
    {picker ? <LearningPersonPicker schoolId={schoolId} selected={picker === "people" ? people : instructor ? [instructor] : []} excludeIds={picker === "instructor" ? people.map(person => person.id) : instructor ? [instructor.id] : []} multiple={picker === "people"} busy={disabled} error={selectionError} onClose={() => setPicker(null)} onDone={ids => {
      if (picker === "people") { void addSelected(ids); return; }
      if (disabled || selectingRef.current) return;
      selectingRef.current = true; setSelecting(true); setSelectionError(""); void getParticipant(schoolId, ids[0]!).then(person => { if (active.current) { setInstructor({ id: person.id, name: person.label, revision: person.revision }); setPicker(null); } }).catch(cause => { if (active.current) setSelectionError(cause instanceof Error ? cause.message : "The instructor could not be checked."); }).finally(() => { selectingRef.current = false; if (active.current) setSelecting(false); });
    }} /> : null}
  </PlannerDialog>;
}

export function LearningPersonPicker({ schoolId, selected, multiple, busy, error, excludeIds = [], onClose, onDone }: {
  schoolId: string; selected: OfferingPerson[]; multiple: boolean; busy: boolean; error?: string; excludeIds?: string[]; onClose: () => void; onDone: (ids: string[]) => void;
}) {
  const environment = useExecutionEnvironment(), [search, setSearch] = useState(""), [page, setPage] = useState(1), [ids, setIds] = useState(selected.map(person => person.id));
  const query = useQuery({ queryKey: executionEnvironmentQueryKey(environment, ["people.participants", schoolId, "learning-picker", search, page]), queryFn: () => listParticipants(schoolId, search, page) });
  return <PlannerDialog title={multiple ? "Choose learners" : "Choose instructor"} busy={busy} onClose={onClose}><div className="learning-assignment-form">
    <label>Find a person<input type="search" value={search} disabled={busy} onChange={event => { setSearch(event.target.value); setPage(1); }} /></label>
    {query.isPending ? <p role="status">Loading people…</p> : query.isError ? <p role="alert">People could not be loaded. <button onClick={() => void query.refetch()}>Try again</button></p> : <>
      <div className="learning-offering-person-list">{query.data.results.filter(person => !excludeIds.includes(person.id)).map(person => <button type="button" key={person.id} aria-pressed={ids.includes(person.id)} disabled={busy || !multiple && (!person.has_account || person.account_state === "inactive") || multiple && ids.length >= 100 && !ids.includes(person.id)} onClick={() => setIds(multiple ? ids.includes(person.id) ? ids.filter(id => id !== person.id) : [...ids, person.id] : [person.id])}>
        <span className="learning-offering-avatar" aria-hidden="true">{initials(person.label)}</span><span><strong>{person.label}</strong><small>{!multiple && (!person.has_account || person.account_state === "inactive") ? "Needs app access" : person.is_you ? "You" : person.affiliations.join(" · ") || "Campus person"}</small></span><span className="learning-offering-check" aria-hidden="true">{ids.includes(person.id) ? <Check size={16} /> : null}</span>
      </button>)}</div>
      {!query.data.results.length ? <p>No matching people.</p> : null}
      <nav className="learning-assignment-pages" aria-label="People pages"><button disabled={busy || page === 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page}</span><button disabled={busy || page * query.data.page_size >= query.data.total} onClick={() => setPage(page + 1)}>Next</button></nav>
    </>}
    {error ? <p role="alert">{error}</p> : null}
    <footer className="learning-assignment-actions"><button disabled={busy} onClick={onClose}>Cancel</button><button disabled={busy || !ids.length} onClick={() => onDone(ids)}>{busy ? "Checking…" : multiple ? `Use ${ids.length} ${ids.length === 1 ? "person" : "people"}` : "Use instructor"}</button></footer>
  </div></PlannerDialog>;
}
