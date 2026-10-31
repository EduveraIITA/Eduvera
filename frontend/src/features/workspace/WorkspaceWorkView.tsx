import { CalendarDays, Search, TriangleAlert, X } from "lucide-react";
import { useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { TemporalInput } from "../../components/forms/TemporalInput";
import { WorkspaceEmpty, WorkspaceWorkRow } from "./WorkspacePrimitives";
import type { WorkspaceManifest, WorkspaceWorkItem } from "./types";
import "./workspace-work.css";

const pageSize = 10;
function addedOn(item: WorkspaceWorkItem, timeZone: string) {
  if (!item.created_at || !Number.isFinite(Date.parse(item.created_at))) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(item.created_at));
}

/** Filters apply before finite pages, over the full authorized projection. */
export function WorkspaceWorkView({ manifest, showPageHeading = true }: { manifest: WorkspaceManifest; showPageHeading?: boolean }) {
  const [params, setParams] = useSearchParams();
  const view = params.get("work_view") === "waiting" ? "waiting" : "needs_me";
  const query = params.get("work_search")?.slice(0, 120).trim() ?? "";
  const requestedDate = params.get("work_date") ?? "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) && Number.isFinite(Date.parse(requestedDate)) ? requestedDate : "";
  const [searchDraft, setSearchDraft] = useState({ source: query, value: query });
  const search = searchDraft.source === query ? searchDraft.value : query;
  const [dateOpen, setDateOpen] = useState(Boolean(date));
  const searchRef = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const change = (values: Record<string, string>, replace = false) => {
    const next = new URLSearchParams(params);
    if (!("work_page" in values)) next.delete("work_page");
    Object.entries(values).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key));
    next.delete("item"); next.delete("unavailable");
    setParams(next, { replace });
  };
  const needsMe = manifest.work.items.filter(item => item.direction !== "waiting");
  const waiting = manifest.work.items.filter(item => item.direction === "waiting");
  const visible = (view === "waiting" ? waiting : needsMe).filter(item => (!date || addedOn(item, manifest.context.time_zone ?? "UTC") === date)
    && `${item.title} ${item.detail ?? ""} ${item.status_label ?? ""} ${item.owner?.label ?? ""} ${item.source_label ?? ""}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
  const requestedPage = Number(params.get("work_page") ?? "1");
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, pageCount) : 1;
  const items = visible.slice((page - 1) * pageSize, page * pageSize);
  const selectedId = params.get("item");
  const selected = selectedId ? manifest.work.items.find(item => item.id === selectedId) : undefined;
  const clearSelected = () => { const next = new URLSearchParams(params); next.delete("item"); next.delete("unavailable"); setParams(next, { replace: true }); };
  const pageTo = (next: number) => { change({ work_page: next === 1 ? "" : String(next) }); heading.current?.focus(); };
  const clearSearch = () => { setSearchDraft({ source: "", value: "" }); change({ work_search: "" }, true); searchRef.current?.focus(); };
  const hasFilters = Boolean(query || date);
  const partial = manifest.work.coverage === "partial";
  const firstVisible = (page - 1) * pageSize + 1;
  const resultLabel = pageCount > 1 ? `${firstVisible}–${firstVisible + items.length - 1} of ${visible.length}`
    : `${visible.length} ${visible.length === 1 ? "item" : "items"}`;
  return <div className="workspace-view workspace-work">
    {showPageHeading ? <header className="workspace-view__heading"><div><h1>Work</h1><p>Your next actions and requests in progress</p></div></header> : null}
    <div className="workspace-work-controls">
      <nav className="workspace-work-tabs" aria-label="Work views">
        <button type="button" aria-pressed={view === "needs_me"} onClick={() => change({ work_view: "" })}>Needs me <span>{needsMe.length}</span></button>
        <button type="button" aria-pressed={view === "waiting"} onClick={() => change({ work_view: "waiting" })}>Waiting <span>{waiting.length}</span></button>
      </nav>
      {manifest.work.items.length ? <div className="workspace-work-tools">
        <form className="workspace-work-search" role="search" aria-label="Search work" onSubmit={event => { event.preventDefault(); change({ work_search: search.trim() }); }}>
          <label><span className="sr-only">Search all {view === "waiting" ? "waiting work" : "work needing me"}</span><input ref={searchRef} type="search" value={search} onChange={event => setSearchDraft({ source: query, value: event.target.value })} maxLength={120} placeholder="Find work" /></label>
          {search || query ? <button type="button" aria-label="Clear work search" onClick={clearSearch}><X size={18} aria-hidden="true" /></button> : null}
          <button type="submit" aria-label="Search work"><Search size={18} aria-hidden="true" /></button>
        </form>
        <button type="button" className="workspace-work-date-toggle" aria-expanded={dateOpen || Boolean(date)} aria-controls="work-date-filter" onClick={() => { if (dateOpen && date) change({ work_date: "" }, true); setDateOpen(!dateOpen); }}><CalendarDays size={18} aria-hidden="true" />{date ? "Date set" : "Date"}</button>
      </div> : null}
      {dateOpen || date ? <div className="workspace-work-date-filter" id="work-date-filter"><label className="workspace-work-date">Added on<TemporalInput type="date" value={date} onChange={event => change({ work_date: event.target.value })} /></label>{date ? <button type="button" className="workspace-work-clear-date" onClick={() => { change({ work_date: "" }, true); setDateOpen(false); }}>Clear date</button> : null}</div> : null}
    </div>
    {partial ? <p role="alert" className="workspace-work-warning"><TriangleAlert size={18} aria-hidden="true" /><span>Some work could not be included. Check the owning areas before treating this queue as complete.</span></p> : null}
    {selectedId ? <section className="workspace-work-recovery" role="status" aria-label="Work item recovery">
      <h2>{selected ? selected.title : "This item is no longer in your current queue"}</h2>
      <p>{selected ? "The source link is unavailable. No decision has been recorded. Check the owning area or contact its responsible coordinator." : "It may have been resolved or your access may have changed. No records were changed."}</p>
      {selected?.status_label ? <p>{selected.status_label}</p> : null}
      <button type="button" onClick={clearSelected}>Return to work</button>
    </section> : null}
    {items.length ? <section className="workspace-section" aria-labelledby="workspace-open-work-title">
      <header><h2 id="workspace-open-work-title" ref={heading} tabIndex={-1}>{view === "waiting" ? "Waiting on others" : "Open work"}</h2><span className="workspace-section__count">{resultLabel}{partial ? " available" : ""}</span></header>
      <ul className="workspace-work-list" aria-label={view === "waiting" ? "Waiting work items" : "Open work items"}>{items.map(item => <li key={item.id}><WorkspaceWorkRow item={item} /></li>)}</ul>
    </section> : !manifest.work.items.length && !partial ? <WorkspaceEmpty kind="work" /> : <section className="workspace-search-empty" role="status">
      <h2>{hasFilters ? "No matching work" : partial ? "No work could be shown" : view === "waiting" ? "No tracked requests are waiting" : "Nothing needs you right now"}</h2>
      <p>{hasFilters ? "Try another search or date." : partial ? "Check the owning areas while part of this queue is unavailable." : view === "waiting" ? "Submitted work and requests appear here while someone else needs to respond." : "You can still follow your requests in Waiting."}</p>
      {hasFilters ? <button type="button" onClick={() => { setSearchDraft({ source: "", value: "" }); setDateOpen(false); change({ work_search: "", work_date: "" }, true); }}>Clear filters</button> : null}
    </section>}
    {pageCount > 1 ? <nav className="workspace-work-pages" aria-label="Work pages"><button type="button" disabled={page === 1} onClick={() => pageTo(page - 1)}>Previous</button><span>Page {page} of {pageCount}</span><button type="button" disabled={page === pageCount} onClick={() => pageTo(page + 1)}>Next</button></nav> : null}
  </div>;
}
