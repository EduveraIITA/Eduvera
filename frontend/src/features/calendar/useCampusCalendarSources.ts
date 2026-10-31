import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../../lib/api";
import { useOptionalAuth } from "../auth/AuthContext";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { loadPublishedCampusDates } from './campusPublishedDates';
import {
  calendarDateEntries, loadCalendarAssessments, loadCalendarDays, loadCalendarEvents, loadCalendarServices,
  type CalendarCategory, type CalendarEntry, type CalendarSourceState, type CampusCalendarScope,
} from "./campusCalendarSources";

/** Read-only composition of owning sources; never another schedule or editor. */
export function useCampusCalendarSources(scope: CampusCalendarScope, from: string, until: string) {
  const client = useQueryClient();
  const environment = useExecutionEnvironment();
  const actor = useOptionalAuth()?.user?.id;
  const unavailable = environment.mode === "simulation" && environment.unavailable === true;
  const enabled = Boolean(actor) && !unavailable;
  const base = ["calendar", "important-dates", actor ?? "unavailable-account", scope.schoolId, scope.surfaceKey,
    scope.studentId ?? "no-student", scope.timeZone, from, until] as const;
  const key = (category: CalendarCategory, href?: string) => unavailable
    ? ["execution-environment", "unavailable", environment.namespaceId, environment.runId, ...base, category, href ?? ""]
    : executionEnvironmentQueryKey(environment, [...base, category, href ?? ""]);
  const options = { retry: false, staleTime: 30_000, refetchInterval: 30_000 } as const;
  const days = useQuery({ ...options, queryKey: key("dates"), enabled,
    queryFn: ({ signal }) => loadCalendarDays(scope, from, until, signal) });
  const publications = useQuery({ ...options, queryKey: key("milestones"), enabled,
    queryFn: ({ signal }) => loadPublishedCampusDates(scope.schoolId, from, until, signal) });
  const events = useQuery({ ...options, queryKey: key("events", scope.eventHref), enabled: enabled && Boolean(scope.eventHref),
    queryFn: ({ signal }) => loadCalendarEvents(scope, from, until, signal) });
  const assessments = useQuery({ ...options, queryKey: key("assessments", scope.assessmentHref), enabled: enabled && Boolean(scope.assessmentHref),
    queryFn: ({ signal }) => loadCalendarAssessments(scope, from, until, signal) });
  const services = useQuery({ ...options, queryKey: key("services"), enabled: enabled && scope.includeDining,
    queryFn: ({ signal }) => loadCalendarServices(scope, from, until, signal) });
  const denied = !actor || days.error instanceof ApiError && [401, 403, 404, 410].includes(days.error.status);
  const campusDays = days.isSuccess && !days.isError && !denied ? days.data.results : [];
  const source = (category: CalendarCategory, label: string, query: {
    isError: boolean; isPending: boolean; refetch: () => unknown;
  }, partial = false): CalendarSourceState => ({
    key: category, label,
    status: unavailable || !actor || query.isError ? "error" : query.isPending ? "loading" : partial ? "partial" : "ready",
    retry: () => { void query.refetch(); },
    ...(unavailable ? { message: "This Simulation is unavailable. Return to an available environment to load dates." }
      : query.isError ? { message: `${label} could not load. Other calendar sources are separate.` }
        : partial ? { message: `${label} are partially loaded. Open the source for its complete records.` } : {}),
  });
  const sources: CalendarSourceState[] = [source("milestones", "Published dates", publications, publications.data?.partial), source("dates", "Campus dates", days)];
  if (scope.eventHref) sources.push(source("events", "Events", events, events.data?.partial));
  if (scope.assessmentHref) sources.push(source("assessments", "Assessments", assessments, assessments.data?.partial));
  if (scope.includeDining) sources.push(source("services", "Service changes", services, services.data?.partial));
  const entries: CalendarEntry[] = denied || unavailable ? [] : [
    ...(publications.isSuccess && !publications.isError ? publications.data.entries : []),
    ...calendarDateEntries(campusDays),
    ...(scope.eventHref && events.isSuccess && !events.isError ? events.data.entries : []),
    ...(scope.assessmentHref && assessments.isSuccess && !assessments.isError ? assessments.data.entries : []),
    ...(scope.includeDining && services.isSuccess && !services.isError ? services.data.entries : []),
  ];
  entries.sort((a, b) => a.startsOn.localeCompare(b.startsOn) || Number(b.allDay) - Number(a.allDay)
    || (a.startsAt ? Date.parse(a.startsAt) : 0) - (b.startsAt ? Date.parse(b.startsAt) : 0)
    || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  return { entries, sources, campusDays, daysLoaded: days.isSuccess && !days.isError && !denied && !unavailable, denied,
    canManagePublishedDates: !denied && !unavailable && publications.isSuccess && !publications.isError && publications.data.canManage,
    refreshPublishedDates: () => client.invalidateQueries({
      queryKey: executionEnvironmentQueryKey(environment, ['calendar', 'important-dates', actor ?? 'unavailable-account', scope.schoolId]),
      predicate: query => query.queryKey.at(-2) === 'milestones',
    }, { throwOnError: true }),
  };
}
