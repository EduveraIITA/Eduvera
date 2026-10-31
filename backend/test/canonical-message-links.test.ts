import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { messageConversationsHref } from "../src/chat/chat-links.js";

const migration = await readFile(
  new URL("../migrations/142_canonical_message_notification_links.sql", import.meta.url),
  "utf8",
);
const chatService = await readFile(
  new URL("../src/chat/chat.service.ts", import.meta.url),
  "utf8",
);

describe("canonical responsibility-composed Messages links", () => {
  it("opens responsibility conversations without selecting a persona portal", () => {
    expect(messageConversationsHref()).toBe("/areas/messages/conversations");
    expect(messageConversationsHref({ conversationId: "conversation/1" })).toBe(
      "/areas/messages/conversations?conversation=conversation%2F1",
    );
  });

  it("retains an exact self or dependent relationship scope", () => {
    expect(messageConversationsHref({
      relationshipScope: "self",
      studentId: "student/1",
      conversationId: "conversation/1",
    })).toBe(
      "/areas/messages/conversations?scope=self&student_id=student%2F1&conversation=conversation%2F1",
    );
    expect(messageConversationsHref({
      relationshipScope: "dependent",
      studentId: "student/1",
      conversationId: "conversation/1",
    })).toBe(
      "/areas/messages/conversations?scope=dependent&student_id=student%2F1&conversation=conversation%2F1",
    );
  });

  it("does not emit a partial relationship context", () => {
    expect(messageConversationsHref({ relationshipScope: "dependent", conversationId: "conversation-1" }))
      .toBe("/areas/messages/conversations?conversation=conversation-1");
    expect(messageConversationsHref({ studentId: "student-1", conversationId: "conversation-1" }))
      .toBe("/areas/messages/conversations?conversation=conversation-1");
  });

  it("derives notification relationship scope from authoritative links rather than account role", () => {
    expect(chatService).toContain("relationship.school_id=${conversation.school_id}::uuid");
    expect(chatService).toContain("relationship.student_id=${conversation.context_student_id ?? null}::uuid");
    expect(chatService).not.toContain("portalForRole");
    expect(chatService).not.toMatch(/conversationLink\([^\n]*\.role/);
  });

  it("repairs retained conversation notifications and leaves authorization to current checks", () => {
    expect(migration).toContain("notification.metadata->>'notification_scope'='chat_conversation'");
    expect(migration).toContain("/areas/messages/conversations?scope=self");
    expect(migration).toContain("/areas/messages/conversations?scope=dependent");
    expect(migration).toContain("/areas/messages/conversations?conversation=");
    expect(migration).toContain("guardian_relationships relationship");
    expect(migration).not.toContain("recipient.role");
    expect(migration).not.toMatch(/\/(parent|student|teacher|principal)\/messages/);
  });
});
