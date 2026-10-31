import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ChevronRight, MoreHorizontal, Plus, Search, X } from "lucide-react";
import { ProductIcon } from "../../components/ProductIcon";
import { InfoSummary } from "../../components/InfoSummary";
import { useAuth } from "../auth/AuthContext";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { TemporalInput } from "../../components/forms/TemporalInput";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { PeopleBulkAddDialog } from "./PeopleBulkAddDialog";
import { createParticipationGroup, listParticipants, listCampusGroups, replaceParticipationGroupMembers, type CampusParticipant, type ParticipationGroup } from "./participationApi";
import { PersonAppAccessDialog } from "./PersonAppAccessDialog";
import { PeoplePages } from "./PeoplePages";
import "./people.css";
import "./participation-people.css";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";

export function GroupEditor({ schoolId, group, onClose, onSaved }: { schoolId: string; group?: ParticipationGroup; onClose: () => void; onSaved: () => void }) {
  const environment = useExecutionEnvironment();
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Record<string, string>>(() => Object.fromEntries(group?.member_ids?.map(id => [id, group.members.find(member => member.person_id === id)?.label ?? id]) ?? group?.members.map(member => [member.person_id, member.label]) ?? []));
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(() => crypto.randomUUID());
  const people = useQuery({ queryKey: executionEnvironmentQueryKey(environment, ["people.participants", schoolId, search, page]), queryFn: () => listParticipants(schoolId, search, page) });
  const changed = () => setRetryKey(crypto.randomUUID());
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      if (group) await replaceParticipationGroupMembers(schoolId, group.id, { person_ids: Object.keys(selected), effective_on: starts, expected_revision: group.revision, idempotency_key: retryKey });
      else await createParticipationGroup(schoolId, { name: name.trim(), person_ids: Object.keys(selected), starts_on: starts, ends_on: ends || null, idempotency_key: retryKey });
      onSaved();
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The group could not be saved. Your selections are retained."); }
    finally { setBusy(false); }
  }
  return <PlannerDialog title={group ? "Edit group members" : "Create group"} subtitle={group ? group.name : "Reuse people together without changing enrollment or access"} onClose={onClose} busy={busy}>
    <form className="planner-lesson-form people-editor-form participation-group-form" onSubmit={(event) => void submit(event)}>
      {group ? <p>Choose the membership to use from a new date. Current members are selected as a starting point; earlier memberships are retained.</p> : <label>Group name<input required maxLength={150} value={name} disabled={busy} onChange={(event) => { changed(); setName(event.target.value); }} /></label>}
      <div className="planner-form-pair"><label>{group ? "Change from" : "Membership starts"}<TemporalInput type="date" required value={starts} disabled={busy} onChange={(event) => { changed(); setStarts(event.target.value); }} /></label>{!group ? <label><span>Ends <small>(optional)</small></span><TemporalInput type="date" min={starts || undefined} value={ends} disabled={busy} onChange={(event) => { changed(); setEnds(event.target.value); }} /></label> : null}</div>
      <label>Find people<input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></label>
      <p role="status">{Object.keys(selected).length} selected across all pages</p>
      {people.isPending ? <p role="status">Loading people…</p> : people.isError ? <p role="alert">People could not be loaded. <button type="button" onClick={() => void people.refetch()}>Try again</button></p> : <>
        <fieldset className="participation-person-options" disabled={busy}><legend>Group members</legend>{people.data.results.map((person) => <label key={person.id}><input type="checkbox" checked={Boolean(selected[person.id])} onChange={(event) => { changed(); setSelected((current) => { const next = { ...current }; if (event.target.checked) next[person.id] = person.label; else delete next[person.id]; return next; }); }} /><span>{person.label}<small>{person.affiliations.join(" · ") || "Campus person"}</small></span></label>)}
          {!people.data.results.length ? <p>No matching people. Add the person in People first.</p> : null}</fieldset>
        <div className="participation-pagination"><button type="button" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page}</span><button type="button" disabled={page * 25 >= people.data.total} onClick={() => setPage(page + 1)}>Next</button></div>
      </>}
      <p className="planner-form-note">A group is a reusable list, not a class enrollment, team authority or permission grant.</p>
      {group ? <details><InfoSummary>Dates and published plans</InfoSummary><p>Choose today or a later date after the existing membership starts. Same-day or already-scheduled memberships cannot be overwritten here. This directory shows current members, not a future/history editor.</p><p>Published activities keep their captured roster. To use the changed group in a published activity, open <Link to={`/areas/timetable/planning${starts ? `?date=${starts}` : ""}`}>Timetable</Link> and choose Plan a change. Past attendance is unchanged.</p><p>Keep at least one member. Closing an entire group is not available in this action.</p></details> : null}
      {error ? <p role="alert" className="planner-form-error">{error}</p> : null}
      <footer><button type="button" className="is-secondary" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" disabled={busy || !group && !name.trim() || !starts || !Object.keys(selected).length}>{busy ? "Saving…" : group ? "Save dated membership" : "Create group"}</button></footer>
    </form>
  </PlannerDialog>;
}

function accountDescription(person: CampusParticipant) {
  if (person.account_state === "active" || !person.account_state && person.has_account) return `App account${person.is_you ? " · You" : ""}`;
  if (person.account_state === "inactive") return `App access inactive${person.is_you ? " · You" : ""}`;
  if (person.pending_invitation) return person.pending_invitation.state === "expired" ? "Invitation expired" : "Invitation pending";
  return "No app account";
}
const needsAppAccess = (person: CampusParticipant) => !person.is_you && (person.account_state === "not_linked" || !person.account_state && !person.has_account);

export function PeopleParticipantsPage() {
  const environment = useExecutionEnvironment();
  const auth = useAuth();
  if (environment.mode === "simulation" && environment.unavailable) return <OperationsShell active="areas" title="People & groups"><p role="alert">This simulation is unavailable. People cannot be loaded from Live instead.</p></OperationsShell>;
  return <PeopleDirectory key={JSON.stringify(executionEnvironmentQueryKey(environment, [auth.user?.id, auth.user?.active_school_id]))} />;
}
function PeopleDirectory() {
  const environment = useExecutionEnvironment();
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const schoolId = auth.user?.active_school_id ?? "";
  const [params, setParams] = useSearchParams();
  const groups = params.get("view") === "groups";
  const requestedPage = Number(params.get("page") ?? 1);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const search = params.get("search") ?? "";
  const [searchDraft, setSearchDraft] = useState({ query: search, groups, value: search });
  const draft = searchDraft.query === search && searchDraft.groups === groups ? searchDraft.value : search;
  const [showSearch, setShowSearch] = useState(false);
  const searchOpen = showSearch || Boolean(search);
  const searchInput = useRef<HTMLInputElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const results = useRef<HTMLUListElement>(null);
  const mounted = useRef(true);
  const pageRequested = useRef(false);
  const [adding, setAdding] = useState<"person" | "group" | null>(null);
  const [appAccessPerson, setAppAccessPerson] = useState<CampusParticipant | null>(null);
  const [notice, setNotice] = useState("");
  const queryClient = useQueryClient();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const people = useQuery({ queryKey: executionEnvironmentQueryKey(environment, ["people.participants", schoolId, search, page]), queryFn: () => listParticipants(schoolId, search, page), enabled: Boolean(schoolId) && !groups });
  const groupState = useQuery({ queryKey: executionEnvironmentQueryKey(environment, ["people.group-catalogue", schoolId, search, page]), queryFn: () => listCampusGroups(schoolId, search, page), enabled: Boolean(schoolId) && groups });
  const state = groups ? groupState : people;
  const total = state.data?.total ?? 0;
  const update = (patch: Record<string, string>) => setParams((current) => { const next = new URLSearchParams(current); for (const [key, value] of Object.entries(patch)) { if (value) next.set(key, value); else next.delete(key); } return next; });
  useEffect(() => { if (showSearch) searchInput.current?.focus(); }, [showSearch]);
  useEffect(() => {
    if (pageRequested.current && !state.isPending && !state.isError) {
      pageRequested.current = false;
      results.current?.focus({ preventScroll: true });
      results.current?.scrollIntoView?.({ block: "start", behavior: "auto" });
    }
  }, [page, state.isPending, state.isError]);
  const clearSearch = () => {
    pageRequested.current = false;
    setSearchDraft({ query: "", groups, value: "" });
    if (search) update({ search: "", page: "" });
  };
  const closeSearch = () => { clearSearch(); setShowSearch(false); searchButton.current?.focus(); };
  const changeView = (view: string) => { pageRequested.current = false; setShowSearch(false); setSearchDraft({ query: "", groups: view === "groups", value: "" }); update({ view, page: "", search: "" }); };
  const ended = environment.mode === "simulation" && (environment.unavailable || environment.runStatus === "completed" || environment.runStatus === "stopped");
  const canAdd = !ended && Boolean(schoolId) && state.isSuccess;
  const closeAdding = () => { setAdding(null); requestAnimationFrame(() => { if (addButton.current?.isConnected) addButton.current.focus(); }); };
  const canInvite = environment.mode === "live" && people.data?.capabilities?.can_invite === true;
  const refreshAppAccess = () => { void queryClient.invalidateQueries({ queryKey: executionEnvironmentQueryKey(environment, ["people.participants", schoolId]) }); void queryClient.invalidateQueries({ queryKey: executionEnvironmentQueryKey(environment, ["activities", schoolId]) }); };
  const saved = (message: string) => { if (!mounted.current) return; closeAdding(); setNotice(message); void queryClient.invalidateQueries({ queryKey: executionEnvironmentQueryKey(environment, ["people.participants", schoolId]) }); void queryClient.invalidateQueries({ queryKey: executionEnvironmentQueryKey(environment, ["people.group-catalogue", schoolId]) }); void queryClient.invalidateQueries({ queryKey: executionEnvironmentQueryKey(environment, ["people.participation-groups", schoolId]) }); void queryClient.invalidateQueries({ queryKey: executionEnvironmentQueryKey(environment, ["activities", schoolId]) }); void queryClient.invalidateQueries({ queryKey: ["staff-operations"] }); };
  const peopleAdded = (accepted: Array<{ id: string; label: string }>) => {
    if (!mounted.current || queryClient.getQueryState(executionEnvironmentQueryKey(environment, ["people.participants", schoolId, search, page]))?.status !== "success") return;
    closeAdding();
    const ready = [...new Map(accepted.map(person => [person.id, person])).values()];
    if (!ready.length) return;
    setNotice(`${ready.length} ${ready.length === 1 ? "person" : "people"} ready. App access is unchanged.`);
    void queryClient.invalidateQueries({ queryKey: executionEnvironmentQueryKey(environment, ["people.participants", schoolId]) });
    void queryClient.invalidateQueries({ queryKey: executionEnvironmentQueryKey(environment, ["activities", schoolId]) });
    const single = ready.length === 1 ? ready[0] : undefined;
    if (single) void navigate(`/areas/people/participants/${encodeURIComponent(single.id)}`, { state: { peopleReturnTo: `${location.pathname}${location.search}` } });
  };
  return <OperationsShell active="areas" title="People & groups" backTo="/areas" contentHasHeading><div className="participation-people participation-directory-page">
    <header><h1>People & groups</h1><button ref={addButton} type="button" className="button button--primary" aria-label={groups ? "Create group" : "Add people"} title={groups ? "Create group" : "Add people"} disabled={!canAdd} onClick={() => setAdding(groups ? "group" : "person")}><Plus size={18} aria-hidden="true" />Add</button></header>
    {ended ? <p>This simulation has ended. Its saved People directory is read-only.</p> : null}
    <div className="participation-directory-toolbar">
      <nav className="participation-view" aria-label="People directory view"><button type="button" aria-pressed={!groups} onClick={() => changeView("")}>People</button><button type="button" aria-pressed={groups} onClick={() => changeView("groups")}>Groups</button></nav>
      <div className="participation-directory-tools"><button ref={searchButton} type="button" className="participation-find" aria-label="Search" title={searchOpen ? "Close search and clear filter" : groups ? "Search groups" : "Search people"} aria-expanded={searchOpen} aria-controls="people-directory-search" onClick={() => searchOpen ? closeSearch() : setShowSearch(true)}>{searchOpen ? <X size={20} aria-hidden="true" /> : <Search size={20} aria-hidden="true" />}</button>
        {!groups && people.data?.capabilities?.can_manage_enrollment ? <details className="people-actions-menu"><summary aria-label="More actions" title="More actions"><MoreHorizontal size={20} aria-hidden="true" /></summary><nav aria-label="People actions"><Link to="/areas/people/import">Enroll from file</Link><Link to="/areas/people/records">Enrollment records</Link></nav></details> : null}
      </div>
    </div>
    {searchOpen ? <form id="people-directory-search" className="participation-search" role="search" aria-label={groups ? "Group directory search" : "People directory search"} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); closeSearch(); } }} onSubmit={(event) => { event.preventDefault(); pageRequested.current = false; update({ search: draft.trim(), page: "" }); }}><label htmlFor="people-directory-query">Search {groups ? "groups" : "people"}</label><div className="participation-search__field"><input ref={searchInput} id="people-directory-query" type="search" value={draft} placeholder={groups ? "Group name" : "Person name"} onChange={(event) => setSearchDraft({ query: search, groups, value: event.target.value })} /><button type="submit" aria-label="Apply search"><Search size={20} aria-hidden="true" /></button>{draft || search ? <button type="button" className="participation-search__clear" onClick={() => { clearSearch(); setShowSearch(true); searchInput.current?.focus(); }}>Clear</button> : null}</div></form> : null}
    {environment.mode === "simulation" && !groups ? <p className="participation-context-note">App access is managed in Live. Real account changes are unavailable here.</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {!schoolId ? <p role="alert">Choose an institution before opening People.</p> : state.isPending ? <p role="status">Loading {groups ? "groups" : "people"}…</p> : state.isError ? <div role="alert"><p>{state.error.message}</p><button type="button" onClick={() => void state.refetch()}>Try again</button></div> : <>
      {groups ? <ul ref={results} tabIndex={-1} aria-label="Groups" className="participation-directory">{groupState.data?.results.map((group) => <li key={`${group.kind}:${group.id}`}><Link className="person-directory-link" aria-label={group.name} aria-describedby={`group-meta-${group.kind}-${group.id}`} state={{ peopleReturnTo: `${location.pathname}${location.search}` }} to={`/areas/people/groups/${encodeURIComponent(group.id)}${group.kind === "participation" ? "" : `?kind=${group.kind}`}`}><span className="participation-group-avatar" aria-hidden="true"><ProductIcon name="groups" size={28} /></span><div><strong>{group.name}</strong><p id={`group-meta-${group.kind}-${group.id}`}>{group.kind === "class" ? "Academic class" : group.kind === "organization" ? "Organizational unit" : "Reusable group"} · {group.member_count} {group.member_count === 1 ? "member" : "members"}</p>{group.parent ? <small>Part of {group.parent.name}</small> : null}</div><ChevronRight size={16} aria-hidden="true" /></Link></li>)}</ul> : <ul ref={results} tabIndex={-1} aria-label="People" className="participation-directory">{people.data?.results.map((person) => <li key={person.id} className={canInvite && needsAppAccess(person) ? "has-app-access-action" : undefined}><Link className="person-directory-link" aria-label={person.label} aria-describedby={`person-meta-${person.id}`} state={{ peopleReturnTo: `${location.pathname}${location.search}` }} to={`/areas/people/participants/${encodeURIComponent(person.id)}`}><span className="people-avatar" aria-hidden="true">{person.label.trim().split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span><div><strong>{person.label}</strong><p id={`person-meta-${person.id}`}>{person.affiliations.join(" · ") || "Campus person"} · {accountDescription(person)}</p></div>{!canInvite || !needsAppAccess(person) ? <ChevronRight size={16} aria-hidden="true" /> : null}</Link>{canInvite && needsAppAccess(person) ? <div className="participation-person-actions participation-row-actions"><button type="button" onClick={() => setAppAccessPerson(person)} title={person.pending_invitation ? "Manage invitation" : "Invite to app"} aria-label={`${person.pending_invitation ? "Manage invitation for" : "Invite to app for"} ${person.label}`}>{person.pending_invitation ? "Manage" : "Invite"}</button></div> : null}</li>)}</ul>}
      {!total ? <div className="participation-empty"><ProductIcon name="people" size={36} /><h2>{search ? "No matches" : groups ? "No groups yet" : "No people yet"}</h2><p>{search ? "Try another name." : groups ? "Group existing people when they regularly participate together." : "Add a person without creating an account or enrollment."}</p></div> : null}
      <PeoplePages page={page} total={total} pageSize={state.data?.page_size ?? 25} onPage={next => { pageRequested.current = true; update({ page: String(next) }); }} label="Directory pages" />
    </>}
    {canAdd && (adding === "person" ? <PeopleBulkAddDialog schoolId={schoolId} onClose={closeAdding} onDone={peopleAdded} /> : adding === "group" ? <GroupEditor schoolId={schoolId} onClose={closeAdding} onSaved={() => saved("Group created. It is now available when scheduling activities.")} /> : null)}
    {appAccessPerson && !ended ? <PersonAppAccessDialog key={appAccessPerson.id} schoolId={schoolId} person={appAccessPerson} onClose={() => setAppAccessPerson(null)} onChanged={refreshAppAccess} /> : null}
  </div></OperationsShell>;
}
