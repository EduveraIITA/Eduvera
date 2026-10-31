import { useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Plus } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { ProductIcon } from "../../components/ProductIcon";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { WorkspaceState } from "../workspace/WorkspaceState";
import type { WorkspaceManifest } from "../workspace/types";
import { listLearningOfferings } from "./offeringApi";
import { LearningOfferingSetup } from "./LearningOfferingSetup";
import { assignmentAccessLost } from "./assignmentReadState";

export function LearningAssignmentsHub({ schoolId, actorId, manifest }: { schoolId: string; actorId: string; manifest: WorkspaceManifest }) {
  const environment = useExecutionEnvironment(), client = useQueryClient(), navigate = useNavigate();
  const [settingUp, setSettingUp] = useState(false), [page, setPage] = useState(1), [classPage, setClassPage] = useState(1), [search, setSearch] = useState("");
  const root = executionEnvironmentQueryKey(environment, ["learning-assignments", schoolId, actorId, "offerings"]);
  const query = useQuery({ queryKey: [...root, page, search], queryFn: () => listLearningOfferings(page, search), placeholderData: keepPreviousData });
  const readOnly = environment.mode === "simulation" && (environment.unavailable || environment.runStatus === "stopped" || environment.runStatus === "completed");
  const refresh = async () => { await client.invalidateQueries({ queryKey: root, refetchType: "none" }); await query.refetch({ throwOnError: true }); await client.invalidateQueries({ queryKey: ["responsibility-workspace"] }); };
  if (query.isPending) return <WorkspaceState state="loading" />;
  if (!query.data || assignmentAccessLost(query.error)) return <WorkspaceState state="error" error={query.error} onRetry={query.refetch} />;
  const data = query.data;
  const legacy = manifest.areas.flatMap(area => area.surfaces).filter(surface => {
    const url = new URL(surface.href, "https://thatcampus.local");
    return url.pathname === "/areas/messages/assignments" && ["class", "self", "learner", "dependent", "person"].includes(url.searchParams.get("scope") ?? "");
  });
  const links = [...new Map(legacy.map(surface => [surface.href, surface])).values()].filter(item => !search || `${item.label} ${item.description ?? ""}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <div className="learning-assignments">
    {query.error ? <p role="alert">Learning groups could not refresh. Your open choices are kept. <button onClick={() => void query.refetch()}>Refresh groups</button></p> : null}
    <header className="learning-assignment-heading"><p className="learning-assignment-caption">Set work. Share feedback. Keep the next step clear.</p>{data.can_create && !readOnly ? <button onClick={() => setSettingUp(true)}><Plus size={18} aria-hidden="true" />Set up learning group</button> : null}</header>
    {search || data.has_more || data.items.length + links.length > 5 ? <label className="learning-offering-search">Find a learning group<input type="search" value={search} onChange={event => { setSearch(event.target.value); setPage(1); setClassPage(1); }} /></label> : null}
    {data.actor_person && data.items.some(item => item.own_enrollment) ? <Link className="learning-offering-own" to={`/areas/messages/assignments?${new URLSearchParams({ scope: "person", person_id: data.actor_person.id })}`}>My assignments<ChevronRight size={18} aria-hidden="true" /></Link> : null}
    {data.items.length ? <section aria-label="Learning groups" className="learning-assignment-list">{data.items.map(item => <Link className="learning-offering-entry" key={item.id} to={`/areas/messages/assignments?${new URLSearchParams(item.can_manage || item.can_publish || item.can_review ? { scope: "offering", offering_id: item.id } : { scope: "person", person_id: data.actor_person!.id })}`}>
      <ProductIcon name="learning" size={30} /><span><strong>{item.name}</strong><small>{item.can_publish || item.can_review ? item.learner_count !== undefined ? `${item.learner_count} learners` : "Teaching responsibility" : "Your learning group"}</small></span><ChevronRight size={18} aria-hidden="true" />
    </Link>)}</section> : null}
    {links.length ? <section aria-label="Your classes" className="learning-assignment-list">{links.slice((classPage - 1) * 10, classPage * 10).map(surface => <Link className="learning-offering-entry" key={surface.href} to={surface.href}><ProductIcon name="learning" size={28} /><span><strong>{surface.label}</strong>{surface.description ? <small>{surface.description}</small> : null}</span><ChevronRight size={18} aria-hidden="true" /></Link>)}{links.length > 10 ? <nav className="learning-assignment-pages" aria-label="Class pages"><button disabled={classPage === 1} onClick={() => setClassPage(classPage - 1)}>Previous classes</button><span>Page {classPage}</span><button disabled={classPage * 10 >= links.length} onClick={() => setClassPage(classPage + 1)}>Next classes</button></nav> : null}</section> : null}
    {!data.items.length && !links.length ? <div className="learning-offering-empty"><ProductIcon name="learning" size={40} /><h2>{data.can_create ? "Start with one learning group" : "Your work will appear here"}</h2><p className="learning-assignment-caption">{data.can_create ? "Choose learners and an instructor. No class or term is needed." : "Assignments appear when an instructor publishes work for you."}</p></div> : null}
    {page > 1 || data.has_more ? <nav className="learning-assignment-pages" aria-label="Learning group pages"><button disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page}</span><button disabled={!data.has_more} onClick={() => setPage(page + 1)}>Next</button></nav> : null}
    {settingUp ? <LearningOfferingSetup schoolId={schoolId} source={data} refresh={refresh} onClose={() => setSettingUp(false)} onCreated={id => navigate(`/areas/messages/assignments?${new URLSearchParams({ scope: "offering", offering_id: id })}`)} /> : null}
  </div>;
}
