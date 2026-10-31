import { useMemo } from 'react';
import { useApi } from './query';
/** Runtime validation stays at the feature boundary, including manual recovery reads. */
export function useAccountQuery<T>(path: string | null, parse: (value: unknown) => T) {
  const query = useApi<unknown>(path);
  const parsed = useMemo(() => { if (query.data === undefined) return { value: undefined, invalid: '' }; try { return { value: parse(query.data), invalid: '' }; } catch (cause) { return { value: undefined, invalid: cause instanceof Error ? cause.message : 'The saved account state could not be verified.' }; } }, [query.data, parse]);
  return { ...query, ...parsed, refresh: async () => { const result = await query.refetch({ throwOnError: true }); if (result.data === undefined) throw new Error('The saved account state could not be refreshed.'); return parse(result.data); } };
}
