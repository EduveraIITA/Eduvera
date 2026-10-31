import { describe, expect, it } from "vitest";
import { decodeChatMessageCursor, encodeChatMessageCursor } from "../src/chat/chat-message-cursor.js";

const position = { conversation_id: "10000000-0000-4000-8000-000000000001", namespace_id: "live:20000000-0000-4000-8000-000000000001", created_at: "2026-10-20T10:00:00.123456Z", id: "30000000-0000-4000-8000-000000000001" };
const scope = { conversation_id: position.conversation_id, namespace_id: position.namespace_id };
const token = (value: unknown) => "message-page-v1." + Buffer.from(JSON.stringify(value)).toString("base64url");

describe("scoped stable message cursor", () => {
  it("retains the exact PostgreSQL timestamp and UUID position", () => {
    expect(decodeChatMessageCursor(encodeChatMessageCursor(position), scope)).toEqual({ version: 1, ...position });
  });
  it.each([undefined, "", "not-a-cursor", "message-page-v1.==", "message-page-v1.a", "message-page-v1." + "a".repeat(769), ["cursor"]])("rejects malformed cursor %#", (value) => {
    expect(() => decodeChatMessageCursor(value, scope)).toThrow("Invalid message cursor");
  });
  it.each([
    { version: 2, ...position },
    { version: 1, ...position, created_at: "2026-02-30T10:00:00.123456Z" },
    { version: 1, ...position, created_at: "2026-10-20T10:00:00.123Z" },
    { version: 1, ...position, id: "bad-id" },
    { version: 1, ...position, extra: "not allowed" },
  ])("rejects invalid strict payload %#", (value) => {
    expect(() => decodeChatMessageCursor(token(value), scope)).toThrow("Invalid message cursor");
  });
  it("does not reuse a position from a different conversation or execution namespace", () => {
    const cursor = encodeChatMessageCursor(position);
    expect(() => decodeChatMessageCursor(cursor, { ...scope, conversation_id: "10000000-0000-4000-8000-000000000002" })).toThrow("Invalid message cursor");
    expect(() => decodeChatMessageCursor(cursor, { ...scope, namespace_id: "scenario:20000000-0000-4000-8000-000000000001:run:30000000-0000-4000-8000-000000000001" })).toThrow("Invalid message cursor");
  });
});
