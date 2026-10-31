import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceTodayView } from "./WorkspaceViews";
import type { WorkspaceEntry, WorkspaceManifest, WorkspaceWorkItem } from "./types";

const upcoming = (index: number, overrides: Partial<WorkspaceEntry> = {}): WorkspaceEntry => ({
  id: `occurrence-${index}`,
  title: "Residence coordination",
  detail: "Scheduled at Aravali Residence · 1 scheduled person",
  time_label: `Oct ${26 + index}, 2026, 2:00 PM`,
  href: `/areas/timetable/schedule?date=2026-10-${26 + index}`,
  action_label: "Open timetable",
  ...overrides,
});

const task = (index: number, overrides: Partial<WorkspaceWorkItem> = {}): WorkspaceWorkItem => ({
  id: `work-${index}`,
  kind: "task",
  title: `Owned task ${index}`,
  urgency: "normal",
  direction: "needs_me",
  state: "action_required",
  href: `/areas/responsibilities/mine?assignment=${index}`,
  action_label: "Open task",
  ...overrides,
});

function manifest(overrides: Partial<WorkspaceManifest> = {}): WorkspaceManifest {
  return {
    revision: "current",
    generated_at: "2026-10-26T07:30:00.000Z",
    context: {
      actor_user_id: "person-1",
      institution_id: "campus-1",
      date_label: "Monday, 26 October",
      time_zone: "Asia/Kolkata",
      environment: { kind: "live", namespace_id: "live-campus-1" },
    },
    today: { now: [], attention: { total: 0, overdue: 0, due_soon: 0 }, next: [] },
    work: { total: 0, items: [], counts: { needs_me: 0, waiting: 0 }, coverage: "complete" },
    areas: [],
    more: { setup: [] },
    freshness: { state: "current", as_of: "1:00 PM", source_revision: "current" },
    ...overrides,
  };
}

function show(value: WorkspaceManifest) {
  return render(<MemoryRouter><WorkspaceTodayView manifest={value} /></MemoryRouter>);
}

afterEach(cleanup);

describe("bounded, responsibility-composed Today", () => {
  it("previews the first two source-ordered owned actions, including a needs-me review state, without promoting Waiting", () => {
    const review = task(1, { title: "Review submitted register", state: "waiting_for_review", status_label: "Awaiting review", action_label: "Review register" });
    const waiting = task(2, { kind: "request", title: "Leave requested", direction: "waiting", state: "needs_reassignment", owner: { user_id: "reviewer", label: "Neha Reviewer" } });
    const policy = task(3, { title: "Campus communication guide", action_label: "Read policy" });
    const later = task(4, { kind: "offer", title: "Temporary library responsibility", action_label: "View offer" });
    const source = manifest();
    show({ ...source, today: { ...source.today, attention: { total: 3, overdue: 0, due_soon: 0 } },
      work: { total: 4, counts: { needs_me: 3, waiting: 1 }, coverage: "complete", items: [review, waiting, policy, later] } });

    const section = screen.getByRole("heading", { name: "Needs attention" }).closest("section")!;
    const links = within(section).getAllByRole("link");
    const preview = links.filter(link => link.getAttribute("href") !== "/work");
    expect(preview.map(link => link.getAttribute("href"))).toEqual([review.href, policy.href]);
    expect(within(section).getByRole("link", { name: /Task: Review submitted register,.*Review register/ })).toBeVisible();
    expect(within(section).getByText("Awaiting review")).toBeVisible();
    expect(within(section).queryByText(waiting.title)).not.toBeInTheDocument();
    expect(within(section).queryByText(later.title)).not.toBeInTheDocument();
    expect(within(section).getByRole("link", { name: "View all open work" })).toHaveAttribute("href", "/work");
  });

  it("keeps one focused current context and every simultaneous current context linked separately", () => {
    const current = [
      upcoming(1, { id: "class-now", title: "Data systems seminar", time_label: "1:00–2:00 PM", detail: "Scheduled in Seminar 101", action_label: "Open session", href: "/areas/timetable/session?occurrence=class-now" }),
      upcoming(2, { id: "dining-now", title: "Courtyard lunch", time_label: "11:30 AM–2:00 PM", detail: "Courtyard Café · Published hours", action_label: "Open dining", href: "/areas/dining?session=dining-now" }),
      upcoming(3, { id: "gate-now", title: "Main gate desk", time_label: "12:00–3:00 PM", detail: "Scheduled at Main Gate", action_label: "Open timetable", href: "/areas/timetable/schedule?occurrence=gate-now" }),
    ];
    const source = manifest();
    show({ ...source, today: { ...source.today, now: current } });

    expect(screen.getAllByRole("heading", { name: "Now" })).toHaveLength(1);
    for (const entry of current) {
      expect(screen.getByRole("link", { name: `${entry.title}, ${entry.action_label}` })).toHaveAttribute("href", entry.href);
      expect(screen.getByText(entry.detail!)).toBeVisible();
    }
    expect(screen.getByRole("link", { name: "Data systems seminar, Open session" })).toHaveTextContent("Open session");
    expect(screen.queryByText(/currently at|checked in|present at/i)).not.toBeInTheDocument();
  });

  it("uses Now and Next once as section headings while retaining meaningful source statuses", () => {
    const source = manifest();
    show({ ...source, today: { ...source.today,
      now: [upcoming(1, { id: "current-1", title: "First current context", status_label: "Now" }), upcoming(2, { id: "current-2", title: "Second current context", status_label: "Now" })],
      next: [upcoming(3, { id: "future-1", title: "Next duty", status_label: "Next" }), upcoming(4, { id: "future-2", title: "Dining service", status_label: "Paused" })],
    } });

    expect(screen.getAllByText("Now", { exact: true })).toHaveLength(1);
    expect(screen.getAllByText("Next", { exact: true })).toHaveLength(1);
    expect(screen.getByText("Paused", { exact: true })).toBeVisible();
  });

  it("shows three upcoming occurrences and reveals the remaining projected occurrences without collapsing repeated titles", async () => {
    const source = manifest();
    const entries = Array.from({ length: 5 }, (_, index) => upcoming(index + 1));
    show({ ...source, today: { ...source.today, next: entries } });

    const section = screen.getByRole("heading", { name: "Next" }).closest("section")!;
    // jsdom's role query includes descendants of closed details; visibility is
    // the relevant boundary while all exact source links remain in the DOM.
    const initialLinks = within(section).getAllByRole("link", { name: "Residence coordination, Open timetable" });
    expect(initialLinks).toHaveLength(5);
    initialLinks.slice(0, 3).forEach(link => expect(link).toBeVisible());
    initialLinks.slice(3).forEach(link => expect(link).not.toBeVisible());
    const summary = within(section).getByText("More upcoming");
    const disclosure = summary.closest("details");
    expect(disclosure).not.toHaveAttribute("open");
    expect(within(section).getByText(entries[3]!.time_label!)).not.toBeVisible();
    expect(within(section).getByText(entries[4]!.time_label!)).not.toBeVisible();

    await userEvent.click(summary);
    expect(disclosure).toHaveAttribute("open");
    expect(within(section).getAllByRole("link", { name: "Residence coordination, Open timetable" }).map(link => link.getAttribute("href")))
      .toEqual(entries.map(entry => entry.href));
    for (const entry of entries) expect(within(section).getByText(entry.time_label!)).toBeVisible();
  });

  it("offers Calendar only from its authorized manifest contribution, preserving the exact supplied destination", () => {
    const source = manifest();
    const calendarHref = "/areas/calendar?scope=self&campus=west";
    const value = { ...source, today: { ...source.today, next: [upcoming(1)] }, areas: [{
      key: "calendar", label: "Calendar", href: calendarHref, capabilities: ["calendar.view"], scopes: [{ kind: "self" as const }], surfaces: [],
    }] };
    const view = show(value);
    expect(screen.getByRole("link", { name: "View calendar" })).toHaveAttribute("href", calendarHref);

    view.rerender(<MemoryRouter><WorkspaceTodayView manifest={{ ...value, areas: [] }} /></MemoryRouter>);
    expect(screen.queryByRole("link", { name: "View calendar" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Residence coordination, Open timetable" })).toHaveAttribute("href", upcoming(1).href);
  });

  it("keeps partial work coverage explicit and never turns missing contributions into an all-clear state", () => {
    const source = manifest();
    show({ ...source, work: { ...source.work, coverage: "partial" } });

    expect(screen.getByRole("alert")).toHaveTextContent("Some work could not be included");
    expect(screen.queryByRole("heading", { name: "No activities or actions to show" })).not.toBeInTheDocument();
    expect(screen.queryByText(/nothing needs you|all clear|no open work/i)).not.toBeInTheDocument();
  });

  it("preserves localized date labels and exact source order instead of parsing display text on the device", () => {
    const source = manifest();
    const entries = [
      upcoming(1, { id: "localized-next", title: "Evening laboratory", time_label: "Jeu. 29 oct. 2026 · 23 h", href: "/areas/timetable/schedule?date=2026-10-29" }),
      upcoming(2, { id: "next-week", title: "Evening laboratory", time_label: "Jeu. 5 nov. 2026 · 23 h", href: "/areas/timetable/schedule?date=2026-11-05" }),
    ];
    show({ ...source, context: { ...source.context, date_label: "Thursday, 29 October", time_zone: "Europe/Paris" }, today: { ...source.today, next: entries } });

    expect(screen.getByText("Thursday, 29 October")).toBeVisible();
    expect(screen.getByText("Jeu. 29 oct. 2026 · 23 h")).toBeVisible();
    expect(screen.getByText("Jeu. 5 nov. 2026 · 23 h")).toBeVisible();
    expect(screen.getAllByRole("link", { name: "Evening laboratory, Open timetable" }).map(link => link.getAttribute("href")))
      .toEqual(entries.map(entry => entry.href));
    expect(screen.queryByText("Tomorrow", { exact: true })).not.toBeInTheDocument();
  });

  it("formats a known overnight instant in campus time with an explicit end date, while unresolved times retain their source wording", () => {
    const source = manifest();
    const overnight = upcoming(1, {
      id: "overnight-duty", title: "Residence night duty", starts_at: "2026-12-31T18:00:00.000Z", ends_at: "2027-01-01T02:00:00.000Z",
      local_date: "2026-12-31", time_label: "Source overnight timing", href: "/areas/timetable/schedule?date=2026-12-31",
    });
    const unresolved = upcoming(2, {
      id: "unresolved-hours", title: "Dining time needs review", local_date: "2027-01-01", time_label: "Published hours repeat during a clock change",
      href: "/areas/dining?date=2027-01-01",
    });
    const view = show({ ...source, today: { ...source.today, next: [overnight, unresolved] } });

    const link = screen.getByRole("link", { name: "Residence night duty, Open timetable" });
    const date = link.querySelector("time");
    expect(date).toHaveAttribute("datetime", overnight.starts_at);
    expect(date).toHaveTextContent("31 Dec 2026");
    expect(link).toHaveTextContent(/11:30.*7:30/);
    expect(link).toHaveTextContent("ends 1 Jan 2027");
    expect(link).not.toHaveTextContent("Source overnight timing");
    // The date gutter and end-date explanation already identify both days;
    // a compact time range must not inject a second pair of numeric dates.
    expect(link).not.toHaveTextContent("31/12/2026");
    expect(screen.getByText(unresolved.time_label!)).toBeVisible();
    expect(screen.getByRole("link", { name: "Dining time needs review, Open timetable" }).querySelector("time")).toBeNull();

    view.rerender(<MemoryRouter><WorkspaceTodayView manifest={{ ...source, context: { ...source.context, time_zone: "Invalid/Timezone" }, today: { ...source.today, next: [overnight] } }} /></MemoryRouter>);
    expect(screen.getByText("Source overnight timing")).toBeVisible();
    expect(screen.getByRole("link", { name: "Residence night duty, Open timetable" }).querySelector("time")).toBeNull();
  });

  it("renders the same source-backed composition under the selected Simulation context and virtual date", () => {
    const source = manifest();
    show({ ...source, context: { ...source.context, date_label: "Friday, 6 November", environment: { kind: "simulation", namespace_id: "scenario-run-1", virtual_now: "2026-11-06T07:30:00.000Z" } },
      today: { ...source.today, next: [upcoming(1, { title: "Branch-only residence round", time_label: "Fri, Nov 6, 2026, 2:00 PM", href: "/areas/timetable/schedule?date=2026-11-06" })] } });

    expect(screen.getByText("Friday, 6 November")).toBeVisible();
    expect(screen.getByRole("link", { name: "Branch-only residence round, Open timetable" })).toHaveAttribute("href", "/areas/timetable/schedule?date=2026-11-06");
    expect(screen.queryByText("Monday, 26 October")).not.toBeInTheDocument();
  });
});
