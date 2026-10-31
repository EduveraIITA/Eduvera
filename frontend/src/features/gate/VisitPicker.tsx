import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ProductIcon } from "../../components/ProductIcon";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { PeopleBulkAddDialog } from "../people/PeopleBulkAddDialog";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { getVisitOptions, type VisitPerson, type VisitPlace } from "./visitApi";
import { VisitPages, VisitReadError } from "./VisitPrimitives";

export function VisitPicker({ schoolId, actorId, kind, title, onClose, onSelected, allowAdd = false }: {
  schoolId: string; actorId: string; kind: "people" | "places"; title: string;
  onClose: () => void; onSelected: (choice: VisitPerson | VisitPlace) => void; allowAdd?: boolean;
}) {
  const environment = useExecutionEnvironment(), [search, setSearch] = useState(""), [query, setQuery] = useState(""), [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => { const timer = setTimeout(() => { setQuery(search.trim()); setPage(1); }, 250); return () => clearTimeout(timer); }, [search]);
  const options = useQuery({ queryKey: executionEnvironmentQueryKey(environment, ["gate-visits", schoolId, actorId, "options", query, page]), queryFn: ({ signal }) => getVisitOptions(schoolId, { q: query, page }, signal), retry: false });
  const items = options.data?.[kind] ?? [];
  return <PlannerDialog title={title} onClose={onClose}><div className="visits-form">
    <label>Find {kind === "people" ? "a person" : "a place"}<input autoFocus type="search" maxLength={80} value={search} onChange={event => setSearch(event.target.value)} /></label>
    {allowAdd && kind === "people" ? <button type="button" className="is-secondary" onClick={() => setAdding(true)}>Add people</button> : null}
    {error ? <p className="visits-error" role="alert">{error}</p> : null}
    {notice ? <p className="visits-caption" role="status">{notice}</p> : null}
    {options.isPending ? <p role="status" className="visits-caption">Loading choices…</p> : options.error ? <VisitReadError error={options.error} onRetry={options.refetch} /> : <>
      <ul className="visits-choices">{items.map(item => <li key={item.id}><button type="button" className="is-secondary visits-choice" onClick={() => onSelected(item)}><ProductIcon name={kind === "people" ? "people" : "building"} size={28} /><span><strong>{item.label}</strong>{"campus_label" in item && item.campus_label ? <small>{item.campus_label}</small> : null}</span></button></li>)}</ul>
      {!items.length ? <p role="status" className="visits-caption">{kind === "places" && !query && page === 1 ? "No meeting places are set up. Ask the campus setup coordinator to add one." : `No matching ${kind === "people" ? "people" : "places"}.`}</p> : null}
      <VisitPages page={page} hasNext={Boolean(options.data?.pagination[kind === "people" ? "people_has_more" : "places_has_more"])} busy={options.isFetching} onChange={setPage} />
    </>}
    <footer><button type="button" className="is-secondary" onClick={onClose}>Cancel</button></footer>
  </div>{adding ? <PeopleBulkAddDialog schoolId={schoolId} onClose={() => setAdding(false)} onDone={people => { setAdding(false); if (people.length > 1) { setNotice("People added. Choose the organiser."); void options.refetch(); return; } const person = people[0]; if (!person) return; void getVisitOptions(schoolId, { person_id: person.id }).then(result => { if (!active.current) return; const choice = result.people.find(item => item.id === person.id); if (!choice) throw new Error("This person is not available for the visit. Refresh your choices."); onSelected(choice); }).catch(cause => { if (active.current) setError(cause instanceof Error ? cause.message : "The person could not be selected."); }); }} /> : null}</PlannerDialog>;
}
