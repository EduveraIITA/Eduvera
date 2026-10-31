import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { ExecutionEnvironmentProvider } from "../simulation/ExecutionEnvironmentContext";
import { ActivityTimetableWorkspace } from "./ActivityTimetableWorkspace";
import { initialActivity } from "./activityExperience";
import { getActivityCatalogue, getActivityOccurrences, getActivityPlans, type ActivityPlan } from "./api";

vi.mock("./api", async original => ({ ...await original<typeof import("./api")>(),
  getActivityCatalogue: vi.fn(), getActivityOccurrences: vi.fn(), getActivityPlans: vi.fn(),
}));
vi.mock("../simulation/applicationTime", async original => ({ ...await original<typeof import("../simulation/applicationTime")>(),
  applicationNow: () => new Date("2026-10-20T12:32:28Z"),
}));
vi.mock("../../pages/operations/OperationsShell", () => ({ OperationsShell: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("./ActivityCalendar", () => ({ ActivityCalendar: () => <div aria-label="Activity calendar" /> }));
vi.mock("./ActivityPlanDetail", () => ({ ActivityPlanDetail: () => <div role="dialog" aria-label="Saved activity" /> }));
vi.mock("./ActivityPlanEditor", () => ({ ActivityPlanEditor: ({ date, start, end, endDayOffset, intent, onSaved }: {
  date: string; start: string; end: string; endDayOffset: number; intent?: string;
  onSaved: (plan: ActivityPlan, notice: string) => Promise<void>;
}) => <div role="dialog" aria-label="Activity editor"><output>{`${intent}:${date}:${start}:${end}:${endDayOffset}`}</output>
  <button onClick={() => void onSaved(saved("draft"), "Draft saved.")}>Save fixture draft</button>
  <button onClick={() => void onSaved(saved("published"), "Activity published.")}>Publish fixture</button></div> }));

function saved(state: "draft" | "published"): ActivityPlan {
  return { ...initialActivity("2026-10-25", "Asia/Kolkata"), title: "Future training", id: "11000000-0000-4000-8000-000000000001", state, revision: 1,
    can_edit: state === "draft", source: "activity", source_ref: "11000000-0000-4000-8000-000000000001" };
}
function Location() { const location = useLocation(); return <output aria-label="Current URL">{location.pathname}{location.search}</output>; }
function mount() {
  vi.mocked(getActivityCatalogue).mockResolvedValue({ school_id: "campus", timezone: "Asia/Kolkata", can_manage: true,
    people: [], recorders: [], reviewers: [], groups: [], spaces: [], classes: [], subjects: [], terms: [], purposes: ["other"] });
  vi.mocked(getActivityOccurrences).mockResolvedValue({ items: [{ id:"exact-occurrence", school_id:"campus", activity_id:saved("published").id,
    plan_version_id:saved("published").id,title:"Future training",purpose:"training",starts_at:"2026-10-25T03:30:00Z",ends_at:"2026-10-25T04:30:00Z",
    local_date:"2026-10-25",timezone:"Asia/Kolkata",space_id:null,space_label:null,attendance_mode:"roll_call",source_revision:1,source:"activity",
    source_ref:saved("published").id,state:"expected",can_open_register:true,participants:[] }], page: 1, page_size: 25, total: 1, total_pages: 1 });
  vi.mocked(getActivityPlans).mockResolvedValue({ items: [], page: 1, page_size: 25, total: 0, total_pages: 1 });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><ExecutionEnvironmentProvider environment={{ mode: "live" }}>
    <MemoryRouter initialEntries={["/areas/timetable/planning?create=attendance&date=2026-10-18&view=week&page=3"]}>
      <ActivityTimetableWorkspace schoolId="campus" /><Location />
    </MemoryRouter></ExecutionEnvironmentProvider></QueryClientProvider>);
}
afterEach(() => { cleanup(); vi.resetAllMocks(); });
describe("attendance-first save continuation", () => {
  it("opens the same editor with the campus's current time instead of a hidden 9am interval", async () => {
    mount();
    expect(await screen.findByText("attendance:2026-10-20:18:02:19:02:0")).toBeVisible();
  });
  it("keeps a saved draft discoverable on its own date and offers a direct continuation", async () => {
    mount(); await userEvent.click(await screen.findByRole("button", { name: "Save fixture draft" }));
    expect(await screen.findByRole("button", { name: "Continue saved draft" })).toBeVisible();
    expect(screen.getByLabelText("Current URL")).toHaveTextContent("date=2026-10-25&view=day&section=drafts");
    expect(screen.getByLabelText("Current URL")).not.toHaveTextContent("create=");
    expect(screen.getByLabelText("Current URL")).not.toHaveTextContent("page=");
    expect(screen.queryByRole("link", { name: /Open attendance for/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Continue saved draft" }));
    expect(screen.getByRole("dialog", { name: "Saved activity" })).toBeVisible();
  });
  it("follows the published date and links attendance without claiming marks were recorded", async () => {
    mount(); await userEvent.click(await screen.findByRole("button", { name: "Publish fixture" }));
    expect(await screen.findByRole("link", { name: "Open attendance for 2026-10-25" }))
      .toHaveAttribute("href", "/areas/attendance/registers?date=2026-10-25&occurrence_id=exact-occurrence");
    expect(screen.getByLabelText("Current URL")).toHaveTextContent("date=2026-10-25&view=day");
    expect(screen.getByLabelText("Current URL")).not.toHaveTextContent("section=drafts");
    expect(screen.getByText("Activity published.")).toBeVisible();
  });
});
