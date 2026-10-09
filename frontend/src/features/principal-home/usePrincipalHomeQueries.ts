import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthContext";
import { getAnalytics } from "../analytics/api";
import { getPrincipalInsights } from "../principal-insights/api";

export function usePrincipalHomeQueries(date: string) {
  const auth = useAuth();
  const schoolId = auth.user?.active_school_id ?? auth.memberships.find(member => member.role === "admin")?.school_id;
  const allowed = Boolean(schoolId && auth.memberships.some(member => member.school_id === schoolId && member.role === "admin"));
  // Match the detail-page keys, but never inherit a narrowed class or period filter.
  const review = useQuery({
    queryKey: ["principal-insights", schoolId, date, 28, "", 50, auth.user?.id],
    queryFn: () => getPrincipalInsights(schoolId!, date, 28, "", 50),
    enabled: allowed, staleTime: 30_000, refetchInterval: 60_000, retry: false,
  });
  const analytics = useQuery({
    queryKey: ["analytics", auth.user?.id, schoolId, "principal", undefined, undefined, "term"],
    queryFn: () => getAnalytics(schoolId!, "principal", "term"),
    enabled: allowed, staleTime: 30_000, refetchInterval: 60_000, retry: false,
  });
  return { allowed, review, analytics };
}
