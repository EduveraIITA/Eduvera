import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../../lib/api";
import { WorkflowRules } from "./WorkflowRules";
vi.mock("../../lib/api", () => ({ apiFetch: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const rules = { revision: 4, attendance_submission_cutoff: "10:30", event_entry_hours_before: 2, event_staff_hours_after: 24, journey_lead_minutes: 30, message_edit_minutes: 2, message_attachment_mb: 10 };
function show() { render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><WorkflowRules schoolId="school-1" category="departure"/></QueryClientProvider>); }
describe("Workflow rules", () => {
  it("saves the selected setting with revision and preserves other domain values", async () => {
    vi.mocked(apiFetch).mockResolvedValue(rules); show();
    fireEvent.change(await screen.findByLabelText("Open boarding before departure (minutes)"), { target: { value: "45" } });
    fireEvent.click(screen.getByRole("button", { name: "Save rules" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/v1/operating-rules/school-1", expect.objectContaining({ method: "POST", body: JSON.stringify({ attendance_submission_cutoff: "10:30", event_entry_hours_before: 2, event_staff_hours_after: 24, journey_lead_minutes: 45, message_edit_minutes: 2, message_attachment_mb: 10, expected_revision: 4 }) })));
    expect(await screen.findByRole("status")).toHaveTextContent("Operating rules saved.");
  });
  it("keeps a conflict visible without silently retrying a stale change", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(rules).mockRejectedValueOnce(new Error("Operating rules changed. Reload before saving.")); show();
    fireEvent.click(await screen.findByRole("button", { name: "Save rules" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Operating rules changed");
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });
});
