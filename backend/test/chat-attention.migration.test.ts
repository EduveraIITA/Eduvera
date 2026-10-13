import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migration = await readFile(
  new URL("../migrations/063_chat_attention_events.sql", import.meta.url),
  "utf8",
);

describe("chat attention realtime authorization", () => {
  it("rechecks active conversation participation and school membership", () => {
    expect(migration).toContain("event_name='chat.updated'");
    expect(migration).toContain("participant.is_active");
    expect(migration).toContain("membership.is_active");
    expect(migration).toContain("conversation.id::text=event_payload->>'conversation_id'");
    expect(migration).toContain("event_user_is_authorized_before_chat_attention(");
  });

  it("uses calculated staff conversation access during replay", () => {
    expect(migration).toContain("staff_has_conversation_permission(");
    expect(migration).toContain("'messages.view'");
  });
});
