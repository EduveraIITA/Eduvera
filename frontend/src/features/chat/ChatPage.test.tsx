import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatExperience, mergeSelectedConversation } from "./ChatPage";
import {
  getChatConversation,
  getChatConversations,
  getChatMessages,
  getChatPolicy,
  type ChatConversation,
} from "./api";

vi.mock("./api", async (original) => {
  const actual = await original<typeof import("./api")>();
  return {
    ...actual,
    createChatConversation: vi.fn(),
    createChatGroup: vi.fn(),
    editChatMessage: vi.fn(),
    getChatConversation: vi.fn(),
    getChatConversations: vi.fn(),
    getChatMessages: vi.fn(),
    getChatPolicy: vi.fn(),
    getChatRecipients: vi.fn(),
    markChatRead: vi.fn(),
    reportChatMessage: vi.fn(),
    sendChatMessage: vi.fn(),
    updateChatPolicy: vi.fn(),
  };
});

vi.mock("../auth/AuthContext", () => ({
  useOptionalAuth: () => ({ user: { display_name: "Pooja Sharma" } }),
}));

const selectedConversation: ChatConversation = {
  id: "conversation-101",
  school_id: "school-1",
  kind: "group",
  title: "Archived family thread",
  other_role: "staff",
  avatar_url: null,
  context_student_id: "child-1",
  student_name: "Aarav Sharma",
  last_message: "Please review the update.",
  last_message_at: "2026-10-01T08:00:00.000Z",
  unread_count: 1,
  group_type: "announcement",
  posting_mode: "moderators",
  participant_role: "member",
  member_count: 20,
  can_post: false,
};

function conversation(index: number): ChatConversation {
  return {
    ...selectedConversation,
    id: `conversation-${index}`,
    title: `Conversation ${index}`,
    context_student_id: null,
    student_name: null,
    posting_mode: "all",
    participant_role: "member",
    can_post: true,
  };
}

function show() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/parent/messages?conversation=conversation-101&student_id=child-1"]}>
        <ChatExperience portal="parent" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(getChatConversations).mockResolvedValue({
    results: Array.from({ length: 100 }, (_, index) => conversation(index)),
  });
  vi.mocked(getChatMessages).mockResolvedValue({ results: [], has_more: false });
  vi.mocked(getChatPolicy).mockResolvedValue({
    school_id: "school-1",
    student_teacher_direct_enabled: true,
    guardian_teacher_direct_enabled: true,
    student_group_replies: true,
    guardian_group_replies: true,
    attachments_enabled: true,
    enforce_communication_hours: false,
    communication_start: "08:00",
    communication_end: "18:00",
    retention_days: 455,
    privacy_notice_version: "1",
    can_manage: false,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("exact selected chat conversation", () => {
  it("merges a selected conversation outside the capped list and uses its posting permission", async () => {
    vi.mocked(getChatConversation).mockResolvedValue(selectedConversation);

    show();

    const selectedRow = await screen.findByRole("button", { name: /Archived family thread/ });
    expect(selectedRow).toHaveClass("is-active");
    expect(getChatConversation).toHaveBeenCalledWith("conversation-101", "child-1");
    expect(await screen.findByText("Posting is restricted")).toBeVisible();
    expect(screen.queryByPlaceholderText("Write a message…")).not.toBeInTheDocument();
    await waitFor(() => expect(getChatMessages).toHaveBeenCalledWith("conversation-101"));
  });

  it("keeps messages and the composer closed until exact metadata is authorized", async () => {
    let rejectDetail!: (reason: Error) => void;
    vi.mocked(getChatConversation).mockImplementation(() => new Promise((_resolve, reject) => {
      rejectDetail = reject;
    }));

    show();

    expect(await screen.findByText("Checking access and messaging settings")).toBeVisible();
    expect(screen.queryByPlaceholderText("Write a message…")).not.toBeInTheDocument();
    expect(getChatMessages).not.toHaveBeenCalled();

    act(() => rejectDetail(new Error("Conversation not found.")));

    expect(await screen.findByRole("heading", { name: "Conversation could not be opened" })).toBeVisible();
    expect(screen.queryByPlaceholderText("Write a message…")).not.toBeInTheDocument();
    expect(getChatMessages).not.toHaveBeenCalled();
  });

  it("replaces stale list metadata with the exact selected projection", () => {
    const stale = { ...selectedConversation, title: "Stale title", can_post: true };
    const merged = mergeSelectedConversation([conversation(1), stale], selectedConversation);

    expect(merged).toHaveLength(2);
    expect(merged[1]).toEqual(selectedConversation);
  });
});
