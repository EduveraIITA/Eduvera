import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "migrations", "072_durable_calendar_attention_revision.sql"),
  "utf8",
);
const schoolService = readFileSync(
  join(process.cwd(), "src", "school", "school.service.ts"),
  "utf8",
);
const attentionService = readFileSync(
  join(process.cwd(), "src", "attention", "notification-attention.service.ts"),
  "utf8",
);

describe("durable calendar attention revisions", () => {
  it("keeps the current revision outside the expiring realtime outbox", () => {
    expect(migration).toContain("CREATE TABLE calendar_attention_topics");
    expect(migration).toContain("PRIMARY KEY (school_id,date)");
    expect(migration).not.toMatch(/FROM event_outbox/);
    expect(migration).toContain("topic.revision=notification.attention_source_revision");
    expect(migration).toContain("topic.source_id=notification.attention_source_id");
  });

  it("increments the date topic atomically in the calendar mutation transaction", () => {
    const upserts = schoolService.match(/INSERT INTO calendar_attention_topics/g) ?? [];
    expect(upserts).toHaveLength(2);
    expect(schoolService).toContain("revision=calendar_attention_topics.revision + 1");
    expect(schoolService).not.toContain("SELECT (count(*) + 1)::int AS revision\n        FROM event_outbox");
    expect(schoolService).toContain('calendar_change_kind: "created"');
    expect(schoolService).toContain('calendar_change_kind: "removed"');
  });

  it("uses the durable topic for the attention projection too", () => {
    expect(attentionService).toContain("FROM calendar_attention_topics topic");
    expect(attentionService).toContain("topic.change_kind=COALESCE");
  });
});
