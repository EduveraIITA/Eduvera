import { beforeEach, describe, expect, it, vi } from "vitest";
import { createChatConversation, createChatGroup, getChatConversation, getChatConversationDirectory, getChatConversations, getChatMessages, getChatReport, getChatRecipients } from "./api";

const apiFetchMock = vi.hoisted(() => vi.fn());
vi.mock("../../lib/api", () => ({ apiFetch: apiFetchMock }));

beforeEach(() => apiFetchMock.mockReset());

describe("exact chat conversation API", () => {
  it("keeps the legacy no-query list contract available", async () => {
    apiFetchMock.mockResolvedValue({results:[]});
    await getChatConversations();
    expect(apiFetchMock).toHaveBeenCalledWith("/api/v1/chat/conversations/");
  });
  it("keeps direct recipients separate from governed group member selection", async () => {
    apiFetchMock.mockResolvedValue({ results: [] });
    await getChatRecipients("child-1");
    expect(apiFetchMock).toHaveBeenLastCalledWith("/api/v1/chat/recipients/?student_id=child-1&purpose=direct");
    await getChatRecipients("child-1", "group");
    expect(apiFetchMock).toHaveBeenLastCalledWith("/api/v1/chat/recipients/?student_id=child-1&purpose=group");
  });
  it("searches and pages the full authorized directory while retaining selected child scope", async () => {
    apiFetchMock.mockResolvedValue({ results: [], has_more: false, next_cursor: null });
    await getChatConversationDirectory({ search: "Aarav", cursor: "opaque+page", studentId: "child-1" });
    expect(apiFetchMock).toHaveBeenCalledWith("/api/v1/chat/conversations/?pagination=cursor&q=Aarav&cursor=opaque%2Bpage&student_id=child-1");
  });
  it("passes the opaque server cursor unchanged instead of deriving a timestamp boundary", async () => {
    apiFetchMock.mockResolvedValue({ results: [], has_more: false, next_cursor: null });
    await getChatMessages("conversation-101", "opaque+cursor");
    expect(apiFetchMock).toHaveBeenCalledWith("/api/v1/chat/conversations/conversation-101/messages/?cursor=opaque%2Bcursor");
  });
  it("passes an exact retained frontier and cancellation signal for an anchored refresh", async () => {
    const signal = new AbortController().signal;
    apiFetchMock.mockResolvedValue({ results: [], has_more: false, reached_through: true });
    await getChatMessages("conversation-101", "upper+cursor", { throughCursor: "lower+cursor", signal });
    expect(apiFetchMock).toHaveBeenCalledWith("/api/v1/chat/conversations/conversation-101/messages/?cursor=upper%2Bcursor&through_cursor=lower%2Bcursor", { signal });
  });
  it("sends the selected parent child scope", async () => {
    apiFetchMock.mockResolvedValue({});

    await getChatConversation("conversation-101", "child-1");

    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/v1/chat/conversations/conversation-101/?student_id=child-1",
    );
  });

  it("keeps ordinary notification deep links participant-scoped when no child is selected", async () => {
    apiFetchMock.mockResolvedValue({});

    await getChatConversation("conversation-101");

    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/v1/chat/conversations/conversation-101/",
    );
  });

  it("binds direct creation to the selected school and child", async () => {
    apiFetchMock.mockResolvedValue({});

    await createChatConversation("recipient-1", "school-1", "child-1");

    expect(apiFetchMock).toHaveBeenCalledWith("/api/v1/chat/conversations/", {
      method: "POST",
      body: JSON.stringify({
        school_id: "school-1",
        recipient_id: "recipient-1",
        student_id: "child-1",
      }),
    });
  });

  it("requires an explicit school when creating a group", async () => {
    apiFetchMock.mockResolvedValue({});

    await createChatGroup({
      school_id: "school-1",
      title: "Trip group",
      group_type: "activity",
      member_ids: ["member-1"],
    });

    expect(apiFetchMock).toHaveBeenCalledWith("/api/v1/chat/groups/", {
      method: "POST",
      body: JSON.stringify({
        school_id: "school-1",
        title: "Trip group",
        group_type: "activity",
        member_ids: ["member-1"],
      }),
    });
  });

  it("loads one exact safeguarding report independently of the bounded queue", async () => {
    apiFetchMock.mockResolvedValue({});

    await getChatReport("report/101");

    expect(apiFetchMock).toHaveBeenCalledWith("/api/v1/chat/reports/report%2F101/");
  });
});
