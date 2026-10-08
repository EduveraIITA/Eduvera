import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../../lib/api";
import { useAuth } from "../auth/AuthContext";

export interface ClassUpdate {
  id: string; class_section_id: string; kind: "note" | "comment" | "change";
  title: string; body: string; occurred_at: string; unread: boolean;
  notification_id: string | null; total: number;
}
export function useClassUpdates(date: string, enabled = true) {
  const auth = useAuth();
  return useQuery({ queryKey: ["teacher-class-updates", auth.user?.id, date], enabled,
    queryFn: () => apiFetch<{ results: ClassUpdate[] }>(`/api/v1/screens/teacher/class-updates/?date=${date}`),
    staleTime: 20_000, refetchInterval: 60_000 });
}
export function activityLabel(items: ClassUpdate[]) {
  const comments = items.filter(item => item.kind === "comment").length;
  const notes = items.filter(item => item.kind === "note").length;
  const changes = items.filter(item => item.kind === "change" && item.unread).length;
  return [comments ? `${comments} recent comment${comments === 1 ? "" : "s"}` : "", notes ? `${notes} recent note${notes === 1 ? "" : "s"}` : "", changes ? `${changes} unread change${changes === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");
}
