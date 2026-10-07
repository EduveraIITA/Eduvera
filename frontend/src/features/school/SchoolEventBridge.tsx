import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ApiError, apiFetch } from "../../lib/api";
import { useOptionalAuth } from "../auth/AuthContext";
import {
  decodeSchoolEventChannelMessage,
  SCHOOL_EVENT_CHANNEL_VERSION,
  schoolEventChannelName,
  schoolEventLockName,
  type SchoolEventChannelMessage,
  type SchoolEventChannelPayload,
  type SharedStreamStatus,
} from "./schoolEventChannel";
import {
  createInvalidationBatcher,
  FULL_SYNC_INVALIDATIONS,
  resolveSchoolEvent,
  SCHOOL_EVENT_TYPES,
  type SchoolEventEnvelope,
  type SchoolEventType,
} from "./schoolEventProtocol";

type StreamStatus = SharedStreamStatus | "unavailable";

const SESSION_VALIDATION_ERROR_THRESHOLD = 2;
const SESSION_VALIDATION_THROTTLE_MS = 15_000;

const statusMessages: Record<StreamStatus, string> = {
  connected: "Live school updates connected.",
  reconnecting: "Reconnecting live school updates.",
  offline: "Live school updates paused while this device is offline.",
  unavailable: "Live school updates are unavailable in this browser.",
};

function initialStreamStatus(): StreamStatus {
  if (typeof EventSource === "undefined") return "unavailable";
  return typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "reconnecting";
}

function createTabId() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function encodeEnvelope(envelope: SchoolEventEnvelope) {
  return JSON.stringify(envelope);
}

export function SchoolEventBridge() {
  const auth = useOptionalAuth();
  const queryClient = useQueryClient();
  const userId = auth?.user?.id;
  const authenticated = auth?.status === "authenticated";
  const [streamStatus, setStreamStatus] = useState<StreamStatus>(initialStreamStatus);

  useEffect(() => {
    if (!authenticated || !userId) return undefined;
    if (typeof EventSource === "undefined") return undefined;

    const batcher = createInvalidationBatcher(queryClient);
    const tabId = createTabId();
    const handledEventIds = new Set<string>();
    let currentStatus: StreamStatus = initialStreamStatus();
    let source: EventSource | undefined;
    let stopSource: (() => void) | undefined;
    let channel: BroadcastChannel | undefined;
    let lockAbort: AbortController | undefined;
    let releaseLeadership: (() => void) | undefined;
    let isLeader = false;
    let cleaned = false;
    let consecutiveErrors = 0;
    let lastSessionValidationAt = Number.NEGATIVE_INFINITY;
    let sessionValidationInFlight = false;
    let sessionValidationTimer: ReturnType<typeof setTimeout> | undefined;
    const sessionValidationAbort = new AbortController();

    const updateStatus = (status: StreamStatus) => {
      currentStatus = status;
      setStreamStatus(status);
    };
    const post = (payload: SchoolEventChannelPayload, targetTabId?: string) => {
      if (!channel || cleaned) return;
      const message: SchoolEventChannelMessage = {
        version: SCHOOL_EVENT_CHANNEL_VERSION,
        senderTabId: tabId,
        userId,
        ...(targetTabId ? { targetTabId } : {}),
        ...payload,
      };
      channel.postMessage(message);
    };
    const publishStatus = (status: SharedStreamStatus) => {
      updateStatus(status);
      if (isLeader) post({ kind: "status", status });
    };
    const requestFullSync = (share = false, targetTabId?: string) => {
      batcher.enqueue(FULL_SYNC_INVALIDATIONS);
      if (share && isLeader) post({ kind: "sync" }, targetTabId);
    };
    const enqueueEnvelope = (envelope: SchoolEventEnvelope, expectedType: SchoolEventType) => {
      if (handledEventIds.has(envelope.id)) return false;
      const resolution = resolveSchoolEvent(encodeEnvelope(envelope), expectedType, userId);
      if (!resolution.envelope) {
        requestFullSync();
        return false;
      }
      handledEventIds.add(envelope.id);
      if (handledEventIds.size > 512) handledEventIds.delete(handledEventIds.values().next().value!);
      batcher.enqueue(resolution.invalidations);
      if(expectedType==="staff.access.updated")window.dispatchEvent(new Event("omnischool:access-updated"));
      return true;
    };
    const expireSession = (share: boolean) => {
      source?.close();
      if (share && isLeader) post({ kind: "session.expired" });
      window.dispatchEvent(new Event("omnischool:session-expired"));
    };
    const validateSession = async () => {
      if (sessionValidationInFlight || !navigator.onLine || cleaned || (!isLeader && channel)) return;
      sessionValidationInFlight = true;
      lastSessionValidationAt = Date.now();
      try {
        const session = await apiFetch<{ authenticated: boolean }>("/api/v1/auth/session/", {
          signal: sessionValidationAbort.signal,
        });
        if (!cleaned && !session.authenticated) expireSession(true);
      } catch (error) {
        // apiFetch already expires this document on a confirmed 401. The leader
        // still relays that result so authenticated follower tabs exit too.
        if (error instanceof ApiError && error.status === 401 && isLeader) post({ kind: "session.expired" });
      } finally {
        sessionValidationInFlight = false;
      }
    };
    const scheduleSessionValidation = () => {
      if (
        consecutiveErrors < SESSION_VALIDATION_ERROR_THRESHOLD ||
        !navigator.onLine ||
        sessionValidationInFlight ||
        sessionValidationTimer
      ) return;
      const delay = Math.max(0, lastSessionValidationAt + SESSION_VALIDATION_THROTTLE_MS - Date.now());
      if (delay === 0) {
        void validateSession();
        return;
      }
      sessionValidationTimer = setTimeout(() => {
        sessionValidationTimer = undefined;
        void validateSession();
      }, delay);
    };
    const clearSessionValidationTimer = () => {
      if (sessionValidationTimer) clearTimeout(sessionValidationTimer);
      sessionValidationTimer = undefined;
    };

    const startSource = (shared: boolean) => {
      if (source || cleaned) return;
      const activeSource = new EventSource("/api/v1/events/stream/", { withCredentials: true });
      source = activeSource;
      consecutiveErrors = 0;

      const handleOpen = () => {
        consecutiveErrors = 0;
        clearSessionValidationTimer();
        publishStatus("connected");
      };
      const handleError = () => {
        consecutiveErrors += 1;
        publishStatus(navigator.onLine ? "reconnecting" : "offline");
        scheduleSessionValidation();
      };
      const handleReady = () => {
        publishStatus("connected");
      };
      const handleSyncRequired = () => requestFullSync(shared);
      const handleSessionExpired = () => expireSession(shared);
      const eventHandlers = new Map<SchoolEventType, EventListener>();

      for (const type of SCHOOL_EVENT_TYPES) {
        const handler: EventListener = (event) => {
          if (!(event instanceof MessageEvent) || typeof event.data !== "string") {
            requestFullSync(shared);
            return;
          }
          const resolution = resolveSchoolEvent(event.data, type, userId);
          if (!resolution.envelope) {
            requestFullSync(shared);
            return;
          }
          if (!enqueueEnvelope(resolution.envelope, type)) return;
          if (shared) post({ kind: "event", eventType: type, envelope: resolution.envelope });
        };
        eventHandlers.set(type, handler);
        activeSource.addEventListener(type, handler);
      }

      activeSource.onopen = handleOpen;
      activeSource.onerror = handleError;
      activeSource.addEventListener("stream.ready", handleReady);
      activeSource.addEventListener("sync.required", handleSyncRequired);
      activeSource.addEventListener("session.expired", handleSessionExpired);
      publishStatus(navigator.onLine ? "reconnecting" : "offline");

      stopSource = () => {
        activeSource.onopen = null;
        activeSource.onerror = null;
        activeSource.removeEventListener("stream.ready", handleReady);
        activeSource.removeEventListener("sync.required", handleSyncRequired);
        activeSource.removeEventListener("session.expired", handleSessionExpired);
        for (const [type, handler] of eventHandlers) activeSource.removeEventListener(type, handler);
        activeSource.close();
        if (source === activeSource) source = undefined;
      };
    };

    const handleOnline = () => {
      if (isLeader || !channel) {
        publishStatus("reconnecting");
        scheduleSessionValidation();
        return;
      }
      updateStatus("reconnecting");
      requestFullSync();
      post({ kind: "hello" });
    };
    const handleOffline = () => {
      clearSessionValidationTimer();
      if (isLeader) publishStatus("offline");
      else updateStatus("offline");
    };
    const handleVisibility = () => {
      if (document.visibilityState !== "visible" || !navigator.onLine || isLeader || !channel) return;
      requestFullSync();
      post({ kind: "hello" });
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    document.addEventListener("visibilitychange", handleVisibility);

    const lockManager = (navigator as Navigator & { locks?: LockManager }).locks;
    const coordinationAvailable = typeof BroadcastChannel !== "undefined" && typeof lockManager?.request === "function";
    if (!coordinationAvailable) {
      startSource(false);
    } else {
      try {
        channel = new BroadcastChannel(schoolEventChannelName(userId));
        const handleChannelMessage = (event: MessageEvent<unknown>) => {
          const message = decodeSchoolEventChannelMessage(event.data);
          if (!message || message.userId !== userId || message.senderTabId === tabId) return;
          if (message.targetTabId && message.targetTabId !== tabId) return;

          if (message.kind === "event") {
            enqueueEnvelope(message.envelope, message.eventType);
          } else if (message.kind === "sync") {
            requestFullSync();
          } else if (message.kind === "session.expired") {
            expireSession(false);
          } else if (message.kind === "status") {
            if (!isLeader) updateStatus(message.status);
          } else if (message.kind === "hello" && isLeader) {
            post({ kind: "status", status: currentStatus === "unavailable" ? "reconnecting" : currentStatus }, message.senderTabId);
            post({ kind: "sync" }, message.senderTabId);
          }
        };
        channel.addEventListener("message", handleChannelMessage);
        lockAbort = new AbortController();
        updateStatus(navigator.onLine ? "reconnecting" : "offline");
        post({ kind: "hello" });

        const lockRequest = lockManager.request(
          schoolEventLockName(userId),
          { mode: "exclusive", signal: lockAbort.signal },
          async (lock) => {
            if (!lock || cleaned) return;
            isLeader = true;
            void validateSession();
            startSource(true);
            await new Promise<void>((resolve) => {
              releaseLeadership = resolve;
            });
            stopSource?.();
            isLeader = false;
          },
        );
        void lockRequest.catch((error: unknown) => {
          if (cleaned || lockAbort?.signal.aborted || error instanceof DOMException && error.name === "AbortError") return;
          channel?.removeEventListener("message", handleChannelMessage);
          channel?.close();
          channel = undefined;
          startSource(false);
        });
      } catch {
        channel?.close();
        channel = undefined;
        startSource(false);
      }
    }

    return () => {
      if (isLeader && channel) post({ kind: "status", status: "reconnecting" });
      cleaned = true;
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      document.removeEventListener("visibilitychange", handleVisibility);
      clearSessionValidationTimer();
      sessionValidationAbort.abort();
      stopSource?.();
      releaseLeadership?.();
      lockAbort?.abort();
      channel?.close();
      batcher.cancel();
    };
  }, [authenticated, queryClient, userId]);

  if (!authenticated) return null;
  return (
    <output className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {statusMessages[streamStatus]}
    </output>
  );
}
