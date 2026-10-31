import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { PeopleBulkAddDialog } from "../people/PeopleBulkAddDialog";
import { getParticipant } from "../people/participationApi";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { getFacilitiesOptions, type FacilitiesPerson } from "./facilitiesApi";
import { FacilitiesPages } from "./FacilitiesPrimitives";

export type RepairTechnician = FacilitiesPerson & { revision: number; has_app_access: boolean };
export function RepairTechnicianPicker({ schoolId, repairId, actorId, onClose, onSelected }: {
  schoolId: string; repairId: string; actorId: string; onClose: () => void; onSelected: (person: RepairTechnician) => void;
}) {
  const world = useExecutionEnvironment(), [search, setSearch] = useState(""), [query, setQuery] = useState(""), [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  useEffect(() => { const timer = setTimeout(() => { setQuery(search.trim()); setPage(1); }, 250); return () => clearTimeout(timer); }, [search]);
  const options = useQuery({ queryKey: executionEnvironmentQueryKey(world, ["facilities", schoolId, actorId, "technicians", repairId, query, page]), queryFn: () => getFacilitiesOptions(schoolId, query, page, repairId) });
  return <PlannerDialog title="Choose technician" onClose={onClose}><div className="facilities-form">
    <div className="facilities-inline-actions"><label className="facilities-grow">Find a person<input autoFocus type="search" maxLength={80} value={search} onChange={event => setSearch(event.target.value)} /></label><button type="button" className="is-secondary" onClick={() => setAdding(true)}>Add people</button></div>
    {notice ? <p role="status" className="facilities-caption">{notice}</p> : null}
    {options.isPending ? <p role="status">Loading people…</p> : options.error ? <p role="alert" className="facilities-error">{options.error.message} <button type="button" className="is-text" onClick={() => void options.refetch()}>Try again</button></p> : <>
      <ul className="facilities-choice-list">{options.data?.people.map(person => <li key={person.id}><button type="button" className="facilities-choice is-secondary" disabled={!person.revision} onClick={() => onSelected({ ...person, revision: person.revision!, has_app_access: person.has_app_access === true })}><span className="facilities-initials" aria-hidden="true">{person.label.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0]).join("")}</span><span><strong>{person.label}</strong><small>{person.has_app_access ? "App account connected" : "Needs an app invitation"}</small></span></button></li>)}</ul>
      {!options.data?.people.length ? <p className="facilities-caption">No matching people. Add them once or ask the campus People coordinator.</p> : null}
      <FacilitiesPages page={page} hasMore={options.data?.pagination.people_has_more ?? false} onChange={setPage} />
    </>}
    {error ? <p className="facilities-error" role="alert">{error}</p> : null}
    <footer><button type="button" className="is-secondary" onClick={onClose}>Cancel</button></footer>
  </div>{adding ? <PeopleBulkAddDialog schoolId={schoolId} onClose={() => setAdding(false)} onDone={people => {
    setAdding(false); setError("");
    if (people.length !== 1) { setNotice(`${people.length} people added. Choose who will handle this repair.`); void options.refetch(); return; }
    void getParticipant(schoolId, people[0]!.id).then(person => onSelected({ id: person.id, label: person.label, revision: person.revision, has_app_access: person.has_account === true })).catch(cause => { setError(cause instanceof Error ? cause.message : "The new person could not be checked. Find them in the list before sharing."); void options.refetch(); });
  }} /> : null}</PlannerDialog>;
}
