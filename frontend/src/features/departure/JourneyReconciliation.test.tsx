import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { JourneyDetail } from "./api";
import { JourneyReconciliation } from "./JourneyReconciliation";

const data: JourneyDetail = {
  trip: {
    id: "trip-1", school_id: "school-1", route_id: "route-1", service_date: "2026-10-13",
    direction: "from_institution", service_pattern_id: null, service_pattern_label: null,
    scheduled_departure_time: "15:30:00", assigned_collector_user_id: "staff-1", backup_collector_user_id: null,
    collector_assignment_status: "accepted", assignment_note: "", state: "in_progress", revision: 2,
    route_name: "Castle Road", route_code: "CR", vehicle_label: "Bus 14", collector_name: "Kavita Mehta",
    backup_collector_name: null, roster_count: 1, boarded_count: 0, dropped_count: 0,
  },
  roster: [{
    student_id: "student-1", state: "expected", revision: 1, boarded_at: null, dropped_at: null,
    outcome_note: "", student_name: "Aarav Sharma", admission_number: "CIS-071", stop_id: "stop-1",
    stop_name: "Castle Gate", stop_sequence: 1, planned_time: "15:45:00",
  }],
  history: [], location: null, location_fresh: false, map: { tile_url: "", attribution: "" },
};

afterEach(cleanup);

describe("journey reconciliation attention destination", () => {
  it("opens and focuses the reconciliation controls without another click", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><JourneyReconciliation schoolId="school-1" data={data} focused /></QueryClientProvider>);

    const target = screen.getByRole("region", { name: "School review" });
    expect(target).toHaveClass("is-attention-target");
    expect(screen.getByLabelText("Learner")).toBeVisible();
    await waitFor(() => expect(target).toHaveFocus());
  });

  it.each(["completed", "cancelled"] as const)("explains a %s journey instead of dropping the focused destination", async state => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><JourneyReconciliation schoolId="school-1" data={{
      ...data,
      trip: { ...data.trip, state },
      roster: data.roster.map(rider => ({ ...rider, state: state === "completed" ? "not_riding" : rider.state })),
    }} focused /></QueryClientProvider>);

    const target = screen.getByRole("region", { name: "School review" });
    expect(target).toHaveClass("is-attention-target");
    expect(target).toHaveTextContent(`This journey is ${state}. No rider outcomes need review.`);
    await waitFor(() => expect(target).toHaveFocus());
  });
});
