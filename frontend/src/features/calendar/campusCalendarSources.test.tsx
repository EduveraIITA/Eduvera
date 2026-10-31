import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch } from "../../lib/api";
import { ExecutionEnvironmentProvider } from "../simulation/ExecutionEnvironmentContext";
import type { ExecutionEnvironment } from "../simulation/executionEnvironment";
import {
  calendarDateEntries, calendarInstantRange, loadCalendarAssessments, loadCalendarDays, loadCalendarEvents, loadCalendarServices,
  type CampusCalendarScope,
} from "./campusCalendarSources";
import { useCampusCalendarSources } from "./useCampusCalendarSources";

const session = vi.hoisted(() => ({ actor: "actor-one" }));
vi.mock("../../lib/api", async original => ({ ...await original<typeof import("../../lib/api")>(), apiFetch: vi.fn() }));
vi.mock("../auth/AuthContext", () => ({ useOptionalAuth: () => ({ user: { id: session.actor } }) }));

const scope: CampusCalendarScope = { schoolId: "campus-one", timeZone: "Asia/Kolkata", surfaceKey: "assigned", includeDining: false };
const from = "2026-10-01", until = "2026-10-31";
const event = (patch: Record<string, unknown> = {}) => ({
  id: "event-one", title: "Open campus", status: "published", revision: 1,
  starts_at: "2026-10-15T08:00:00Z", ends_at: "2026-10-15T10:00:00Z", venue: "Main hall", cancellation_reason: null, ...patch,
});
const service = (patch: Record<string, unknown> = {}) => ({
  id: "service-one", source_id: "session-one", source_revision: 2, service_name: "Campus dining", label: "Lunch",
  starts_at: "2026-10-15T06:00:00Z", ends_at: "2026-10-15T08:00:00Z", local_date: "2026-10-15",
  state: "published", changed_for_date: false, plan_id: "plan-one", menu_text: "Private menu should not be copied",
  href: "/areas/dining?session_id=session-one", space_label: "Dining hall", ...patch,
});
const availability = (items: unknown[], patch: Record<string, unknown> = {}) => ({
  items, total: items.length, page: 1, total_pages: 1, page_size: 20, from, until, timezone: scope.timeZone, warnings: [], ...patch,
});
function emptyResponse(path: string) {
  return path.startsWith("/api/v1/calendar/days/") ? { results: [] }
    : path.includes('/campus-dates?') ? { items: [], page: 1, total_pages: 1, can_manage: false }
    : path.includes("/dining/availability") ? availability([])
      : path.startsWith("/api/v1/campus-events?") ? { items: [], next_cursor: null } : { items: [] };
}
function show(initialScope = scope, environment: ExecutionEnvironment = { mode: "live" }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>
    <ExecutionEnvironmentProvider environment={environment}>{children}</ExecutionEnvironmentProvider>
  </QueryClientProvider>;
  return { client, ...renderHook(({ current }) => useCampusCalendarSources(current, from, until), {
    wrapper, initialProps: { current: initialScope },
  }) };
}
beforeEach(() => {
  session.actor = "actor-one";
  vi.mocked(apiFetch).mockImplementation(path => Promise.resolve(emptyResponse(path)));
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe("source-owned important campus dates", () => {
  it("uses exact institution-local month bounds, not device dates, including DST", () => {
    expect(calendarInstantRange(from, until, "Asia/Kolkata")).toEqual({ from: "2026-09-30T18:30:00.000Z", to: "2026-10-31T18:29:59.999Z" });
    expect(calendarInstantRange("2026-03-01", "2026-03-31", "America/New_York")).toEqual({ from: "2026-03-01T05:00:00.000Z", to: "2026-04-01T03:59:59.999Z" });
    expect(calendarInstantRange("2026-11-01", "2026-11-30", "America/New_York")).toEqual({ from: "2026-11-01T04:00:00.000Z", to: "2026-12-01T04:59:59.999Z" });
    expect(calendarInstantRange("2019-09-08", "2019-09-08", "America/Santiago")).toEqual({ from: "2019-09-08T04:00:00.000Z", to: "2019-09-09T02:59:59.999Z" });
  });

  it("rejects invalid or oversized ranges before reading any source", async () => {
    expect(() => calendarInstantRange("2026-02-30", until, "UTC")).toThrow("up to 31 days");
    await expect(loadCalendarDays(scope, from, "2026-11-01")).rejects.toThrow("up to 31 days");
    await expect(loadCalendarServices(scope, until, from)).rejects.toThrow("up to 31 days");
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("retains instructional overrides as dates without claiming whole-campus closure", () => {
    expect(calendarDateEntries([{ id: "override", date: "2026-10-10", is_instructional: true, label: "", kind: "instructional_override", reason: "Special workshop day", revision: 3 }])).toEqual([{
      id: "dates:override", category: "dates", sourceId: "override", title: "Academic date", startsOn: "2026-10-10", endsOn: "2026-10-10",
      allDay: true, revision: 3, summary: "Special workshop day", status: "Teaching day changed",
    }]);
  });

  it("follows event cursors with ISO bounds, excludes drafts and deduplicates the current revision", async () => {
    vi.mocked(apiFetch).mockImplementation(path => {
      const query = new URL(path, "https://thatcampus.invalid").searchParams;
      if (query.get("status") === "published") return Promise.resolve({ items: [event(), event({ id: "draft", status: "draft" })], next_cursor: query.has("cursor") ? null : "next-event" });
      if (query.get("status") === "cancelled") return Promise.resolve({ items: [event({ status: "cancelled", revision: 2, cancellation_reason: "Moved online" })], next_cursor: null });
      return Promise.resolve({ items: [], next_cursor: null });
    });
    const signal = new AbortController().signal;
    const result = await loadCalendarEvents({ ...scope, eventHref: "/areas/events/calendar?scope=dependent&student_id=learner-one", studentId: "learner-one" }, from, until, signal);
    expect(result.partial).toBe(false);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({ sourceId: "event-one", revision: 2, status: "Cancelled", summary: "Moved online", href: "/areas/events/calendar/event-one?scope=dependent&student_id=learner-one" });
    expect(apiFetch).toHaveBeenCalledTimes(4);
    for (const [path, init] of vi.mocked(apiFetch).mock.calls) {
      const query = new URL(path, "https://thatcampus.invalid").searchParams;
      expect(query.get("from")).toBe("2026-09-30T18:30:00.000Z");
      expect(query.get("to")).toBe("2026-10-31T18:29:59.999Z");
      expect(query.get("student_id")).toBe("learner-one");
      expect(init?.signal).toBe(signal);
    }
  });

  it("does not include the next date for an event ending exactly at local midnight", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ items: [event({ starts_at: "2026-10-15T16:30:00Z", ends_at: "2026-10-15T18:30:00Z" })], next_cursor: null });
    const result = await loadCalendarEvents(scope, from, until);
    expect(result.entries[0]).toMatchObject({ startsOn: "2026-10-15", endsOn: "2026-10-15", endsAt: "2026-10-15T18:30:00Z" });
  });

  it("never retries a denied event range as an unbounded broad read", async () => {
    vi.mocked(apiFetch).mockRejectedValue(new ApiError("Revoked", 403));
    await expect(loadCalendarEvents(scope, from, until)).rejects.toMatchObject({ status: 403 });
    expect(apiFetch).toHaveBeenCalledTimes(3);
    expect(vi.mocked(apiFetch).mock.calls.every(([path]) => path.includes("from=") && path.includes("to=") && path.includes("status="))).toBe(true);
  });

  it("marks bounded and repeated event cursors as partial rather than complete", async () => {
    let cursor = 0;
    vi.mocked(apiFetch).mockImplementation(() => Promise.resolve({ items: [event()], next_cursor: `cursor-${cursor++}` }));
    expect((await loadCalendarEvents(scope, from, until)).partial).toBe(true);
    expect(apiFetch).toHaveBeenCalledTimes(30);
    vi.mocked(apiFetch).mockClear();
    vi.mocked(apiFetch).mockResolvedValue({ items: [event()], next_cursor: "repeated" });
    expect((await loadCalendarEvents(scope, from, until)).partial).toBe(true);
    expect(apiFetch).toHaveBeenCalledTimes(6);
  });

  it("reads only scheduled assessment metadata and preserves supported owning navigation", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ items: [{ id: "exam-one", title: "Assessment", date: "2026-10-15", scheduled_at: "2026-10-15T08:00:00Z", duration_minutes: 90, venue: "Hall 2", subject_name: "Design", class_name: "Cohort A" }] });
    const result = await loadCalendarAssessments({ ...scope, assessmentHref: "/areas/assessments/assigned?offering=one" }, from, until);
    expect(result.entries[0]).toMatchObject({ category: "assessments", endsAt: "2026-10-15T09:30:00.000Z", location: "Hall 2", summary: "Design · Cohort A", href: "/areas/assessments/assigned?offering=one&assessment=exam-one" });
    const family = await loadCalendarAssessments({ ...scope, studentId: "learner-one", assessmentHref: "/areas/assessments/results?scope=self&student_id=learner-one" }, from, until);
    expect(family.entries[0]?.href).toBeUndefined();
    expect(vi.mocked(apiFetch).mock.calls[1]?.[0]).toContain("student_id=learner-one");
    expect(vi.mocked(apiFetch).mock.calls.every(([path]) => path.includes("/assessments/calendar/?"))).toBe(true);
  });

  it("paginates service availability but copies only exceptions, never normal menus or meals", async () => {
    vi.mocked(apiFetch).mockImplementation(path => {
      const page = new URL(path, "https://thatcampus.invalid").searchParams.get("page");
      return Promise.resolve(availability(page === "1" ? [service(), service({ id: "changed", changed_for_date: true })]
        : [service({ id: "paused", state: "paused" }), service({ id: "cancelled", state: "cancelled" })], { page: Number(page), total_pages: 2 }));
    });
    const result = await loadCalendarServices(scope, from, until);
    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(result.partial).toBe(false);
    expect(result.entries.map(item => item.id)).toEqual(["services:changed", "services:paused", "services:cancelled"]);
    expect(result.entries.map(item => item.status)).toEqual(["Changed for this date", "Paused", "Cancelled"]);
    expect(JSON.stringify(result.entries)).not.toContain("Private menu");
    expect(result.entries.every(item => item.href === "/areas/dining?session_id=session-one")).toBe(true);
  });

  it("preserves unresolved dining date warnings without duplicating resolved exceptions", async () => {
    vi.mocked(apiFetch).mockResolvedValue(availability([service({ changed_for_date: true })], { warnings: [
      { plan_id: "plan-one", plan_version_id: "v1", local_date: "2026-10-15", reason: "cancelled_for_date", href: "/areas/dining?date=2026-10-15" },
      { plan_id: "plan-two", plan_version_id: "v2", local_date: "2026-10-16", reason: "nonexistent_time", href: "/areas/dining?date=2026-10-16" },
    ] }));
    const result = await loadCalendarServices(scope, from, until);
    expect(result.entries).toHaveLength(2);
    expect(result.entries[1]).toMatchObject({ allDay: true, title: "Dining hours need review", startsOn: "2026-10-16", status: "Needs review", href: "/areas/dining?date=2026-10-16" });
  });

  it("does not claim that bounded service pages give complete month coverage", async () => {
    vi.mocked(apiFetch).mockResolvedValue(availability([service({ state: "paused" })], { total_pages: 11 }));
    const result = await loadCalendarServices(scope, from, until);
    expect(apiFetch).toHaveBeenCalledTimes(10);
    expect(result.partial).toBe(true);
    expect(result.entries).toHaveLength(1);
  });
});

describe("capability and selected-world Calendar composition", () => {
  it("reads campus dates alone unless independent source surfaces are supplied", async () => {
    const shown = show();
    await waitFor(() => expect(shown.result.current.daysLoaded).toBe(true));
    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(shown.result.current.sources.map(item => item.key)).toEqual(["milestones", "dates"]);
    expect(vi.mocked(apiFetch).mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("keeps other sources visible when an event read fails and hides retained event rows", async () => {
    vi.mocked(apiFetch).mockImplementation(path => Promise.resolve(path.startsWith("/api/v1/campus-events?")
      ? { items: [event()], next_cursor: null }
      : path.startsWith("/api/v1/calendar/days/") ? { results: [{ id: "date-one", date: "2026-10-16", is_instructional: false, label: "Holiday" }] } : emptyResponse(path)));
    const shown = show({ ...scope, eventHref: "/areas/events/assigned" });
    await waitFor(() => expect(shown.result.current.entries).toHaveLength(2));
    vi.mocked(apiFetch).mockImplementation(path => path.startsWith("/api/v1/campus-events?")
      ? Promise.reject(new ApiError("Revoked", 403)) : Promise.resolve({ results: [{ id: "date-one", date: "2026-10-16", is_instructional: false, label: "Holiday" }] }));
    await act(() => shown.client.invalidateQueries());
    await waitFor(() => expect(shown.result.current.sources.find(item => item.key === "events")?.status).toBe("error"));
    expect(shown.result.current.entries.map(item => item.category)).toEqual(["dates"]);
    expect(shown.result.current.denied).toBe(false);
  });

  it("fails the whole Calendar closed when its current campus membership is denied", async () => {
    vi.mocked(apiFetch).mockImplementation(path => path.startsWith("/api/v1/calendar/days/")
      ? Promise.reject(new ApiError("Membership revoked", 403)) : Promise.resolve({ items: [event()], next_cursor: null }));
    const shown = show({ ...scope, eventHref: "/areas/events/manage" });
    await waitFor(() => expect(shown.result.current.denied).toBe(true));
    expect(shown.result.current.entries).toEqual([]);
    expect(shown.result.current.campusDays).toEqual([]);
    expect(shown.result.current.daysLoaded).toBe(false);
  });

  it("keeps caches separate by actor, institution, exact surface, subject and Simulation world", async () => {
    const shown = show({ ...scope, eventHref: "/areas/events/calendar?scope=dependent&student_id=one", studentId: "one" }, {
      mode: "simulation", namespaceId: "world-one", runId: "run-one", virtualClock: { now: "2026-10-01T00:00:00Z", timeZone: "Asia/Kolkata" },
    });
    await waitFor(() => expect(shown.result.current.daysLoaded).toBe(true));
    session.actor = "actor-two";
    shown.rerender({ current: { ...scope, schoolId: "campus-two", surfaceKey: "dependent-two", studentId: "two", eventHref: "/areas/events/calendar?scope=dependent&student_id=two" } });
    await waitFor(() => expect(shown.result.current.daysLoaded).toBe(true));
    const keys = shown.client.getQueryCache().getAll().map(query => query.queryKey);
    expect(keys.every(key => key[0] === "execution-environment" && key[1] === "simulation" && key[2] === "world-one" && key[3] === "run-one")).toBe(true);
    expect(keys.some(key => key.includes("actor-one") && key.includes("campus-one") && key.includes("assigned") && key.includes("one"))).toBe(true);
    expect(keys.some(key => key.includes("actor-two") && key.includes("campus-two") && key.includes("dependent-two") && key.includes("two"))).toBe(true);
    expect(vi.mocked(apiFetch).mock.calls.every(([path]) => !/attendance|timetable|screens\/|leave|arrangements|assignments/.test(path))).toBe(true);
  });

  it("does not issue any API read or silently use Live while Simulation is unavailable", () => {
    const shown = show({ ...scope, eventHref: "/areas/events/manage", assessmentHref: "/areas/assessments/manage", includeDining: true }, {
      mode: "simulation", unavailable: true, unavailableReason: "runtime_unavailable", namespaceId: "unavailable-world", runId: "unavailable-run",
    });
    expect(apiFetch).not.toHaveBeenCalled();
    expect(shown.result.current.entries).toEqual([]);
    expect(shown.result.current.sources.every(item => item.status === "error")).toBe(true);
  });

  it("reports partial source coverage in the same shared UI contract", async () => {
    vi.mocked(apiFetch).mockImplementation(path => Promise.resolve(path.includes("/dining/availability")
      ? availability([service({ state: "paused" })], { total_pages: 12 }) : emptyResponse(path)));
    const shown = show({ ...scope, includeDining: true });
    await waitFor(() => expect(shown.result.current.sources.find(item => item.key === "services")?.status).toBe("partial"));
    expect(shown.result.current.sources.find(item => item.key === "services")?.message).toContain("partially loaded");
    expect(shown.result.current.entries).toHaveLength(1);
  });
});
