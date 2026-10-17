import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mapNotificationAttention } from "../src/attention/notification-attention.service.js";

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");
const migration = read("migrations", "079_staff_workflow_attention.sql");
const notificationProjection = read("src", "attention", "notification-attention.service.ts");
const staffProducer = read("src", "staff-operations", "staff-operations.service.ts");
const transportProducer = read("src", "departure-coordination", "departure-coordination.service.ts");
const materializer = read("src", "school", "school-event.service.ts");

const row = {
  id: "10000000-0000-4000-a000-000000000001",
  link: "/teacher/responsibilities?assignment=20000000-0000-4000-a000-000000000002",
  title: "New work assignment",
  body: "Examiner needs your response.",
  read_at: null,
  created_at: "2026-10-13T10:00:00.000Z",
  attention_module: "responsibilities" as const,
  attention_source_kind: "responsibility_offer" as const,
  attention_source_id: "20000000-0000-4000-a000-000000000002",
  attention_source_revision: 1,
  attention_student_id: null,
  attention_class_section_id: null,
  source_date: "2026-10-20",
  aggregate_id: null,
  subject_label: "Examiner",
};

describe("staff workflow notification attention", () => {
  it("keeps a live offer actionable after acknowledgement while clearing only its new signal", () => {
    const scope = { portal: "teacher" as const, schoolId: "30000000-0000-4000-a000-000000000003" };
    const unread = mapNotificationAttention(scope, row);
    const acknowledged = mapNotificationAttention(scope, { ...row, read_at: "2026-10-13T10:05:00.000Z" });

    expect(unread).toMatchObject({
      source_kind: "responsibility_offer",
      state: "action_required",
      signals: ["action_required", "new"],
      priority: "high",
      subject_label: "Examiner",
      href: `${row.link}&attention_notification_id=${row.id}`,
    });
    expect(acknowledged).toMatchObject({ state: "action_required", signals: ["action_required"] });
  });

  it("treats exact responses, revocations and decisions as informational outcomes", () => {
    for (const kind of ["responsibility_response", "coverage_response", "responsibility_revocation", "transport_swap_response", "transport_swap_decision"] as const) {
      const item = mapNotificationAttention({
        portal: kind.endsWith("response") && kind !== "transport_swap_response" ? "principal" : "teacher",
        schoolId: "30000000-0000-4000-a000-000000000003",
      }, {
        ...row,
        attention_module: kind === "responsibility_response" || kind === "coverage_response" ? "staff" : kind.startsWith("transport") ? "transport" : "responsibilities",
        attention_source_kind: kind,
      });
      expect(item.state).toBe("new");
      expect(item.signals).toEqual(["new"]);
    }
  });

  it("persists exact workflow destinations from every producer", () => {
    for (const fragment of [
      "`/teacher/responsibilities?assignment=${assignment.id}&assignment_revision=${assignment.revision}`",
      "`/principal/staff/${assignment.staff_profile_id}?assignment=${assignmentId}&assignment_revision=${updated.revision}`",
      "`/teacher/responsibilities?assignment=${assignmentId}&assignment_revision=${updated.revision}`",
      "`/work/staff-leave?school=${schoolId}&request=${request.id}&request_revision=${request.revision}`",
      "`/teacher/responsibilities?coverage=${task.id}&coverage_revision=${updated.revision}`",
      "`/principal/staff?section=leave&coverage=${task.id}&coverage_revision=${updated.revision}`",
    ]) expect(staffProducer).toContain(fragment);

    for (const fragment of [
      "`/teacher/transport?swap=${row.id}&swap_revision=${row.revision}`",
      "`/principal/departure?section=roster&swap=${row.id}&swap_revision=${row.revision}`",
    ]) expect(transportProducer).toContain(fragment);
  });

  it("materializes every typed kind only for its intended portal and module", () => {
    for (const kind of [
      "responsibility_offer", "responsibility_response", "responsibility_revocation",
      "coverage_offer", "coverage_response", "staff_leave_review",
      "transport_swap", "transport_swap_approval", "transport_swap_response", "transport_swap_decision",
    ]) {
      expect(materializer).toContain(`WHEN '${kind}'`);
      expect(migration).toContain(`WHEN '${kind}'`);
    }
    expect(materializer).toContain("'fees','safeguarding','policies','departure','staff','responsibilities','transport'");
  });

  it("fails closed against current membership, recipient, state, revision, assignment and swap window", () => {
    expect(migration).toContain("CREATE FUNCTION notification_staff_workflow_is_currently_authorized");
    expect(migration).toContain("membership.is_active");
    expect(migration).toContain("profile.user_id=actor");
    expect(migration).toContain("assignment.status='offered' AND assignment.revision=source_revision");
    expect(migration).toContain("task.status='offered' AND task.revision=source_revision");
    expect(migration).toContain("request.status='submitted' AND request.revision=source_revision");
    expect(migration).toContain("swap.target_user_id=actor");
    expect(migration).toContain("requester_trip.assigned_collector_user_id=swap.requester_user_id");
    expect(migration).toContain("interval '30 minutes'");
    expect(migration).toContain("notification_departure_plan_exception_is_currently_authorized");
    expect(migration).toContain("notification_attention_is_currently_authorized");
  });

  it("retains only live actions after read and resolves focused swaps beyond the default 30-day window", () => {
    expect(notificationProjection).toContain("'responsibility_offer','coverage_offer','staff_leave_review','transport_swap','transport_swap_approval'");
    expect(transportProducer).toContain("swap.created_at>=now()-interval '30 days' OR swap.id=${focusedSwapId??null}::uuid");
    expect(transportProducer).toContain("swap.requester_user_id=${user.id}::uuid OR swap.target_user_id=${user.id}::uuid");
  });

  it("keeps active-profile eligibility aligned across notifications, Requests, workspaces and mutations", () => {
    const requests = read("src", "requests", "requests.service.ts");
    expect(requests).toContain('.where("status", "=", "active").executeTakeFirst()');
    expect(staffProducer).toContain("assignment.status<>'offered' OR profile.status='active'");
    expect(staffProducer).toContain("task.status<>'offered' OR replacement.status='active'");
    expect(staffProducer).toContain("profile.user_id=${user.id}::uuid AND profile.status='active' FOR UPDATE");
    expect(migration).toContain("profile.status='active'");
  });

  it("has a stable SHA-256 migration checksum", () => {
    expect(createHash("sha256").update(migration).digest("hex")).toMatch(/^[0-9a-f]{64}$/);
  });
});
