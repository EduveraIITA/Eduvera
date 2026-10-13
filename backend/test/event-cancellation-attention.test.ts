import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mapNotificationAttention } from "../src/attention/notification-attention.service.js";

const migration = readFileSync(
  join(process.cwd(), "migrations", "076_cross_portal_event_cancellation_attention.sql"),
  "utf8",
);
const campusEvents = readFileSync(
  join(process.cwd(), "src", "campus-events", "campus-events.service.ts"),
  "utf8",
);
const eventMaterializer = readFileSync(
  join(process.cwd(), "src", "school", "school-event.service.ts"),
  "utf8",
);
const attentionProjection = readFileSync(
  join(process.cwd(), "src", "attention", "notification-attention.service.ts"),
  "utf8",
);

const row = {
  id: "10000000-0000-4000-a000-000000000001",
  link: "/teacher/events/20000000-0000-4000-a000-000000000002?focus=status&event_revision=4",
  title: "Discovery picnic cancelled",
  body: "Transport is unavailable.",
  read_at: null,
  created_at: "2026-10-13T10:00:00.000Z",
  attention_module: "events" as const,
  attention_source_kind: "event_cancellation" as const,
  attention_source_id: "20000000-0000-4000-a000-000000000002",
  attention_source_revision: 4,
  attention_student_id: null,
  attention_class_section_id: null,
  source_date: null,
  aggregate_id: null,
  subject_label: null,
};

describe("cross-portal event cancellation attention", () => {
  it("keeps routine event changes out and types only the cancellation transition", () => {
    expect(campusEvents).toContain('...(operation === "cancel" ? {');
    expect(campusEvents).toContain('attention_source_kind: "event_cancellation"');
    expect(campusEvents).toContain("staff_link: `/teacher/events/${event.id}?focus=status&event_revision=${updated.revision}`");
    expect(campusEvents).toContain("admin_link: `/principal/events/${event.id}?focus=status&event_revision=${updated.revision}`");
    expect(campusEvents).toContain('attention_topic_key: `event-cancellation:${event.id}`');
  });

  it("allows family, assigned-teacher and principal cancellation contracts with the right subject shape", () => {
    expect(migration).toContain("WHEN 'event_cancellation' THEN attention_module='events'");
    expect(migration).toContain("attention_portal='parent' AND attention_student_id IS NOT NULL");
    expect(migration).toContain("attention_portal IN ('teacher','principal') AND attention_student_id IS NULL");
    expect(eventMaterializer).toContain("WHEN 'event_cancellation' THEN role_context.portal IN ('parent','teacher','principal')");
    expect(eventMaterializer).toContain("role_context.portal IN ('teacher','principal')");
  });

  it("rechecks the exact cancelled revision and live assignment before every staff read", () => {
    for (const source of [migration, attentionProjection]) {
      expect(source).toContain("event.status='cancelled'");
      expect(source).toContain("event.revision=notification.attention_source_revision");
      expect(source).toContain("binding.context_kind='event'");
      expect(source).toContain("binding.scope_id=event.id");
      expect(source).toContain("binding.role_active");
      expect(source).toContain("'events.view'=ANY(binding.permissions)");
    }
    expect(migration).toContain("membership.is_active");
    expect(migration).toContain("account.is_active");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION notification_is_currently_visible(");
    expect(migration).toContain("IF notification_attention THEN");
    expect(migration).toContain("RETURN notification_attention_is_currently_authorized(");
    expect(migration).toContain("RETURN notification_event_is_currently_visible(notification_event::uuid,actor)");
  });

  it("backfills only authoritative retained cancellation events, never notification copy", () => {
    expect(migration).toContain("source.event_type='campus_event.updated'");
    expect(migration).toContain("source.payload->>'change_kind'='cancelled'");
    expect(migration).toContain("event.revision=CASE");
    expect(migration).not.toMatch(/notification\.(title|body)\s*(=|LIKE|~)/);
  });

  it.each([
    ["teacher", row.link],
    ["principal", row.link.replace("/teacher/", "/principal/")],
  ] as const)("preserves the producer-owned exact %s destination", (portal, link) => {
    const item = mapNotificationAttention({
      portal,
      schoolId: "30000000-0000-4000-a000-000000000003",
    }, { ...row, link });

    expect(item).toMatchObject({
      module: "events",
      source_kind: "event_cancellation",
      source_id: row.attention_source_id,
      href: `${link}&attention_notification_id=${row.id}`,
    });
  });
});
