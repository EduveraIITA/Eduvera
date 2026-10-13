import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NoticeListPage } from "./NoticeListPage";
import { getNotices, type NoticeSummary } from "./api";

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ memberships: [{ role: "guardian", school_id: "school-1" }] }),
}));
vi.mock("../auth/staffAccess", () => ({ currentStaffMembership: () => undefined, hasStaffPermission: () => false }));
vi.mock("./NoticeShell", () => ({ NoticeShell: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("./api", async (original) => {
  const actual = await original<typeof import("./api")>();
  return { ...actual, getNotices: vi.fn() };
});

const notice = (overrides: Partial<NoticeSummary> = {}): NoticeSummary => ({
  id: "notice-1", title: "Tomorrow's uniform", body: "Please use the winter uniform.", response_mode: "acknowledgement",
  response_options: [], priority: "normal", due_at: "2026-10-15T12:00:00.000Z", status: "published", revision: 2,
  published_at: "2026-10-13T06:00:00.000Z", cancelled_at: null, cancellation_reason: "", created_at: "2026-10-13T05:00:00.000Z",
  recipient_id: "recipient-1", student_id: "student-1", opened_at: null, responded_at: null, response_value: null,
  attention_reasons: ["unread", "response_required"],
  ...overrides,
});

function show(portal: "parent" | "principal", path: string) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[path]}><NoticeListPage portal={portal} /></MemoryRouter>
  </QueryClientProvider>);
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("notice attention drill-down", () => {
  it("marks the exact active-child notice as new and keeps its required action distinct", async () => {
    vi.mocked(getNotices).mockResolvedValue({ portal: "parent", school_id: "school-1", student_id: "student-1",
      attention: { total: 1, unread: 1, action_required: 1, exceptions: 0 }, results: [notice()] });
    show("parent", "/parent/notices?student_id=student-1");

    const row = await screen.findByRole("link", { name: "Tomorrow's uniform. New. Acknowledgement needed" });
    expect(row).toHaveAttribute("href", "/parent/notices/notice-1?student_id=student-1");
    expect(screen.getByText("New")).toBeVisible();
    expect(screen.getByText("Acknowledgement needed")).toBeVisible();
    expect(screen.getByRole("button", { name: "Needs attention 1" })).toBeVisible();
  });

  it("uses manager follow-up language instead of asking the publisher to respond", async () => {
    vi.mocked(getNotices).mockResolvedValue({ portal: "principal", school_id: "school-1", student_id: null,
      attention: { total: 1, unread: 0, action_required: 0, exceptions: 1 },
      results: [notice({ can_manage: true, opened_at: undefined, responded_at: undefined, recipient_count: 12, response_count: 9,
        pending_response_count: 3, delivery_exception_count: 1, attention_reasons: ["delivery_failed"] })] });
    show("principal", "/principal/notices");

    const row = await screen.findByRole("link", { name: "Tomorrow's uniform. Delivery issue" });
    expect(row).toHaveAttribute("href", "/principal/notices/notice-1?focus=attention");
    expect(screen.getByText("1 person needs follow-up")).toBeVisible();
  });
});
