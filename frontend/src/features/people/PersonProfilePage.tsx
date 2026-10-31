import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import { ChevronRight, Mail, Pencil, Phone, Plus } from "lucide-react";
import { ProductIcon } from "../../components/ProductIcon";
import { ApiError } from "../../lib/api";
import { portalReturnState } from "../navigation/portalReturnState";
import { useAuth } from "../auth/AuthContext";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { NewStaffDialog } from "../staff-operations/StaffOperationsPage";
import { getParticipant, listPersonConnections, listPersonGroups, type ParticipantDetail, type PersonConnection } from "./participationApi";
import { enrollmentOptions } from "./api";
import { EnrollmentForm } from "./EnrollmentForm";
import { PersonNameEditor } from "./PersonNameEditor";
import { PersonAppAccessDialog } from "./PersonAppAccessDialog";
import { PersonContactEditor, PersonConnectionEditor } from "./PersonConnectionEditor";
import { GuardianConnectionEditor } from "./GuardianConnectionEditor";
import { PeoplePages } from "./PeoplePages";
import "./people.css";
import "./participation-people.css";
import "./person-profile.css";

const connectionLabel = (value: PersonConnection) => value.type === "mentor_of" ? value.direction === "outgoing" ? "Mentors" : "Mentored by" : value.direction === "outgoing" ? "Guardian of" : "Guardian";
const dateLabel = (date: string | null) => date ? new Date(`${date}T12:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "Start not recorded";
const denied = (error: unknown) => error instanceof ApiError && [401, 403, 404].includes(error.status);
const profilePage = (value: string | null) => { const page = Number(value ?? 1); return Number.isSafeInteger(page) && page > 0 && page <= 10_000 ? page : 1; };
function accountLabel(person: ParticipantDetail) {
  const you = person.is_you ? " · You" : "";
  if (person.account_state === "inactive") return `App access inactive${you}`;
  if (person.account_state === "active" || person.has_account) return `App account${you}`;
  if (person.pending_invitation) return person.pending_invitation.state === "expired" ? "Invitation expired" : "Invitation pending";
  return "No app account";
}
function ConnectionRow({ connection, ended, onEnd, origin }: { connection: PersonConnection; ended: boolean; onEnd: () => void; origin: string }) {
  const destination = `/areas/people/participants/${encodeURIComponent(connection.related_person.id)}`;
  return <li><div><span>{connectionLabel(connection)}</span><Link state={portalReturnState(origin, destination, { peopleReturnTo: origin })} to={destination}>{connection.related_person.label}</Link>
    <small>{connection.source_kind === "guardian" && !connection.starts_on ? "Contact relationship · dates not recorded" : <>{dateLabel(connection.starts_on)}{connection.ends_on ? ` – ${dateLabel(connection.ends_on)}` : " · no end date"}</>}</small>
    {connection.history?.length ? <details><summary>Connection history</summary><p>Latest 10 recorded changes.</p><ol>{connection.history.map(item => <li key={item.revision}>{item.effective_on} · {item.reason}<small>Recorded {new Date(item.recorded_at).toLocaleString()}</small></li>)}</ol></details> : null}
  </div>{connection.source_href ? <Link to={connection.source_href}>Review leave-signing permission</Link> : connection.can_end ? <button type="button" disabled={ended} onClick={onEnd}>End connection</button> : null}</li>;
}

function PersonEnrollment({ schoolId, person, onClose, onSaved }: { schoolId: string; person: ParticipantDetail; onClose: () => void; onSaved: () => void }) {
  const environment = useExecutionEnvironment();
  const options = useQuery({ queryKey: executionEnvironmentQueryKey(environment, ["school", "people", "options", schoolId]), queryFn: () => enrollmentOptions(schoolId) });
  return <PlannerDialog title="Enroll this person" onClose={onClose}>{options.isPending ? <p role="status">Loading enrollment options…</p> : options.isError ? <p role="alert">{options.error.message} <button type="button" onClick={() => void options.refetch()}>Try again</button></p> : options.data.results.length ? <EnrollmentForm schoolId={schoolId} person={person} options={options.data.results} onCancel={onClose} onSaved={onSaved} /> : <div className="planner-lesson-form"><p>An active term and class are needed for academic enrollment. This person can still join other campus activities without them.</p><Link to={`/more/setup/institution/academics?school=${encodeURIComponent(schoolId)}`}>Set up terms and classes</Link></div>}</PlannerDialog>;
}

export function PersonProfilePage() {
  const environment = useExecutionEnvironment();
  const { personId = "" } = useParams();
  if (environment.mode === "simulation" && environment.unavailable) return <OperationsShell active="areas" title="Person"><p role="alert">This simulation is unavailable. This person cannot be loaded from Live instead.</p></OperationsShell>;
  return <PersonProfile key={personId} />;
}
function PersonProfile() {
  const auth = useAuth(), environment = useExecutionEnvironment(), client = useQueryClient();
  const schoolId = auth.user?.active_school_id ?? "", { personId = "" } = useParams();
  const location = useLocation();
  const state: unknown = location.state;
  const retainedState = state && typeof state === "object" && !Array.isArray(state) ? state : {};
  const previous = state && typeof state === "object" && "peopleReturnTo" in state ? state.peopleReturnTo : null;
  const returnTo = typeof previous === "string" && /^\/areas\/people\/participants(?:\/[A-Za-z0-9_-]+)?(?:\?|$)/.test(previous) ? previous : "/areas/people/participants";
  const [params, setParams] = useSearchParams();
  const view = params.get("profile_view") === "connections" ? "connections" : params.get("profile_view") === "groups" ? "groups" : "overview";
  const connectionPage = profilePage(params.get("connection_page")), groupPage = profilePage(params.get("group_page"));
  const updateView = (nextView: typeof view) => { const next = new URLSearchParams(params); if (nextView === "overview") next.delete("profile_view"); else next.set("profile_view", nextView); setParams(next, { replace: true, state: { ...retainedState, peopleReturnTo: returnTo } }); };
  const updatePage = (key: "connection_page" | "group_page", page: number) => { const next = new URLSearchParams(params); if (page === 1) next.delete(key); else next.set(key, String(page)); setParams(next, { replace: true, state: { ...retainedState, peopleReturnTo: returnTo } }); };
  const [dialog, setDialog] = useState<"edit" | "connection" | "name" | "contact" | "mentor" | "guardian" | "enroll" | "work" | "access" | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const restoreFocus = useRef(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const openDialog = (next: typeof dialog) => { restoreFocus.current = false; returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setDialog(next); };
  const closeDialog = () => { restoreFocus.current = true; setDialog(null); setEnding(null); };
  const [ending, setEnding] = useState<PersonConnection | null>(null), [notice, setNotice] = useState("");
  useEffect(() => {
    if (dialog !== null || ending !== null || !restoreFocus.current) return;
    const frame = window.requestAnimationFrame(() => { restoreFocus.current = false; if (returnFocus.current?.isConnected) returnFocus.current.focus(); else editButton.current?.focus(); });
    return () => window.cancelAnimationFrame(frame);
  }, [dialog, ending]);
  const person = useQuery({ queryKey: executionEnvironmentQueryKey(environment, ["people.participants", schoolId, "detail", personId]), queryFn: () => getParticipant(schoolId, personId), enabled: Boolean(schoolId && personId) });
  const connections = useQuery({ queryKey: executionEnvironmentQueryKey(environment, ["people.connections", schoolId, personId, connectionPage]), queryFn: () => listPersonConnections(schoolId, personId, connectionPage), enabled: Boolean(person.data) && !person.isError });
  const groups = useQuery({ queryKey: executionEnvironmentQueryKey(environment, ["people.person-groups", schoolId, personId, groupPage]), queryFn: () => listPersonGroups(schoolId, personId, groupPage), enabled: Boolean(person.data) && !person.isError });
  const ended = environment.mode === "simulation" && (environment.unavailable || environment.runStatus === "stopped" || environment.runStatus === "completed");
  async function refresh(message = "Person updated.", close = true) {
    if (close) closeDialog(); setNotice(message);
    await Promise.all([client.invalidateQueries({ queryKey: executionEnvironmentQueryKey(environment, ["people.participants", schoolId]) }), client.invalidateQueries({ queryKey: executionEnvironmentQueryKey(environment, ["people.connections", schoolId]) }), client.invalidateQueries({ queryKey: executionEnvironmentQueryKey(environment, ["people.person-groups", schoolId]) }), client.invalidateQueries({ queryKey: executionEnvironmentQueryKey(environment, ["activities", schoolId]) })]);
  }
  const current = person.data, capabilities = current?.capabilities ?? {}, sources = current?.source_profiles ?? [];
  const learner = sources.find(source => source.kind === "learning"), work = sources.find(source => source.kind === "work");
  const appPerson = current ? { ...current, affiliations: current.affiliations ?? current.affiliation_sources.map(source => source.affiliation), has_account: current.has_account ?? current.account_state === "active" } : null;
  const canInvite = environment.mode === "live" && capabilities.can_invite && !current?.is_you && current?.account_state !== "active" && current?.account_state !== "inactive" && !current?.has_account;
  const canConnect = !denied(connections.error) && (capabilities.can_manage_connections || capabilities.can_link_guardian);
  const reviewedConnection = ending && !denied(connections.error) ? connections.data?.results.find(item => item.id === ending.id && item.can_end) : null;
  const allowedDialog = !ended && (dialog === "edit" ? capabilities.can_correct_name || capabilities.can_edit_profile : dialog === "connection" ? canConnect : dialog === "name" ? capabilities.can_correct_name : dialog === "contact" ? capabilities.can_edit_profile : dialog === "mentor" ? capabilities.can_manage_connections && !denied(connections.error) : dialog === "guardian" ? capabilities.can_link_guardian && !denied(connections.error) : dialog === "enroll" ? capabilities.can_enroll && !learner : dialog === "work" ? capabilities.can_add_work_profile && !work : dialog === "access" ? canInvite : false);
  return <OperationsShell active="areas" title="Person" backTo={returnTo} contentHasHeading={!person.isPending && !person.isError && Boolean(current)}><div className="participation-people person-profile">
    {person.isPending ? <p role="status">Loading person…</p> : person.isError ? <div role="alert"><p>{person.error.message}</p><button type="button" onClick={() => void person.refetch()}>Try again</button></div> : current ? <>
      <header className="person-profile-identity"><div className="person-profile-identity__details"><span className="people-avatar" aria-hidden="true">{current.label.trim().split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase()}</span><div><h1>{current.label}</h1><p>{[...new Set(current.affiliation_sources.map(source => source.affiliation))].join(" · ") || "Campus person"}</p><span className="person-profile-account-state">{accountLabel(current)}</span></div></div>{connections.isSuccess || groups.isSuccess ? <div className="person-profile-metrics" aria-label="Recorded profile counts">{connections.isSuccess ? <button type="button" aria-label={`View ${connections.data.total} ${connections.data.total === 1 ? "connection" : "connections"}`} onClick={() => updateView("connections")}><strong>{connections.data.total}</strong><span>Connections</span></button> : null}{groups.isSuccess ? <button type="button" aria-label={`View ${groups.data.total} current ${groups.data.total === 1 ? "group" : "groups"}`} onClick={() => updateView("groups")}><strong>{groups.data.total}</strong><span>Groups</span></button> : null}</div> : null}{capabilities.can_correct_name || capabilities.can_edit_profile ? <button ref={editButton} className="person-profile-primary person-profile-edit" disabled={ended} type="button" onClick={() => openDialog("edit")}><Pencil size={16} aria-hidden="true" />Edit details</button> : null}</header>
      {ended ? <p>This simulation has ended. This saved person is read-only.</p> : null}{notice ? <p role="status">{notice}</p> : null}
      <nav className="person-profile-views" aria-label="Person profile views">{(["overview", "connections", "groups"] as const).map(item => <button key={item} type="button" aria-current={view === item ? "page" : undefined} onClick={() => updateView(item)}>{item === "overview" ? "Overview" : item === "connections" ? "Connections" : "Groups"}</button>)}</nav>
      {view === "overview" ? <>
      <section className="people-panel person-profile-section"><h2>Contact details</h2><dl className="person-profile-contact"><div><dt><Mail size={16} aria-hidden="true" />Email</dt><dd>{current.profile?.contact_email || "Email not recorded"}</dd></div><div><dt><Phone size={16} aria-hidden="true" />Phone</dt><dd>{current.profile?.contact_phone || "Phone not recorded"}</dd></div></dl></section>
      {learner || capabilities.can_enroll ? <section className="people-panel person-profile-section person-profile-context"><header><h2><ProductIcon name="learning" size={24} />Learning</h2>{!learner && capabilities.can_enroll ? <button disabled={ended} type="button" onClick={() => openDialog("enroll")}>Enroll this person</button> : null}</header>{learner ? <Link className="person-profile-source" to={learner.href}>{learner.label} · Open enrollment<ChevronRight size={16} aria-hidden="true" /></Link> : <p>No academic enrollment record. Campus participation does not require one.</p>}</section> : null}
      {work || capabilities.can_add_work_profile ? <section className="people-panel person-profile-section person-profile-context"><header><h2><ProductIcon name="work" size={24} />Work</h2>{!work && capabilities.can_add_work_profile ? <button disabled={ended} type="button" onClick={() => openDialog("work")}>Add work profile</button> : null}</header>{work ? <Link className="person-profile-source" to={work.href}>{work.label} · Open work details<ChevronRight size={16} aria-hidden="true" /></Link> : <p>No employment profile. This does not prevent participation in a duty or activity.</p>}</section> : null}
      <section className="people-panel person-profile-section person-profile-context"><header><h2><ProductIcon name="security" size={24} />App access</h2>{canInvite ? <button type="button" onClick={() => openDialog("access")}>{current.pending_invitation ? "Manage invitation" : "Invite to app"}</button> : null}</header><p>{current.account_state === "inactive" ? "The retained app account is inactive." : current.account_state === "active" || current.has_account ? "This person has a linked sign-in account." : current.pending_invitation?.state === "expired" ? "The invitation has expired." : current.pending_invitation ? "The invitation is waiting for acceptance." : "This person can participate without signing in."}</p>{environment.mode !== "live" ? <p>App access is managed in Live. This simulation cannot invite real people or change accounts.</p> : null}<p>App access does not grant operational permissions.</p></section>
      </> : view === "connections" ? <section className="people-panel person-profile-section"><header><h2><ProductIcon name="relationships" size={24} />Connections</h2>{canConnect ? <button type="button" className="person-profile-primary" disabled={ended} onClick={() => openDialog(capabilities.can_manage_connections && capabilities.can_link_guardian ? "connection" : capabilities.can_manage_connections ? "mentor" : "guardian")}><Plus size={16} aria-hidden="true" />Add connection</button> : null}</header>
        {connections.isPending ? <p role="status">Loading connections…</p> : connections.isError ? <p role="alert">{connections.error.message} <button onClick={() => void connections.refetch()}>Try again</button></p> : <><ul className="person-profile-list">{connections.data?.results.map(connection => <ConnectionRow key={connection.id} connection={connection} origin={`${location.pathname}${location.search}`} ended={Boolean(ended)} onEnd={() => { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setEnding(connection); }} />)}</ul>{!connections.data?.total ? <p>No connections recorded.</p> : null}<PeoplePages page={connectionPage} total={connections.data?.total ?? 0} pageSize={connections.data?.page_size ?? 25} onPage={page => updatePage("connection_page", page)} label="Connection pages" /></>}
      </section> : <section className="people-panel person-profile-section"><h2><ProductIcon name="groups" size={24} />Groups</h2>{groups.isPending ? <p role="status">Loading groups…</p> : groups.isError ? <p role="alert">{groups.error.message} <button onClick={() => void groups.refetch()}>Try again</button></p> : <><ul className="person-profile-list">{groups.data?.results.map(group => <li key={`${group.kind}:${group.id}`}><div><Link to={group.href} state={portalReturnState(`${location.pathname}${location.search}`, group.href, { peopleReturnTo: `${location.pathname}${location.search}` })}>{group.name}</Link><small>{group.kind === "class" ? "Class" : group.kind === "organization" ? "Organization group" : "Participation group"} · {group.starts_on ? <>From {dateLabel(group.starts_on)}{group.ends_on ? ` – ${dateLabel(group.ends_on)}` : ""}</> : "Current membership · dates not recorded"}</small></div></li>)}</ul>{!groups.data?.total ? <p>No current group membership.</p> : null}<PeoplePages page={groupPage} total={groups.data?.total ?? 0} pageSize={groups.data?.page_size ?? 25} onPage={page => updatePage("group_page", page)} label="Person group pages" /></>}</section>}
      {!ended && reviewedConnection ? <PersonConnectionEditor schoolId={schoolId} person={current} connection={ending!} onClose={closeDialog} onSaved={() => void refresh("Connection saved. Access and past records are unchanged.")} /> : allowedDialog && (dialog === "edit" ? <PlannerDialog title="Edit details" subtitle={current.label} onClose={closeDialog}><div className="person-profile-choices">{capabilities.can_correct_name ? <button type="button" onClick={() => setDialog("name")}><Pencil size={18} aria-hidden="true" /><span>Correct name</span><ChevronRight size={16} aria-hidden="true" /></button> : null}{capabilities.can_edit_profile ? <button type="button" onClick={() => setDialog("contact")}><Phone size={18} aria-hidden="true" /><span>Edit contact details</span><ChevronRight size={16} aria-hidden="true" /></button> : null}</div></PlannerDialog> : dialog === "connection" ? <PlannerDialog title="Add connection" subtitle={current.label} onClose={closeDialog}><div className="person-profile-choices">{capabilities.can_manage_connections ? <button type="button" onClick={() => setDialog("mentor")}><ProductIcon name="relationships" size={28} /><span>Add mentoring connection<small>Informational mentoring, without access or authority</small></span><ChevronRight size={16} aria-hidden="true" /></button> : null}{capabilities.can_link_guardian ? <button type="button" onClick={() => setDialog("guardian")}><ProductIcon name="people" size={28} /><span>Add family connection<small>Contact relationship; leave-signing rights stay separate</small></span><ChevronRight size={16} aria-hidden="true" /></button> : null}</div></PlannerDialog> : dialog === "name" ? <PersonNameEditor schoolId={schoolId} personId={current.id} onClose={closeDialog} onSaved={label => void refresh(`${label} corrected. Published snapshots are unchanged.`)} /> : dialog === "contact" ? <PersonContactEditor schoolId={schoolId} person={current} onClose={closeDialog} onSaved={() => void refresh("Contact details saved.")} /> : dialog === "mentor" ? <PersonConnectionEditor schoolId={schoolId} person={current} onClose={closeDialog} onSaved={() => void refresh("Connection saved. Access and past records are unchanged.")} /> : dialog === "guardian" ? <GuardianConnectionEditor schoolId={schoolId} person={current} studentId={learner?.id} onClose={closeDialog} onSaved={() => void refresh("Family connection saved. No authority or app access was granted.")} /> : dialog === "enroll" ? <PersonEnrollment schoolId={schoolId} person={current} onClose={closeDialog} onSaved={() => void refresh("Enrollment saved for this same person.")} /> : dialog === "work" ? <NewStaffDialog schoolId={schoolId} person={current} onClose={closeDialog} onSaved={async () => { await refresh("Work profile saved. App access and responsibilities stay separate."); }} /> : dialog === "access" && appPerson ? <PersonAppAccessDialog schoolId={schoolId} person={appPerson} onClose={closeDialog} onChanged={() => void refresh("App invitation updated.", false)} /> : null)}
    </> : null}
  </div></OperationsShell>;
}
