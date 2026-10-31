import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { DiningHistoryView } from "./DiningPrimitives";
afterEach(cleanup);
describe("native Dining receipt presentation", () => {
  it("renders actual service receipt date/reason even when the raw service row has no action column", async () => { render(<DiningHistoryView timezone="Asia/Kolkata" entries={[{ id: "service-save", actor_label: "Meera Shah", recorded_at: "2026-10-24T06:30:00Z", reason: "Counter moved" }]} />); await userEvent.click(screen.getByText("History")); expect(screen.getByText("Service saved")).toBeVisible(); expect(screen.getByText(/Meera Shah · 24 Oct 2026/)).toBeVisible(); expect(screen.getByText("Counter moved")).toBeVisible(); });
  it("does not fabricate a zero observation from publication but retains an explicitly counted zero", async () => { render(<DiningHistoryView timezone="UTC" entries={[{ id: "pub", action: "published", actor_label: "Meera Shah", recorded_at: "2026-10-24T06:30:00Z", count_total: 0 }, { id: "count", action: "counted", actor_label: "Neha Patel", recorded_at: "2026-10-24T07:00:00Z", observed_at: "2026-10-24T06:59:00Z", count_total: 0 }]} />); await userEvent.click(screen.getByText("History")); expect(screen.getAllByText("Cumulative total: 0")).toHaveLength(1); expect(screen.getByText("Published")).toBeVisible(); expect(screen.getByText("Cumulative serving total recorded")).toBeVisible(); });
});
