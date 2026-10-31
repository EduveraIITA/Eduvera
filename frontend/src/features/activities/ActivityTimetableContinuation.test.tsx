import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { BrowserRouter, Link, MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ExecutionEnvironmentProvider } from "../simulation/ExecutionEnvironmentContext";
import type { ExecutionEnvironment } from "../simulation/executionEnvironment";
import { ActivityTimetableWorkspace } from "./ActivityTimetableWorkspace";
import { initialActivity } from "./activityExperience";
import { createActivityPlan, getActivityCatalogue, getActivityOccurrences, getActivityPlan, getActivityPlans, transitionActivityPlan, type ActivityCatalogue, type ActivityPlan } from "./api";

const auth = vi.hoisted(() => ({ user: { id: "actor-a" } }));
vi.mock("../auth/AuthContext", async original => ({ ...await original<typeof import("../auth/AuthContext")>(), useOptionalAuth: () => auth }));
vi.mock("./api", async original => ({ ...await original<typeof import("./api")>(), getActivityCatalogue: vi.fn(), getActivityOccurrences: vi.fn(),
  getActivityPlan: vi.fn(), getActivityPlans: vi.fn(), createActivityPlan: vi.fn(), transitionActivityPlan: vi.fn() }));
vi.mock("../../pages/operations/OperationsShell", () => ({ OperationsShell: ({ children, pageTitleTrailing, beforeBack }: { children: ReactNode; pageTitleTrailing?: ReactNode; beforeBack?: () => boolean }) => {
  const navigate = useNavigate();
  return <><button onClick={() => { if (!beforeBack || beforeBack()) void navigate("/today"); }}>Shell back</button>{pageTitleTrailing}{children}</>;
} }));
vi.mock("./ActivityCalendar", () => ({ ActivityCalendar: () => <div aria-label="Activity calendar" /> }));
const id = "11000000-0000-4000-8000-000000000001";
const plan: ActivityPlan = { ...initialActivity("2026-11-03", "UTC"), id, title: "Saved briefing", person_ids: ["participant"],
  state: "draft", revision: 2, source: "activity", source_ref: id, can_edit: true, attendance_mode: "none" };
const catalogue: ActivityCatalogue = { school_id: "campus", timezone: "UTC", can_manage: true, people: [{ id: "participant", label: "Mira Participant", affiliations: [] }],
  groups: [], spaces: [], recorders: [], reviewers: [], classes: [], terms: [], subjects: [], purposes: ["other"] };
function Location() { const location = useLocation(), navigate = useNavigate(); return <><output aria-label="Current URL">{location.pathname}{location.search}</output><Link to="/today">Leave timetable</Link><button onClick={() => navigate(-1)}>Browser back</button><button onClick={() => navigate(1)}>Browser forward</button></>; }
function show(url: string, environment: ExecutionEnvironment = { mode: "live" }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (world: ExecutionEnvironment, school = "campus") => <QueryClientProvider client={client}><ExecutionEnvironmentProvider environment={world}><MemoryRouter initialEntries={[url]}><ActivityTimetableWorkspace schoolId={school} /><Location /></MemoryRouter></ExecutionEnvironmentProvider></QueryClientProvider>;
  const rendered = render(tree(environment));
  return { client, rerender: (world = environment, school = "campus") => rendered.rerender(tree(world, school)) };
}
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
beforeEach(() => {
  auth.user.id = "actor-a";
  vi.mocked(getActivityCatalogue).mockResolvedValue(catalogue);
  vi.mocked(getActivityOccurrences).mockResolvedValue({ items: [], page: 3, page_size: 25, total: 0, total_pages: 3 });
  vi.mocked(getActivityPlans).mockResolvedValue({ items: [plan], page: 3, page_size: 25, total: 51, total_pages: 3 });
  vi.mocked(getActivityPlan).mockResolvedValue(plan);
  vi.mocked(createActivityPlan).mockResolvedValue(plan);
});
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.restoreAllMocks(); window.history.replaceState({}, "", "/"); });
function showBrowser(url: string) {
  window.history.replaceState({ idx: 0, key: "today" }, "", "/today");
  window.history.pushState({ idx: 1, key: "timetable" }, "", url);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><ExecutionEnvironmentProvider environment={{ mode: "live" }}><BrowserRouter><Routes>
    <Route path="/today" element={<h1>Today workspace</h1>} />
    <Route path="/areas/timetable/planning" element={<ActivityTimetableWorkspace schoolId="campus" />} />
  </Routes></BrowserRouter></ExecutionEnvironmentProvider></QueryClientProvider>);
}
async function fillActivity() {
  await userEvent.type(await screen.findByLabelText("Activity name"), "Saved briefing");
  await userEvent.click(screen.getByRole("checkbox", { name: /Mira Participant/ }));
  await userEvent.click(screen.getByRole("button", { name: "Continue", exact: true }));
  expect(screen.getByLabelText("Attendance")).toHaveValue("none");
  expect(screen.queryByLabelText("Attendance recorder")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Continue", exact: true }));
}
function mockPhoneViewport(phone: boolean) {
  const media = window.matchMedia("(max-width: 680px)");
  vi.spyOn(window, "matchMedia").mockImplementation(query => ({ ...media, media: query, matches: phone && query === "(max-width: 680px)" }));
}
describe("Timetable source-backed continuation", () => {
  it("defaults phones to Agenda and reads a bounded seven-day range", async () => {
    mockPhoneViewport(true);
    show("/areas/timetable/planning?date=2026-10-28");
    const display = await screen.findByRole("combobox", { name: "Timetable display" });
    expect(display).toHaveValue("agenda");
    expect(screen.queryByLabelText("Activity calendar")).not.toBeInTheDocument();
    await waitFor(() => expect(getActivityOccurrences).toHaveBeenCalledWith("campus", "2026-10-28", "2026-11-03", 1));
    expect(createActivityPlan).not.toHaveBeenCalled();
  });
  it("defaults larger screens to the selected day's grid", async () => {
    mockPhoneViewport(false);
    show("/areas/timetable/planning?date=2026-10-28");
    const display = await screen.findByRole("combobox", { name: "Timetable display" });
    expect(display).toHaveValue("day");
    expect(await screen.findByLabelText("Activity calendar")).toBeVisible();
    await waitFor(() => expect(getActivityOccurrences).toHaveBeenCalledWith("campus", "2026-10-28", "2026-10-28", 1));
  });
  it("honours explicit display links and preserves date/search while switching and navigating days", async () => {
    mockPhoneViewport(true);
    show("/areas/timetable/planning?date=2026-10-28&view=day&page=3&search=briefing");
    const display = await screen.findByRole("combobox", { name: "Timetable display" });
    expect(display).toHaveValue("day");
    await waitFor(() => expect(getActivityOccurrences).toHaveBeenCalledWith("campus", "2026-10-28", "2026-10-28", 3));
    await userEvent.selectOptions(display, "agenda");
    expect(screen.getByLabelText("Current URL")).toHaveTextContent("date=2026-10-28&view=agenda&search=briefing");
    expect(screen.getByLabelText("Current URL")).not.toHaveTextContent("page=");
    await waitFor(() => expect(getActivityOccurrences).toHaveBeenCalledWith("campus", "2026-10-28", "2026-11-03", 1));
    await userEvent.click(await screen.findByRole("button", { name: "Thursday, 29 October", exact: true }));
    await userEvent.click(screen.getByRole("button", { name: "Next week", exact: true }));
    expect(screen.getByLabelText("Current URL")).toHaveTextContent("date=2026-11-05&view=agenda&search=briefing");
    await waitFor(() => expect(getActivityOccurrences).toHaveBeenCalledWith("campus", "2026-11-05", "2026-11-11", 1));
    await userEvent.click(screen.getByRole("button", { name: "Plans & drafts", exact: true }));
    await waitFor(() => expect(getActivityPlans).toHaveBeenCalledWith("campus", "2026-11-05", "2026-11-05", 1));
    expect(createActivityPlan).not.toHaveBeenCalled();
  });
  it("keeps Agenda query ranges separate between Simulation and Live", async () => {
    const simulation: ExecutionEnvironment = { mode: "simulation", namespaceId: "simulation-campus", runId: "agenda-run",
      virtualClock: { now: "2026-10-28T09:00:00.000Z", timeZone: "UTC" }, runStatus: "running" };
    const view = show("/areas/timetable/planning?date=2026-10-28&view=agenda", simulation);
    await waitFor(() => expect(getActivityOccurrences).toHaveBeenCalledWith("campus", "2026-10-28", "2026-11-03", 1));
    view.rerender({ mode: "live" });
    await waitFor(() => expect(getActivityOccurrences).toHaveBeenCalledTimes(2));
    const keys = view.client.getQueryCache().getAll().map(query => query.queryKey);
    const source = ["activities", "campus", "actor", "actor-a", "occurrences", "expected", "2026-10-28", "2026-11-03", 1];
    expect(keys).toContainEqual(["execution-environment", "simulation", "simulation-campus", "agenda-run", ...source]);
    expect(keys).toContainEqual(["execution-environment", "live", ...source]);
    expect(createActivityPlan).not.toHaveBeenCalled();
  });
  it("switches the day through circular weekday buttons without a stretched week view", async () => {
    show("/areas/timetable/planning?date=2026-10-28");
    expect(await screen.findByRole("combobox", { name: "Timetable display" })).toBeVisible();
    expect(screen.queryByLabelText("Timetable view", { exact: true })).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "Thursday, 29 October", exact: true }));
    expect(screen.getByLabelText("Current URL")).toHaveTextContent("date=2026-10-29");
    await userEvent.click(screen.getByRole("button", { name: "Next week", exact: true }));
    expect(screen.getByLabelText("Current URL")).toHaveTextContent("date=2026-11-05");
    expect(createActivityPlan).not.toHaveBeenCalled();
  });
  it("opens an exact draft outside the loaded date/page after reload and closes without losing list context", async () => {
    vi.mocked(getActivityPlans).mockResolvedValue({ items: [], page: 3, page_size: 25, total: 51, total_pages: 3 });
    const base = "/areas/timetable/planning?date=2026-10-20&view=week&section=drafts&page=3&search=briefing";
    show(`${base}&plan=${id}&plan_revision=2`);
    expect(await screen.findByRole("dialog", { name: "Saved briefing" })).toBeVisible();
    expect(getActivityPlan).toHaveBeenCalledWith("campus", id);
    expect(createActivityPlan).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Close", exact: true }));
    expect(screen.getByLabelText("Current URL")).toHaveTextContent(base);
    expect(screen.getByLabelText("Current URL")).not.toHaveTextContent("plan=");
  });
  it("restores selected source on Back/Forward while preserving date, view and page", async () => {
    show("/areas/timetable/planning?date=2026-10-20&view=week&section=drafts&page=3");
    await userEvent.click(await screen.findByRole("button", { name: /Saved briefing/ }));
    expect(await screen.findByRole("dialog", { name: "Saved briefing" })).toBeVisible();
    expect(screen.getByLabelText("Current URL")).toHaveTextContent(`page=3&plan=${id}&plan_revision=2`);
    await userEvent.click(screen.getByRole("button", { name: "Browser back" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Browser forward" }));
    expect(await screen.findByRole("dialog", { name: "Saved briefing" })).toBeVisible();
  });
  it.each(["plan=", "plan=abc", "plan=%20", "plan=a%2Fb", `plan=${id}&plan=${id}`, `plan=${id}&plan_revision=0`,
    `plan=${id}&plan_revision=2&plan_revision=3`, `plan=${id}&create=activity`, "create=activity&create=attendance"])("recovers a malformed selector without reading or creating another source: %s", async query => {
    show(`/areas/timetable/planning?date=2026-10-20&page=3&${query}`);
    expect(await screen.findByRole("alert")).toHaveTextContent("No draft has been created");
    expect(getActivityPlan).not.toHaveBeenCalled();
    expect(createActivityPlan).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Return to timetable" }));
    expect(screen.getByLabelText("Current URL")).toHaveTextContent("date=2026-10-20&page=3");
  });
  it("requires explicit current-source review for a stale deep link before offering edits", async () => {
    show(`/areas/timetable/planning?plan=${id}&plan_revision=1`);
    expect(await screen.findByRole("dialog", { name: "Activity changed" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Edit and review draft" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Review current activity" }));
    expect(await screen.findByRole("button", { name: "Edit and review draft" })).toBeVisible();
    expect(screen.getByLabelText("Current URL")).toHaveTextContent("plan_revision=2");
  });
  it("keeps denied source recovery on the same list without opening creation", async () => {
    vi.mocked(getActivityPlan).mockRejectedValue(new Error("This activity is outside your current planning responsibility."));
    show(`/areas/timetable/planning?section=drafts&page=3&plan=${id}&plan_revision=2`);
    expect(await screen.findByRole("alert")).toHaveTextContent("outside your current planning responsibility");
    await userEvent.click(screen.getByRole("button", { name: "Return to timetable" }));
    expect(screen.getByLabelText("Current URL")).toHaveTextContent("section=drafts&page=3");
    expect(createActivityPlan).not.toHaveBeenCalled();
  });
  it("creates an ordinary no-attendance draft and continues its exact accepted source", async () => {
    show("/areas/timetable/planning?create=activity&date=2026-11-03");
    await fillActivity();
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByRole("dialog", { name: "Saved briefing" })).toBeVisible();
    expect(createActivityPlan).toHaveBeenCalledWith("campus", expect.objectContaining({ attendance_mode: "none", recorder_person_id: null,
      reviewer_person_id: null, class_section_id: null, term_id: null }), expect.any(String));
    expect(screen.getByLabelText("Current URL")).toHaveTextContent(`section=drafts&plan=${id}&plan_revision=2`);
    const cleanUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(cleanUnload);
    expect(cleanUnload.defaultPrevented).toBe(false);
  });
  it("retains accepted draft identity after publication fails and retries that publication without duplicate creation", async () => {
    vi.mocked(transitionActivityPlan).mockRejectedValueOnce(new Error("Publication was not confirmed. Review this draft."))
      .mockResolvedValueOnce({ ...plan, state: "published", revision: 3 });
    show("/areas/timetable/planning?create=activity&date=2026-11-03");
    await fillActivity();
    await userEvent.click(screen.getByRole("button", { name: "Publish activity" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Publication was not confirmed");
    expect(screen.getByLabelText("Current URL")).toHaveTextContent(`plan=${id}&plan_revision=2`);
    expect(screen.getByLabelText("Current URL")).not.toHaveTextContent("create=");
    expect(screen.getByRole("button", { name: "Publish activity" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "Publish activity" }));
    await waitFor(() => expect(transitionActivityPlan).toHaveBeenCalledTimes(2));
    expect(vi.mocked(transitionActivityPlan).mock.calls[0]?.[4]).toEqual(vi.mocked(transitionActivityPlan).mock.calls[1]?.[4]);
    expect(createActivityPlan).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("button", { name: "View published activity" })).toBeVisible();
    expect(screen.queryByRole("link", { name: /Open attendance/ })).not.toBeInTheDocument();
  });
  it("partitions actor caches, unmounts stale editors and ignores late accepted callbacks after actor change", async () => {
    let accept!: (value: ActivityPlan) => void;
    vi.mocked(createActivityPlan).mockReturnValueOnce(new Promise(resolve => { accept = resolve; }));
    const view = show("/areas/timetable/planning?create=activity&date=2026-11-03");
    await fillActivity();
    await userEvent.click(screen.getByRole("button", { name: "Publish activity" }));
    auth.user.id = "actor-b";
    vi.mocked(getActivityCatalogue).mockResolvedValue({ ...catalogue, can_manage: false });
    view.rerender();
    expect(await screen.findByRole("alert")).toHaveTextContent("no longer have permission");
    await act(async () => { accept(plan); await Promise.resolve(); });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByLabelText("Current URL")).not.toHaveTextContent("plan=");
    expect(transitionActivityPlan).not.toHaveBeenCalled();
    const keys = view.client.getQueryCache().getAll().map(query => query.queryKey);
    expect(keys.some(key => key.includes("actor-a"))).toBe(true);
    expect(keys.some(key => key.includes("actor-b"))).toBe(true);
  });
  it("preserves an unsaved editor when the same source refetches at a newer revision", async () => {
    const view = show(`/areas/timetable/planning?plan=${id}&plan_revision=2`);
    await userEvent.click(await screen.findByRole("button", { name: "Edit and review draft" }));
    fireEvent.change(screen.getByLabelText("Activity name"), { target: { value: "Unsaved revision" } });
    vi.mocked(getActivityPlan).mockResolvedValue({ ...plan, revision: 3 });
    await view.client.invalidateQueries({ queryKey: ["execution-environment", "live", "activities", "campus", "actor", "actor-a", "plan", id] });
    expect(screen.getByLabelText("Activity name")).toHaveValue("Unsaved revision");
    expect(screen.queryByRole("dialog", { name: "Activity changed" })).not.toBeInTheDocument();
  });
  it.each(["Leave timetable", "Shell back"])("guards unsaved source fields before %s navigation", async label => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const url = `/areas/timetable/planning?plan=${id}&plan_revision=2`;
    show(url);
    await userEvent.click(await screen.findByRole("button", { name: "Edit and review draft" }));
    fireEvent.change(screen.getByLabelText("Activity name"), { target: { value: "My unsaved activity" } });
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    await userEvent.click(screen.getByRole(label === "Shell back" ? "button" : "link", { name: label }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("Current URL")).toHaveTextContent(url);
    expect(screen.getByLabelText("Activity name")).toHaveValue("My unsaved activity");
    expect(createActivityPlan).not.toHaveBeenCalled();
  });
  it("retains fields and exact URL on cancelled native Back, then leaves on confirmation", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const url = `/areas/timetable/planning?plan=${id}&plan_revision=2&date=2026-10-20&page=3`;
    showBrowser(url);
    await userEvent.click(await screen.findByRole("button", { name: "Edit and review draft" }));
    fireEvent.change(screen.getByLabelText("Activity name"), { target: { value: "Keep this draft text" } });
    act(() => { window.history.back(); });
    await waitFor(() => expect(confirm).toHaveBeenCalledOnce());
    await waitFor(() => expect(`${window.location.pathname}${window.location.search}`).toBe(url));
    expect(screen.getByLabelText("Activity name")).toHaveValue("Keep this draft text");
    confirm.mockReturnValue(true);
    act(() => { window.history.back(); });
    expect(await screen.findByRole("heading", { name: "Today workspace" })).toBeVisible();
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(createActivityPlan).not.toHaveBeenCalled();
  });
  it("does not warn when native Back leaves a clean saved source", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    showBrowser(`/areas/timetable/planning?plan=${id}&plan_revision=2`);
    expect(await screen.findByRole("dialog", { name: "Saved briefing" })).toBeVisible();
    act(() => { window.history.back(); });
    expect(await screen.findByRole("heading", { name: "Today workspace" })).toBeVisible();
    expect(confirm).not.toHaveBeenCalled();
  });
});
