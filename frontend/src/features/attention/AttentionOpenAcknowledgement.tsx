import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { apiFetch } from "../../lib/api";
import { useOptionalAuth } from "../auth/AuthContext";

const notificationIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Render this only in a destination's successful data state. Merely starting
 * navigation or displaying a route loader must never clear informational
 * attention. The API independently verifies the full `opened_target` (route
 * plus producer-owned query parameters) against the typed notification.
 */
export function AttentionOpenAcknowledgement() {
  const auth = useOptionalAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const attempted = useRef("");
  const notificationId = new URLSearchParams(location.search).get("attention_notification_id");
  const userId = auth?.user?.id;

  useEffect(() => {
    if (auth?.status !== "authenticated" || !userId || !notificationId || !notificationIdPattern.test(notificationId)) return;
    let active = true;
    const openedTarget = `${location.pathname}${location.search}`;
    const attemptKey = `${userId}:${openedTarget}:${notificationId}`;
    if (attempted.current === attemptKey) return;
    attempted.current = attemptKey;

    void apiFetch<{ id: string; read_at: string }>(`/api/v1/notifications/${notificationId}/read/`, {
      method: "POST",
      body: JSON.stringify({ opened_target: openedTarget }),
    }).then(async () => {
      if (active) {
        const parameters = new URLSearchParams(location.search);
        if (parameters.get("attention_notification_id") === notificationId) {
          parameters.delete("attention_notification_id");
          void navigate({ pathname: location.pathname, search: parameters.toString(), hash: location.hash }, { replace: true });
        }
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["attention"] }),
        queryClient.invalidateQueries({ queryKey: ["notifications", userId] }),
      ]);
    }).catch(() => {
      // Fail closed. Keeping the stable id in the URL makes a reload retryable,
      // while the server-side unread item and its navigation signal remain.
      attempted.current = "";
    });
    return () => { active = false; };
  }, [auth?.status, location.hash, location.pathname, location.search, navigate, notificationId, queryClient, userId]);

  return null;
}
