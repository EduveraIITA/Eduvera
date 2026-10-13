import { useQuery } from "@tanstack/react-query";
import { useOptionalAuth } from "../auth/AuthContext";
import { getAttention, type AttentionPortal } from "./api";

export const attentionQueryRoot = ["attention"] as const;

export function attentionQueryKey(portal: AttentionPortal, userId: string, studentId?: string) {
  return [...attentionQueryRoot, portal, userId, studentId ?? "school"] as const;
}

/**
 * The school attention read model is intentionally unavailable to students.
 * A parent query is enabled only when its active child is known so sibling
 * attention can never be merged into the current view.
 */
export function useAttention(portal: AttentionPortal | "student" | null | undefined, studentId?: string) {
  const auth = useOptionalAuth();
  const supportedPortal = portal === "student" ? null : portal;
  const userId = auth?.user?.id ?? "anonymous";
  const hasScope = supportedPortal !== "parent" || Boolean(studentId);

  return useQuery({
    queryKey: supportedPortal
      ? attentionQueryKey(supportedPortal, userId, studentId)
      : [...attentionQueryRoot, "disabled", userId] as const,
    queryFn: () => {
      if (!supportedPortal) throw new Error("Attention is not available for this portal.");
      return getAttention(supportedPortal, studentId);
    },
    enabled: auth?.status === "authenticated" && Boolean(supportedPortal) && hasScope,
    staleTime: 15_000,
    refetchInterval: 60_000,
    refetchOnMount: "always",
    retry: false,
  });
}
