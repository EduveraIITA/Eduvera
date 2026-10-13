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
    request.body = { ...settings, journey_lead_minutes: 45, event_staff_hours_after: 48, attendance_submission_cutoff: "11:45", expected_revision: revision };
    const after = await controller.save(request, admin.school_id);
    assert.equal(after.revision, revision + 1);
    assert.equal(after.journey_lead_minutes, 45);
    assert.equal(after.event_staff_hours_after, 48);
    assert.equal(after.attendance_submission_cutoff, "11:45");
    await assert.rejects(() => controller.save(request, admin.school_id), /changed/);
    await assert.rejects(() => controller.get({ ...request, authUser: { ...request.authUser, id: staff.user_id } }, admin.school_id), /administrator/);
    await assert.rejects(() => controller.save({ ...request, authUser: { ...request.authUser, id: staff.user_id } }, admin.school_id), /administrator/);
    await assert.rejects(() => controller.get({ ...request, authUser: { ...request.authUser, active_school_id: randomUUID() } }, admin.school_id), /Switch/);
    const audit = await tx.selectFrom("audit_events").select("metadata").where("request_id", "=", request.requestId).where("action", "=", "operating_rules.updated").execute();
    assert.equal(audit.length, 1);
    console.log("Verified: save/read, revision conflicts, staff read/write denial, cross-school denial, audit. All changes rolled back.");
    throw rollback;
  });
} catch (error) { if (error !== rollback) throw error; }
finally { await db.destroy(); }
