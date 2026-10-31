import { useQueries } from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';
import type { CalendarCategory, CalendarEntry, CalendarSourceResult, CampusCalendarScope } from '../../../../packages/contracts/src/wire/features/calendar/campusCalendarSources';
import type { ApiSchoolCalendarDay } from '../../../../packages/contracts/src/wire/features/school/api';
import { useSession } from '../../auth/SessionProvider';
import { ApiError, apiFetch, captureApiContext } from '../../lib/api';
import { loadNativeCalendarSource, nativeCalendarSourceLabels } from '../../lib/native-calendar';

type SourceResult = CalendarSourceResult & { campusDays?: ApiSchoolCalendarDay[] };

/** Each source has its own finite, cancellable read in the selected native scope. */
export function useNativeCampusCalendarSources(scope: CampusCalendarScope, from: string, until: string) {
  const { scopeKey, user, status, environment } = useSession();
  const focused = useIsFocused();
  const unavailable = Boolean(environment.unavailable);
  const categories: CalendarCategory[] = ['milestones', 'dates', ...(scope.eventHref ? ['events' as const] : []), ...(scope.assessmentHref ? ['assessments' as const] : []), ...(scope.includeDining ? ['services' as const] : [])];
  const queries = useQueries({ queries: categories.map(category => ({
    queryKey: ['campus', scopeKey, 'important-calendar', user?.id, scope.schoolId, scope.surfaceKey, scope.studentId ?? '', scope.timeZone, from, until, category, category === 'events' ? scope.eventHref : category === 'assessments' ? scope.assessmentHref : ''],
    enabled: focused && status === 'authenticated' && Boolean(user) && !unavailable,
    staleTime: 15_000, retry: false, refetchInterval: 60_000,
    queryFn: async ({ signal }: { signal: AbortSignal }): Promise<SourceResult> => {
      const context = captureApiContext();
      const fetcher = async <T,>(path: string, options?: { signal?: AbortSignal }) => { context.assertCurrent(); const result = await apiFetch<T>(path, options); context.assertCurrent(); return result; };
      return loadNativeCalendarSource(category, scope, from, until, fetcher, signal);
    },
  })) });
  const days = queries[categories.indexOf('dates')]!;
  const denied = !user || days.error instanceof ApiError && [401, 403, 404, 410].includes(days.error.status);
  const sources = categories.map((category, index) => {
    const query = queries[index]!;
    const state = unavailable || !user || query.isError ? 'error' : query.isPending ? 'loading' : query.data?.partial ? 'partial' : 'ready';
    return { key: category, label: nativeCalendarSourceLabels[category], state,
      retry: () => { void query.refetch(); },
      message: unavailable ? 'This Simulation is unavailable. Return to an available environment to load dates.'
        : query.isError ? `${nativeCalendarSourceLabels[category]} could not load. Other calendar sources are separate.`
          : query.data?.partial ? `${nativeCalendarSourceLabels[category]} are partially loaded. Markers describe loaded dates only.` : undefined,
    };
  });
  const entries: CalendarEntry[] = denied || unavailable ? [] : queries.flatMap(query => query.isSuccess && !query.isError ? query.data.entries : []);
  entries.sort((a, b) => a.startsOn.localeCompare(b.startsOn) || Number(b.allDay) - Number(a.allDay) || (a.startsAt ?? '').localeCompare(b.startsAt ?? '') || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  return { entries, sources, denied, unavailable,
    campusDays: !denied && !unavailable && days.isSuccess && !days.isError ? days.data.campusDays ?? [] : [],
    daysLoaded: !denied && !unavailable && days.isSuccess && !days.isError && !days.isFetching,
    daysVerifiedAt: !denied && !unavailable && days.isSuccess && !days.isError && !days.isFetching ? days.dataUpdatedAt : 0,
    refreshing: queries.some(query => query.isRefetching), refresh: () => { for (const query of queries) void query.refetch(); },
  };
}
