import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from "kysely";
import { afterAll, describe, expect, it } from "vitest";
import { chatConversationProjectionQuery } from "../src/chat/chat.service.js";

const userId = "11111111-1111-4111-8111-111111111111";
const database = new Kysely<Record<string, never>>({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (db) => new PostgresIntrospector(db),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  },
});

afterAll(async () => database.destroy());

function normalizedSql(
  mode: "list" | "attention" | "detail",
  scope: { conversationId?: string; studentId?: string } = {},
): string {
  return chatConversationProjectionQuery(userId, mode, scope)
    .compile(database)
    .sql.replaceAll(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

describe("chat attention conversation projection", () => {
  it("does not hide an older unread conversation behind the 100 most recent conversations", () => {
    const query = normalizedSql("attention");

    expect(query).toContain("exists ( select 1 from chat_messages unread_filter");
    expect(query).toContain("unread_filter.created_at>coalesce(cp.last_read_at, cp.joined_at)");
    expect(query).not.toContain("limit 100");
  });

  it("keeps the ordinary conversation list capped at 100", () => {
    const query = normalizedSql("list");

    expect(query).toContain("order by coalesce(last_message.created_at, c.created_at) desc limit 100");
    expect(query).not.toContain("unread_filter");
  });

  it("delegates active participation and current role scope to the canonical database policy", () => {
    const query = normalizedSql("attention");

    expect(query).toContain("cp.user_id=$");
    expect(query).toContain("cp.is_active");
    expect(query).toContain("membership.user_id=$");
    expect(query).toContain("membership.is_active");
    expect(query).toContain("chat_actor_is_current_participant(c.school_id,$");
    expect(query).toContain("'messages.view',c.id)");
  });

  it("loads one exact conversation without applying the 100-row list cap", () => {
    const query = normalizedSql("detail", {
      conversationId: "22222222-2222-4222-8222-222222222222",
    });

    expect(query).toContain("and c.id=$");
    expect(query).not.toContain("limit 100");
    expect(query).toContain("cp.participant_role");
    expect(query).toContain("as can_post");
    expect(query).toContain("cp.user_id=$");
    expect(query).toContain("chat_actor_is_current_participant(c.school_id,$");
  });

  it("uses the selected child only as an additional exact-link filter", () => {
    const query = normalizedSql("detail", {
      conversationId: "22222222-2222-4222-8222-222222222222",
      studentId: "33333333-3333-4333-8333-333333333333",
    });

    expect(query).toContain("c.context_student_id is null or c.context_student_id=$");
    expect(query).toContain("chat_actor_is_current_participant(c.school_id,$");
    expect(query).not.toContain("selected_relationship");
  });
});
