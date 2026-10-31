import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool, types } from "pg";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { Database } from "../src/database/types.js";
import type { DatabaseService } from "../src/database/database.service.js";
import { AccessRolesService } from "../src/roles/access-roles.service.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";
import { createCampusDatesFixture } from "./campus-dates.test-support.js";
const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
const url = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/campus_dates_unused_test";
types.setTypeParser(1082, value => value);
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: url, max: 4 }) }) }) as DatabaseService;
afterAll(() => db.destroy());
describe.runIf(enabled)("source-owned member-wide informational campus dates", () => {
  it("publishes historical plans, returns immutable retry results and records one atomic actor/journal/outcome without operational effects", async () => {
    const f = await createCampusDatesFixture(db), body = f.input();
    const item = await f.run(() => f.service.publish(f.owner, f.schoolId, body));
    expect(item).toMatchObject({ title: body.title, starts_on: body.starts_on, ends_on: body.ends_on, state: "published", revision: 1 });
    expect(await f.run(() => f.service.publish(f.owner, f.schoolId, body))).toEqual(item);
    await expect(f.run(() => f.service.publish(f.owner, f.schoolId, { ...body, title: "A different intent" }))).rejects.toThrow(/different campus-date/);
    const current = await f.run(() => f.service.list(f.member, f.schoolId, { from: "2026-07-01", until: "2026-07-31" }));
    expect(current).toMatchObject({ total: 1, can_manage: false, page: 1, total_pages: 1 }); expect(current.items).toEqual([item]);
    expect((await db.selectFrom("campus_date_revisions").selectAll().where("school_id", "=", f.schoolId).execute())).toHaveLength(1);
    const outbox = await db.selectFrom("event_outbox").selectAll().where("aggregate_id", "=", item.id).execute();
    expect(outbox).toHaveLength(1); expect(outbox[0]).toMatchObject({ notification_user_ids: [], notification_payload: null });
    expect(new Set(outbox[0]!.audience_user_ids)).toEqual(new Set([f.owner.id, f.member.id, f.staff.id]));
    expect(outbox[0]!.payload).toMatchObject({ date_id: item.id, revision: 1, action: "published", refresh: ["calendar"] });
    const trace = await sql`SELECT command.state,outcome.resulting_revision,event.source_revision FROM campus_model_commands command
      JOIN campus_model_command_outcomes outcome ON outcome.command_id=command.id JOIN campus_model_events event ON event.source_outbox_event_id=outcome.domain_event_id
      WHERE command.school_id=${f.schoolId}::uuid AND command.source_domain='campus_dates'`.execute(db);
    expect(trace.rows).toEqual([{ state: "accepted", resulting_revision: 1, source_revision: 1 }]);
    expect(await db.selectFrom("school_calendar_days").select("id").where("school_id", "=", f.schoolId).execute()).toHaveLength(0);
    expect(await db.selectFrom("assessment_cycles").select("id").where("school_id", "=", f.schoolId).execute()).toHaveLength(0);
  });
  it("retains period association, correction/cancellation history and original retry results after the stream advances", async () => {
    const f = await createCampusDatesFixture(db), term = await db.insertInto("academic_terms").values({ school_id: f.schoolId, academic_year: "2026-27", name: "Programme period", starts_on: "2026-08-11", ends_on: "2026-12-31", attendance_threshold: "0", updated_by: f.owner.id }).returning("id").executeTakeFirstOrThrow();
    const body = f.input({ academic_term_id: term.id }), original = await f.run(() => f.service.publish(f.owner, f.schoolId, body));
    const fields = Object.fromEntries(Object.entries(body).filter(([key]) => !["academic_term_id", "provenance"].includes(key)));
    const correction = { ...fields, idempotency_key: randomUUID(), expected_revision: 1, starts_on: "2026-07-28", ends_on: "2026-08-02", reason: "Welcome desk arrangements changed" };
    const revised = await f.run(() => f.service.correct(f.owner, f.schoolId, original.id, correction));
    expect(revised).toMatchObject({ academic_term_id: term.id, provenance: body.provenance, revision: 2, starts_on: "2026-07-28" });
    expect(await f.run(() => f.service.publish(f.owner, f.schoolId, body))).toEqual(original);
    await expect(f.run(() => f.service.correct(f.owner, f.schoolId, original.id, { ...correction, idempotency_key: randomUUID() }))).rejects.toThrow(/latest revision/);
    const august = await f.run(() => f.service.list(f.member, f.schoolId, { from: "2026-08-01", until: "2026-08-31" })); expect(august.items).toHaveLength(1);
    const cancellation = { idempotency_key: randomUUID(), expected_revision: 2, reason: "Published replacement arrangements supersede this window" };
    const cancelled = await f.run(() => f.service.cancel(f.owner, f.schoolId, original.id, cancellation)); expect(cancelled).toMatchObject({ revision: 3, state: "cancelled", cancellation_reason: cancellation.reason });
    expect(await f.run(() => f.service.correct(f.owner, f.schoolId, original.id, correction))).toEqual(revised);
    expect(await f.run(() => f.service.cancel(f.owner, f.schoolId, original.id, cancellation))).toEqual(cancelled);
    await expect(f.run(() => f.service.correct(f.owner, f.schoolId, original.id, { ...correction, idempotency_key: randomUUID(), expected_revision: 3 }))).rejects.toThrow(/cancelled/);
    const history = await db.selectFrom("campus_date_revisions").selectAll().where("date_id", "=", original.id).orderBy("revision").execute(); expect(history.map(row => row.action)).toEqual(["published", "corrected", "cancelled"]);
    await expect(db.updateTable("campus_date_revisions").set({ reason: "Attempted history rewrite" }).where("date_id", "=", original.id).execute()).rejects.toThrow(/immutable/);
    await expect(db.deleteFrom("campus_dates").where("id", "=", original.id).execute()).rejects.toThrow(/history/);
    await expect(sql`TRUNCATE campus_date_revisions`.execute(db)).rejects.toThrow(/immutable/);
  });
  it("requires an explicit current institution publication assignment, never title, class scope or read access", async () => {
    const f = await createCampusDatesFixture(db);
    await expect(f.run(() => f.service.publish(f.staff, f.schoolId, f.input()))).rejects.toThrow(/Institution-scoped/);
    const roles = new AccessRolesService(db);
    await expect(f.run(() => roles.save(f.owner, f.schoolId, { name: "Incorrect class scope", context_kind: "class", permissions: ["calendar.manage"] }))).rejects.toThrow(/supported actions/);
    const role = await f.run(() => roles.save(f.owner, f.schoolId, { name: "Calendar publication", context_kind: "institution", permissions: ["calendar.manage"] }));
    const profile = await db.selectFrom("staff_profiles").select("id").where("school_id", "=", f.schoolId).where("user_id", "=", f.staff.id).executeTakeFirstOrThrow();
    const assignment = await f.run(() => roles.assign(f.owner, f.schoolId, { role_id: role.id, staff_profile_id: profile.id, starts_on: f.now.slice(0, 10), ends_on: null }));
    const body = f.input(), item = await f.run(() => f.service.publish(f.staff, f.schoolId, body)); expect(item.revision).toBe(1);
    await db.updateTable("staff_responsibility_assignments").set({ status: "revoked", revoked_by: f.owner.id, revoked_at: new Date(f.now), revocation_reason: "Fictional publisher assignment ended" }).where("id", "=", assignment.id).execute();
    await expect(f.run(() => f.service.publish(f.staff, f.schoolId, body))).rejects.toThrow(/Institution-scoped/);
    expect((await f.run(() => f.service.detail(f.staff, f.schoolId, item.id))).can_manage).toBe(false);
  });
  it("rejects tenant/period mismatches and invalid ranges without leaking or publishing partial records", async () => {
    const f = await createCampusDatesFixture(db), other = await createCampusDatesFixture(db);
    const term = await db.insertInto("academic_terms").values({ school_id: other.schoolId, academic_year: "2026-27", name: "Other programme", starts_on: "2026-01-01", ends_on: "2026-12-31", attendance_threshold: "0", updated_by: other.owner.id }).returning("id").executeTakeFirstOrThrow();
    await expect(f.run(() => f.service.publish(f.owner, f.schoolId, f.input({ academic_term_id: term.id })))).rejects.toThrow(/period in this institution/);
    await expect(f.run(() => f.service.list(f.owner, other.schoolId, { from: "2026-07-01", until: "2026-07-31" }))).rejects.toThrow(/current world/);
    await expect(f.run(() => f.service.list(f.member, f.schoolId, { from: "2026-07-01", until: "2026-08-01" }))).rejects.toThrow(/31 days/);
    await expect(f.run(() => f.service.publish(f.owner, f.schoolId, f.input({ ends_on: "2026-07-26" })))).rejects.toThrow(/inclusive date range/);
    expect(await db.selectFrom("campus_dates").select("id").where("school_id", "=", f.schoolId).execute()).toHaveLength(0);
    await db.updateTable("school_memberships").set({ is_active: false }).where("school_id", "=", f.schoolId).where("user_id", "=", f.member.id).execute();
    await expect(f.run(() => f.service.list(f.member, f.schoolId, { from: "2026-07-01", until: "2026-07-31" }))).rejects.toThrow(/membership/);
  });
  it("pages complete overlapping reads without truncating and does not show dates from unrelated months", async () => {
    const f = await createCampusDatesFixture(db);
    for (let index = 0; index < 101; index++) await f.run(() => f.service.publish(f.owner, f.schoolId, f.input({ title: `Published planning item ${index + 1}` })));
    const first = await f.run(() => f.service.list(f.member, f.schoolId, { from: "2026-07-01", until: "2026-07-31" }));
    const second = await f.run(() => f.service.list(f.member, f.schoolId, { from: "2026-07-01", until: "2026-07-31", page: 2 }));
    expect(first).toMatchObject({ total: 101, total_pages: 2, page_size: 100 }); expect(first.items).toHaveLength(100); expect(second.items).toHaveLength(1);
    expect(new Set([...first.items, ...second.items].map(row => row.id)).size).toBe(101);
    expect((await f.run(() => f.service.list(f.member, f.schoolId, { from: "2026-08-01", until: "2026-08-31" }))).total).toBe(0);
  }, 60_000);
  it("rolls back source, revision and pending command together when the model journal fails", async () => {
    const f = await createCampusDatesFixture(db), { service, kernel } = f.services(db);
    const failure = vi.spyOn(kernel, "recordAcceptedEvent").mockRejectedValueOnce(new Error("Injected journal failure"));
    try { await expect(f.run(() => service.publish(f.owner, f.schoolId, f.input()))).rejects.toThrow(/journal failure/); } finally { failure.mockRestore(); }
    expect(await db.selectFrom("campus_dates").select("id").where("school_id", "=", f.schoolId).execute()).toHaveLength(0);
    expect(await db.selectFrom("campus_model_commands").select("id").where("school_id", "=", f.schoolId).where("source_domain", "=", "campus_dates").execute()).toHaveLength(0);
  });
  it("rechecks the current acting endpoint before returning even an accepted replay", async () => {
    const f = await createCampusDatesFixture(db), input = f.input(), item = await f.run(() => f.service.publish(f.owner, f.schoolId, input));
    const { kernel } = f.services(db);
    await f.run(() => db.transaction().execute(async tx => {
      const actor = await kernel.resolveAccountEndpoint(tx, { school_id: f.schoolId, user_id: f.owner.id, at: f.now });
      if (!actor.acting) throw new Error("Fictional publisher endpoint required");
      await kernel.closeAccountEndpoint(tx, { school_id: f.schoolId, endpoint_id: actor.endpoint_id, actor_user_id: f.owner.id, expected_revision: 1,
        effective_at: f.now, disposition: "revoked", reason: "Fictional campus publication access ended", source_domain: "staff_operations", source_record_id: f.owner.id,
        source_revision: 1, idempotency_key: `campus-date-test-revoke:${f.owner.id}` });
    }));
    await expect(f.run(() => f.service.publish(f.owner, f.schoolId, input))).rejects.toThrow(/linked campus-person/);
    expect((await f.run(() => f.service.detail(f.member, f.schoolId, item.id))).item).toEqual(item);
  });
  it("authorizes cache invalidations from exact native evidence and current membership, refusing forged events and private notification side effects", async () => {
    const f = await createCampusDatesFixture(db), item = await f.run(() => f.service.publish(f.owner, f.schoolId, f.input()));
    const event = await db.selectFrom("event_outbox").selectAll().where("aggregate_id", "=", item.id).executeTakeFirstOrThrow();
    const allowed = async (payload: unknown, actor = f.member.id) => (await sql<{ source: boolean; recipient: boolean }>`SELECT
      event_source_is_valid(${f.schoolId}::uuid,${event.event_type},${event.aggregate_type},${event.aggregate_id}::uuid,${JSON.stringify(payload)}::jsonb) AS source,
      event_user_is_authorized(${f.schoolId}::uuid,${event.event_type},${JSON.stringify(payload)}::jsonb,${actor}::uuid) AS recipient`.execute(db)).rows[0];
    expect(await allowed(event.payload)).toEqual({ source: true, recipient: true });
    const payload = event.payload as Record<string, unknown>;
    for (const forged of [{ ...payload, revision: 999 }, { ...payload, source_command_id: randomUUID() }, { ...payload, title: "Private content is forbidden" }])
      expect(await allowed(forged)).toEqual({ source: false, recipient: false });
    await expect(db.insertInto("event_outbox").values({ school_id: f.schoolId, event_type: event.event_type, aggregate_type: event.aggregate_type,
      aggregate_id: event.aggregate_id, payload: { ...payload, revision: 99 }, audience_user_ids: [f.member.id], notification_user_ids: [], notification_payload: null,
      idempotency_key: `forged-campus-date:${randomUUID()}` }).execute()).rejects.toThrow(/accepted source evidence/);
    await expect(db.insertInto("event_outbox").values({ school_id: f.schoolId, event_type: event.event_type, aggregate_type: event.aggregate_type,
      aggregate_id: event.aggregate_id, payload, audience_user_ids: [f.member.id], notification_user_ids: [f.member.id], notification_payload: sql`${JSON.stringify({ title: "Not a notification" })}::jsonb`,
      idempotency_key: `forged-campus-date-notification:${randomUUID()}` }).execute()).rejects.toThrow(/accepted source evidence/);
    await db.updateTable("school_memberships").set({ is_active: false }).where("school_id", "=", f.schoolId).where("user_id", "=", f.member.id).execute();
    expect(await allowed(payload)).toEqual({ source: true, recipient: false });
    await db.updateTable("event_outbox").set({ published_at: new Date(f.now) }).where("id", "=", event.id).execute();
  });
});
