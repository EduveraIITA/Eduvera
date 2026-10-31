import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { getFacilitiesOptions, type FacilitiesPerson } from "./facilitiesApi";
import { FacilitiesPages } from "./FacilitiesPrimitives";

export interface FacilitiesChoice { id: string; label: string; map_status_supported?: boolean }
export function FacilitiesOptionPicker({ schoolId, actorId, title, kind, eligible, repairId, onClose, onSelected }: {
  schoolId: string; actorId: string; title: string; kind: "people" | "places" | "holdings";
  eligible?: "handler" | "verifier"; repairId?: string; onClose: () => void; onSelected: (choice: FacilitiesChoice) => void;
}) {
  const environment = useExecutionEnvironment(), [search, setSearch] = useState(""), [submitted, setSubmitted] = useState(""), [page, setPage] = useState(1);
  useEffect(() => { const timer = setTimeout(() => { setSubmitted(search.trim()); setPage(1); }, 250); return () => clearTimeout(timer); }, [search]);
  const options = useQuery({ queryKey: executionEnvironmentQueryKey(environment, ["facilities", schoolId, actorId, "options", repairId ?? "intake", submitted, page]), queryFn: () => getFacilitiesOptions(schoolId, submitted, page, repairId) });
  const entries = options.data?.[kind].filter(item => kind !== "people" || !eligible || (item as FacilitiesPerson).has_app_access) ?? [];
  const hasMore = options.data?.pagination[`${kind}_has_more`] ?? false;
  return <PlannerDialog title={title} onClose={onClose}><div className="facilities-form">
    <label>Find {kind === "people" ? "a person" : kind === "places" ? "a place" : "an item"}<input autoFocus type="search" maxLength={80} value={search} onChange={event => setSearch(event.target.value)} /></label>
    {options.isPending ? <p role="status">Loading choices…</p> : options.error ? <p role="alert" className="facilities-error">{options.error instanceof Error ? options.error.message : "Choices are unavailable."} <button type="button" className="is-text" onClick={() => void options.refetch()}>Try again</button></p>
      : <><ul className="facilities-choice-list">{entries.map(item => <li key={item.id}><button type="button" className="facilities-choice is-secondary" onClick={() => onSelected({ id: item.id, label: item.label, ...("map_status_supported" in item ? { map_status_supported: item.map_status_supported === true } : {}) })}>
        <span className="facilities-initials" aria-hidden="true">{item.label.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0]).join("")}</span><span><strong>{item.label}</strong>{"asset_tag" in item && typeof item.asset_tag === "string" && item.asset_tag ? <small>{item.asset_tag}</small> : null}</span></button></li>)}</ul>
        {!entries.length ? <p role="status" className="facilities-caption">{eligible ? "No eligible people on this page. Try a name or another page." : "No matching choices."}</p> : null}
        <FacilitiesPages label={`${title} pages`} page={page} hasMore={hasMore} onChange={setPage} /></>}
    <footer><button type="button" className="is-secondary" onClick={onClose}>Cancel</button></footer>
  </div></PlannerDialog>;
}
