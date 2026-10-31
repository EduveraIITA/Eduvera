import { useQuery } from "@tanstack/react-query";
import { CalendarClock, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError } from "../../lib/api";
import { schoolDateToday } from "../../lib/schoolTime";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { StudentTimetablePage } from "../../pages/student/StudentTimetablePage";
import { AttentionOpenAcknowledgement } from "../attention/AttentionOpenAcknowledgement";
import { AttentionTargetUnavailable } from "../attention/AttentionTargetUnavailable";
import {
  getParentTimetable,
  getParentTimetableSummary,
  getStudentTimetable,
  getStudentTimetableSummary,
} from "../school/api";
import { adaptTimetable } from "../school/adapters";
import { resolveParentTimetableAttention } from "../school/ParentLiveRoutes";
import { TeacherDayPanel } from "../day-plans/TeacherDayPage";
import PrincipalDayPlanPage from "../day-plans/PrincipalDayPlanPage";
import { PrincipalPlannerRoute } from "../planner/PrincipalPlannerRoute";
import { resolveTimetableDisplayDate } from "../planner/rehearsal";
import { ScheduleSettingsRoute } from "../schedule-planning/ScheduleSettingsRoute";
import { ActivityTimetableWorkspace } from "../activities/ActivityTimetableWorkspace";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { manifestMatchesEnvironment } from "../workspace/ResponsibilityWorkspace";
import { WorkspaceState } from "../workspace/WorkspaceState";
import type {
  WorkspaceArea,
  WorkspaceAreaSurface,
  WorkspaceManifest,
} from "../workspace/types";
import { useWorkspaceManifest } from "../workspace/useWorkspaceManifest";
import {
  readTimetableView,
  timetableSummaryRange,
} from "./TimetableNavigator";
import "./timetable-workspace.css";

type TimetableSurfaceKind = "schedule" | "planning";
type RelationshipKind = "self" | "dependent";

export interface TimetableWorkspaceAccess {
  readonly manifest: WorkspaceManifest;
  readonly area: WorkspaceArea;
  readonly surface: WorkspaceAreaSurface;
  readonly kind: TimetableSurfaceKind;
  readonly institutionId: string;
  readonly institutionLabel?: string | null;
  readonly relationship?: RelationshipKind;
  readonly studentId?: string;
  readonly relationshipLabel?: string | null;
}

function relationshipSurface(surface: WorkspaceAreaSurface) {
  const match = surface.key.match(/^schedule:(self|dependent):(.+)$/);
  if (!match) return null;
  return { relationship: match[1] as RelationshipKind, studentId: match[2]! };
}

/**
 * Resolves only the server-composed timetable contribution. It deliberately
 * does not inspect a membership role, job title or legacy portal pathname.
 */
export function resolveTimetableWorkspaceAccess(
  manifest: WorkspaceManifest,
  requested: TimetableSurfaceKind,
  search: URLSearchParams,
): TimetableWorkspaceAccess | null {
  const area = manifest.areas.find((entry) => entry.key === "timetable");
  if (!area) return null;

  if (requested === "planning") {
    const surface = area.surfaces.find((entry) => entry.key === "planning");
    if (!surface) return null;
    return {
      manifest,
      area,
      surface,
      kind: "planning",
      institutionId: manifest.context.institution_id,
      institutionLabel: manifest.context.institution_label,
    };
  }

  const scope = search.get("scope");
  const studentId = search.get("student_id")?.trim();
  const hasRelationshipQuery = search.has("scope") || search.has("student_id");
  if (hasRelationshipQuery && ((scope !== "self" && scope !== "dependent") || !studentId)) return null;

  if (scope && studentId) {
    const key = `schedule:${scope}:${studentId}`;
    const surface = area.surfaces.find((entry) => entry.key === key);
    const scopeEntry = surface?.scopes.find((entry) => entry.kind === scope && entry.id === studentId);
    if (!surface || !scopeEntry) return null;
    return {
      manifest,
      area,
      surface,
      kind: "schedule",
      institutionId: manifest.context.institution_id,
      institutionLabel: manifest.context.institution_label,
      relationship: scope as RelationshipKind,
      studentId,
      relationshipLabel: scopeEntry.label,
    };
  }

  const surface = area.surfaces.find((entry) => entry.key === "schedule");
  if (!surface) return null;
  return {
    manifest,
    area,
    surface,
    kind: "schedule",
    institutionId: manifest.context.institution_id,
    institutionLabel: manifest.context.institution_label,
  };
}

function TimetableRouteState({ state, error, retry }: { state: "loading" | "error" | "revoked" | "unavailable"; error?: unknown; retry?: () => unknown }) {
  return <OperationsShell active="areas" title="Timetable">
    <WorkspaceState state={state} error={error} onRetry={retry} />
  </OperationsShell>;
}

function TimetableWorkspaceBoundary({ requested, children }: { requested: TimetableSurfaceKind; children: (access: TimetableWorkspaceAccess) => ReactNode }) {
  const environment = useExecutionEnvironment();
  const manifest = useWorkspaceManifest();
  const [search] = useSearchParams();

  if (environment.mode === "simulation" && environment.unavailable === true) return <TimetableRouteState state="unavailable" />;
  if (manifest.isPending) return <TimetableRouteState state="loading" />;
  if (manifest.error) {
    const revoked = manifest.error instanceof ApiError && manifest.error.status === 403;
    return <TimetableRouteState state={revoked ? "revoked" : "error"} error={manifest.error} retry={manifest.refetch} />;
  }
  if (!manifest.data || !manifestMatchesEnvironment(manifest.data, environment)) {
    return <TimetableRouteState state="error" error={new Error("The Timetable workspace did not match the active environment.")} retry={manifest.refetch} />;
  }
  const access = resolveTimetableWorkspaceAccess(manifest.data, requested, search);
  if (!access) return <TimetableRouteState state="revoked" retry={manifest.refetch} />;
  return children(access);
}

function surfaceDestination(surface: WorkspaceAreaSurface, current: URLSearchParams) {
  const [pathname, query = ""] = surface.href.split("?", 2);
  const next = new URLSearchParams(query);
  for (const key of ["date", "view"] as const) {
    const value = current.get(key);
    if (value) next.set(key, value);
  }
  const search = next.toString();
  return `${pathname}${search ? `?${search}` : ""}`;
}

export function calendarDestination(access: TimetableWorkspaceAccess, current: URLSearchParams) {
  const next = new URLSearchParams();
  if (access.relationship && access.studentId) {
    next.set("scope", access.relationship);
    next.set("student_id", access.studentId);
  } else {
    next.set("surface", access.kind === "planning" ? "manage" : "assigned");
  }
  for (const key of ["date", "view"] as const) {
    const value = current.get(key);
    if (value) next.set(key, value);
  }
  return `/areas/calendar?${next.toString()}`;
}

function TimetableContextBar({ access, compact = false }: { access: TimetableWorkspaceAccess; compact?: boolean }) {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const options = access.area.surfaces.filter((surface) => surface.key === "schedule" || surface.key === "planning" || Boolean(relationshipSurface(surface)));
  const planning = access.area.surfaces.find((surface) => surface.key === "planning");
  const settingsDestination = planning
    ? surfaceDestination({ ...planning, href: "/areas/timetable/planning/settings" }, search)
    : null;
  if (compact) return <div className="activity-timetable-scope">
    {options.length > 1 ? <label>Timetable scope<select value={access.surface.key} onChange={(event) => {
      const surface = options.find((candidate) => candidate.key === event.target.value);
      if (surface) void navigate(surfaceDestination(surface, search));
    }}>{options.map((surface) => <option key={surface.key} value={surface.key}>{surface.label}</option>)}</select></label> : null}
    <Link className="activity-text-button" to={calendarDestination(access, search)}>Campus calendar</Link>
    {settingsDestination ? <Link className="activity-text-button" to={settingsDestination}>Schedule settings</Link> : null}
  </div>;
  return <section className="timetable-workspace-context" aria-label="Timetable scope">
    <span className="timetable-workspace-context__icon" aria-hidden="true"><CalendarClock size={20} /></span>
    <span className="timetable-workspace-context__copy">
      <small>Current timetable</small>
      <strong>{access.surface.label}</strong>
      {access.surface.description ? <span>{access.surface.description}</span> : null}
    </span>
    <span className="timetable-workspace-context__actions">
      <Link to={calendarDestination(access, search)}>Calendar</Link>
      {settingsDestination ? <Link to={settingsDestination}>Schedule settings</Link> : null}
      {options.length > 1 ? <label>
        <span className="sr-only">Choose timetable scope</span>
        <select value={access.surface.key} onChange={(event) => {
          const surface = options.find((candidate) => candidate.key === event.target.value);
          if (surface) void navigate(surfaceDestination(surface, search));
        }}>
          {options.map((surface) => <option key={surface.key} value={surface.key}>{surface.label}</option>)}
        </select>
        <ChevronDown size={15} aria-hidden="true" />
      </label> : null}
    </span>
  </section>;
}

function positiveRevision(value: string | null) {
  if (!value) return null;
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision > 0 ? revision : null;
}

function ResponsibilitySchedule({ access }: { access: TimetableWorkspaceAccess }) {
  const [params, setParams] = useSearchParams();
  const date = resolveTimetableDisplayDate(params.get("date"), null, schoolDateToday());
  const view = readTimetableView(params.get("view"));
  const update = (nextDate: string, nextView?: typeof view) => {
    const next = new URLSearchParams(params);
    next.set("date", nextDate);
    if (nextView) next.set("view", nextView);
    setParams(next, { replace: true });
  };
  const setView = (nextView: typeof view) => {
    const next = new URLSearchParams(params);
    next.set("view", nextView);
    setParams(next, { replace: true });
  };
  return <TeacherDayPanel
    date={date}
    view={view}
    onDateChange={(nextDate) => update(nextDate)}
    onViewChange={setView}
    onNavigate={(nextDate, nextView) => update(nextDate, nextView)}
    schoolContext={{ id: access.institutionId, label: access.institutionLabel }}
    attentionTarget={{
      notificationId: params.get("attention_notification_id"),
      dayPlanId: params.get("day_plan_id"),
      dayPlanRevision: positiveRevision(params.get("day_plan_revision")),
      scheduleId: params.get("schedule_id"),
      scheduleRevision: positiveRevision(params.get("schedule_revision")),
    }}
  />;
}

function RelationshipSchedule({ access }: { access: TimetableWorkspaceAccess }) {
  const [params, setParams] = useSearchParams();
  const date = resolveTimetableDisplayDate(params.get("date"), null, schoolDateToday());
  const view = readTimetableView(params.get("view"));
  const range = timetableSummaryRange(date, view);
  const relationship = access.relationship!;
  const studentId = access.studentId!;
  const schedule = useQuery({
    queryKey: ["timetable", "workspace", relationship, studentId, date],
    queryFn: () => relationship === "self" ? getStudentTimetable(date) : getParentTimetable(date, studentId),
    placeholderData: (previous) => previous,
  });
  const summary = useQuery({
    queryKey: ["timetable", "workspace", "summary", relationship, studentId, range.start, range.end, date],
    queryFn: () => relationship === "self"
      ? getStudentTimetableSummary(range.start, range.end, date)
      : getParentTimetableSummary(range.start, range.end, date, studentId),
  });
  const set = (values: { date?: string; view?: typeof view }) => {
    const next = new URLSearchParams(params);
    if (values.date) next.set("date", values.date);
    if (values.view) next.set("view", values.view);
    setParams(next, { replace: true });
  };

  if (schedule.isPending) return <div className="timetable-workspace-loading" role="status"><span /><span /><span /><p>Loading the published timetable…</p></div>;
  if (schedule.isError || !schedule.data) return <section className="timetable-workspace-error" role="alert"><strong>The published timetable could not be loaded.</strong><p>{schedule.error?.message ?? "Try again."}</p><button type="button" onClick={() => void schedule.refetch()}>Try again</button></section>;

  const attention = relationship === "dependent" && !schedule.isPlaceholderData
    ? resolveParentTimetableAttention(params, schedule.data)
    : "none";
  const className = schedule.data.class_name;
  return <>
    {attention === "exact" ? <AttentionOpenAcknowledgement /> : null}
    <StudentTimetablePage
      presentation="workspace"
      audience={relationship === "dependent" ? "parent" : "student"}
      focusPublishedSource={attention === "exact"}
      attentionStatus={attention === "stale" ? <AttentionTargetUnavailable message="This timetable update no longer matches the published source, revision, learner and date. It was not marked as opened." /> : undefined}
      dayPlan={schedule.data.day_plan}
      selectedDate={date}
      scheduleLoading={schedule.isPlaceholderData}
      onDateChange={(nextDate) => set({ date: nextDate })}
      view={view}
      onViewChange={(nextView) => set({ view: nextView })}
      onNavigate={(nextDate, nextView) => set({ date: nextDate, view: nextView })}
      summary={summary.data}
      summaryLoading={summary.isPending}
      summaryError={summary.isError ? summary.error.message : undefined}
      onSummaryRetry={() => void summary.refetch()}
      className={className}
      studentName={schedule.data.student.user.display_name}
      termLabel={`${schedule.data.student.current_enrollment.term.name} - ${schedule.data.student.current_enrollment.term.academic_year}`}
      days={adaptTimetable(schedule.data)}
    />
  </>;
}

export function WorkspaceTimetableScheduleRoute() {
  const [params] = useSearchParams();
  return <TimetableWorkspaceBoundary requested="schedule">{(access) => !access.relationship && params.get("source") !== "academic" ? <ActivityTimetableWorkspace schoolId={access.institutionId} planning={false} context={<TimetableContextBar access={access} compact />} /> : <OperationsShell active="areas" title="Timetable" backTo="/areas">
    <div className="timetable-workspace">
      <TimetableContextBar access={access} />
      <div className="timetable-workspace__content">
        {access.relationship ? <RelationshipSchedule access={access} /> : <ResponsibilitySchedule access={access} />}
      </div>
    </div>
  </OperationsShell>}</TimetableWorkspaceBoundary>;
}

const workspacePlannerRoutes = {
  plannerPath: "/areas/timetable/planning",
  settingsPath: "/areas/timetable/planning/settings",
  dayPlanPath: "/areas/timetable/planning/day",
  eventCreatePath: "/areas/events/manage/new",
  eventDetailPath: "/areas/events/manage",
} as const;

export function WorkspaceTimetablePlanningRoute() {
  const [params] = useSearchParams();
  return <TimetableWorkspaceBoundary requested="planning">{(access) => params.has("class") || params.has("period") || params.get("source") === "academic" ? <PrincipalPlannerRoute
    presentation="workspace"
    expectedSchoolId={access.institutionId}
    routes={{
      ...workspacePlannerRoutes,
      ...(access.manifest.areas.find((area) => area.key === "events")?.surfaces.some((surface) => surface.key === "manage")
        ? { eventCreatePath: workspacePlannerRoutes.eventCreatePath, eventDetailPath: workspacePlannerRoutes.eventDetailPath }
        : { eventCreatePath: undefined, eventDetailPath: undefined }),
    }}
    workspaceContext={<TimetableContextBar access={access} />}
  /> : <ActivityTimetableWorkspace schoolId={access.institutionId} context={<TimetableContextBar access={access} compact />} />}</TimetableWorkspaceBoundary>;
}

export function WorkspaceTimetableDayPlanRoute() {
  return <TimetableWorkspaceBoundary requested="planning">{(access) => <PrincipalDayPlanPage workspace={{
    institutionId: access.institutionId,
    institutionLabel: access.institutionLabel,
    planningPath: workspacePlannerRoutes.plannerPath,
    dayPlanPath: workspacePlannerRoutes.dayPlanPath,
  }} />}</TimetableWorkspaceBoundary>;
}

export function WorkspaceTimetableSettingsRoute() {
  return <TimetableWorkspaceBoundary requested="planning">{(access) => <ScheduleSettingsRoute
    presentation="workspace"
    expectedSchoolId={access.institutionId}
    routes={workspacePlannerRoutes}
  />}</TimetableWorkspaceBoundary>;
}
