import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { TemporalInput } from "../../components/forms/TemporalInput";
import { GroupEditor } from "./PeopleParticipantsPage";
import { PeoplePages } from "./PeoplePages";
import { getNativeGroup, getParticipationGroup, getParticipationGroupHistory, listParticipationGroups, setParticipationGroupParent, type ParticipationGroupDetail } from "./participationApi";
import "./people.css";
import "./participation-people.css";

function GroupParentEditor({ schoolId, group, onClose, onSaved }: { schoolId: string; group: ParticipationGroupDetail; onClose: () => void; onSaved: () => void }) {
  const environment = useExecutionEnvironment();
  const [parent, setParent] = useState(group.parent?.id ?? ""), [search, setSearch] = useState(""), [page, setPage] = useState(1);
  const [date, setDate] = useState(""), [reason, setReason] = useState(""), [key, setKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const choices = useQuery({ queryKey: executionEnvironmentQueryKey(environment, ["people.participation-groups", schoolId, "parent-selector", search, page]), queryFn: () => listParticipationGroups(schoolId, search, page) });
  const changed = () => setKey(crypto.randomUUID());
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { await setParticipationGroupParent(schoolId, group.id, { parent_group_id: parent || null, effective_on: date, expected_revision: group.revision, reason: reason.trim(), idempotency_key: key }); onSaved(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The group structure was not saved. Your choices are retained."); }
    finally { setBusy(false); }
  }
  return <PlannerDialog title="Change group structure" subtitle={group.name} onClose={onClose} busy={busy}><form className="planner-lesson-form people-editor-form" onSubmit={event => void save(event)}>
    <p>Optional descriptive containment only. Members of subgroups are not automatically included; app permissions, reporting lines and published rosters stay unchanged.</p>
    <fieldset className="onboarding-fields" disabled={busy}><label><input type="radio" name="group-parent" checked={!parent} onChange={() => { changed(); setParent(""); }} />No parent group</label>
      {parent ? <p>Selected parent: {choices.data?.results.find(item => item.id === parent)?.name ?? (group.parent?.id === parent ? group.parent.name : "Selected group")}</p> : null}
      <label>Find a parent group<input type="search" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} /></label>
      {choices.isPending ? <p role="status">Loading groups…</p> : choices.isError ? <p role="alert">{choices.error.message} <button type="button" onClick={() => void choices.refetch()}>Try again</button></p> : <><div className="participation-person-options">{choices.data.results.filter(item => item.id !== group.id).map(item => <label key={item.id}><input type="radio" name="group-parent" checked={parent === item.id} onChange={() => { changed(); setParent(item.id); }} /><span>{item.name}</span></label>)}</div><PeoplePages page={page} total={choices.data.total} pageSize={25} onPage={setPage} label="Parent group pages" /></>}
      <label>Effective from<TemporalInput required type="date" value={date} onChange={event => { changed(); setDate(event.target.value); }} /></label><label>Reason<textarea required minLength={3} maxLength={500} value={reason} onChange={event => { changed(); setReason(event.target.value); }} /></label>
      {error ? <p role="alert" className="planner-form-error">{error}</p> : null}<footer><button type="button" className="is-secondary" onClick={onClose}>Cancel</button><button type="submit" disabled={!date || reason.trim().length < 3}>Save group structure</button></footer>
    </fieldset>
  </form></PlannerDialog>;
}

export function PeopleGroupDetailPage() {
  const [params] = useSearchParams();
  const location = useLocation();
  const state: unknown = location.state;
  const previous = state && typeof state === "object" && "peopleReturnTo" in state ? state.peopleReturnTo : null;
  const returnTo = typeof previous === "string" && /^\/areas\/people\/participants(?:\/[A-Za-z0-9_-]+)?(?:\?|$)/.test(previous) ? previous : "/areas/people/participants?view=groups";
  const { groupId = "" } = useParams();
  const environment = useExecutionEnvironment();
  if (environment.mode === "simulation" && environment.unavailable) return <OperationsShell active="areas" title="Group"><p role="alert">This simulation is unavailable. This group cannot be loaded from Live instead.</p></OperationsShell>;
  const kind = params.get("kind");
  return kind === "class" || kind === "organization" ? <NativeGroupPage key={`${kind}:${groupId}`} kind={kind} returnTo={returnTo} /> : <ParticipationGroupPage key={`participation:${groupId}`} returnTo={returnTo} />;
}
function NativeGroupPage({ kind, returnTo }: { kind: "class" | "organization"; returnTo: string }) {
  const { groupId = "" } = useParams(), auth = useAuth(), environment = useExecutionEnvironment();
  const schoolId = auth.user?.active_school_id ?? "", [page, setPage] = useState(1);
  const query = useQuery({ queryKey: executionEnvironmentQueryKey(environment, ["people.group-catalogue", schoolId, kind, groupId, page]), queryFn: () => getNativeGroup(schoolId, kind, groupId, page), enabled: Boolean(schoolId && groupId) });
  return <OperationsShell active="areas" title="Group" backTo={returnTo} contentHasHeading={!query.isPending && !query.isError && Boolean(query.data)}><div className="participation-people">
    {query.isPending ? <p role="status">Loading group…</p> : query.isError ? <p role="alert">{query.error.message} <button onClick={() => void query.refetch()}>Try again</button></p> : query.data ? <>
      <header><div><h1>{query.data.name}</h1><p>{kind === "class" ? "Academic class" : "Organizational unit"} · {query.data.member_count} {query.data.member_count === 1 ? "member" : "members"}</p></div></header>
      <p>{kind === "class" ? "Membership comes from academic enrollment. Open a learner to review their enrollment; a reusable group cannot change it." : "This structure is descriptive. It does not grant app access or operational authority."}</p>
      {query.data.source_href ? <Link to={query.data.source_href}>Open {kind === "class" ? "class records" : "organization structure"}</Link> : null}
      <section className="people-panel person-profile-section"><h2>Members</h2><ul className="person-profile-list">{query.data.members.map(member => <li key={member.person_id}><Link to={`/areas/people/participants/${encodeURIComponent(member.person_id)}`}>{member.label}</Link></li>)}</ul>{!query.data.total ? <p>No current members.</p> : null}<PeoplePages page={page} total={query.data.total} pageSize={query.data.page_size} onPage={setPage} label="Native group member pages" /></section>
    </> : null}
  </div></OperationsShell>;
}
function ParticipationGroupPage({ returnTo }: { returnTo: string }) {
  const { groupId = "" } = useParams(), auth = useAuth(), environment = useExecutionEnvironment(), client = useQueryClient();
  const schoolId = auth.user?.active_school_id ?? "";
  const [page, setPage] = useState(1), [editing, setEditing] = useState<"members" | "parent" | null>(null), [notice, setNotice] = useState("");
  const [showHistory, setShowHistory] = useState(false), [historyPage, setHistoryPage] = useState(1);
  const query = useQuery({ queryKey: executionEnvironmentQueryKey(environment, ["people.participation-groups", schoolId, groupId, page]), queryFn: () => getParticipationGroup(schoolId, groupId, page), enabled: Boolean(schoolId && groupId) });
  const history = useQuery({ queryKey: executionEnvironmentQueryKey(environment, ["people.participation-groups", schoolId, groupId, "history", historyPage]), queryFn: () => getParticipationGroupHistory(schoolId, groupId, historyPage), enabled: Boolean(query.data && showHistory) });
  const ended = environment.mode === "simulation" && (environment.unavailable || environment.runStatus === "stopped" || environment.runStatus === "completed");
  const saved = () => { setEditing(null); setNotice("Group updated. Published activities keep their captured rosters until a plan change is published."); void client.invalidateQueries({ queryKey: executionEnvironmentQueryKey(environment, ["people.participation-groups", schoolId]) }); void client.invalidateQueries({ queryKey: executionEnvironmentQueryKey(environment, ["people.group-catalogue", schoolId]) }); void client.invalidateQueries({ queryKey: executionEnvironmentQueryKey(environment, ["people.person-groups", schoolId]) }); };
  const group = query.data;
  return <OperationsShell active="areas" title="Group" backTo={returnTo} contentHasHeading={!query.isPending && !query.isError && Boolean(group)}><div className="participation-people">
    {query.isPending ? <p role="status">Loading group…</p> : query.isError ? <div role="alert"><p>{query.error.message}</p><button type="button" onClick={() => void query.refetch()}>Try again</button></div> : group ? <>
      <header><div><h1>{group.name}</h1><p>{group.member_count} current {group.member_count === 1 ? "member" : "members"}</p></div>{group.capabilities.can_manage ? <button type="button" disabled={ended} onClick={() => setEditing("members")}>Edit members</button> : null}</header>
      {ended ? <p>This simulation has ended. Its saved group is read-only.</p> : null}{notice ? <p role="status">{notice}</p> : null}
      <section className="people-panel person-profile-section"><h2>Current members</h2><ul className="person-profile-list">{group.members.map(member => <li key={member.person_id}><div><Link to={`/areas/people/participants/${encodeURIComponent(member.person_id)}`}>{member.label}</Link><small>Since {member.starts_on}{member.ends_on ? ` · until ${member.ends_on}` : ""}</small></div></li>)}</ul>{!group.member_count ? <p>No current members.</p> : null}<PeoplePages page={page} total={group.total} pageSize={group.page_size} onPage={setPage} label="Group member pages" /></section>
      <section className="people-panel person-profile-section"><header><h2>Structure <small>(optional)</small></h2>{group.capabilities.can_manage ? <button type="button" disabled={ended} onClick={() => setEditing("parent")}>Change structure</button> : null}</header>{group.parent ? <p>Part of <Link to={`/areas/people/groups/${encodeURIComponent(group.parent.id)}`}>{group.parent.name}</Link> from {group.parent.starts_on}</p> : <p>No parent group.</p>}<p>Containment does not add subgroup members, establish reporting authority or change app permissions.</p>
        {group.parent_history.length ? <details><summary>Containment history</summary><p>Latest 25 changes.</p><ul>{group.parent_history.map(item => <li key={item.id}>{item.parent_name ?? "No parent"} · {item.starts_on}{item.ends_on ? ` – ${item.ends_on}` : ""}</li>)}</ul></details> : null}
      </section>
      <section className="people-panel person-profile-section"><details onToggle={event => setShowHistory(event.currentTarget.open)}><summary>Membership history</summary>{showHistory ? history.isPending ? <p role="status">Loading membership history…</p> : history.isError ? <p role="alert">{history.error.message} <button onClick={() => void history.refetch()}>Try again</button></p> : <><p>Membership periods are retained. Names shown are current campus names, not historical attendance snapshots.</p><ul className="person-profile-list">{history.data?.results.map(item => <li key={item.id}><div><Link to={`/areas/people/participants/${encodeURIComponent(item.person_id)}`}>{item.label}</Link><small>{item.starts_on}{item.ends_on ? ` – ${item.ends_on}` : " · no end date"}</small></div></li>)}</ul><PeoplePages page={historyPage} total={history.data?.total ?? 0} pageSize={25} onPage={setHistoryPage} label="Membership history pages" /></> : null}</details></section>
      {!ended && (editing === "members" ? <GroupEditor schoolId={schoolId} group={group} onClose={() => setEditing(null)} onSaved={saved} /> : editing === "parent" ? <GroupParentEditor schoolId={schoolId} group={group} onClose={() => setEditing(null)} onSaved={saved} /> : null)}
    </> : null}
  </div></OperationsShell>;
}
