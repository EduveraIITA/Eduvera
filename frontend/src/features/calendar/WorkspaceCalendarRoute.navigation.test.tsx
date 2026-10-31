import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceArea, WorkspaceManifest } from "../workspace/types";
import type { CampusCalendarScope } from "./campusCalendarSources";
import { WorkspaceCalendarRoute } from "./WorkspaceCalendarRoute";

const state = vi.hoisted((): { manifest?: WorkspaceManifest; mode: "live" | "simulation"; unavailable: boolean } => ({ manifest: undefined, mode: "live", unavailable: false }));
vi.mock("../workspace/useWorkspaceManifest", () => ({ useWorkspaceManifest: () => ({ data: state.manifest, isPending: false, error: null, refetch: vi.fn() }) }));
vi.mock("../simulation/ExecutionEnvironmentContext", () => ({ useExecutionEnvironment: () => ({ mode: state.mode, namespaceId: state.mode === "live" ? "live:school-1" : "world-1", unavailable: state.unavailable }) }));
vi.mock("../../pages/operations/OperationsShell", () => ({ OperationsShell: ({ children, title, backTo }: { children: ReactNode; title: string; backTo?: string }) => <><h1>{title}</h1><a href={backTo}>Back destination</a>{children}</> }));
vi.mock("./CampusDatesCalendar", () => ({ CampusDatesCalendar: ({ scope }: { scope: CampusCalendarScope }) => <><p>Important dates calendar</p><output aria-label="Calendar source scope">{JSON.stringify(scope)}</output></> }));

const relationship = (id: string, label: string) => ({ key: `calendar:dependent:${id}`, label: `${label} calendar`, href: `/areas/calendar?scope=dependent&student_id=${id}`, capabilities: ["timetable.view"], scopes: [{ kind: "dependent" as const, id, label }] });
const calendar: WorkspaceArea = {
  key: "calendar", label: "Calendar", href: "/areas/calendar", attention_count: 0, capabilities: ["timetable.view", "schedule.manage"], scopes: [],
  surfaces: [
    { key: "assigned", label: "Activity calendar", href: "/areas/calendar?surface=assigned", capabilities: ["timetable.view"], scopes: [] },
    { key: "manage", label: "Campus calendar", href: "/areas/calendar?surface=manage", capabilities: ["schedule.manage"], scopes: [] },
    relationship("child-1", "Aarav"),
  ],
};
const manifest: WorkspaceManifest = {
  revision: "calendar-navigation", generated_at: "2026-10-20T00:00:00.000Z",
  context: { institution_id: "school-1", institution_label: "Test campus", time_zone: "Pacific/Auckland", scope_label: null, date_label: "20 October", environment: { kind: "live", namespace_id: "live:school-1" } },
  today: { now: [], next: [], attention: { total: 0, overdue: 0, due_soon: 0 }, completed_automatically: [] },
  work: { total: 0, items: [] }, more: { groups: [], setup: [], other: [] }, freshness: { state: "current", as_of: "Now", source_revision: "one" },
  areas: [calendar, { key: "timetable", label: "Timetable", href: "/areas/timetable", attention_count: 0, capabilities: ["timetable.view", "schedule.manage"], scopes: [], surfaces: [
    { key: "schedule", label: "My schedule", href: "/areas/timetable/schedule", capabilities: ["timetable.view"], scopes: [] },
    { key: "planning", label: "Planning", href: "/areas/timetable/planning", capabilities: ["schedule.manage"], scopes: [] },
  ] }],
};

function Location() { const location = useLocation(); return <output aria-label="current location">{location.pathname}{location.search}{location.hash}</output>; }
function mount(path = "/areas/calendar") {
  return render(<MemoryRouter initialEntries={[path]}><WorkspaceCalendarRoute /><Location /></MemoryRouter>);
}
function sourceScope(): CampusCalendarScope { return JSON.parse(screen.getByLabelText("Calendar source scope").textContent) as CampusCalendarScope; }
afterEach(() => { cleanup(); state.manifest = undefined; state.mode = "live"; state.unavailable = false; });

describe("Calendar important-dates Area navigation", () => {
  it("opens an unambiguous learner's full exact calendar by default, retaining date, attention and independently contributed sources", () => {
    const self = { key: "calendar:self:learner-1", label: "My calendar", href: "/areas/calendar?scope=self&student_id=learner-1", capabilities: ["timetable.view"], scopes: [{ kind: "self" as const, id: "learner-1", label: "Learner one" }] };
    state.manifest = { ...manifest, areas: [{ ...calendar, surfaces: [
      { ...calendar.surfaces[0]!, scopes: [{ kind: "self", id: "person-1", label: "My scheduled activities" }] }, self,
      { key: "availability", label: "Dining hours", href: "/areas/calendar?surface=availability", capabilities: ["dining.view"], scopes: [] },
    ] }, ...["events", "assessments"].map(key => { const stem = key === "events" ? "calendar" : "results"; return { key, label: key, href: `/areas/${key}`, attention_count: 0, capabilities: [], scopes: [], surfaces: [{ key: `${stem}:self:learner-1`, label: "Mine", href: `/areas/${key}/${stem}?scope=self&student_id=learner-1`, capabilities: [], scopes: self.scopes }] }; })] };
    mount("/areas/calendar?date=2026-12-15&view=list&calendar_change_id=change-1&attention_notification_id=n1#day-detail");
    expect(sourceScope()).toMatchObject({ surfaceKey: self.key, studentId: "learner-1", eventHref: "/areas/events/calendar?scope=self&student_id=learner-1", assessmentHref: "/areas/assessments/results?scope=self&student_id=learner-1", includeDining: true });
    expect(screen.getByRole("combobox", { name: "Choose calendar scope" })).toHaveValue(self.key);
    expect(screen.getByLabelText("current location")).toHaveTextContent("date=2026-12-15&view=list&calendar_change_id=change-1&attention_notification_id=n1&scope=self&student_id=learner-1#day-detail");
  });

  it("supports Dining-only Calendar without mounting an Activity or child context", () => {
    state.manifest = { ...manifest, areas: [{ ...calendar, capabilities: ["dining.view"], surfaces: [
      { key: "availability", label: "Dining hours", href: "/areas/calendar?surface=availability", capabilities: ["dining.view"], scopes: [] },
    ] }] };
    mount("/areas/calendar?surface=availability&date=2026-10-20");
    expect(sourceScope()).toEqual({ schoolId: "school-1", timeZone: "Pacific/Auckland", surfaceKey: "availability", includeDining: true });
    expect(screen.queryByRole("link", { name: "Timetable" })).not.toBeInTheDocument();
    expect(screen.getByText("Campus dates")).toBeVisible();
  });
  it("has its own heading and Areas back destination, with a direct contextual Timetable action", () => {
    state.manifest = manifest;
    mount("/areas/calendar?surface=manage&date=2026-10-20&view=day");
    expect(screen.getByRole("heading", { name: "Calendar", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back destination" })).toHaveAttribute("href", "/areas");
    expect(screen.getByRole("link", { name: "Timetable" })).toHaveAttribute("href", "/areas/timetable/planning?date=2026-10-20&view=day");
    expect(screen.getByText("Important dates calendar")).toBeInTheDocument();
    expect(sourceScope()).toEqual({ schoolId: "school-1", timeZone: "Pacific/Auckland", surfaceKey: "manage", includeDining: false });
    expect(screen.queryByRole("navigation", { name: "Timetable and calendar" })).not.toBeInTheDocument();
  });

  it.each([false, true])("derives the Timetable link from its own contribution, not Calendar management (%s)", planning => {
    state.manifest = { ...manifest, areas: manifest.areas.map(area => area.key === "timetable" ? { ...area, surfaces: area.surfaces.filter(surface => planning || surface.key !== "planning") } : area) };
    mount("/areas/calendar?surface=manage&date=2026-10-20");
    expect(screen.getByText("Important dates calendar")).toBeVisible();
    expect(screen.getByRole("link", { name: "Timetable" })).toHaveAttribute("href", `/areas/timetable/${planning ? "planning" : "schedule"}?date=2026-10-20`);
  });

  it.each(["assigned", "manage"])("collapses assigned/manage choices without rejecting a contributed legacy %s link", surface => {
    state.manifest = manifest;
    mount(`/areas/calendar?surface=${surface}`);
    expect(screen.getAllByRole("option", { name: "Campus dates" })).toHaveLength(1);
    expect(screen.queryByRole("option", { name: "Activity calendar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Campus calendar" })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Choose calendar scope" })).toHaveValue("campus");
    expect(sourceScope().surfaceKey).toBe(surface);
  });

  it("changes only to a contributed person context, retains date/view and clears another scope's attention and anchor", async () => {
    state.manifest = manifest;
    mount("/areas/calendar?surface=assigned&date=2026-10-20&view=month&calendar_change_id=change-1&attention_notification_id=n1#day-detail");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Choose calendar scope" }), "calendar:dependent:child-1");
    expect(screen.getByLabelText("current location")).toHaveTextContent("/areas/calendar?scope=dependent&student_id=child-1&date=2026-10-20&view=month");
    expect(screen.getByLabelText("current location")).not.toHaveTextContent(/change-1|n1|day-detail/);
    expect(sourceScope()).toMatchObject({ studentId: "child-1", surfaceKey: "calendar:dependent:child-1" });
  });

  it.each(["", "scope=dependent&"])("offers an explicit choice for several linked children without inventing a default (%s)", async (scope) => {
    state.manifest = { ...manifest, areas: [{ ...calendar, surfaces: [relationship("child-1", "Aarav"), relationship("child-2", "Mira")] }] };
    mount(`/areas/calendar?${scope}date=2026-10-20&view=month`);
    expect(screen.getByRole("heading", { name: "Choose a calendar" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Mira calendar" })).toHaveAttribute("href", "/areas/calendar?scope=dependent&student_id=child-2&date=2026-10-20&view=month");
    expect(screen.queryByText("Important dates calendar")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("link", { name: "Mira calendar" }));
    expect(sourceScope()).toMatchObject({ studentId: "child-2", surfaceKey: "calendar:dependent:child-2" });
    expect(screen.getByRole("combobox", { name: "Choose calendar scope" })).toHaveValue("calendar:dependent:child-2");
    expect(screen.queryByRole("link", { name: "Timetable" })).not.toBeInTheDocument();
  });

  it("does not render a calendar for an unlinked child", () => {
    state.manifest = manifest;
    mount("/areas/calendar?scope=dependent&student_id=foreign");
    expect(screen.getByText("Your workspace access changed")).toBeInTheDocument();
    expect(screen.queryByText("Important dates calendar")).not.toBeInTheDocument();
  });

  it("canonicalizes a sole contributed child before mounting the owning body, without dropping attention or anchor", async () => {
    state.manifest = { ...manifest, areas: [{ ...calendar, surfaces: [relationship("child-2", "Mira")] }] };
    mount("/areas/calendar?scope=dependent&date=2026-10-20&calendar_change_id=change-1&calendar_revision=7&calendar_record_revision=2&attention_notification_id=n1#day-detail");
    expect(await screen.findByText("Important dates calendar")).toBeInTheDocument();
    expect(screen.getByLabelText("current location")).toHaveTextContent("scope=dependent&date=2026-10-20&calendar_change_id=change-1&calendar_revision=7&calendar_record_revision=2&attention_notification_id=n1&student_id=child-2#day-detail");
  });

  it("rejects a Live manifest while Simulation is selected", () => {
    state.manifest = manifest; state.mode = "simulation";
    mount();
    expect(screen.getByText("We couldn’t load your workspace")).toBeInTheDocument();
    expect(screen.queryByText("Important dates calendar")).not.toBeInTheDocument();
  });

  it("uses the same authorized Calendar in the selected Simulation namespace", () => {
    state.mode = "simulation";
    state.manifest = { ...manifest, context: { ...manifest.context, environment: { kind: "simulation", namespace_id: "world-1", virtual_now: "2026-10-20T00:00:00.000Z" } } };
    mount("/areas/calendar?surface=assigned");
    expect(sourceScope()).toMatchObject({ schoolId: "school-1", surfaceKey: "assigned" });
    expect(screen.getByRole("link", { name: "Timetable" })).toHaveAttribute("href", "/areas/timetable/planning");
  });

  it("uses the same body for exact self context without depending on a membership role", () => {
    state.manifest = { ...manifest, areas: [{ ...calendar, surfaces: [{ key: "calendar:self:learner-1", label: "My calendar", href: "/areas/calendar?scope=self&student_id=learner-1", capabilities: [], scopes: [{ kind: "self", id: "learner-1", label: "Learner one" }] }] }] };
    mount("/areas/calendar?scope=self&student_id=learner-1");
    expect(screen.getByText("My calendar")).toBeVisible();
    expect(sourceScope()).toEqual({ schoolId: "school-1", timeZone: "Pacific/Auckland", surfaceKey: "calendar:self:learner-1", studentId: "learner-1", includeDining: false });
  });

  it("does not render cached content while the selected Simulation is unavailable", () => {
    state.mode = "simulation"; state.unavailable = true; state.manifest = manifest;
    mount();
    expect(screen.queryByText("Important dates calendar")).not.toBeInTheDocument();
    expect(screen.getByText("This simulation is unavailable")).toBeInTheDocument();
  });
});
