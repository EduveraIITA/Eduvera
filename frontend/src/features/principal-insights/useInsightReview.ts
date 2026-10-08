import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { schoolDateToday } from "../../lib/schoolTime";
import { useAuth } from "../auth/AuthContext";
import { getPrincipalInsights } from "./api";

export function useInsightReview() {
  const auth = useAuth(), [params] = useSearchParams();
  const schoolId = auth.user?.active_school_id ?? auth.memberships.find(member => member.role === "admin")?.school_id;
  const date = params.get("date") || schoolDateToday();
  const days = [14, 28, 56].includes(Number(params.get("insight_days"))) ? Number(params.get("insight_days")) : 28;
  const classId = params.get("class") ?? params.get("insight_class") ?? "";
  const raw = Number(params.get("insight_threshold") ?? 50);
  const threshold = Number.isInteger(raw) && raw >= 1 && raw <= 99 ? raw : 50;
  const allowed = Boolean(schoolId && auth.memberships.some(member => member.school_id === schoolId && member.role === "admin"));
  const query = useQuery({
    queryKey: ["principal-insights", schoolId, date, days, classId, threshold, auth.user?.id],
    queryFn: () => getPrincipalInsights(schoolId!, date, days, classId, threshold),
    enabled: allowed, staleTime: 30_000, refetchInterval: 60_000, retry: false,
  });
  return { ...query, allowed, date, days, classId, threshold };
}
