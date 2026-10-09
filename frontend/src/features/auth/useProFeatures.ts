import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api';
import { useOptionalAuth } from './AuthContext';

export interface ProFeaturesPreference { enabled:boolean; preview:true }
export const proFeaturesKey = (userId?:string) => ['account','pro-features',userId] as const;

export function useProFeatures() {
  const auth=useOptionalAuth();
  const query=useQuery({queryKey:proFeaturesKey(auth?.user?.id),queryFn:()=>apiFetch<ProFeaturesPreference>('/api/v1/auth/pro-features/'),enabled:Boolean(auth?.user),staleTime:30_000});
  return { ...query, enabled:query.data?.enabled===true };
}
