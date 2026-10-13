import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

afterEach(() => vi.clearAllMocks());

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
});
