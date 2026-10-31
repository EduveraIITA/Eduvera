import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ApiError, apiFetch } from "../../lib/api";
import { blockExecutionRequests, EXECUTION_ENVIRONMENT_VERIFY_EVENT } from "../../lib/executionRequestScope";
import { useOptionalAuth } from "../auth/AuthContext";
import { useOptionalApplicationExecutionEnvironment } from "../simulation/ApplicationExecutionEnvironment";
import { LIVE_EXECUTION_ENVIRONMENT, executionEnvironmentIdentity } from "../simulation/executionEnvironment";
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
  schoolEventMatchesScope,
  SCHOOL_EVENT_TYPES,
  type SchoolEventEnvelope,
  type SchoolEventType,
} from "./schoolEventProtocol";

type StreamStatus = SharedStreamStatus | "unavailable";

const SESSION_VALIDATION_ERROR_THRESHOLD = 2;
const SESSION_VALIDATION_THROTTLE_MS = 15_000;

const statusMessages: Record<StreamStatus, string> = {
  connected: "Campus updates connected.",
  reconnecting: "Reconnecting campus updates.",
  offline: "Campus updates paused while this device is offline.",
  superseded: "Campus updates continue in another active window.",
  unavailable: "Campus updates are unavailable in this browser.",
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
  const applicationEnvironment = useOptionalApplicationExecutionEnvironment();
  const environment = applicationEnvironment?.environment ?? auth?.executionEnvironment ?? LIVE_EXECUTION_ENVIRONMENT;
  const institutionId = environment.institutionId ?? auth?.user?.active_school_id ?? undefined;
  const namespaceId = environment.namespaceId ?? (environment.mode === "live" && institutionId ? `live:${institutionId}` : undefined);
  const environmentId = executionEnvironmentIdentity(environment.mode === "live"
    ? { ...environment, institutionId, namespaceId } : environment);
  // Stable across virtual clock checkpoints: a run's event stream must not
  // reconnect for each tick, and cannot invalidate another world's cache.
  const environmentQueryPrefix = JSON.stringify(environment.mode === "simulation"
    ? ["execution-environment", "simulation", environment.namespaceId, environment.runId]
    : ["execution-environment", "live"]);
  const userId = auth?.user?.id;
  const authenticated = auth?.status === "authenticated";
  const [streamStatus, setStreamStatus] = useState<StreamStatus>(initialStreamStatus);

  useEffect(() => {
    if (!authenticated || !userId) return undefined;
    if (typeof EventSource === "undefined") return undefined;

    const batcher = createInvalidationBatcher(queryClient, 75, JSON.parse(environmentQueryPrefix) as readonly unknown[]);
    const tabId = createTabId();
    const handledEventIds = new Set<string>();
    let currentStatus: StreamStatus = initialStreamStatus();
    let source: EventSource | undefined;
    let stopSource: (() => void) | undefined;
    let channel: BroadcastChannel | undefined;
    let lockAbort: AbortController | undefined;
    let releaseLeadership: (() => void) | undefined;
    let isLeader = false;
    let leadershipRequestActive = false;
    let requestLeadership: (() => void) | undefined;
    let pageSuspended = false;
    let superseded = false;
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
      if (!schoolEventMatchesScope(envelope, { institutionId, namespaceId })) return false;
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
    const environmentChanged = (share: boolean) => {
      if (share) post({ kind: "environment.changed" });
      superseded = true;
      stopSource?.();
      batcher.cancel();
      blockExecutionRequests();
      void queryClient.cancelQueries();
      window.dispatchEvent(new Event(EXECUTION_ENVIRONMENT_VERIFY_EVENT));
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
      if (source || cleaned || pageSuspended || superseded) return;
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
      const handleReady = (event: Event) => {
        if (event instanceof MessageEvent && typeof event.data === "string") {
          try {
            const ready = JSON.parse(event.data) as { namespace_id?: unknown };
            if (typeof ready.namespace_id === "string" && namespaceId
              && ready.namespace_id !== namespaceId) { environmentChanged(shared); return; }
          } catch { requestFullSync(shared); return; }
        }
        publishStatus("connected");
      };
      const handleSyncRequired = () => requestFullSync(shared);
      const handleSessionExpired = () => expireSession(shared);
      const handleEnvironmentChanged = () => environmentChanged(shared);
      const handleStreamReplaced = () => {
        superseded = true;
        stopSource?.();
        publishStatus("superseded");
      };
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
      activeSource.addEventListener("environment.changed", handleEnvironmentChanged);
      activeSource.addEventListener("stream.replaced", handleStreamReplaced);
      publishStatus(navigator.onLine ? "reconnecting" : "offline");

      const closeSource = () => {
        activeSource.onopen = null;
        activeSource.onerror = null;
        activeSource.removeEventListener("stream.ready", handleReady);
        activeSource.removeEventListener("sync.required", handleSyncRequired);
        activeSource.removeEventListener("session.expired", handleSessionExpired);
        activeSource.removeEventListener("environment.changed", handleEnvironmentChanged);
        activeSource.removeEventListener("stream.replaced", handleStreamReplaced);
        for (const [type, handler] of eventHandlers) activeSource.removeEventListener(type, handler);
        activeSource.close();
        if (source === activeSource) source = undefined;
        if (stopSource === closeSource) stopSource = undefined;
      };
      stopSource = closeSource;
    };

    const handleOnline = () => {
      if (superseded) {
        updateStatus("superseded");
        return;
      }
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
      if (superseded) {
        updateStatus("superseded");
        return;
      }
      if (isLeader) publishStatus("offline");
      else updateStatus("offline");
    };
    const handleVisibility = () => {
      if (document.visibilityState !== "visible" || !navigator.onLine || isLeader || !channel || superseded) return;
      requestFullSync();
      post({ kind: "hello" });
    };
    const relinquishLeadership = () => {
      const release = releaseLeadership;
      releaseLeadership = undefined;
      release?.();
      lockAbort?.abort();
    };
    const handlePageHide = () => {
      pageSuspended = true;
      if (isLeader && channel && !superseded) post({ kind: "status", status: "reconnecting" });
      stopSource?.();
      relinquishLeadership();
    };
    const handlePageShow = () => {
      pageSuspended = false;
      if (cleaned || superseded) return;
      if (channel) {
        post({ kind: "hello" });
        requestLeadership?.();
      } else {
        startSource(false);
      }
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("pageshow", handlePageShow);
    document.addEventListener("visibilitychange", handleVisibility);

    const lockManager = (navigator as Navigator & { locks?: LockManager }).locks;
    const coordinationAvailable = typeof BroadcastChannel !== "undefined" && typeof lockManager?.request === "function";
    if (!coordinationAvailable) {
      startSource(false);
    } else {
      try {
        channel = new BroadcastChannel(schoolEventChannelName(userId, environmentId));
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
          } else if (message.kind === "environment.changed") {
            environmentChanged(false);
          } else if (message.kind === "status") {
            if (message.status === "superseded") {
              superseded = true;
              stopSource?.();
              lockAbort?.abort();
            }
            if (!isLeader) updateStatus(message.status);
          } else if (message.kind === "hello" && isLeader) {
            post({ kind: "status", status: currentStatus === "unavailable" ? "reconnecting" : currentStatus }, message.senderTabId);
            post({ kind: "sync" }, message.senderTabId);
          }
        };
        channel.addEventListener("message", handleChannelMessage);
        updateStatus(navigator.onLine ? "reconnecting" : "offline");
        post({ kind: "hello" });
        requestLeadership = () => {
          if (cleaned || pageSuspended || superseded || leadershipRequestActive || !channel) return;
          leadershipRequestActive = true;
          const requestAbort = new AbortController();
          lockAbort = requestAbort;
          const lockRequest = lockManager.request(
            schoolEventLockName(userId, environmentId),
            { mode: "exclusive", signal: requestAbort.signal },
            async (lock) => {
              if (!lock || cleaned || pageSuspended || superseded) return;
              isLeader = true;
              void validateSession();
              startSource(true);
              await new Promise<void>((resolve) => {
                releaseLeadership = resolve;
              });
              stopSource?.();
              releaseLeadership = undefined;
              isLeader = false;
            },
          );
          void lockRequest.catch((error: unknown) => {
            if (cleaned || requestAbort.signal.aborted || error instanceof DOMException && error.name === "AbortError") return;
            channel?.removeEventListener("message", handleChannelMessage);
            channel?.close();
            channel = undefined;
            startSource(false);
          }).finally(() => {
            leadershipRequestActive = false;
            if (lockAbort === requestAbort) lockAbort = undefined;
            if (!cleaned && !pageSuspended && !superseded && channel && !isLeader) requestLeadership?.();
          });
        };
        requestLeadership();
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
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("pageshow", handlePageShow);
      document.removeEventListener("visibilitychange", handleVisibility);
      clearSessionValidationTimer();
      sessionValidationAbort.abort();
      stopSource?.();
      relinquishLeadership();
      channel?.close();
      batcher.cancel();
    };
  }, [authenticated, environmentId, institutionId, namespaceId, environmentQueryPrefix, queryClient, userId]);

  if (!authenticated) return null;
  return (
    <output className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {statusMessages[streamStatus]}
    </output>
  );
}
