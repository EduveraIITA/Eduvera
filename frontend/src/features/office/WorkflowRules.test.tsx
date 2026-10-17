import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../../lib/api";
import { WorkflowRules } from "./WorkflowRules";
vi.mock("../../lib/api", () => ({ apiFetch: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const rules = { revision: 4, attendance_submission_cutoff: "10:30", attendance_academic_mode: "scheduled_session" as const, attendance_campus_mode: "none" as const, attendance_academic_channels: ["staff_roll_call" as const], attendance_campus_channels: ["staff_entry" as const], attendance_self_check_in_mode: "staff_review" as const, attendance_session_open_before_minutes: 10, attendance_session_close_after_minutes: 30, attendance_finalization_mode: "automatic" as const, attendance_auto_finalize_minutes: 30, attendance_overdue_reminder_minutes: 15, attendance_overdue_escalation_minutes: 60, event_entry_hours_before: 2, event_staff_hours_after: 24, journey_lead_minutes: 30, message_edit_minutes: 2, message_attachment_mb: 10 };
function show(onDirtyChange?: (dirty: boolean) => void, category: "attendance" | "departure" = "departure") { render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><WorkflowRules schoolId="school-1" category={category} onDirtyChange={onDirtyChange}/></QueryClientProvider>); }
describe("Workflow rules", () => {
  it("saves the selected setting with revision and preserves other domain values", async () => {
    vi.mocked(apiFetch).mockResolvedValue(rules); show();
    fireEvent.change(await screen.findByLabelText("Open boarding before departure (minutes)"), { target: { value: "45" } });
    fireEvent.click(screen.getByRole("button", { name: "Save rules" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/v1/operating-rules/school-1", expect.objectContaining({ method: "POST", body: JSON.stringify({ ...rules, revision: undefined, journey_lead_minutes: 45, expected_revision: 4 }, (_key: string, value: unknown): unknown => value === undefined ? undefined : value) })));
    expect(await screen.findByRole("status")).toHaveTextContent("Operating rules saved.");
  });
  it("keeps navigation guarded until the changed category has saved", async () => {
    const onDirtyChange = vi.fn();
    vi.mocked(apiFetch).mockResolvedValue(rules); show(onDirtyChange);
    fireEvent.change(await screen.findByLabelText("Open boarding before departure (minutes)"), { target: { value: "45" } });
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "Save rules" }));
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
  });
  it("keeps a conflict visible without silently retrying a stale change", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(rules).mockRejectedValueOnce(new Error("Operating rules changed. Reload before saving.")); show();
    fireEvent.click(await screen.findByRole("button", { name: "Save rules" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Operating rules changed");
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });
  it("switches between automatic finalization and principal review", async () => {
    vi.mocked(apiFetch).mockResolvedValue(rules); show(undefined, "attendance");
    const mode = await screen.findByLabelText("After submission");
    expect(screen.getByLabelText("Finalization delay (minutes)")).toHaveValue(30);
    fireEvent.change(mode, { target: { value: "principal_review" } });
    expect(screen.queryByLabelText("Finalization delay (minutes)")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save rules" }));
    await waitFor(() => expect(vi.mocked(apiFetch).mock.calls.some(([, options]) => options?.method === "POST")).toBe(true));
    const [, request] = vi.mocked(apiFetch).mock.calls.find(([, options]) => options?.method === "POST")!;
    expect(request?.method).toBe("POST");
    expect(typeof request?.body).toBe("string");
    const payload: unknown = JSON.parse(request!.body as string);
    expect(payload).toMatchObject({
      attendance_finalization_mode: "principal_review",
      attendance_auto_finalize_minutes: 30,
    });
  });
  it("saves teacher-first reminder and escalation timing", async () => {
    vi.mocked(apiFetch).mockResolvedValue(rules); show(undefined, "attendance");
    fireEvent.change(await screen.findByLabelText("First reminder after deadline (minutes)"), { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText("Escalate after deadline (minutes)"), { target: { value: "90" } });
    fireEvent.click(screen.getByRole("button", { name: "Save rules" }));
    await waitFor(() => expect(vi.mocked(apiFetch).mock.calls.some(([, options]) => options?.method === "POST")).toBe(true));
    const [, request] = vi.mocked(apiFetch).mock.calls.find(([, options]) => options?.method === "POST")!;
    expect(JSON.parse(request!.body as string)).toMatchObject({
      attendance_overdue_reminder_minutes: 20,
      attendance_overdue_escalation_minutes: 90,
    });
  });
});
