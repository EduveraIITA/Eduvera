import { BookOpen, Building2, Bus, CalendarDays, ChevronDown, ClipboardCheck, Search } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
import type { AccessRole, RoleAssignment, RoleOptions } from "./access-api";
import {
  assignmentDetail, assignmentKey, assignmentLink, assignmentScope, assignmentStatus, assignmentTripDate, assignmentWhen, contextLabels,
  groupAssignments, groupStatus, isCurrentAssignment, matchesSearch, type AssignmentGroup,
} from "./assignment-overview";
import "./assignment-overview.css";

type View = "assigned" | "unassigned" | "history";
const contextIcons = { class: BookOpen, assessment: ClipboardCheck, event: CalendarDays, trip: Bus, institution: Building2 };
const staffingLinks = {
  event: { to: "/principal/events", label: "Event staffing" },
  assessment: { to: "/principal/assessments", label: "Exam staffing" },
  trip: { to: "/principal/departure", label: "Journey roster" },
};

export function StaffAssignmentOverview({ assignments, roles, options, canAssign, onAssign, onManage, focusAssignmentId }: {
  assignments: RoleAssignment[]; roles: AccessRole[]; options?: RoleOptions; canAssign: boolean;
  onAssign: (role: AccessRole) => void; onManage: (assignment: RoleAssignment) => void; focusAssignmentId?: string;
}) {
  const [view, setView] = useState<View>("assigned");
  const [query, setQuery] = useState("");
  const focusedAssignment=focusAssignmentId?assignments.find(item=>item.source_id===focusAssignmentId):undefined;
  const focusedIsCurrent=Boolean(focusedAssignment&&isCurrentAssignment(focusedAssignment));
  const focusedSourceId=focusedAssignment?.source_id;
  const activeView:View=focusedAssignment?(focusedIsCurrent?"assigned":"history"):view;
  const activeQuery=focusedAssignment?"":query;
  useEffect(()=>{
    if(!focusedSourceId)return;
    const frame=window.requestAnimationFrame(()=>{
      const target=document.getElementById(`attention-staff-assignment-${focusedSourceId}`);
      target?.scrollIntoView?.({behavior:"smooth",block:"center"});
      target?.focus({preventScroll:true});
    });
    return()=>window.cancelAnimationFrame(frame);
  },[focusedSourceId,activeView]);
  const current = assignments.filter(isCurrentAssignment);
  const currentGroups = groupAssignments(current);
  const historyGroups = groupAssignments(assignments.filter((item) => !isCurrentAssignment(item)));
  const assignedRoleIds = new Set(currentGroups.map((group) => group.roleId));
  const unassigned = roles.filter((role) => role.is_active && !assignedRoleIds.has(role.id));
  const groups = (activeView === "history" ? historyGroups : currentGroups).flatMap((group) => {
    const matching = group.assignments.filter((item) => matchesSearch(activeQuery, `${group.name} ${contextLabels[group.context]} ${assignmentScope(item)} ${assignmentWhen(item)} ${assignmentStatus(item).label}`));
    return matching.length ? [{ ...group, assignments: matching }] : [];
  });
  const available = unassigned.filter((role) => matchesSearch(activeQuery, `${role.name} ${contextLabels[role.context_kind]}`));
  const views: { id: View; label: string; count: number }[] = [
    { id: "assigned", label: "Assigned", count: currentGroups.length },
    { id: "unassigned", label: "Not assigned", count: unassigned.length },
    { id: "history", label: "History", count: historyGroups.length },
  ];
  const resultCount = activeView === "unassigned" ? available.length : groups.length;
  return <div className="staff-assignment-overview">
    {focusAssignmentId&&!focusedAssignment?<section className="staff-assignment-attention-state" role="alert"><strong>Assignment unavailable</strong><p>This assignment no longer belongs to this staff profile or is outside your current access.</p></section>:null}
    <p className="staff-assignment-total"><strong>{currentGroups.length}</strong> {currentGroups.length === 1 ? "role" : "roles"} · <strong>{current.length}</strong> {current.length === 1 ? "assignment" : "assignments"}</p>
    <div className="staff-assignment-views" role="group" aria-label="Assignment view">
      {views.map((item) => <button key={item.id} type="button" aria-pressed={activeView === item.id} onClick={() => setView(item.id)}>
        <span className="staff-assignment-view-label">{item.label}</span><span>{item.count}</span>
      </button>)}
    </div>
    <label className="staff-assignment-search">
      <Search size={18} aria-hidden="true"/><span className="sr-only">Search roles and assignments</span>
      <input type="search" value={activeQuery} disabled={Boolean(focusedAssignment)} onChange={(event) => setQuery(event.target.value)} placeholder="Role, class, exam or journey"/>
    </label>
    <p className="sr-only" role="status">{resultCount} {activeView === "unassigned" ? "unassigned" : activeView === "history" ? "past" : "assigned"} {resultCount === 1 ? "role" : "roles"} found.</p>
    {activeView === "unassigned" ? <div className="staff-available-roles">
      {available.map((role) => {
        const plan = role.context_kind in staffingLinks ? staffingLinks[role.context_kind as keyof typeof staffingLinks] : null;
        return <div className="staff-available-role" key={role.id}>
          <div><h4>{role.name}</h4><small>{contextLabels[role.context_kind]}</small></div>
          {plan ? <Link to={plan.to} aria-label={`${plan.label}: ${role.name}`}>Plan assignment</Link>
            : <button className="staff-secondary" type="button" disabled={!canAssign} aria-label={`Assign ${role.name}`} onClick={() => onAssign(role)}>Assign</button>}
        </div>;
      })}
    </div> : <div className="staff-assignment-groups">
      {groups.map((group) => <AssignmentRoleGroup key={`${activeView}:${group.roleId}:${activeQuery}`} group={group} options={options} history={activeView === "history"} expand={(Boolean(activeQuery.trim()) && !matchesSearch(activeQuery, group.name))||group.assignments.some(item=>item.source_id===focusedSourceId)} onManage={onManage} focusAssignmentId={focusedSourceId}/>)}
    </div>}
    {!resultCount ? <div className="staff-assignment-empty">
      <p>{query.trim() ? "No matching roles or assignments." : view === "history" ? "No past assignments." : view === "unassigned" ? "All available roles are assigned." : "No roles assigned."}</p>
      {query.trim() ? <button type="button" onClick={() => setQuery("")}>Clear search</button> : null}
      {view === "assigned" && unassigned.length > 0 ? <button type="button" onClick={() => setView("unassigned")}>Check unassigned roles</button> : null}
    </div> : null}
  </div>;
}

function AssignmentRoleGroup({ group, options, history, expand, onManage, focusAssignmentId }: {
  group: AssignmentGroup; options?: RoleOptions; history: boolean; expand: boolean; onManage: (assignment: RoleAssignment) => void; focusAssignmentId?: string;
}) {
  const Icon = contextIcons[group.context];
  const statusId = useId();
  const scopes = [...new Set(group.assignments.map(assignmentScope))];
  const scopePreview = group.context === "class" ? `${scopes.slice(0, 2).join(", ")}${scopes.length > 2 ? ` +${scopes.length - 2}` : ""}` : contextLabels[group.context];
  return <details className="staff-assignment-group" open={expand}>
    <summary aria-label={`${group.name}, ${group.assignments.length} ${group.assignments.length === 1 ? "assignment" : "assignments"}`} aria-describedby={statusId}>
      <span className="staff-assignment-icon"><Icon size={19} aria-hidden="true"/></span>
      <span className="staff-assignment-group-title"><strong>{group.name}</strong><small>{scopePreview}</small><small id={statusId} className="staff-assignment-state">{groupStatus(group.assignments)}</small></span>
      <span className="staff-assignment-count" aria-hidden="true">{group.assignments.length}</span>
      <ChevronDown className="staff-assignment-chevron" size={17} aria-hidden="true"/>
    </summary>
    <div className="staff-assignment-group-body">
      {!history ? <details className="staff-group-actions"><summary>Allowed actions</summary><ul>{group.assignments[0]?.permissions.map((code) => <li key={code}>{options?.permissions.find((permission) => permission.code === code)?.label ?? code}</li>)}</ul></details> : null}
      {group.assignments.map((item) => {
        const link = assignmentLink(item, "principal");
        const status = assignmentStatus(item);
        const workLabel = item.source_kind === "transport_trip" && item.trip_service_date
          ? `${assignmentScope(item)}, ${assignmentWhen(item)}` : assignmentScope(item);
        const focused=item.source_id===focusAssignmentId;
        return <article className={`staff-assignment-scope${focused?" is-attention-target":""}`} id={focused?`attention-staff-assignment-${item.source_id}`:undefined} tabIndex={focused?-1:undefined} key={assignmentKey(item)}>
          <header><h4>{assignmentTripDate(item) ?? assignmentScope(item)}</h4><span className={`staff-status staff-status--${status.tone}`}>{status.label}</span></header>
          <p>{assignmentDetail(item, history)}</p>
          <footer>{link ? <Link to={link} aria-label={`Open work: ${workLabel}`}>Open work</Link> : null}
            {!history ? <button type="button" aria-label={`Manage assignment: ${workLabel}`} onClick={() => onManage(item)}>Manage</button> : null}
          </footer>
        </article>;
      })}
    </div>
  </details>;
}
