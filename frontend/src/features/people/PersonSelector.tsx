import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { listParticipants } from "./participationApi";

export interface PersonSelection { id: string; label: string }

/** An explicit existing-person choice; names and contact details never merge identities. */
export function PersonSelector({ schoolId, label, value, onChange, excludeId, disabled = false }: {
  schoolId: string; label: string; value: PersonSelection | null; onChange: (value: PersonSelection | null) => void;
  excludeId?: string; disabled?: boolean;
}) {
  const environment = useExecutionEnvironment();
  const [search, setSearch] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => { const timer = setTimeout(() => { setSubmitted(search.trim()); setPage(1); }, 250); return () => clearTimeout(timer); }, [search]);
  const query = useQuery({ queryKey: executionEnvironmentQueryKey(environment, ["people.participants", schoolId, "selector", submitted, page]),
    queryFn: () => listParticipants(schoolId, submitted, page), enabled: Boolean(schoolId) });
  return <fieldset className="person-selector" disabled={disabled}>
    <legend>{label}</legend>
    {value ? <p className="person-selector__selected"><strong>{value.label}</strong><button type="button" onClick={() => onChange(null)}>Change selection</button></p> : null}
    <label>Find a campus person<input type="search" value={search} onChange={event => setSearch(event.target.value)} autoComplete="off" /></label>
    {query.isPending ? <p role="status">Loading people…</p> : query.isError ? <p role="alert">{query.error.message} <button type="button" onClick={() => void query.refetch()}>Try again</button></p> : <>
      <div className="participation-person-options">{query.data.results.filter(person => person.id !== excludeId).map(person => <label key={person.id}>
        <input type="radio" name={`person-selection-${label}`} checked={value?.id === person.id} onChange={() => onChange({ id: person.id, label: person.label })} />
        <span>{person.label}<small>{person.affiliations.join(" · ") || "Campus person"}</small></span>
      </label>)}</div>
      {!query.data.results.filter(person => person.id !== excludeId).length ? <p>No matching people. Add the person in People first, then return to this action.</p> : null}
      <nav className="participation-pagination" aria-label={`${label} result pages`}><button type="button" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous people</button><span>Page {page} of {Math.max(1, Math.ceil(query.data.total / query.data.page_size))}</span><button type="button" disabled={page * query.data.page_size >= query.data.total} onClick={() => setPage(page + 1)}>Next people</button></nav>
    </>}
  </fieldset>;
}
