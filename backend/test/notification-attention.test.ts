import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mapNotificationAttention } from "../src/attention/notification-attention.service.js";
import { summarizeAttention } from "../src/attention/attention.service.js";
import { notificationAttentionDestinationMatches } from "../src/school/school.service.js";

const serviceSource = readFileSync(
  join(process.cwd(), "src", "attention", "notification-attention.service.ts"),
  "utf8",
);
const migration = readFileSync(
  join(process.cwd(), "migrations", "066_typed_notification_attention.sql"),
  "utf8",
);
const extendedMigration = readFileSync(
  join(process.cwd(), "migrations", "069_extended_typed_notification_attention.sql"),
  "utf8",
);
const authorizationMigration = readFileSync(
  join(process.cwd(), "migrations", "070_typed_notification_current_authorization.sql"),
  "utf8",
);
const calendarAuthorizationMigration = readFileSync(
  join(process.cwd(), "migrations", "071_calendar_notification_revision_authorization.sql"),
  "utf8",
);
const notificationVisibilityMigration = readFileSync(
  join(process.cwd(), "migrations", "073_notification_current_visibility.sql"),
  "utf8",
);
const departurePlanExceptionMigration = readFileSync(
  join(process.cwd(), "migrations", "078_departure_plan_exception_attention.sql"),
  "utf8",
);
const schoolServiceSource = readFileSync(
  join(process.cwd(), "src", "school", "school.service.ts"),
  "utf8",
);
const departureSource = readFileSync(
  join(process.cwd(), "src", "departure-coordination", "departure-coordination.service.ts"),
  "utf8",
);

const base = {
  id: "10000000-0000-4000-a000-000000000001",
  link: "/parent/results?student_id=30000000-0000-4000-a000-000000000003&assessment_id=50000000-0000-4000-a000-000000000005&publication_id=20000000-0000-4000-a000-000000000002",
  title: "Published update",
  body: "Open the record to review it.",
  read_at: null,
  created_at: "2026-10-13T10:00:00.000Z",
  attention_module: "results" as const,
  attention_source_kind: "assessment_publication" as const,
  attention_source_id: "20000000-0000-4000-a000-000000000002",
  attention_source_revision: 2,
  attention_student_id: "30000000-0000-4000-a000-000000000003",
  attention_class_section_id: "40000000-0000-4000-a000-000000000004",
  source_date: null,
  aggregate_id: "50000000-0000-4000-a000-000000000005",
  subject_label: "Aarav Sharma",
};

describe("typed notification attention", () => {
  it("accepts only the exact stored target and stable notification id", () => {
    const id = base.id;
    const destination = "/parent/attendance?student_id=child-1&date=2026-10-09&attendance_record_id=record-1&attendance_revision=2";
    expect(notificationAttentionDestinationMatches(
      id,
      destination,
      `${destination}&attention_notification_id=${id}`,
    )).toBe(true);
    expect(notificationAttentionDestinationMatches(
      id,
      destination,
      `/parent/attendance?student_id=child-1&date=2026-10-10&attendance_record_id=record-1&attendance_revision=2&attention_notification_id=${id}`,
    )).toBe(false);
    expect(notificationAttentionDestinationMatches(
      id,
      destination,
      `/parent/attendance?student_id=child-2&date=2026-10-09&attendance_record_id=record-1&attendance_revision=2&attention_notification_id=${id}`,
    )).toBe(false);
    expect(notificationAttentionDestinationMatches(id, destination, destination)).toBe(false);
    expect(notificationAttentionDestinationMatches(
      id,
      "/parent/attendance",
      `/parent/attendance?attention_notification_id=${id}`,
    )).toBe(false);
  });

  it("links an assessment publication to the exact child, assessment, publication and acknowledgement", () => {
    const item = mapNotificationAttention({
      portal: "parent",
      schoolId: "60000000-0000-4000-a000-000000000006",
      studentId: base.attention_student_id,
    }, base);

    expect(item).toMatchObject({
      id: `notification:${base.id}`,
      module: "results",
      state: "new",
      source_id: base.attention_source_id,
      href: `/parent/results?student_id=${base.attention_student_id}&assessment_id=${base.aggregate_id}&publication_id=${base.attention_source_id}&attention_notification_id=${base.id}`,
    });
  });

  it.each([
    ["transport_rider_exception", "high"],
    ["departure_handover_exception", "urgent"],
    ["departure_plan_exception", "high"],
  ] as const)("keeps %s visible as both a new update and an operational exception", (sourceKind, priority) => {
    const item = mapNotificationAttention({
      portal: "parent",
      schoolId: "60000000-0000-4000-a000-000000000006",
      studentId: base.attention_student_id,
    }, {
      ...base,
      link: `/parent/departure?student_id=${base.attention_student_id}&date=2026-10-09&trip_id=${base.attention_source_id}`,
      attention_module: "departure",
      attention_source_kind: sourceKind,
      source_date: "2026-10-09",
      aggregate_id: null,
    });

    expect(item).toMatchObject({
      state: "exception",
      signals: ["exception", "new"],
      priority,
    });
    const projection = summarizeAttention("parent", [item], base.attention_student_id);
    expect(projection.modules.departure).toMatchObject({ total: 1, new: 1, exceptions: 1 });
    expect(projection.modules.requests).toMatchObject({ total: 1, new: 0, exceptions: 1 });
    expect(projection.modules.requests?.first_item_href).toBe(item.href);
  });

  it("keeps an acknowledged transport exception until its durable source is resolved", () => {
    const item = mapNotificationAttention({
      portal: "parent",
      schoolId: "60000000-0000-4000-a000-000000000006",
      studentId: base.attention_student_id,
    }, {
      ...base,
      read_at: "2026-10-13T10:05:00.000Z",
      link: `/parent/departure?student_id=${base.attention_student_id}&date=2026-10-09&trip_id=${base.attention_source_id}`,
      attention_module: "departure",
      attention_source_kind: "transport_rider_exception",
      source_date: "2026-10-09",
      aggregate_id: null,
    });

    expect(item).toMatchObject({ state: "exception", signals: ["exception"], priority: "high" });
    const projection = summarizeAttention("parent", [item], base.attention_student_id);
    expect(projection.summary).toMatchObject({ total: 1, new: 0, exceptions: 1 });
    expect(projection.modules.requests).toMatchObject({ total: 1, new: 0, exceptions: 1 });
    const activeQuery = serviceSource.slice(serviceSource.indexOf("WITH ranked AS"), serviceSource.indexOf("return result.rows"));
    expect(activeQuery).toContain("notification.read_at IS NULL");
    expect(activeQuery).toContain("'transport_rider_exception','departure_handover_exception','departure_plan_exception'");
  });

  it("opens final leave decisions in history and preserves their stable acknowledgement id", () => {
    const item = mapNotificationAttention({
      portal: "parent",
      schoolId: "60000000-0000-4000-a000-000000000006",
      studentId: base.attention_student_id,
    }, {
      ...base,
      link: `/parent/leave?leave_id=${base.attention_source_id}&student_id=${base.attention_student_id}&tab=history`,
      attention_module: "leave",
      attention_source_kind: "student_leave_decision",
      aggregate_id: null,
    });

    expect(item.href).toBe(
      `/parent/leave?leave_id=${base.attention_source_id}&student_id=${base.attention_student_id}&tab=history&attention_notification_id=${base.id}`,
    );
  });

  it("links a calendar update to its exact source change as well as its date", () => {
    const item = mapNotificationAttention({
      portal: "parent",
      schoolId: "60000000-0000-4000-a000-000000000006",
      studentId: base.attention_student_id,
    }, {
      ...base,
      link: `/parent/calendar?date=2026-10-14&calendar_change_id=${base.attention_source_id}`,
      attention_module: "calendar",
      attention_source_kind: "calendar_change",
      source_date: "2026-10-14",
      aggregate_id: null,
    });

    expect(item.href).toBe(
      `/parent/calendar?date=2026-10-14&calendar_change_id=${base.attention_source_id}&attention_notification_id=${base.id}`,
    );
  });

  it.each([
    ["attendance", "attendance_outcome", "2026-10-09", null, `/parent/attendance?student_id=${base.attention_student_id}&date=2026-10-09&attendance_record_id=${base.attention_source_id}&attendance_revision=2&attention_notification_id=${base.id}`],
    ["events", "event_cancellation", null, null, `/parent/events/${base.attention_source_id}?student_id=${base.attention_student_id}&focus=status&event_revision=2&attention_notification_id=${base.id}`],
    ["events", "event_withdrawal", null, base.aggregate_id, `/parent/events/${base.aggregate_id}?student_id=${base.attention_student_id}&focus=payment&withdrawal_id=${base.attention_source_id}&attention_notification_id=${base.id}`],
    ["events", "event_refund", null, base.aggregate_id, `/parent/events/${base.aggregate_id}?student_id=${base.attention_student_id}&focus=payment&refund_id=${base.attention_source_id}&attention_notification_id=${base.id}`],
    ["fees", "fee_review_decision", null, base.aggregate_id, `/parent/fees?student_id=${base.attention_student_id}&view=reviews&review=${base.aggregate_id}&decision=${base.attention_source_id}&attention_notification_id=${base.id}`],
    ["leave", "guardian_leave_authority", null, null, `/parent/leave?student_id=${base.attention_student_id}&tab=apply&authority_change_id=${base.attention_source_id}&authority_revision=2&attention_notification_id=${base.id}`],
    ["safeguarding", "restricted_care_update", null, null, `/teacher/safeguarding?section=cases&case=${base.attention_source_id}&case_revision=2&attention_notification_id=${base.id}`],
    ["policies", "policy_publication", null, null, `/parent/policies?policy=${base.attention_source_id}&policy_revision=2&attention_notification_id=${base.id}`],
    ["departure", "departure_request_decision", "2026-10-09", null, `/parent/departure?student_id=${base.attention_student_id}&date=2026-10-09&request_id=${base.attention_source_id}&request_revision=2&attention_notification_id=${base.id}`],
    ["departure", "transport_trip_cancellation", "2026-10-09", null, `/parent/departure?student_id=${base.attention_student_id}&date=2026-10-09&trip_id=${base.attention_source_id}&trip_revision=2&attention_notification_id=${base.id}`],
    ["departure", "transport_rider_exception", "2026-10-09", null, `/parent/departure?student_id=${base.attention_student_id}&date=2026-10-09&trip_id=${base.attention_source_id}&rider_revision=2&attention_notification_id=${base.id}`],
    ["departure", "departure_handover_exception", "2026-10-09", null, `/parent/departure?student_id=${base.attention_student_id}&date=2026-10-09&plan_id=${base.attention_source_id}&plan_revision=2&attention_notification_id=${base.id}`],
    ["departure", "departure_plan_exception", "2026-10-09", null, `/parent/departure?student_id=${base.attention_student_id}&date=2026-10-09&plan_id=${base.attention_source_id}&plan_revision=2&attention_notification_id=${base.id}`],
  ] as const)("maps the exact %s/%s destination", (module, kind, sourceDate, aggregateId, expectedHref) => {
    const item = mapNotificationAttention({
      portal: kind === "restricted_care_update" ? "teacher" : "parent",
      schoolId: "60000000-0000-4000-a000-000000000006",
      studentId: base.attention_student_id,
    }, {
      ...base,
      link: expectedHref.replace(`&attention_notification_id=${base.id}`, ""),
      attention_module: module,
      attention_source_kind: kind,
      source_date: sourceDate,
      aggregate_id: aggregateId,
    });
    expect(item.href).toBe(expectedHref);
  });

  it("keeps every authorized unread outcome while ranking revisions before filtering read state", () => {
    const unreadQuery = serviceSource.slice(
      serviceSource.indexOf("WITH ranked AS"),
      serviceSource.indexOf("return result.rows"),
    );
    expect(serviceSource).toContain("row_number() OVER");
    expect(serviceSource).toContain("PARTITION BY notification.recipient_id, notification.attention_topic_key");
    expect(serviceSource.indexOf("row_number() OVER")).toBeLessThan(serviceSource.indexOf("notification.read_at IS NULL"));
    expect(unreadQuery).not.toMatch(/\bLIMIT\b/);
  });

  it("requires explicit complete producer metadata and leaves all legacy rows untyped", () => {
    expect(migration).toContain("attention_eligible boolean NOT NULL DEFAULT false");
    expect(migration).toContain("NOT attention_eligible");
    expect(migration).toContain("attention_topic_key IS NULL");
    expect(migration).toContain("attention_source_revision >= 1");
    expect(migration).toContain("WHERE attention_eligible AND read_at IS NULL");
    expect(migration).toContain("WHEN 'assessment_publication' THEN attention_portal='parent' AND attention_module='results'");
    expect(migration).toContain("WHERE attention_eligible;");
    for (const sourceKind of [
      "attendance_outcome", "event_cancellation", "event_withdrawal", "event_refund",
      "fee_review_decision", "guardian_leave_authority", "restricted_care_update",
      "policy_publication", "departure_request_decision", "transport_trip_cancellation",
      "transport_rider_exception", "departure_handover_exception",
    ]) expect(extendedMigration).toContain(`WHEN '${sourceKind}'`);
    expect(departurePlanExceptionMigration).toContain("WHEN 'departure_plan_exception'");
  });

  it("rechecks each extended source against its durable current record", () => {
    const currentScope=serviceSource.slice(serviceSource.lastIndexOf("AND CASE notification.attention_source_kind"));
    for (const [sourceKind, durableTable] of [
      ["attendance_outcome", "attendance_records"],
      ["event_cancellation", "campus_events"],
      ["event_withdrawal", "campus_event_participant_withdrawals"],
      ["event_refund", "fee_refunds"],
      ["fee_review_decision", "fee_review_decisions"],
      ["guardian_leave_authority", "guardian_leave_authority_commands"],
      ["restricted_care_update", "restricted_care_cases"],
      ["policy_publication", "institution_policy_versions"],
      ["departure_request_decision", "departure_change_requests"],
      ["transport_trip_cancellation", "transport_trips"],
      ["transport_rider_exception", "transport_trip_roster"],
      ["departure_handover_exception", "departure_plans"],
      ["departure_plan_exception", "departure_plans"],
    ] as const) {
      const branch = currentScope.slice(currentScope.indexOf(`WHEN '${sourceKind}'`));
      expect(branch.slice(0, 2_500)).toContain(durableTable);
    }
    expect(serviceSource).toContain("request.requester_user_id=notification.recipient_id");
    expect(serviceSource).toContain("assignment.revoked_at IS NULL");
    expect(serviceSource).toContain("rider.state='exception'");
    expect(serviceSource).toContain("plan.is_current");
  });

  it("emits parent transport outcomes only from explicit durable transitions", () => {
    for (const sourceKind of [
      "departure_request_decision", "transport_trip_cancellation",
      "transport_rider_exception", "departure_handover_exception", "departure_plan_exception",
    ]) expect(departureSource).toContain(`sourceKind:"${sourceKind}"`);
    expect(departureSource).toContain('refresh:["departure","parent.home","notifications","attention"]');
    expect(departureSource).not.toContain('sourceKind:"transport_location"');
  });

  it("rechecks active membership, current parent scope, source state and teacher class permission", () => {
    expect(serviceSource).toContain("membership.is_active");
    expect(serviceSource).toContain("account.is_active");
    expect(serviceSource).toContain("guardian_relationships relationship");
    expect(serviceSource).toContain("request.status IN ('school_approved','school_rejected')");
    expect(serviceSource).toContain("batch.status='published'");
    expect(serviceSource).toContain("version.state='published'");
    expect(serviceSource).toContain("staff_has_class_permission(");
  });

  it("uses one current-scope authorization contract for attention, bell counts and acknowledgement", () => {
    expect(authorizationMigration).toContain("CREATE FUNCTION notification_attention_is_currently_authorized");
    expect(authorizationMigration).toContain("membership.is_active");
    expect(authorizationMigration).toContain("account.is_active");
    expect(authorizationMigration).toContain("guardian_relationships relationship");
    expect(authorizationMigration).toContain("assignment.revoked_at IS NULL");
    expect(authorizationMigration).toContain("staff_has_class_permission(");
    expect(calendarAuthorizationMigration).toContain("attention_source_revision=(");
    expect(calendarAuthorizationMigration).toContain("SELECT count(*)::integer");
    expect(serviceSource).toContain("notification_attention_is_currently_authorized(");
    expect(notificationVisibilityMigration).toContain("notification_attention_is_currently_authorized(notification.id,actor)");
    expect(departurePlanExceptionMigration).toContain("notification_departure_plan_exception_is_currently_authorized(");
    expect(departurePlanExceptionMigration).toContain("notification_source_kind='departure_plan_exception'");
    expect(schoolServiceSource.match(/notification_is_currently_visible\(/g)).toHaveLength(5);
  });

  it("clears typed attention only from its owning path and broadcasts the attention refresh idempotently", () => {
    const acknowledgement = schoolServiceSource.slice(
      schoolServiceSource.indexOf("async markNotificationRead"),
      schoolServiceSource.indexOf("async parentHome"),
    );

    expect(acknowledgement).toContain("target.attention_eligible");
    expect(acknowledgement).toContain("currentAuthorization.rows[0]?.allowed");
    expect(acknowledgement).toContain("notificationAttentionDestinationMatches(target.id, target.link, openedTargetValue)");
    expect(acknowledgement).toContain("COALESCE(read_at,clock_timestamp())");
    expect(acknowledgement).toContain('refresh: ["notifications", "attention"]');
    expect(acknowledgement).toContain("notification-read:${row.id}:${user.id}");
  });
});
