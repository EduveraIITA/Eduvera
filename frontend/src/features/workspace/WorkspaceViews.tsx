import { Clock3, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import {
  WorkspaceAreaRow,
  WorkspaceEmpty,
  WorkspaceMoreRow,
} from "./WorkspacePrimitives";
import type { WorkspaceManifest } from "./types";

interface WorkspaceViewProps {
  readonly manifest: WorkspaceManifest;
  readonly showPageHeading?: boolean;
}

export { WorkspaceTodayView } from "./WorkspaceTodayView";

export { WorkspaceWorkView } from "./WorkspaceWorkView";

export function WorkspaceAreasView({ manifest, showPageHeading = true }: WorkspaceViewProps) {
  return <div className="workspace-view">
    {showPageHeading ? <header className="workspace-view__heading">
      <div><h1>Areas</h1><p>Tools available through your current responsibilities</p></div>
    </header> : null}
    {manifest.areas.length ? <section className="workspace-section" aria-labelledby="workspace-available-areas-title">
      <header>
        <h2 id="workspace-available-areas-title">Available to you</h2>
        <span className="workspace-section__count">{manifest.areas.length} {manifest.areas.length === 1 ? "area" : "areas"}</span>
      </header>
      <div className="workspace-directory">
        {manifest.areas.map((area) => <WorkspaceAreaRow key={area.key} area={area} />)}
      </div>
    </section> : <WorkspaceEmpty kind="areas" />}
  </div>;
}

function toolMatches(query: string, label: string, description?: string | null) {
  const haystack = `${label} ${description ?? ""}`.toLocaleLowerCase();
  return haystack.includes(query);
}

export function WorkspaceMoreView({ manifest, showPageHeading = true }: WorkspaceViewProps) {
  const groups = useMemo(() => manifest.more.groups?.length
    ? manifest.more.groups
    : [
      ...(manifest.more.setup.length ? [{ key: "setup", label: "Campus setup", items: manifest.more.setup }] : []),
      ...((manifest.more.other ?? []).length ? [{ key: "other", label: "Other tools", items: manifest.more.other ?? [] }] : []),
    ], [manifest.more.groups, manifest.more.other, manifest.more.setup]);
  const items = groups.flatMap((group) => group.items);
  const [search, setSearch] = useState("");
  const query = search.trim().toLocaleLowerCase();
  const filtered = useMemo(() => groups.map((group) => ({
    ...group,
    items: query ? group.items.filter((item) => toolMatches(query, `${group.label} ${item.label}`, item.description)) : group.items,
  })).filter((group) => group.items.length), [groups, query]);
  const matchCount = filtered.reduce((count, group) => count + group.items.length, 0);
  return <div className="workspace-view">
    {showPageHeading ? <header className="workspace-view__heading">
      <div><h1>More</h1><p>Your account, connections and lower-frequency campus tools</p></div>
    </header> : null}
    {!items.length ? <WorkspaceEmpty kind="more" /> : null}
    {items.length ? <label className="workspace-tool-search">
      <Search size={19} aria-hidden="true" />
      <span className="sr-only">Search account, setup and tools</span>
      <input
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search account, setup and tools"
        autoComplete="off"
      />
      {search ? <button type="button" aria-label="Clear tool search" onClick={() => setSearch("")}><X size={17} aria-hidden="true" /></button> : null}
    </label> : null}
    {query && matchCount === 0 ? <section className="workspace-search-empty" role="status">
      <strong>No matching tools</strong>
      <p>Try another name, or clear the search to see everything available to you.</p>
      <button type="button" onClick={() => setSearch("")}>Clear search</button>
    </section> : null}
    {filtered.map((group) => <section className="workspace-section" aria-labelledby={`workspace-more-${group.key}-title`} key={group.key}>
      <header><h2 id={`workspace-more-${group.key}-title`}>{group.label}</h2></header>
      <div className="workspace-directory">
        {group.items.map((item) => <WorkspaceMoreRow key={item.key} item={item} />)}
      </div>
    </section>)}
    {items.length ? <p className="workspace-context-note"><Clock3 size={14} aria-hidden="true" />Available tools update with your current responsibilities.</p> : null}
  </div>;
}
