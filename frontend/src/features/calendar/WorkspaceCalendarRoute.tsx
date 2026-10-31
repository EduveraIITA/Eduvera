import { ArrowRight, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError } from "../../lib/api";
import { ProductIcon } from "../../components/ProductIcon";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { manifestMatchesEnvironment } from "../workspace/ResponsibilityWorkspace";
import { WorkspaceState } from "../workspace/WorkspaceState";
import type { WorkspaceArea, WorkspaceAreaSurface, WorkspaceManifest } from "../workspace/types";
import { useWorkspaceManifest } from "../workspace/useWorkspaceManifest";
import { CampusDatesCalendar } from "./CampusDatesCalendar";
import type { CampusCalendarScope } from "./campusCalendarSources";
import "../timetable/timetable-workspace.css";
import "./calendar-workspace.css";

type CalendarWorkspaceKind = "self" | "dependent" | "assigned" | "manage" | "availability";

export interface CalendarWorkspaceAccess {
  readonly manifest: WorkspaceManifest;
  readonly area: WorkspaceArea;
  readonly surface: WorkspaceAreaSurface;
  readonly kind: CalendarWorkspaceKind;
  readonly studentId?: string;
  readonly relationshipLabel?: string;
}

function relationshipCalendar(surface: WorkspaceAreaSurface) {
  const match = surface.key.match(/^calendar:(self|dependent):(.+)$/);
  if (!match) return null;
  return { kind: match[1] as "self" | "dependent", studentId: match[2]! };
}

/**
 * Resolve a calendar from server-composed responsibility/relationship evidence.
 * No membership role, job title or legacy pathname participates in this choice.
 */
export function resolveCalendarWorkspaceAccess(
  manifest: WorkspaceManifest,
  search: URLSearchParams,
): CalendarWorkspaceAccess | null {
  const area = manifest.areas.find((entry) => entry.key === "calendar");
  if (!area) return null;

  const requestedScope = search.get("scope");
  const requestedStudent = search.get("student_id")?.trim() || null;
  if (requestedScope === "self" || requestedScope === "dependent") {
    const candidates = area.surfaces.flatMap((surface) => {
      const relationship = relationshipCalendar(surface);
      return relationship?.kind === requestedScope ? [{ surface, relationship }] : [];
    });
    const selected = requestedStudent
      ? candidates.find((candidate) => candidate.relationship.studentId === requestedStudent)
      : candidates.length === 1 ? candidates[0] : null;
    if (!selected) return null;
    const relationshipScope = selected.surface.scopes.find((scope) => scope.kind === requestedScope && scope.id === selected.relationship.studentId);
    if (!relationshipScope) return null;
    return {
      manifest,
      area,
      surface: selected.surface,
      kind: requestedScope,
      studentId: selected.relationship.studentId,
      relationshipLabel: relationshipScope?.label ?? undefined,
    };
  }
  if (search.has("scope") || search.has("student_id")) return null;

  const requestedSurface = search.get("surface");
  if (requestedSurface === "assigned") {
    const surface = area.surfaces.find((entry) => entry.key === "assigned");
    return surface ? { manifest, area, surface, kind: "assigned" } : null;
  }
  if (requestedSurface === "manage") {
    const surface = area.surfaces.find((entry) => entry.key === "manage");
    return surface ? { manifest, area, surface, kind: "manage" } : null;
  }
  if (requestedSurface === "availability") {
    const surface = area.surfaces.find((entry) => entry.key === "availability");
    return surface ? { manifest, area, surface, kind: "availability" } : null;
  }
  if (requestedSurface) return null;

  const assigned = area.surfaces.find((entry) => entry.key === "assigned");
  const manage = area.surfaces.find((entry) => entry.key === "manage");
  const relationshipCandidates = area.surfaces.flatMap((surface) => {
    const relationship = relationshipCalendar(surface);
    return relationship ? [{ surface, relationship }] : [];
  });
  const own = relationshipCandidates.length === 1 && relationshipCandidates[0]!.relationship.kind === "self"
    ? relationshipCandidates[0] : undefined;
  const ownScope = own?.surface.scopes.find((scope) => scope.kind === "self" && scope.id === own.relationship.studentId);
  // A personal activity contribution is not a second campus responsibility.
  // Prefer the one exact own-learner context so its Events/Assessments remain
  // available. Never choose a dependent, or replace class/team/management work.
  if (own && ownScope && !manage && (!assigned || assigned.scopes.length > 0 && assigned.scopes.every((scope) => scope.kind === "self"))) {
    return { manifest, area, surface: own.surface, kind: "self", studentId: own.relationship.studentId, relationshipLabel: ownScope.label ?? undefined };
  }
  if (assigned) return { manifest, area, surface: assigned, kind: "assigned" };
  if (manage) return { manifest, area, surface: manage, kind: "manage" };
  const availability = area.surfaces.find((entry) => entry.key === "availability");
  if (availability && area.surfaces.length === 1) return { manifest, area, surface: availability, kind: "availability" };
  if (relationshipCandidates.length !== 1 || availability) return null;
  const selected = relationshipCandidates[0]!;
  const relationshipScope = selected.surface.scopes.find((scope) => scope.kind === selected.relationship.kind && scope.id === selected.relationship.studentId);
  if (!relationshipScope) return null;
  return {
    manifest,
    area,
    surface: selected.surface,
    kind: selected.relationship.kind,
    studentId: selected.relationship.studentId,
    relationshipLabel: relationshipScope?.label ?? undefined,
  };
}

function stateRoute(state: "loading" | "error" | "revoked" | "unavailable", error?: unknown, retry?: () => unknown) {
  return <OperationsShell active="areas" title="Calendar" backTo="/areas">
    <WorkspaceState state={state} error={error} onRetry={retry} />
  </OperationsShell>;
}

function CalendarWorkspaceBoundary({ children }: { children: (access: CalendarWorkspaceAccess) => ReactNode }) {
  const environment = useExecutionEnvironment();
  const manifest = useWorkspaceManifest();
  const [search] = useSearchParams();
  const location = useLocation();

  if (environment.mode === "simulation" && environment.unavailable === true) return stateRoute("unavailable");
  if (manifest.isPending) return stateRoute("loading");
  if (manifest.error) {
    const revoked = manifest.error instanceof ApiError && manifest.error.status === 403;
    return stateRoute(revoked ? "revoked" : "error", manifest.error, manifest.refetch);
  }
  if (!manifest.data || !manifestMatchesEnvironment(manifest.data, environment)) {
    return stateRoute("error", new Error("The Calendar workspace did not match the active environment."), manifest.refetch);
  }
  const access = resolveCalendarWorkspaceAccess(manifest.data, search);
  if (!access) {
    // A person with several linked calendars must choose their exact context.
    // Do not silently choose a child, or present an ordinary choice as revoked.
    const hasRequestedContext = ["scope", "student_id", "surface"].some((key) => search.has(key));
    const area = manifest.data.areas.find((entry) => entry.key === "calendar");
    if (!hasRequestedContext && area && calendarOptions(area).length > 1) return <CalendarScopeChoice area={area} search={search} />;
    const relationshipKind = search.get("scope");
    if (area && !search.has("student_id") && !search.has("surface") && (relationshipKind === "self" || relationshipKind === "dependent")) {
      const choices = { ...area, surfaces: area.surfaces.filter((surface) => relationshipCalendar(surface)?.kind === relationshipKind) };
      if (calendarOptions(choices).length > 1) return <CalendarScopeChoice area={choices} search={search} />;
    }
    return stateRoute("revoked", undefined, manifest.refetch);
  }
  if ((access.kind === "self" || access.kind === "dependent") && (search.get("scope") !== access.kind || search.get("student_id") !== access.studentId)) {
    const exact = new URLSearchParams(search);
    exact.set("scope", access.kind);
    exact.set("student_id", access.studentId!);
    return <Navigate replace to={{ pathname: "/areas/calendar", search: exact.toString(), hash: location.hash }} />;
  }
  return children(access);
}

function calendarOptions(area: WorkspaceArea) {
  const campus = area.surfaces.find((surface) => surface.key === "assigned")
    ?? area.surfaces.find((surface) => surface.key === "manage");
  return area.surfaces.flatMap((surface) => {
    const relationship = relationshipCalendar(surface);
    if (relationship) {
      const scope = surface.scopes.find((entry) => entry.kind === relationship.kind && entry.id === relationship.studentId);
      if (!scope) return [];
      return [{
        key: surface.key,
        label: relationship.kind === "self" ? "My calendar" : `${scope?.label ?? surface.label.replace(/ calendar$/i, "")} calendar`,
        href: surface.href,
      }];
    }
    // Assigned and manage contribute authority, not two different calendars.
    if (surface === campus) return [{ key: "campus", label: "Campus dates", href: surface.href }];
    if (surface.key === "availability" && !campus) return [{ key: "availability", label: "Campus dates", href: surface.href }];
    return [];
  });
}

function selectedOptionKey(access: CalendarWorkspaceAccess) {
  const campus = access.area.surfaces.some(surface => surface.key === 'assigned' || surface.key === 'manage');
  return access.kind === "assigned" || access.kind === "manage" || access.kind === 'availability' && campus ? "campus" : access.surface.key;
}

/** An owning-domain link needs its own exact manifest contribution. */
function contributedDestination(access: CalendarWorkspaceAccess, areaKey: "events" | "assessments" | "timetable") {
  const area = access.manifest.areas.find((entry) => entry.key === areaKey);
  if (!area || access.kind === "availability") return undefined;
  const family = access.kind === "self" || access.kind === "dependent";
  const stem = areaKey === "events" ? "calendar" : areaKey === "assessments" ? "results" : "schedule";
  const surface = family
    ? area.surfaces.find((entry) => entry.key === `${stem}:${access.kind}:${access.studentId}`
      && entry.scopes.some((scope) => scope.kind === access.kind && scope.id === access.studentId))
    : area.surfaces.find((entry) => entry.key === (areaKey === "timetable" ? "planning" : "manage"))
      ?? area.surfaces.find((entry) => entry.key === (areaKey === "timetable" ? "schedule" : "assigned"));
  if (!surface) return undefined;
  const target = new URL(surface.href, "https://thatcampus.invalid");
  const expectedPath = `/areas/${areaKey}/${family ? stem : surface.key}`;
  if (target.origin !== "https://thatcampus.invalid" || target.pathname !== expectedPath) return undefined;
  if (family && (target.searchParams.get("scope") !== access.kind || target.searchParams.get("student_id") !== access.studentId)) return undefined;
  return `${target.pathname}${target.search}`;
}

export function calendarSourceScope(access: CalendarWorkspaceAccess): CampusCalendarScope {
  return {
    schoolId: access.manifest.context.institution_id,
    timeZone: access.manifest.context.time_zone ?? "UTC",
    surfaceKey: access.surface.key,
    studentId: access.studentId,
    eventHref: contributedDestination(access, "events"),
    assessmentHref: contributedDestination(access, "assessments"),
    includeDining: access.area.surfaces.some((surface) => surface.key === "availability"),
  };
}

/** Only link to a Timetable surface independently contributed by the server. */
export function calendarTimetableDestination(access: CalendarWorkspaceAccess, current: URLSearchParams) {
  const href = contributedDestination(access, "timetable");
  if (!href) return null;
  const target = new URL(href, "https://thatcampus.invalid");
  for (const key of ["date", "school", "class", "class_section_id"] as const) {
    const value = current.get(key);
    if (value) target.searchParams.set(key, value);
  }
  const view = current.get("view");
  if (view === "day" || view === "agenda") target.searchParams.set("view", view);
  return `${target.pathname}${target.search}`;
}

function destination(href: string, current: URLSearchParams) {
  const target = new URL(href, "https://thatcampus.invalid");
  for (const key of ["date", "view"] as const) {
    const value = current.get(key);
    if (value) target.searchParams.set(key, value);
  }
  return `${target.pathname}${target.search}`;
}

function CalendarScopeChoice({ area, search }: { area: WorkspaceArea; search: URLSearchParams }) {
  return <OperationsShell active="areas" title="Calendar" backTo="/areas">
    <section className="responsibility-workspace">
      <div className="responsibility-workspace__content workspace-view">
        <section className="workspace-section" aria-labelledby="calendar-scope-choice-title">
          <header><h2 id="calendar-scope-choice-title">Choose a calendar</h2></header>
          <div className="workspace-directory">
            {calendarOptions(area).map((option) => <Link className="workspace-directory-row" key={option.key} to={destination(option.href, search)}>
              <span className="workspace-directory-row__icon"><ProductIcon name="calendar" size={30} /></span>
              <span className="workspace-directory-row__body"><strong>{option.label}</strong></span>
              <ArrowRight className="workspace-directory-row__arrow" size={17} aria-hidden="true" />
            </Link>)}
          </div>
        </section>
      </div>
    </section>
  </OperationsShell>;
}

function CalendarContextBar({ access }: { access: CalendarWorkspaceAccess }) {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const options = calendarOptions(access.area);
  const timetableHref = calendarTimetableDestination(access, search);
  const label = access.kind === "manage" || access.kind === "assigned"
    ? "Campus dates"
      : access.kind === "availability"
        ? "Campus dates"
      : access.kind === "self"
        ? "My calendar"
        : `${access.relationshipLabel ?? "Learner"} calendar`;
  return <nav className="calendar-workspace-context" aria-label="Calendar scope and related tools">
    {options.length > 1 ? <label>
      <span className="sr-only">Choose calendar scope</span>
      <select value={selectedOptionKey(access)} onChange={(event) => {
        const option = options.find((candidate) => candidate.key === event.target.value);
        if (option) void navigate(destination(option.href, search));
      }}>
        {options.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
      </select>
      <ChevronDown size={15} aria-hidden="true" />
    </label> : <span className="calendar-workspace-context__label">{label}</span>}
    {timetableHref ? <Link className="calendar-workspace-context__link" to={timetableHref}>Timetable <ArrowRight size={17} aria-hidden="true" /></Link> : null}
  </nav>;
}

function CalendarBody({ access }: { access: CalendarWorkspaceAccess }) {
  return <CampusDatesCalendar
    key={`${access.manifest.context.environment.namespace_id}:${access.manifest.context.institution_id}:${access.surface.key}`}
    scope={calendarSourceScope(access)}
  />;
}

export function WorkspaceCalendarRoute() {
  return <CalendarWorkspaceBoundary>{(access) => <OperationsShell active="areas" title="Calendar" backTo="/areas">
    <div className="timetable-workspace">
      <CalendarContextBar access={access} />
      <div className="timetable-workspace__content">
        <CalendarBody access={access} />
      </div>
    </div>
  </OperationsShell>}</CalendarWorkspaceBoundary>;
}
