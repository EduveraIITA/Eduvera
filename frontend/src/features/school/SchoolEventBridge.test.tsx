import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SchoolEventBridge } from "./SchoolEventBridge";

const { apiFetchMock } = vi.hoisted(() => ({
  apiFetchMock: vi.fn<(path: string, init?: RequestInit) => Promise<unknown>>(),
}));

const auth = {
  status: "authenticated" as const,
  user: { id: "user-1" },
};

vi.mock("../auth/AuthContext", () => ({ useOptionalAuth: () => auth }));
vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  apiFetch: apiFetchMock,
}));

class EventSourceMock {
  static instances: EventSourceMock[] = [];
  readonly url: string;
  readonly withCredentials: boolean;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;
  private readonly listeners = new Map<string, Set<EventListener>>();

  constructor(url: string | URL, options?: EventSourceInit) {
    this.url = String(url);
    this.withCredentials = options?.withCredentials ?? false;
    EventSourceMock.instances.push(this);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
    if (typeof listener !== "function") return;
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
    if (typeof listener === "function") this.listeners.get(type)?.delete(listener);
  }

  close() {
    this.closed = true;
  }

  emit(type: string, data = "{}") {
    const event = new MessageEvent(type, { data });
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

class BroadcastChannelMock {
  static channels = new Map<string, Set<BroadcastChannelMock>>();
  readonly name: string;
  closed = false;
  private readonly listeners = new Set<EventListener>();

  constructor(name: string) {
    this.name = name;
    const peers = BroadcastChannelMock.channels.get(name) ?? new Set<BroadcastChannelMock>();
    peers.add(this);
    BroadcastChannelMock.channels.set(name, peers);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
    if (type === "message" && typeof listener === "function") this.listeners.add(listener);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
    if (type === "message" && typeof listener === "function") this.listeners.delete(listener);
  }

  postMessage(data: unknown) {
    for (const peer of BroadcastChannelMock.channels.get(this.name) ?? []) {
      if (peer === this || peer.closed) continue;
      queueMicrotask(() => {
        if (!peer.closed) {
          const event = new MessageEvent("message", { data });
          for (const listener of peer.listeners) listener(event);
        }
      });
    }
  }

  close() {
    this.closed = true;
    BroadcastChannelMock.channels.get(this.name)?.delete(this);
  }

  static reset() {
    BroadcastChannelMock.channels.clear();
  }
}

interface PendingLockRequest {
  name: string;
  signal?: AbortSignal;
  callback: (lock: Lock) => unknown;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  started: boolean;
  abort: () => void;
}

class LockManagerMock {
  private active = false;
  private readonly queue: PendingLockRequest[] = [];

  request(
    name: string,
    options: { signal?: AbortSignal },
    callback: (lock: Lock) => unknown,
  ) {
    return new Promise((resolve, reject) => {
      const request: PendingLockRequest = {
        name,
        signal: options.signal,
        callback,
        resolve,
        reject,
        started: false,
        abort: () => {
          if (request.started) return;
          const index = this.queue.indexOf(request);
          if (index >= 0) this.queue.splice(index, 1);
          reject(new DOMException("Lock request aborted", "AbortError"));
        },
      };
      if (request.signal?.aborted) {
        request.abort();
        return;
      }
      request.signal?.addEventListener("abort", request.abort, { once: true });
      this.queue.push(request);
      this.drain();
    });
  }

  get pendingCount() {
    return this.queue.length;
  }

  get activeCount() {
    return this.active ? 1 : 0;
  }

  private drain() {
    if (this.active) return;
    const request = this.queue.shift();
    if (!request) return;
    request.started = true;
    request.signal?.removeEventListener("abort", request.abort);
    this.active = true;
    queueMicrotask(() => {
      Promise.resolve(request.callback({ name: request.name, mode: "exclusive" })).then(
        (value) => request.resolve(value),
        (error: unknown) => request.reject(error),
      ).finally(() => {
        this.active = false;
        this.drain();
      });
    });
  }
}

function eventData(type: string, refresh: string[], id = `event-${type}`) {
  return JSON.stringify({
    id,
    type,
    created_at: "2026-09-12T06:00:00.000Z",
    payload: { student_id: "student-1", refresh },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  EventSourceMock.instances = [];
  BroadcastChannelMock.reset();
  apiFetchMock.mockReset();
  apiFetchMock.mockResolvedValue({ authenticated: true });
  vi.stubGlobal("EventSource", EventSourceMock);
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, "locks");
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function renderBridge() {
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
  const view = render(<QueryClientProvider client={queryClient}><SchoolEventBridge /></QueryClientProvider>);
  return { ...view, source: EventSourceMock.instances[0]!, invalidate };
}

function installCrossTabCoordination() {
  const locks = new LockManagerMock();
  Object.defineProperty(navigator, "locks", { configurable: true, value: locks });
  vi.stubGlobal("BroadcastChannel", BroadcastChannelMock);
  return locks;
}

async function settleCoordination() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("SchoolEventBridge", () => {
  it("falls back to one direct stream per app when cross-tab coordination is unavailable", () => {
    renderBridge();
    renderBridge();

    expect(EventSourceMock.instances).toHaveLength(2);
    expect(EventSourceMock.instances[0]).not.toBe(EventSourceMock.instances[1]);
    expect(EventSourceMock.instances[0]?.withCredentials).toBe(true);
    expect(EventSourceMock.instances[1]?.withCredentials).toBe(true);
  });

  it("opens one credentialed app-level stream and batches targeted event refreshes", async () => {
    const { source, invalidate } = renderBridge();
    expect(EventSourceMock.instances).toHaveLength(1);
    expect(source.url).toBe("/api/v1/events/stream/");
    expect(source.withCredentials).toBe(true);

    act(() => {
      source.onopen?.(new Event("open"));
      source.emit("attendance.updated", eventData("attendance.updated", ["student.attendance", "notifications"], "attendance-1"));
      source.emit("notification.created", eventData("notification.created", ["notifications"]));
    });
    expect(screen.getByRole("status")).toHaveTextContent("Live school updates connected.");
    expect(invalidate).not.toHaveBeenCalled();

    await act(() => vi.advanceTimersByTimeAsync(75));
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["school", "student", "attendance"], exact: undefined });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["notifications", "user-1"], exact: undefined });

    act(() => source.emit("attendance.updated", eventData("attendance.updated", ["student.attendance", "notifications"], "attendance-1")));
    await act(() => vi.advanceTimersByTimeAsync(75));
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  it("refreshes notifications when a distinct notification event arrives", async () => {
    const { source, invalidate } = renderBridge();

    act(() => source.emit("notification.created", eventData("notification.created", ["notifications"], "notification-42")));
    await act(() => vi.advanceTimersByTimeAsync(75));

    expect(invalidate).toHaveBeenCalledOnce();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["notifications", "user-1"], exact: undefined });
  });

  it("relies on cursor replay after reconnect instead of creating a full-sync herd", async () => {
    const { source, invalidate } = renderBridge();
    act(() => source.onopen?.(new Event("open")));
    act(() => source.onerror?.(new Event("error")));
    expect(screen.getByRole("status")).toHaveTextContent("Reconnecting live school updates.");
    act(() => source.onopen?.(new Event("open")));
    await act(() => vi.advanceTimersByTimeAsync(75));

    expect(invalidate).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Live school updates connected.");
  });

  it("announces when live updates pause because the device is offline", () => {
    const { source } = renderBridge();
    act(() => source.onopen?.(new Event("open")));
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByRole("status")).toHaveTextContent("Live school updates paused while this device is offline.");
  });

  it("hands session expiry to the existing auth flow and closes the stream", () => {
    const { source } = renderBridge();
    const expired = vi.fn();
    window.addEventListener("omnischool:session-expired", expired, { once: true });
    act(() => source.emit("session.expired"));
    expect(expired).toHaveBeenCalledOnce();
    expect(source.closed).toBe(true);
  });

  it("validates the auth session after repeated stream failures and throttles checks", async () => {
    const { source } = renderBridge();

    act(() => source.onerror?.(new Event("error")));
    expect(apiFetchMock).not.toHaveBeenCalled();

    await act(async () => {
      source.onerror?.(new Event("error"));
      await Promise.resolve();
    });
    expect(apiFetchMock).toHaveBeenCalledOnce();
    expect(apiFetchMock.mock.calls[0]?.[0]).toBe("/api/v1/auth/session/");
    expect(apiFetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);

    act(() => {
      source.onerror?.(new Event("error"));
      source.onerror?.(new Event("error"));
    });
    await act(() => vi.advanceTimersByTimeAsync(14_999));
    expect(apiFetchMock).toHaveBeenCalledOnce();

    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(apiFetchMock).toHaveBeenCalledTimes(2);
  });

  it("expires the existing auth flow when validation confirms the session ended", async () => {
    apiFetchMock.mockResolvedValueOnce({ authenticated: false });
    const { source } = renderBridge();
    const expired = vi.fn();
    window.addEventListener("omnischool:session-expired", expired, { once: true });

    await act(async () => {
      source.onerror?.(new Event("error"));
      source.onerror?.(new Event("error"));
      await Promise.resolve();
    });

    expect(expired).toHaveBeenCalledOnce();
    expect(source.closed).toBe(true);
  });

  it("shares one EventSource across tabs and relays validated events to follower caches", async () => {
    const locks = installCrossTabCoordination();
    const leader = renderBridge();
    await settleCoordination();
    const follower = renderBridge();
    await settleCoordination();
    await act(() => vi.advanceTimersByTimeAsync(75));
    leader.invalidate.mockClear();
    follower.invalidate.mockClear();

    expect(EventSourceMock.instances).toHaveLength(1);
    expect(locks.activeCount).toBe(1);
    expect(locks.pendingCount).toBe(1);

    const source = EventSourceMock.instances[0]!;
    act(() => {
      source.onopen?.(new Event("open"));
      source.emit("attendance.updated", eventData("attendance.updated", ["student.attendance"], "shared-attendance-1"));
    });
    await settleCoordination();
    await act(() => vi.advanceTimersByTimeAsync(75));

    expect(leader.invalidate).toHaveBeenCalledWith({ queryKey: ["school", "student", "attendance"], exact: undefined });
    expect(follower.invalidate).toHaveBeenCalledWith({ queryKey: ["school", "student", "attendance"], exact: undefined });
    expect(screen.getAllByRole("status")).toHaveLength(2);
    for (const status of screen.getAllByRole("status")) {
      expect(status).toHaveTextContent("Live school updates connected.");
    }
  });

  it("waits for the server watermark before a new leader requests a full sync", async () => {
    installCrossTabCoordination();
    const leader = renderBridge();
    await settleCoordination();
    await act(() => vi.advanceTimersByTimeAsync(75));

    expect(leader.invalidate).not.toHaveBeenCalled();

    act(() => EventSourceMock.instances[0]!.emit("sync.required"));
    await act(() => vi.advanceTimersByTimeAsync(75));
    expect(leader.invalidate).toHaveBeenCalledWith({ queryKey: ["school"], exact: undefined });
  });

  it("hands leadership to a waiting tab and releases all coordination resources on cleanup", async () => {
    const locks = installCrossTabCoordination();
    const first = renderBridge();
    await settleCoordination();
    const second = renderBridge();
    await settleCoordination();

    expect(EventSourceMock.instances).toHaveLength(1);
    const firstSource = EventSourceMock.instances[0]!;
    first.unmount();
    await settleCoordination();

    expect(firstSource.closed).toBe(true);
    expect(EventSourceMock.instances).toHaveLength(2);
    expect(locks.activeCount).toBe(1);
    expect(locks.pendingCount).toBe(0);

    const successorSource = EventSourceMock.instances[1]!;
    act(() => successorSource.onopen?.(new Event("open")));
    expect(screen.getByRole("status")).toHaveTextContent("Live school updates connected.");

    second.unmount();
    await settleCoordination();
    expect(successorSource.closed).toBe(true);
    expect(locks.activeCount).toBe(0);
    expect(locks.pendingCount).toBe(0);
    expect([...BroadcastChannelMock.channels.values()].every((peers) => peers.size === 0)).toBe(true);
  });

  it("relays full-sync and session-expiry control events to followers", async () => {
    installCrossTabCoordination();
    const leader = renderBridge();
    await settleCoordination();
    const follower = renderBridge();
    await settleCoordination();
    await act(() => vi.advanceTimersByTimeAsync(75));
    leader.invalidate.mockClear();
    follower.invalidate.mockClear();

    const source = EventSourceMock.instances[0]!;
    act(() => source.emit("sync.required"));
    await settleCoordination();
    await act(() => vi.advanceTimersByTimeAsync(75));
    expect(leader.invalidate).toHaveBeenCalledWith({ queryKey: ["school"], exact: undefined });
    expect(follower.invalidate).toHaveBeenCalledWith({ queryKey: ["school"], exact: undefined });

    const expired = vi.fn();
    window.addEventListener("omnischool:session-expired", expired);
    act(() => source.emit("session.expired"));
    await settleCoordination();
    expect(expired).toHaveBeenCalledTimes(2);
    expect(source.closed).toBe(true);
    window.removeEventListener("omnischool:session-expired", expired);
  });

  it("runs a follower full sync after returning online without opening another stream", async () => {
    installCrossTabCoordination();
    const leader = renderBridge();
    await settleCoordination();
    const follower = renderBridge();
    await settleCoordination();
    await act(() => vi.advanceTimersByTimeAsync(75));
    leader.invalidate.mockClear();
    follower.invalidate.mockClear();

    await act(async () => {
      window.dispatchEvent(new Event("offline"));
      await Promise.resolve();
    });
    for (const status of screen.getAllByRole("status")) {
      expect(status).toHaveTextContent("Live school updates paused while this device is offline.");
    }
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await Promise.resolve();
    });
    await settleCoordination();
    await act(() => vi.advanceTimersByTimeAsync(75));

    expect(EventSourceMock.instances).toHaveLength(1);
    expect(follower.invalidate).toHaveBeenCalledWith({ queryKey: ["school"], exact: undefined });
  });
});
