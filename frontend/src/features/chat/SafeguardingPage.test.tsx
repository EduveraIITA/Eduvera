import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { ChatReport, ChatReportQueue } from "./api";
import { PrincipalSafeguardingRoute } from "./SafeguardingPage";

const api = vi.hoisted(() => ({
  getChatReport: vi.fn(),
  getChatReports: vi.fn(),
  getChatReportReviewers: vi.fn(),
  updateChatReport: vi.fn(),
}));

vi.mock("./api", () => api);
vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({
    memberships: [{ role: "admin", school_id: "school-1", school_name: "Cambridge International School" }],
  }),
}));
vi.mock("../restricted-care/RestrictedCarePage", () => ({
  RestrictedCarePage: ({ messageReports }: { messageReports?: ReactNode }) => <>{messageReports}</>,
}));

const exactReport: ChatReport = {
  id: "report-101",
  message_id: "message-101",
  reported_by: "reporter-1",
  reason: "Safety concern",
  status: "open",
  assigned_to: null,
  reviewed_by: null,
  resolution_note: "",
  action_taken: "none",
  created_at: "2026-10-08T10:00:00Z",
  updated_at: "2026-10-08T10:00:00Z",
  resolved_at: null,
  conversation_id: "conversation-1",
  conversation_title: "Class 7A",
  conversation_kind: "group",
  group_type: null,
  message_body: "Exact safeguarding detail",
  message_created_at: "2026-10-08T09:00:00Z",
  sender_id: "student-1",
  sender_name: "Older report sender",
  reporter_name: "Teacher",
  assignee_name: null,
  reviewer_role: "admin",
  can_assign: true,
  context_messages: [],
};

const emptyQueue: ChatReportQueue = {
  results: [],
  summary: { open: 0, under_review: 0, resolved: 0, dismissed: 0 },
};

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  api.getChatReportReviewers.mockResolvedValue({ results: [] });
  api.updateChatReport.mockResolvedValue(exactReport);
});

describe("focused safeguarding report loading", () => {
  it("opens the exact authorised report without waiting for the bounded queue", async () => {
    let resolveQueue!: (queue: ChatReportQueue) => void;
    api.getChatReports.mockReturnValue(new Promise<ChatReportQueue>((resolve) => { resolveQueue = resolve; }));
    api.getChatReport.mockResolvedValue(exactReport);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/principal/safeguarding?section=message_reports&report=report-101"]}>
          <PrincipalSafeguardingRoute />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Older report sender")).toBeVisible();
    expect(screen.getByText(/Exact safeguarding detail/)).toBeVisible();
    expect(api.getChatReport).toHaveBeenCalledWith("report-101");

    act(() => { resolveQueue(emptyQueue); });
    client.clear();
  });
});
