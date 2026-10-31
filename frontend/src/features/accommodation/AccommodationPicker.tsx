import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PeopleBulkAddDialog } from "../people/PeopleBulkAddDialog";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { getAccommodationOptions, type AccommodationRef } from "./accommodationApi";
import { AccommodationPages } from "./AccommodationPrimitives";

export function AccommodationPicker({ schoolId, actorId, title, kind, appRequired = false, stayId, repairId, roomId, spaceKinds, campusId, onClose, onSelected }: {
  schoolId: string; actorId: string; title: string; kind: "people" | "spaces" | "rooms" | "holdings";
  appRequired?: boolean; stayId?: string; repairId?: string; roomId?: string; spaceKinds?: string[]; campusId?: string; onClose: () => void; onSelected: (choice: AccommodationRef) => void;
}) {
  const environment = useExecutionEnvironment(), [search, setSearch] = useState(""), [submitted, setSubmitted] = useState(""), [page, setPage] = useState(1), [adding, setAdding] = useState(false), [message, setMessage] = useState("");
  useEffect(() => { const timer = setTimeout(() => { setSubmitted(search.trim()); setPage(1); }, 250); return () => clearTimeout(timer); }, [search]);
  const options = useQuery({ queryKey: executionEnvironmentQueryKey(environment, ["accommodation", schoolId, actorId, "options", stayId ?? "intake", repairId ?? null, roomId ?? null, submitted, page]),
    queryFn: () => getAccommodationOptions(schoolId, { search: submitted, page, ...(stayId ? { stay_id: stayId } : {}), ...(repairId ? { repair_id: repairId } : {}), ...(roomId ? { room_id: roomId } : {}) }) });
  const entries: AccommodationRef[] = kind === "rooms" ? options.data?.rooms.filter(item => item.active).map(item => ({ id: item.id, label: item.space.label })) ?? []
    : kind === "people" ? options.data?.people.filter(person => !appRequired || person.has_app) ?? [] : options.data?.[kind] ?? [];
  const visible = entries.filter(item => kind !== "spaces" || (!spaceKinds || !item.kind || spaceKinds.includes(item.kind)) && (!campusId || !item.campus_id || item.campus_id === campusId));
  const hasMore = options.data?.[`${kind}_has_more`] ?? false;
  return <PlannerDialog title={title} onClose={onClose}><div className="accommodation-form">
    {kind === "people" && !appRequired && options.data?.can_add_people && !options.error ? <button type="button" className="is-secondary" onClick={() => setAdding(true)}>Add people</button> : null}{message ? <p className="accommodation-caption" role="status">{message}</p> : null}<label>Find {kind === "people" ? "a person" : kind === "rooms" ? "a room" : kind === "holdings" ? "an item" : "a place"}<input autoFocus type="search" maxLength={80} value={search} onChange={event => setSearch(event.target.value)} /></label>
    {options.isPending ? <p role="status">Loading choices…</p> : options.error ? <p role="alert" className="accommodation-error">{options.error instanceof Error ? options.error.message : "Choices are unavailable."} <button type="button" className="is-text" onClick={() => void options.refetch()}>Try again</button></p> : <>
      <ul className="accommodation-choice-list">{visible.map(item => <li key={item.id}><button type="button" className="accommodation-choice is-secondary" onClick={() => onSelected(item)}><span className="accommodation-initials" aria-hidden="true">{item.label.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0]).join("")}</span><span><strong>{item.label}</strong></span></button></li>)}</ul>
      {!visible.length ? <p className="accommodation-caption" role="status">{appRequired ? "No eligible people on this page. Try a name or another page." : "No matching choices."}</p> : null}
      <AccommodationPages page={page} hasMore={hasMore} label={`${title} pages`} onChange={setPage} />
    </>}
    <footer><button type="button" className="is-secondary" onClick={onClose}>Cancel</button></footer>
  </div>{adding ? <PeopleBulkAddDialog schoolId={schoolId} onClose={() => setAdding(false)} onDone={people => { setAdding(false); if (people.length === 1) onSelected(people[0]!); else { setMessage(`${people.length} people ready. Find one to select.`); void options.refetch(); } }} /> : null}</PlannerDialog>;
}
