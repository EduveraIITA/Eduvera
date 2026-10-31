import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ExecutionEnvironmentProvider } from "../simulation/ExecutionEnvironmentContext";
import type { ExecutionEnvironment } from "../simulation/executionEnvironment";
import { ActivityPlanDetail } from "./ActivityPlanDetail";
import { initialActivity } from "./activityExperience";
import { getActivityPlan, reviseActivityPlan, transitionActivityPlan, type ActivityCatalogue, type ActivityOccurrence, type ActivityPlan } from "./api";
vi.mock("./api", async (original) => ({ ...await original<typeof import("./api")>(), getActivityPlan: vi.fn(), reviseActivityPlan: vi.fn(), transitionActivityPlan: vi.fn() }));
vi.mock("./ActivityPlanEditor", () => ({ ActivityPlanEditor: ({ plan }: { plan: ActivityPlan }) => <div>Shared activity editor: {plan.id}</div> }));
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const catalogue: ActivityCatalogue = { school_id: "school-1", timezone: "UTC", can_manage: true, people: [], groups: [], recorders: [], reviewers: [], spaces: [], classes: [], subjects: [], terms: [], purposes: ["other"] };
const plan: ActivityPlan = { ...initialActivity("2026-10-20", "UTC"), title: "Night duty", person_ids: ["guard"], recurrence: "weekly", ends_on: null, id: "published-1", state: "published", revision: 7, can_edit: false, source: "activity", source_ref: "published-1" };
function mount(occurrence?: ActivityOccurrence, source = plan, environment: ExecutionEnvironment = { mode: "live" }) {
  vi.mocked(getActivityPlan).mockResolvedValue(source);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><ExecutionEnvironmentProvider environment={environment}><MemoryRouter><ActivityPlanDetail schoolId="school-1" catalogue={catalogue} occurrence={occurrence} planId={source.id} onClose={vi.fn()} onSaved={vi.fn()} /></MemoryRouter></ExecutionEnvironmentProvider></QueryClientProvider>);
}
describe("immutable publication with a dated change", () => {
  it("explains temporary windows without hiding an available later change", async () => {
    mount(undefined, { ...plan, can_plan_change: true, superseded_on: "2026-12-01", replacement_window_count: 1, replacement_windows: [{ replacement_plan_id: "temporary-one", from: "2026-10-23", until: "2026-10-26" }] });
    expect(await screen.findByRole("button", { name: "Plan a change" })).toBeVisible();
    await userEvent.click(screen.getByText("Scheduled changes · 1"));
    expect(screen.getByText(/original plan resumes on 2026-10-26/)).toBeVisible();
    vi.mocked(getActivityPlan).mockResolvedValue({ ...plan, id: "temporary-one", title: "Temporary maintenance timetable" });
    await userEvent.click(screen.getByRole("button", { name: "View change from 2026-10-23" }));
    expect(await screen.findByRole("dialog", { name: "Temporary maintenance timetable" })).toBeVisible();
    expect(getActivityPlan).toHaveBeenLastCalledWith("school-1", "temporary-one");
  });
  it("rediscovers a saved change draft instead of offering another conflicting draft", async () => {
    mount(undefined, { ...plan, pending_revision_id: "pending-change" });
    expect(await screen.findByRole("button", { name: "Continue change draft" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Plan a change" })).not.toBeInTheDocument();
    vi.mocked(getActivityPlan).mockResolvedValue({ ...plan, id: "pending-change", title: "Saved change", state: "draft", can_edit: true });
    await userEvent.click(screen.getByRole("button", { name: "Continue change draft" }));
    await userEvent.click(await screen.findByRole("button", { name: "Edit and review draft" }));
    expect(screen.getByText("Shared activity editor: pending-change")).toBeVisible();
    expect(reviseActivityPlan).not.toHaveBeenCalled();
  });
  it("allows a future one-off activity to move beyond its old date using the selected campus clock", async () => {
    const once: ActivityPlan = { ...plan, recurrence: "once", starts_on: "2026-10-26", ends_on: "2026-10-26" };
    mount(undefined, once, { mode: "simulation", namespaceId: "namespace-one", runId: "run-one", runStatus: "draft", virtualClock: { now: "2026-10-24T12:00:00Z", timeZone: "UTC" } });
    await userEvent.click(await screen.findByRole("button", { name: "Plan a change" }));
    expect(screen.getByLabelText("New date")).toHaveAttribute("min", "2026-10-24");
    expect(screen.getByLabelText("New date")).not.toHaveAttribute("max");
    vi.mocked(reviseActivityPlan).mockResolvedValue({ ...once, id: "moved-one", starts_on: "2026-10-28", ends_on: "2026-10-28", state: "draft" });
    fireEvent.input(screen.getByLabelText("New date"), { target: { value: "2026-10-28" } });
    await userEvent.type(screen.getByLabelText("Reason for change"), "Move the future briefing after maintenance");
    await userEvent.click(screen.getByRole("button", { name: "Prepare change draft" }));
    expect(await screen.findByText("Shared activity editor: moved-one")).toBeVisible();
    expect(reviseActivityPlan).toHaveBeenCalledWith("school-1", expect.objectContaining({ id: once.id }), "2026-10-28", "Move the future briefing after maintenance", expect.any(String));
  });
  it("opens the exact permitted occurrence register, not a separate class or worker workflow", async () => {
    const occurrence: ActivityOccurrence = {
      id: "occurrence-night", school_id: "school-1", activity_id: "activity-night", plan_version_id: plan.id,
      title: plan.title, purpose: "duty", starts_at: "2026-10-20T22:00:00Z", ends_at: "2026-10-21T06:00:00Z",
      local_date: "2026-10-20", timezone: "UTC", space_id: null, space_label: null,
      attendance_mode: "roll_call", source_revision: 7, source: "activity", source_ref: plan.id,
      state: "expected", can_open_register: true, participants: [],
    };
    mount(occurrence);
    expect(await screen.findByRole("link", { name: "Open attendance" })).toHaveAttribute("href", "/areas/attendance/registers?date=2026-10-20&occurrence_id=occurrence-night");
  });
  it("prepares a reasoned replacement draft and opens the same editor without publishing or cancelling", async () => {
    mount();
    vi.mocked(reviseActivityPlan).mockResolvedValue({ ...plan, id: "replacement-1", state: "draft", revision: 1, can_edit: true, replaces_version_id: plan.id });
    await userEvent.click(await screen.findByRole("button", { name: "Plan a change" }));
    fireEvent.input(screen.getByLabelText("Change from"), { target: { value: "2026-10-23" } });
    await userEvent.type(screen.getByLabelText("Reason for change"), "Move the night duty after maintenance");
    await userEvent.click(screen.getByRole("button", { name: "Prepare change draft" }));
    expect(await screen.findByText("Shared activity editor: replacement-1")).toBeVisible();
    expect(reviseActivityPlan).toHaveBeenCalledWith("school-1", expect.objectContaining({ id: plan.id, revision: 7 }), "2026-10-23", "Move the night duty after maintenance", expect.any(String));
    expect(transitionActivityPlan).not.toHaveBeenCalled();
  });
  it("keeps the published source and reason visible when preparing a change fails", async () => {
    mount();
    vi.mocked(reviseActivityPlan).mockRejectedValue(new Error("Another dated change already exists. Open that draft."));
    await userEvent.click(await screen.findByRole("button", { name: "Plan a change" }));
    await userEvent.type(screen.getByLabelText("Reason for change"), "Maintenance change");
    await userEvent.click(screen.getByRole("button", { name: "Prepare change draft" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("dated change already exists"));
    expect(screen.getByLabelText("Reason for change")).toHaveValue("Maintenance change");
    expect(screen.getByText(/published · Revision 7/)).toBeVisible();
    expect(transitionActivityPlan).not.toHaveBeenCalled();
  });
});
