import { beforeEach, describe, expect, it, vi } from "vitest";
import { createChatConversation, createChatGroup, getChatConversation, getChatReport } from "./api";

const apiFetchMock = vi.hoisted(() => vi.fn());
vi.mock("../../lib/api", () => ({ apiFetch: apiFetchMock }));

beforeEach(() => apiFetchMock.mockReset());

describe("exact chat conversation API", () => {
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
