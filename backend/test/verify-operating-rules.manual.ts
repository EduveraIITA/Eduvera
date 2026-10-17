// Run with node --env-file=.env --import tsx test/verify-operating-rules.manual.ts.
// Local, rollback-only verification against the synthetic review database.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { DatabaseService } from "../src/database/database.service.js";
import { OperatingRulesController } from "../src/operating-rules/operating-rules.module.js";
import type { AuthenticatedRequest } from "../src/common/request.js";

const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (!["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Only the local review database is allowed.");
const db = new DatabaseService();
const rollback = new Error("verification complete; rollback");
try {
  await db.transaction().execute(async tx => {
    const members = (await sql<{ school_id: string; user_id: string; role: string }>`SELECT m.school_id,m.user_id,m.role FROM school_memberships m JOIN users u ON u.id=m.user_id WHERE m.is_active AND u.is_active AND m.role IN ('admin','staff') ORDER BY m.school_id,m.role`.execute(tx)).rows;
    const admin = members.find(member => member.role === "admin" && members.some(other => other.school_id === member.school_id && other.role === "staff"));
    assert(admin, "Synthetic administrator required");
    const staff = members.find(member => member.school_id === admin.school_id && member.role === "staff");
    assert(staff, "Synthetic staff member required");
    const facade = new Proxy(tx, { get(target, key) {
      if (key === "transaction") return () => ({ execute: (fn: (inner: typeof tx) => unknown) => fn(tx) });
      const value = Reflect.get(target, key, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    } }) as unknown as DatabaseService;
    const controller = new OperatingRulesController(facade);
    const request = { authUser: { id: admin.user_id, active_school_id: admin.school_id }, requestId: randomUUID() } as AuthenticatedRequest;
    const before = await controller.get(request, admin.school_id);
    const { revision, ...settings } = before;
    request.body = { ...settings, journey_lead_minutes: 45, event_staff_hours_after: 48, attendance_submission_cutoff: "11:45", attendance_finalization_mode: "automatic", attendance_auto_finalize_minutes: 15, expected_revision: revision };
    const after = await controller.save(request, admin.school_id);
    assert.equal(after.revision, revision + 1);
    assert.equal(after.journey_lead_minutes, 45);
    assert.equal(after.event_staff_hours_after, 48);
    assert.equal(after.attendance_submission_cutoff, "11:45");
    assert.equal(after.attendance_finalization_mode, "automatic");
    assert.equal(after.attendance_auto_finalize_minutes, 15);
    await assert.rejects(() => controller.save(request, admin.school_id), /changed/);
    await assert.rejects(() => controller.get({ ...request, authUser: { ...request.authUser, id: staff.user_id } }, admin.school_id), /administrator/);
    await assert.rejects(() => controller.save({ ...request, authUser: { ...request.authUser, id: staff.user_id } }, admin.school_id), /administrator/);
    await assert.rejects(() => controller.get({ ...request, authUser: { ...request.authUser, active_school_id: randomUUID() } }, admin.school_id), /Switch/);
    const audit = await tx.selectFrom("audit_events").select("metadata").where("request_id", "=", request.requestId).where("action", "=", "operating_rules.updated").execute();
    assert.equal(audit.length, 1);
    const workflowEvent = await tx.selectFrom("event_outbox").select(["event_type", "payload"])
      .where("school_id", "=", admin.school_id)
      .where("idempotency_key", "=", `operating-rules:${admin.school_id}:attendance:${after.revision}:workflow`)
      .executeTakeFirst();
    assert.equal(workflowEvent?.event_type, "administration.updated");
    assert.equal((workflowEvent?.payload as { category?: string } | undefined)?.category, "attendance");
    const categoryBefore = await controller.getCategory(request, admin.school_id, "events");
    const eventDomain = categoryBefore.domain as { revision: number; observation_hours_before: number; observation_hours_after: number };
    request.body = {
      expected_workflow_revision: categoryBefore.workflow.revision,
      expected_domain_revision: eventDomain.revision,
      event_entry_hours_before: 3,
      event_staff_hours_after: 36,
      observation_hours_before: 1,
      observation_hours_after: 6,
    };
    const categoryAfter = await controller.saveCategory(request, admin.school_id, "events");
    const savedEventDomain = categoryAfter.domain as { revision: number; observation_hours_after: number };
    assert.equal(categoryAfter.workflow.revision, categoryBefore.workflow.revision + 1);
    assert.equal(savedEventDomain.revision, eventDomain.revision + 1);
    assert.equal(categoryAfter.workflow.event_staff_hours_after, 36);
    assert.equal(savedEventDomain.observation_hours_after, 6);
    await assert.rejects(() => controller.saveCategory(request, admin.school_id, "events"), /changed/);
    const categoryAudit = await tx.selectFrom("audit_events").select("metadata").where("request_id", "=", request.requestId).where("action", "=", "operating_rules.events.updated").execute();
    assert.equal(categoryAudit.length, 1);
    const categoryEvent = await tx.selectFrom("event_outbox").select(["event_type", "payload"])
      .where("school_id", "=", admin.school_id)
      .where("idempotency_key", "=", `operating-rules:${admin.school_id}:events:${categoryAfter.workflow.revision}:${savedEventDomain.revision}`)
      .executeTakeFirst();
    assert.equal(categoryEvent?.event_type, "administration.updated");
    assert.equal((categoryEvent?.payload as { category?: string } | undefined)?.category, "events");
    const departureBefore = await controller.getCategory(request, admin.school_id, "departure");
    const departureDomain = departureBefore.domain as { revision: number; enabled: boolean; enabled_modes: string[]; change_cutoff: string; location_retention_hours: number; location_stale_seconds: number };
    request.body = {
      expected_workflow_revision: departureBefore.workflow.revision,
      expected_domain_revision: departureDomain.revision,
      journey_lead_minutes: 40,
      enabled: departureDomain.enabled,
      enabled_modes: departureDomain.enabled_modes,
      change_cutoff: departureDomain.change_cutoff,
      location_retention_hours: departureDomain.location_retention_hours,
      location_stale_seconds: departureDomain.location_stale_seconds,
    };
    const departureAfter = await controller.saveCategory(request, admin.school_id, "departure");
    const savedDepartureDomain = departureAfter.domain as { revision: number };
    assert.equal(departureAfter.workflow.journey_lead_minutes, 40);
    assert.equal(savedDepartureDomain.revision, departureDomain.revision + 1);
    const messagesBefore = await controller.getCategory(request, admin.school_id, "messages");
    const messageDomain = messagesBefore.domain as { revision: number; student_teacher_direct_enabled: boolean; guardian_teacher_direct_enabled: boolean; student_group_replies: boolean; guardian_group_replies: boolean; attachments_enabled: boolean; enforce_communication_hours: boolean; communication_start: string; communication_end: string; retention_days: number };
    request.body = {
      expected_workflow_revision: messagesBefore.workflow.revision,
      expected_domain_revision: messageDomain.revision,
      message_edit_minutes: 3,
      message_attachment_mb: messagesBefore.workflow.message_attachment_mb,
      student_teacher_direct_enabled: messageDomain.student_teacher_direct_enabled,
      guardian_teacher_direct_enabled: messageDomain.guardian_teacher_direct_enabled,
      student_group_replies: messageDomain.student_group_replies,
      guardian_group_replies: messageDomain.guardian_group_replies,
      attachments_enabled: messageDomain.attachments_enabled,
      enforce_communication_hours: messageDomain.enforce_communication_hours,
      communication_start: messageDomain.communication_start,
      communication_end: messageDomain.communication_end,
      retention_days: messageDomain.retention_days,
    };
    const messagesAfter = await controller.saveCategory(request, admin.school_id, "messages");
    const savedMessageDomain = messagesAfter.domain as { revision: number };
    assert.equal(messagesAfter.workflow.message_edit_minutes, 3);
    assert.equal(savedMessageDomain.revision, messageDomain.revision + 1);
    console.log("Verified: single and category saves, revision conflicts, staff read/write denial, cross-school denial, atomic audit and refresh outbox. All changes rolled back.");
    throw rollback;
  });
} catch (error) { if (error !== rollback) throw error; }
finally { await db.destroy(); }
