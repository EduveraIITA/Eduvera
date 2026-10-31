import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { getDiningOptions, type DiningRef } from "./diningApi";
import { DiningPages } from "./DiningPrimitives";
import { ActivityPlaceQuickCreate } from "../activities/ActivityPlaceQuickCreate";

export function DiningPicker({ schoolId, actorId, title, kind, serviceId, sessionId, issueId, planId, onClose, onSelected }: {
  schoolId: string; actorId: string; title: string; kind: "people" | "spaces"; serviceId?: string; sessionId?: string; issueId?: string; planId?: string;
  onClose: () => void; onSelected: (choice: DiningRef) => void;
}) {
  const environment = useExecutionEnvironment(), [search, setSearch] = useState(""), [submitted, setSubmitted] = useState(""), [page, setPage] = useState(1), [adding, setAdding] = useState(false);
  useEffect(() => { const timer = setTimeout(() => { setSubmitted(search.trim()); setPage(1); }, 250); return () => clearTimeout(timer); }, [search]);
  const options = useQuery({ queryKey: executionEnvironmentQueryKey(environment, ["dining", schoolId, actorId, "options", serviceId ?? null, sessionId ?? null, issueId ?? null, planId ?? null, submitted, page]),
    queryFn: () => getDiningOptions(schoolId, { search: submitted, page, ...(serviceId ? { service_id: serviceId } : {}), ...(sessionId ? { session_id: sessionId } : {}), ...(issueId ? { issue_id: issueId } : {}), ...(planId ? { plan_id: planId } : {}) }) });
  const entries = kind === "people" ? options.data?.people.filter(person => person.has_app) ?? [] : options.data?.spaces ?? [];
  return <PlannerDialog title={title} onClose={onClose}><div className="dining-form"><label>Find {kind === "people" ? "a person" : "a place"}<input autoFocus type="search" maxLength={80} value={search} onChange={event => setSearch(event.target.value)} /></label>
    {kind === "spaces" && options.data?.can_create_places && !options.error ? <button type="button" className="is-text" onClick={() => setAdding(true)}>Add place</button> : null}
    {options.isPending ? <p role="status">Loading choices…</p> : options.error ? <p role="alert" className="dining-error">{options.error instanceof Error ? options.error.message : "Choices are unavailable."} <button type="button" className="is-text" onClick={() => void options.refetch()}>Try again</button></p> : <>
      <ul className="dining-choices">{entries.map(item => <li key={item.id}><button type="button" className="is-secondary dining-choice" onClick={() => onSelected(item)}>{item.label}</button></li>)}</ul>
      {!entries.length ? <p className="dining-caption" role="status">{kind === "people" ? "No eligible app users on this page. Try a name or another page." : "No matching places."}</p> : null}
      <DiningPages page={page} hasMore={options.data?.[`${kind}_has_more`] ?? false} onChange={setPage} label={`${title} pages`} />
    </>}
    <footer><button type="button" className="is-secondary" onClick={onClose}>Cancel</button></footer>
  </div>{adding ? <ActivityPlaceQuickCreate schoolId={schoolId} campuses={options.data?.campuses ?? []} onClose={() => setAdding(false)} onCreated={choice => { setAdding(false); onSelected(choice); }} /> : null}</PlannerDialog>;
}
