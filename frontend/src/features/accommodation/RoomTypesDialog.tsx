import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { getAccommodationOptions, type RoomType } from "./accommodationApi";
import { AccommodationPages, AccommodationReadError } from "./AccommodationPrimitives";
import { RoomTypeDialog } from "./RoomTypeDialog";

export function RoomTypesDialog({ schoolId, actorId, onClose, onSelected, readOnly = false }: { schoolId: string; actorId: string; onClose: () => void; onSelected?: (type: RoomType) => void; readOnly?: boolean }) {
  const environment = useExecutionEnvironment(), [search, setSearch] = useState(""), [submitted, setSubmitted] = useState(""), [page, setPage] = useState(1), [editing, setEditing] = useState<RoomType | "new" | null>(null);
  useEffect(() => { const timer = setTimeout(() => { setSubmitted(search.trim()); setPage(1); }, 250); return () => clearTimeout(timer); }, [search]);
  const options = useQuery({ queryKey: executionEnvironmentQueryKey(environment, ["accommodation", schoolId, actorId, "room-types", submitted, page]), queryFn: () => getAccommodationOptions(schoolId, { search: submitted, page }) });
  return <PlannerDialog title={onSelected ? "Choose room type" : "Room types"} onClose={onClose}><div className="accommodation-form"><div className="accommodation-heading"><label>Find type<input type="search" maxLength={80} value={search} onChange={event => setSearch(event.target.value)} /></label>{!readOnly && options.data?.can_manage ? <button type="button" className="is-secondary" onClick={() => setEditing("new")}>Add type</button> : null}</div>
    {options.isPending ? <p role="status">Loading types…</p> : options.error ? <AccommodationReadError error={options.error} onRetry={() => void options.refetch()} /> : <><ul className="accommodation-choice-list">{options.data?.room_types.filter(type => !onSelected || type.active).map(type => <li key={type.id}>{onSelected ? <button type="button" className="accommodation-choice is-secondary" onClick={() => onSelected(type)}><span><strong>{type.name}</strong><small>{type.default_capacity} places · {type.allocation_mode === "shared" ? "Shared" : "Whole room"}</small></span></button> : <div className="accommodation-summary"><div className="accommodation-heading"><strong>{type.name}</strong>{!readOnly && options.data.can_manage ? <button type="button" className="is-text" onClick={() => setEditing(type)}>Edit</button> : null}</div><p className="accommodation-caption">{type.default_capacity} places · {type.allocation_mode === "shared" ? "Shared" : "Whole room"} · {type.active ? "Active" : "Inactive"}</p></div>}</li>)}</ul>{!options.data?.room_types.length ? <p className="accommodation-caption">No matching room types.</p> : null}<AccommodationPages page={page} hasMore={options.data?.room_types_has_more ?? false} label="Room type pages" onChange={setPage} /></>}
    <footer><button type="button" className="is-secondary" onClick={onClose}>Back</button></footer>
  </div>{editing ? <RoomTypeDialog schoolId={schoolId} {...(editing === "new" ? {} : { initial: editing })} refresh={async () => { await options.refetch({ throwOnError: true }); }} onClose={() => setEditing(null)} onSaved={type => { setEditing(null); if (onSelected) onSelected(type); }} /> : null}</PlannerDialog>;
}
