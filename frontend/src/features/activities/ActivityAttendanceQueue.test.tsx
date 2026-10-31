import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActivityAttendanceWorkspace } from "./ActivityAttendanceWorkspace";
import { getActivityRegister, getActivityRegisters, type ActivityRegisterPage, type ActivityRegisterSummary } from "./api";
import { ExecutionEnvironmentProvider } from "../simulation/ExecutionEnvironmentContext";

vi.mock("./api", async original => ({ ...await original<typeof import("./api")>(), getActivityRegisters: vi.fn(), getActivityRegister: vi.fn() }));
vi.mock("./ActivityRegisterEditor", () => ({ ActivityRegisterEditor: ({ onBack }: { onBack: () => void }) => <button type="button" onClick={onBack}>Back to registers</button> }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const item = (index: number): ActivityRegisterSummary => ({ id: `register-${index}`, occurrence_id: `occurrence-${index}`, title: `Duty ${index}`, kind: "duty", starts_at: "2026-10-20T08:00:00Z", ends_at: "2026-10-20T10:00:00Z", time_zone: "UTC", place_label: "North gate", state: "draft", revision: 0, participant_count: 2, recorded_count: 0, can_record: true, can_review: false, availability_reason: null, source_kind: "activity", queue_category: "needs_recording" });
const page = (number = 1): ActivityRegisterPage => ({ date: "2026-10-20", page: number, page_size: 8, total: 40, total_pages: 5,
  registers: Array.from({ length: 8 }, (_, index) => item(index + (number - 1) * 8)), counts: { all: 40, needs_recording: 40, upcoming: 0, completed: 0, cancelled: 0 }, available_kinds: [{ kind: "duty", count: 40 }, { kind: "training", count: 3 }] });
function Location() { return <output aria-label="Current URL">{useLocation().search}</output>; }
function show(url = "/areas/attendance/registers?date=2026-10-20") {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ExecutionEnvironmentProvider environment={{ mode: "live" }}><MemoryRouter initialEntries={[url]}><ActivityAttendanceWorkspace schoolId="school-1" /><Location /></MemoryRouter></ExecutionEnvironmentProvider></QueryClientProvider>);
}

describe("short, categorized register queue", () => {
  it("shows global counts with only eight rows and submits search rather than refetching while typing", async () => {
    vi.mocked(getActivityRegisters).mockImplementation((_school, _date, number, filters) => Promise.resolve(filters?.search ? { ...page(), total: 1, total_pages: 1, registers: [item(39)], counts: { all: 1, needs_recording: 1, upcoming: 0, completed: 0, cancelled: 0 } } : page(number)));
    show();
    const views = await screen.findByRole("group", { name: "Register views" });
    expect(within(views).getByRole("button", { name: "All 40" })).toHaveAttribute("aria-pressed", "true");
    expect(within(views).queryByRole("button", { name: "Upcoming 0" })).not.toBeInTheDocument();
    expect(document.querySelectorAll(".activity-agenda > button")).toHaveLength(8);
    expect(screen.getByRole("region", { name: "To record" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Next", exact: true })).toBeVisible();
    const calls = vi.mocked(getActivityRegisters).mock.calls.length;
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Find or filter registers" }));
    expect(screen.getByRole("searchbox")).toHaveFocus();
    await userEvent.type(screen.getByRole("searchbox", { name: "Search all registers on this date" }), "Duty 39");
    expect(getActivityRegisters).toHaveBeenCalledTimes(calls);
    fireEvent.click(screen.getByRole("button", { name: "Search registers", exact: true }));
    expect(await screen.findByRole("button", { name: /Duty 39/ })).toBeVisible();
    expect(getActivityRegisters).toHaveBeenLastCalledWith("school-1", "2026-10-20", 1, { search: "Duty 39", view: "all", kind: "" });
    expect(screen.getByLabelText("Current URL")).toHaveTextContent("search=Duty+39");
    await userEvent.click(screen.getByRole("button", { name: "Close register filters" }));
    await waitFor(() => expect(screen.queryByRole("searchbox")).not.toBeInTheDocument());
    expect(screen.getByLabelText("Current URL")).not.toHaveTextContent("search=");
    expect(getActivityRegisters).toHaveBeenLastCalledWith("school-1", "2026-10-20", 1, { search: "", view: "all", kind: "" });
  });

  it("keeps the list page and filters when opening a register and returning", async () => {
    vi.mocked(getActivityRegisters).mockResolvedValue(page(2));
    vi.mocked(getActivityRegister).mockResolvedValue({ register: { id: "register-8" } } as Awaited<ReturnType<typeof getActivityRegister>>);
    show("/areas/attendance/registers?date=2026-10-20&page=2&attendance_view=needs_recording&activity_kind=duty&search=North");
    await userEvent.click(await screen.findByRole("button", { name: /Duty 8/ }));
    expect(screen.getByLabelText("Current URL")).toHaveTextContent("page=2");
    await userEvent.click(await screen.findByRole("button", { name: "Back to registers" }));
    await waitFor(() => expect(screen.getByRole("searchbox")).toHaveValue("North"));
    const location = screen.getByLabelText("Current URL");
    expect(location).toHaveTextContent("page=2");
    expect(location).toHaveTextContent("attendance_view=needs_recording");
    expect(location).toHaveTextContent("activity_kind=duty");
    expect(location).not.toHaveTextContent("register_id");
  });

  it("does not describe final-category results as work still to record", async () => {
    vi.mocked(getActivityRegisters).mockResolvedValue({ ...page(), total: 2, total_pages: 1,
      counts: { all: 40, needs_recording: 38, upcoming: 0, completed: 2, cancelled: 0 },
      registers: [0, 1].map(index => ({ ...item(index), state: "locked", queue_category: "completed" })) });
    show("/areas/attendance/registers?date=2026-10-20&attendance_view=completed");
    expect(await screen.findByRole("region", { name: "Final" })).toBeVisible();
    expect(document.querySelector(".attendance-queue-summary")).toHaveTextContent("2 matching registers");
    expect(document.querySelector(".attendance-queue-summary")).not.toHaveTextContent("to complete");
    expect(screen.getByRole("button", { name: "To record 38" })).toBeVisible();
  });

  it("keeps submitted reviews distinct from final registers and explains remaining work", async () => {
    vi.mocked(getActivityRegisters).mockResolvedValue({ ...page(), total: 2, total_pages: 1,
      counts: { all: 2, needs_recording: 0, awaiting_review: 1, upcoming: 0, completed: 1, cancelled: 0 },
      registers: [{ ...item(1), state: "submitted", can_review: true, queue_category: "awaiting_review" },
        { ...item(2), state: "locked", queue_category: "completed" }] });
    show();
    expect(await screen.findByRole("region", { name: "Awaiting review" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Final" })).toBeVisible();
    expect(document.querySelector(".attendance-queue-summary")).toHaveTextContent("0 to record · 1 awaiting review");
    await userEvent.click(screen.getByRole("button", { name: "Awaiting review 1" }));
    expect(getActivityRegisters).toHaveBeenLastCalledWith("school-1", "2026-10-20", 1,
      { search: "", view: "awaiting_review", kind: "" });
    expect(screen.getByLabelText("Current URL")).toHaveTextContent("attendance_view=awaiting_review");
  });

  it("shows future automation separately without asking for review or claiming finality", async () => {
    vi.mocked(getActivityRegisters).mockResolvedValue({ ...page(), total: 1, total_pages: 1,
      counts: { all: 1, needs_recording: 0, awaiting_review: 0, automatic_pending: 1, upcoming: 0, completed: 0, cancelled: 0 },
      registers: [{ ...item(1), state: "submitted", queue_category: "automatic_pending",
        finalization: { state: "automatic_pending", reason: "scheduled", scheduled_at: "2026-10-20T12:10:00Z" } }] });
    show();
    expect(await screen.findByRole("region", { name: "Automatic pending" })).toBeVisible();
    expect(screen.getByText(/Automatic finalization scheduled/)).toBeVisible();
    expect(screen.queryByRole("region", { name: "Final", exact: true })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Awaiting review" })).not.toBeInTheDocument();
    expect(document.querySelector(".attendance-queue-summary")).not.toHaveTextContent("awaiting review");
  });
});
