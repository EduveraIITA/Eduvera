import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../../lib/api";
import { CategoryOperatingRules } from "./CategoryOperatingRules";

vi.mock("../../lib/api", () => ({ apiFetch: vi.fn() }));

const eventRules = {
  category: "events" as const,
  workflow: {
    revision: 4,
    attendance_submission_cutoff: "10:30",
    event_entry_hours_before: 2,
    event_staff_hours_after: 24,
    journey_lead_minutes: 30,
    message_edit_minutes: 2,
    message_attachment_mb: 10,
  },
  domain: { observation_hours_before: 2, observation_hours_after: 4, revision: 3 },
};

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("category operating rules", () => {
  it("saves the complete event category through one revision-checked command", async () => {
    vi.mocked(apiFetch).mockResolvedValue(eventRules);
    const dirty = vi.fn();
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CategoryOperatingRules schoolId="school-1" category="events" onDirtyChange={dirty}/>
    </QueryClientProvider>);

    fireEvent.change(await screen.findByLabelText("Observation after session (hours)"), { target: { value: "8" } });
    expect(dirty).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(
      "/api/v1/operating-rules/school-1/categories/events",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          expected_workflow_revision: 4,
          expected_domain_revision: 3,
          event_entry_hours_before: 2,
          event_staff_hours_after: 24,
          observation_hours_before: 2,
          observation_hours_after: 8,
        }),
      }),
    ));
    expect(dirty).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole("status")).toHaveTextContent("Operating rules saved.");
  });

  it("uses the one category writer and explains hours without advertising inactive retention", async () => {
    const rules = { ...eventRules, category: "messages", domain: {
      revision: 2, timezone: "Asia/Kolkata", communication_start: "22:00", communication_end: "06:00",
      student_teacher_direct_enabled: true, guardian_teacher_direct_enabled: false,
      student_group_replies: true, guardian_group_replies: false, attachments_enabled: true,
      enforce_communication_hours: true, retention_days: 455,
    } };
    vi.mocked(apiFetch).mockResolvedValue(rules);
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CategoryOperatingRules schoolId="school-1" category="messages" onDirtyChange={vi.fn()}/>
    </QueryClientProvider>);
    await screen.findByLabelText("Communication starts");
    expect(screen.queryByLabelText("Retention (days)")).not.toBeInTheDocument();
    expect(screen.getByText(/Times use Asia\/Kolkata/)).toHaveTextContent("Overnight ranges cross midnight");
    expect(screen.getByText("Automatic message deletion is not enabled.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(
      "/api/v1/operating-rules/school-1/categories/messages", expect.objectContaining({ method: "POST", body: JSON.stringify({
        expected_workflow_revision: 4, expected_domain_revision: 2,
        message_edit_minutes: 2, message_attachment_mb: 10,
        student_teacher_direct_enabled: true, guardian_teacher_direct_enabled: false,
        student_group_replies: true, guardian_group_replies: false, attachments_enabled: true,
        enforce_communication_hours: true, communication_start: "22:00", communication_end: "06:00",
      }) }),
    ));
    expect(vi.mocked(apiFetch).mock.calls.some(([, options]) => options?.method === "PATCH")).toBe(false);
  });

  it("keeps unsaved input through a changed revision and failed background refresh", async () => {
    vi.mocked(apiFetch).mockResolvedValue(eventRules);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const dirty = vi.fn();
    render(<QueryClientProvider client={client}>
      <CategoryOperatingRules schoolId="school-1" category="events" onDirtyChange={dirty}/>
    </QueryClientProvider>);
    fireEvent.change(await screen.findByLabelText("Observation after session (hours)"), { target: { value: "8" } });
    const changed = { ...eventRules, workflow: { ...eventRules.workflow, revision: 5 }, domain: { ...eventRules.domain, revision: 4, observation_hours_after: 12 } };
    void act(() => { client.setQueryData(["operating-rules", "school-1", "events"], changed); });
    expect(await screen.findByText(/Rules changed elsewhere/)).toBeInTheDocument();
    expect(screen.getByLabelText("Observation after session (hours)")).toHaveValue(8);
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error("Offline"));
    await act(() => client.refetchQueries({ queryKey: ["operating-rules", "school-1", "events"] }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your edits are kept");
    expect(screen.getByLabelText("Observation after session (hours)")).toHaveValue(8);
    vi.mocked(apiFetch).mockResolvedValue(changed);
    fireEvent.click(screen.getByRole("button", { name: "Discard edits and reload" }));
    await waitFor(() => expect(screen.getByLabelText("Observation after session (hours)")).toHaveValue(12));
    expect(dirty).toHaveBeenLastCalledWith(false);
  });

  it("never carries another campus's unsaved rules into the selected campus", async () => {
    vi.mocked(apiFetch).mockResolvedValue(eventRules);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = (schoolId: string) => <QueryClientProvider client={client}>
      <CategoryOperatingRules schoolId={schoolId} category="events" onDirtyChange={vi.fn()}/>
    </QueryClientProvider>;
    const mounted = render(view("school-1"));
    fireEvent.change(await screen.findByLabelText("Observation after session (hours)"), { target: { value: "8" } });
    mounted.rerender(view("school-2"));
    expect(await screen.findByLabelText("Observation after session (hours)")).toHaveValue(4);
    expect(screen.queryByRole("button", { name: "Discard edits and reload" })).not.toBeInTheDocument();
  });
});
