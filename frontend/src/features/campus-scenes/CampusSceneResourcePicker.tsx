import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useOptionalExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { LIVE_EXECUTION_ENVIRONMENT } from "../simulation/executionEnvironment";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { getCampusSceneResources } from "./api";

export interface CampusSceneResourceScope { schoolId: string; campusId: string }
interface Props extends CampusSceneResourceScope {
  holdingId: string | null; linkedElsewhere: ReadonlySet<string>; disabled: boolean;
  onChange: (holdingId: string | null) => void;
}

/** Resource identity is selected explicitly; artwork never creates or renames it. */
export function CampusSceneResourcePicker({ schoolId, campusId, holdingId, linkedElsewhere, disabled, onChange }: Props) {
  const environment = useOptionalExecutionEnvironment() ?? LIVE_EXECUTION_ENVIRONMENT;
  const [open, setOpen] = useState(false), [input, setInput] = useState("");
  const [search, setSearch] = useState(""), [page, setPage] = useState(1);
  const unavailable = environment.mode === "simulation" && environment.unavailable;
  const query = useQuery({
    queryKey: unavailable ? ["campus-scene-resources-unavailable", schoolId, campusId] : executionEnvironmentQueryKey(environment, ["campus-scenes", schoolId, campusId, "resources", search, page, holdingId]),
    queryFn: ({ signal }) => getCampusSceneResources(schoolId, campusId, { search, page, ...(holdingId ? { holding_id: holdingId } : {}) }, signal),
    enabled: Boolean(schoolId && campusId && (open || holdingId)) && !unavailable,
    staleTime: 30_000, retry: false,
  });
  const selected = query.data?.selected;
  const searchResources = () => { setPage(1); setSearch(input.trim()); };
  return <section className="campus-scene-resource-picker" aria-label="Linked campus resource">
    <div className="campus-scene-panel-heading"><strong>Campus resource</strong><button type="button" className="campus-scene-button" disabled={disabled} aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? "Close search" : holdingId ? "Change resource" : "Link resource"}</button></div>
    <p className="campus-scene-helper">Link this fixture to an individual resource to show its recorded availability. This does not move the resource or report a fault.</p>
    {holdingId ? <div className="campus-scene-resource-selection"><span>{selected ? `${selected.name}${selected.asset_tag ? ` · ${selected.asset_tag}` : ""}` : query.isPending ? "Loading linked resource…" : "Resource link needs checking"}</span><button type="button" className="campus-scene-button" disabled={disabled} onClick={() => onChange(null)}>Clear resource link</button></div> : null}
    {unavailable ? <p className="campus-scene-error" role="alert">Resource links are unavailable until this Simulation is recovered.</p> : null}
    {query.isError ? <div className="campus-scene-error" role="alert"><p>Campus resources could not be loaded. Your current link is unchanged.</p><button type="button" className="campus-scene-button" disabled={disabled || unavailable} onClick={() => void query.refetch()}>Try resource search again</button></div> : null}
    {open && !unavailable ? <>
      <div className="campus-scene-resource-search"><label>Resource name or asset tag<input type="search" value={input} maxLength={80} disabled={disabled} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); searchResources(); } }} /></label><button type="button" className="campus-scene-button" disabled={disabled} onClick={searchResources}>Search resources</button></div>
      {query.isPending ? <p role="status" className="campus-scene-helper">Loading campus resources…</p> : null}
      {query.data && !query.isError ? query.data.items.length ? <ul className="campus-scene-item-list">{query.data.items.map(resource => <li key={resource.id}><button type="button" disabled={disabled || linkedElsewhere.has(resource.id)} aria-pressed={holdingId === resource.id} aria-label={`Link ${resource.name}${resource.asset_tag ? `, ${resource.asset_tag}` : ""}`} onClick={() => { onChange(resource.id); setOpen(false); }}><span><strong>{resource.name}</strong><small>{resource.asset_tag ? `${resource.asset_tag} · ` : ""}{linkedElsewhere.has(resource.id) ? "Already linked to another fixture" : resource.state === "unavailable" ? "Recorded unavailable" : "Recorded available"}</small></span></button></li>)}</ul> : <p role="status" className="campus-scene-helper">No individual campus resources match this search.</p> : null}
      {query.data && query.data.total > query.data.page_size ? <div className="campus-scene-pagination"><button type="button" className="campus-scene-button" disabled={disabled || page <= 1 || query.isFetching} onClick={() => setPage(value => value - 1)}>Previous resources</button><span>{page} / {Math.ceil(query.data.total / query.data.page_size)}</span><button type="button" className="campus-scene-button" disabled={disabled || page * query.data.page_size >= query.data.total || query.isFetching} onClick={() => setPage(value => value + 1)}>Next resources</button></div> : null}
    </> : null}
  </section>;
}
