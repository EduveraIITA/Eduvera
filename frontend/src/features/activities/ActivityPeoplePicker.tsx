import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Plus, Search, X } from "lucide-react";
import { ProductIcon } from "../../components/ProductIcon";
import { ActivityPagination } from "./ActivityPagination";
import type { ActivityCatalogue } from "./api";
import { listParticipants } from "../people/participationApi";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import "./activity-people-picker.css";

export function ActivityPeoplePicker({ catalogue, people, groups, onPeople, onGroups, onCreatePerson, onDiscovered, legend = "Who is expected?", hint = "Reuse people or groups from your campus. Participants do not need app accounts." }: { catalogue: ActivityCatalogue; people: string[]; groups: string[]; onPeople: (ids: string[]) => void; onGroups: (ids: string[]) => void; onCreatePerson?: () => void; onDiscovered?: (person: { id: string; label: string; affiliations: string[] }) => void; legend?: string; hint?: string }) {
  const environment = useExecutionEnvironment();
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [page, setPage] = useState(1);
  const searchId = useId();
  const searchInput = useRef<HTMLInputElement>(null);
  const findButton = useRef<HTMLButtonElement>(null);
  const alwaysSearch = catalogue.people_truncated === true || catalogue.people.length + catalogue.groups.length > 8;
  const showSearch = alwaysSearch || searchOpen;
  useEffect(() => { if (searchOpen) searchInput.current?.focus(); }, [searchOpen]);
  const closeSearch = () => { setSearch(""); setPage(1); setSearchOpen(false); findButton.current?.focus(); };
  const remote = useQuery({ queryKey: executionEnvironmentQueryKey(environment, ["people.participants", catalogue.school_id, search, page]), queryFn: () => listParticipants(catalogue.school_id, search, page), enabled: catalogue.people_truncated === true });
  const groupRows = catalogue.groups.map((item) => ({ ...item, category: "group" as const })).filter((item) => item.label.toLowerCase().includes(search.trim().toLowerCase()));
  const peopleRows = (catalogue.people_truncated ? remote.isSuccess ? remote.data.results : [] : catalogue.people).map((item) => ({ ...item, category: "person" as const })).filter((item) => item.label.toLowerCase().includes(search.trim().toLowerCase()));
  const rows = [...groupRows, ...peopleRows];
  const pages = Math.max(1, Math.ceil(catalogue.people_truncated ? (remote.data?.total ?? 0) / 25 : rows.length / 12));
  const activePage = Math.min(page, pages);
  const selectionCount = people.length + groups.length;
  const showEmpty = !rows.length && (!catalogue.people_truncated || remote.isSuccess);
  return <fieldset className="activity-picker activity-people-picker"><legend>{legend}</legend>
    <p>{hint}</p>
    <div className="activity-people-picker__toolbar"><p className="activity-people-picker__selection" aria-live="polite">{selectionCount} selected</p><div>{!alwaysSearch ? <button ref={findButton} type="button" aria-expanded={searchOpen} aria-controls={searchId} onClick={() => searchOpen ? closeSearch() : setSearchOpen(true)}><Search size={17} aria-hidden="true" />Find</button> : null}{onCreatePerson ? <button type="button" onClick={onCreatePerson}><Plus size={17} aria-hidden="true" />Add people</button> : null}</div></div>
    {showSearch ? <label id={searchId} className="activity-search activity-people-picker__search"><Search size={18} aria-hidden="true" /><span className="sr-only">Find people or groups</span><input ref={searchInput} type="search" aria-label="Find people or groups" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); if (!alwaysSearch) closeSearch(); else { setSearch(""); setPage(1); } } }} placeholder="Find a person, class or team" />{search || !alwaysSearch ? <button type="button" aria-label={alwaysSearch ? "Clear people search" : "Close people search"} onClick={() => { if (!alwaysSearch) closeSearch(); else { setSearch(""); setPage(1); searchInput.current?.focus(); } }}><X size={18} aria-hidden="true" /></button> : null}</label> : null}
    {catalogue.people_truncated ? <p>Group matches appear first. People are searched across the whole campus, 25 per page.</p> : null}
    {catalogue.people_truncated && remote.isPending ? <p role="status">Finding campus people…</p> : catalogue.people_truncated && remote.isError ? <p className="activity-people-picker__error" role="alert">{remote.error.message}<button type="button" onClick={() => void remote.refetch()}>Try again</button></p> : null}
    <div className="activity-picker__options">{(catalogue.people_truncated ? rows : rows.slice((activePage - 1) * 12, activePage * 12)).map((item) => {
      const selectedIds = item.category === "person" ? people : groups;
      const change = item.category === "person" ? onPeople : onGroups;
      return <label className={`activity-people-picker__person${selectedIds.includes(item.id) ? " is-selected" : ""}`} key={`${item.category}:${item.id}`}><input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => { if (item.category === "person") onDiscovered?.({ id: item.id, label: item.label, affiliations: item.affiliations }); change(selectedIds.includes(item.id) ? selectedIds.filter((id) => id !== item.id) : [...selectedIds, item.id]); }} /><span className="activity-people-picker__avatar" aria-hidden="true">{item.category === "group" ? <ProductIcon name="groups" size={28} /> : item.label.trim().split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span><span className="activity-people-picker__identity">{item.label}<small>{item.category === "group" ? "Campus group" : "Campus person"}</small></span><span className="activity-people-picker__check" aria-hidden="true"><Check size={16} /></span></label>;
    })}{showEmpty ? <p>{search ? "No people or groups match this search." : "No campus people or groups yet."}{onCreatePerson ? " Add people to get started." : " Ask a campus administrator to add the people you need."}</p> : null}</div>
    {(catalogue.people_truncated ? remote.isSuccess : pages > 1 || Boolean(search.trim())) ? <ActivityPagination page={activePage} pages={pages} total={catalogue.people_truncated ? remote.data?.total ?? 0 : rows.length} label={catalogue.people_truncated ? "people matches" : "matches"} onPage={setPage} /> : null}
  </fieldset>;
}
