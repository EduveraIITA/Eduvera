import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FollowupInbox } from "./FollowupInbox";
import { getFollowup, getFollowups, type Followup } from "./api";

vi.mock("./api", () => ({ getFollowup: vi.fn(), getFollowups: vi.fn() }));
vi.mock("../auth/AuthContext", () => ({
  useOptionalAuth: () => ({ status: "authenticated", user: { id: "staff-1" } }),
}));
vi.mock("./FollowupThread", () => ({ FollowupThread: ({ id }: { id: string }) => <div>Thread {id}</div> }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("FollowupInbox attention destinations", () => {
  it("keeps conversation detail behind a compact task row", async () => {
    const item: Followup = {
      id: "followup-compact", student_id: "student-1", student_name: "Aarushi Mishra", owner_name: "Meera Kapoor",
      attendance_date: "2026-10-08", question: "Please confirm the recorded absence.", due_at: "2026-10-09T10:00:00.000Z",
      overdue: true, state: "in_review", revision: 1, outcome: null,
      updated_at: "2026-10-08T10:00:00.000Z", created_at: "2026-10-08T09:00:00.000Z",
    };
    vi.mocked(getFollowups).mockResolvedValue({ results: [item], next_cursor: null });

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <FollowupInbox context="staff" showHeading={false} />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("button", { name: "Open", pressed: true })).toBeVisible();
    const row = await screen.findByRole("button", { name: /Aarushi Mishra/ });
    expect(row).toHaveTextContent("School review");
    expect(row).toHaveTextContent("Overdue");
    expect(row).not.toHaveTextContent(item.question);
    expect(row).toHaveAttribute("aria-expanded", "false");
  });

  it("opens and focuses the exact follow-up selected by the attention link", async () => {
    const target: Followup = {
      id: "followup-1",
      student_id: "student-1",
      student_name: "Aarav Sharma",
      owner_name: "Kavita Mehta",
      attendance_date: "2026-10-12",
      question: "Please confirm the absence.",
      due_at: "2026-10-14T10:00:00.000Z",
      overdue: false,
      state: "awaiting_response",
      revision: 1,
      outcome: null,
      updated_at: "2026-10-12T10:00:00.000Z",
      created_at: "2026-10-12T09:00:00.000Z",
    };
    vi.mocked(getFollowup).mockResolvedValue({ ...target, can_resolve: true, entries: [], guardians: [] });
    vi.mocked(getFollowups).mockResolvedValue({
      results: [target],
      next_cursor: null,
    });

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <FollowupInbox context="staff" initialFollowupId="followup-1" />
      </QueryClientProvider>,
    );

    const row = await screen.findByRole("button", { name: /Aarav Sharma/ });
    expect(row).toHaveAttribute("aria-expanded", "true");
    expect(row.closest("article")).toHaveClass("is-attention-target");
    expect(screen.getByText("Thread followup-1")).toBeVisible();
    await waitFor(() => expect(row).toHaveFocus());
  });

  it("fetches and focuses a selected follow-up that is not on the first page", async () => {
    const target = {
      id: "followup-26", student_id: "student-1", student_name: "Ananya Iyer", owner_name: "Kavita Mehta",
      attendance_date: "2026-09-12", question: "Please confirm the late arrival.", due_at: "2026-10-14T10:00:00.000Z",
      overdue: true, state: "awaiting_response" as const, revision: 2, outcome: null,
      updated_at: "2026-10-12T10:00:00.000Z", created_at: "2026-09-12T09:00:00.000Z",
    };
    vi.mocked(getFollowups).mockResolvedValue({ results: [], next_cursor: "page-2" });
    vi.mocked(getFollowup).mockResolvedValue({ ...target, can_resolve: true, entries: [], guardians: [] });

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <FollowupInbox context="staff" initialFollowupId="followup-26" />
      </QueryClientProvider>,
    );

    const row = await screen.findByRole("button", { name: /Ananya Iyer/ });
    expect(getFollowup).toHaveBeenCalledWith("followup-26", "staff");
    expect(row).toHaveAttribute("aria-expanded", "true");
    expect(row.closest("article")).toHaveClass("is-attention-target");
    await waitFor(() => expect(row).toHaveFocus());
  });

  it("does not silently hide a selected follow-up when its exact record cannot be loaded", async () => {
    vi.mocked(getFollowups).mockRejectedValue(new Error("offline"));
    vi.mocked(getFollowup).mockRejectedValue(new Error("offline"));

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <FollowupInbox context="guardian" initialFollowupId="followup-stale" hideWithoutOpenFollowups />
      </QueryClientProvider>,
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("This follow-up could not be opened.");
    expect(alert).toHaveTextContent("may no longer be available");
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
  });
});
