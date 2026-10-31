import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';
import { useSession } from '../auth/SessionProvider';
import { apiFetch } from './api';
import { ApiConnectionError } from './api-client';
import { isExecutionRequest } from './api-policy';

export function useApi<T>(path: string | null, options: { refetchInterval?: number | false; staleTime?: number } = {}) {
  const { scopeKey, status, environment } = useSession();
  const focused = useIsFocused(), client = useQueryClient(), queryKey = ['campus', scopeKey, path] as const;
  return useQuery<T, Error>({
    queryKey,
    queryFn: ({ signal }) => apiFetch<T>(path!, { signal }),
    enabled: focused && !!path && status === 'authenticated' && (!environment.unavailable || !isExecutionRequest(path)),
    staleTime: options.staleTime ?? 15_000,
    // Only an initial read gets a bounded transport retry. A cached source must
    // publish its failed refresh immediately so existing authority gates pause
    // actions; Query keeps status=success while a background retry is pending.
    retry: (failureCount, error) => failureCount < 1 && error instanceof ApiConnectionError && client.getQueryData(queryKey) === undefined,
    retryDelay: 1_000,
    // An unavailable initial read must settle on its recovery UI instead of
    // replacing it with a fresh loader every polling interval. An explicit
    // refresh, route re-entry or app foreground can start a new bounded read.
    refetchInterval: query => query.state.status === 'error' ? false : options.refetchInterval ?? 60_000,
  });
}
