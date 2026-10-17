import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from "kysely";
import { afterAll, describe, expect, it } from "vitest";
import { notificationSchoolContextQuery } from "../src/school/school.service.js";

const database = new Kysely<Record<string, never>>({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (db) => new PostgresIntrospector(db),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  },
});
const chatService = readFileSync(join(process.cwd(), "src", "chat", "chat.service.ts"), "utf8");
const chatController = readFileSync(join(process.cwd(), "src", "chat", "chat.controller.ts"), "utf8");
const schoolService = readFileSync(join(process.cwd(), "src", "school", "school.service.ts"), "utf8");

afterAll(async () => database.destroy());

describe("cross-device user projection convergence", () => {
  it("commits a message edit, audit record and audience-scoped chat invalidation together", () => {
    const edit = chatService.slice(
      chatService.indexOf("async editMessage("),
      chatService.indexOf("async reportMessage("),
    );

    expect(chatController).toContain("request.body, request");
    expect(edit).toContain("this.db.transaction().execute");
    expect(edit).toContain(".forUpdate()");
    expect(edit).toContain('eventType: "chat.updated"');
    expect(edit).toContain('change_kind: "message_edited"');
    expect(edit).toContain('refresh: ["messages", "notifications", "attention"]');
    expect(edit).toContain("chat_actor_is_current_participant(");
    expect(edit).toContain('action: "chat.message.edited"');
    expect(edit).toContain("chat:message-edit:${messageId}:${edited.updated_at.toISOString()}");
  });

  it("derives legacy notification school context only from authoritative source records", () => {
    const query = notificationSchoolContextQuery("11111111-1111-4111-8111-111111111111")
      .compile(database).sql.replaceAll(/\s+/g, " ").toLowerCase();

    expect(query).toContain("notification.attention_school_id");
    expect(query).toContain("from event_outbox event");
    expect(query).toContain("from school_notice_recipients recipient");
    expect(query).toContain("from chat_message_reports report");
    expect(query).toContain("from chat_conversations conversation");
    expect(query).toContain("from assessment_publications publication");
    expect(query).toContain("from grading_report_batches batch");
    expect(query).toContain("from leave_requests request join students student");
    expect(query).toContain("from students student");
    expect(query).toContain("else null");
    expect(query).not.toContain("active_school_id");
    expect(query).not.toContain("metadata->>'school_id'");
  });

  it("emits a personal refresh after read only when source-backed school context resolves", () => {
    const acknowledgement = schoolService.slice(
      schoolService.indexOf("async markNotificationRead("),
      schoolService.indexOf("async parentHome("),
    );

    expect(acknowledgement).toContain("notificationSchoolId(tx, target.id)");
    expect(acknowledgement).toContain("if (schoolId)");
    expect(acknowledgement).toContain('eventType: "notification.created"');
    expect(acknowledgement).toContain("audienceUserIds: [user.id]");
    expect(acknowledgement).toContain('refresh: ["notifications", "attention"]');
    expect(acknowledgement).toContain("notification-read:${row.id}:${user.id}");
  });
});
