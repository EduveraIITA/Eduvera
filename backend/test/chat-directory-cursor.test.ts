import { describe, expect, it } from "vitest";
import { decodeChatDirectoryCursor, encodeChatDirectoryCursor } from "../src/chat/chat-directory-cursor.js";

const scope = { user_id:"11111111-1111-4111-8111-111111111111", namespace_id:"live:school-a", search:"aarav", student_id:null };
const position = { ...scope, activity_at:"2026-10-20T10:00:00.123456Z", id:"22222222-2222-4222-8222-222222222222" };
describe("scoped directory page cursor", () => {
  it("preserves the exact microsecond/tie position", () => {
    expect(decodeChatDirectoryCursor(encodeChatDirectoryCursor(position),scope)).toMatchObject(position);
  });
  it.each([null,"",[],"conversation-page-v1.???","message-page-v1.abc","conversation-page-v1."+"a".repeat(1200)])("rejects malformed positions %s", value => {
    expect(()=>decodeChatDirectoryCursor(value,scope)).toThrow("Invalid conversation cursor");
  });
  it.each([{user_id:"33333333-3333-4333-8333-333333333333"},{namespace_id:"scenario:second:run:second"},{search:"other"},{student_id:"44444444-4444-4444-8444-444444444444"}])("does not borrow another actor/world/filter/child frontier %j", other => {
    expect(()=>decodeChatDirectoryCursor(encodeChatDirectoryCursor(position),{...scope,...other})).toThrow("Invalid conversation cursor");
  });
});
