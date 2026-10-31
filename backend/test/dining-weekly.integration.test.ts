import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { afterAll, describe, expect, it, vi } from "vitest";
import * as sharedRecurrence from "../src/schedule-planning/shared-recurrence.js";
import type { Database } from "../src/database/types.js";
import type { DatabaseService } from "../src/database/database.service.js";
import { createDiningFixture } from "./dining.test-support.js";
import { resourceLoanRequest } from "./resource-loans.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";
import { addDiningDays } from "../src/dining/dining-weekly.resolver.js";
const enabled = process.env.TEST_DATABASE_ISOLATED === "true",
  url = enabled
    ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL)
    : "postgresql://invalid.invalid/unused_test";
const db = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: url, max: 5 }),
  }),
}) as DatabaseService;
afterAll(() => db.destroy());
const command = (expected_revision = 0) => ({
  command_id: randomUUID(),
  expected_revision,
});
async function fixture() {
  const f = await createDiningFixture(db);
  return f.run(async () => {
    await db
      .updateTable("schools")
      .set({ timezone: "Asia/Kolkata" })
      .where("id", "=", f.schoolId)
      .execute();
    const space = await f.topology.createSpace(
      f.user,
      f.schoolId,
      {
        campus_id: f.campusId,
        name: "Fictional mess hall",
        code: randomUUID().slice(0, 8),
        kind: "other",
      },
      resourceLoanRequest(f.user),
    );
    if (typeof space.id !== "string")
      throw new Error("Missing canonical space");
    const service = await f.dining.saveService(f.user, f.schoolId, {
      ...command(),
      name: "Fictional mess",
      coordinator_person_id: f.custodianPersonId,
      space_id: space.id,
    });
    const date = (
      await sql<{
        date: string;
      }>`SELECT (${f.now}::timestamptz AT TIME ZONE 'Asia/Kolkata')::date::text AS date`.execute(
        db,
      )
    ).rows[0]!.date;
    return { ...f, service, spaceId: space.id, date };
  });
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function input(f: Fixture, extra: Record<string, unknown> = {}) {
  return {
    ...command(),
    service_id: f.service.id,
    service_expected_revision: 1,
    label: "Lunch",
    timezone: "Asia/Kolkata",
    starts_on: f.date,
    ends_on: null,
    days: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
      weekday,
      menu_text: "Rice, dal and vegetables",
      starts_at: "12:00",
      ends_at: "13:00",
      end_day_offset: 0,
      space_id: f.spaceId,
      operator_person_id: f.borrowerPersonId,
      start_fold: "reject",
      end_fold: "reject",
    })),
    note: "",
    ...extra,
  };
}
async function publish(f: Fixture, extra: Record<string, unknown> = {}) {
  const plan = await f.dining.savePlan(f.user, f.schoolId, input(f, extra));
  return f.dining.publishPlan(f.user, f.schoolId, plan.id, {
    ...command(plan.revision),
    note: "Reviewed upcoming menu",
  });
}
describe.skipIf(!enabled)("Weekly Dining source and date ownership", () => {
  it("expands open-ended plans without read writes, pages fully and retains one-date exceptions through future revision/stop", async () => {
    const f = await fixture();
    await f.run(async () => {
      const plan = await publish(f),
        before = (
          await db
            .selectFrom("dining_sessions")
            .select(db.fn.countAll().as("n"))
            .where("school_id", "=", f.schoolId)
            .executeTakeFirstOrThrow()
        ).n;
      const q = { from: f.date, until: addDiningDays(f.date, 34) };
      const first = await f.dining.availability(f.borrower, f.schoolId, q),
        second = await f.dining.availability(f.borrower, f.schoolId, {
          ...q,
          page: 2,
        });
      expect(first.total).toBe(35);
      expect(first.items).toHaveLength(20);
      expect(second.items).toHaveLength(15);
      expect(first.items[0]).not.toHaveProperty("coordinator");
      expect(
        (
          await db
            .selectFrom("dining_sessions")
            .select(db.fn.countAll().as("n"))
            .where("school_id", "=", f.schoolId)
            .executeTakeFirstOrThrow()
        ).n,
      ).toEqual(before);
      const date = addDiningDays(f.date, 2),
        read = await f.dining.planDate(
          f.user,
          f.schoolId,
          plan.series_id,
          date,
        );
      if (read.origin !== "plan_date") throw new Error("Unexpected saved date");
      const body = {
        command_id: randomUUID(),
        expected_plan_version_id: read.plan_version_id,
        expected_plan_revision: read.plan_revision,
        expected_session_revision: 0,
        action: "publish_changes",
        note: "Festival menu for this date only",
        menu_text: "Festival meal",
      };
      const saved = await f.dining.actPlanDate(
        f.user,
        f.schoolId,
        plan.series_id,
        date,
        body,
      );
      expect(
        await f.dining.actPlanDate(
          f.user,
          f.schoolId,
          plan.series_id,
          date,
          body,
        ),
      ).toMatchObject(saved);
      const next = await f.dining.revisePlan(f.user, f.schoolId, plan.id, {
        ...command(plan.revision),
        starts_on: addDiningDays(f.date, 1),
        note: "New menu from next week",
      });
      const omittedDate = addDiningDays(f.date, 3),
        omittedWeekday = new Date(`${omittedDate}T12:00:00Z`).getUTCDay() || 7;
      const revised = await f.dining.savePlan(f.user, f.schoolId, {
        ...input(f),
        ...command(next.revision),
        id: next.id,
        starts_on: addDiningDays(f.date, 1),
        days: input(f).days.filter((day) => day.weekday !== omittedWeekday),
      });
      const parentStopped = await f.dining.stopPlan(
        f.user,
        f.schoolId,
        plan.id,
        {
          ...command(plan.revision),
          stop_from: addDiningDays(f.date, 10),
          note: "Changed source arrangement after draft preparation",
        },
      );
      await expect(
        f.dining.publishPlan(f.user, f.schoolId, next.id, {
          ...command(revised.revision),
          note: "Old parent not reviewed",
        }),
      ).rejects.toThrow("changed");
      const publication = await f.dining.publishPlan(
        f.user,
        f.schoolId,
        next.id,
        {
          ...command(revised.revision),
          expected_parent_revision: parentStopped.revision,
          note: "Reviewed revised plan",
        },
      );
      expect(
        (
          await f.dining.availability(f.user, f.schoolId, {
            from: omittedDate,
            until: omittedDate,
          })
        ).items,
      ).toHaveLength(0);
      expect(
        (
          await sql<{
            state: string;
          }>`SELECT state FROM campus_model_schedule_occurrences WHERE school_id=${f.schoolId}::uuid AND occurrence_date=${omittedDate}::date AND recorded_until IS NULL`.execute(
            db,
          )
        ).rows,
      ).toMatchObject([{ state: "cancelled" }]);
      await expect(
        f.dining.actPlanDate(
          f.user,
          f.schoolId,
          plan.series_id,
          addDiningDays(f.date, 4),
          {
            command_id: randomUUID(),
            expected_plan_version_id: plan.id,
            expected_plan_revision: parentStopped.revision,
            expected_session_revision: 0,
            action: "publish_changes",
            note: "Stale version review",
            menu_text: "Old draft",
          },
        ),
      ).rejects.toMatchObject({
        response: {
          fields: {
            dining_obsolete: {
              reason: "plan_superseded",
              expected_plan_version_id: plan.id,
              current_plan_version_id: next.id,
            },
          },
        },
      });
      const kept = await f.dining.planDate(
        f.user,
        f.schoolId,
        plan.series_id,
        date,
      );
      expect(kept.origin).toBe("session");
      if (kept.origin === "session")
        expect(kept.session.menu_text).toBe("Festival meal");
      await f.dining.stopPlan(f.user, f.schoolId, next.id, {
        ...command(publication.revision),
        stop_from: addDiningDays(f.date, 1),
        note: "Service will pause",
      });
      expect(
        (await f.dining.planDate(f.user, f.schoolId, plan.series_id, date))
          .origin,
      ).toBe("session");
      expect(
        (
          await f.dining.availability(f.user, f.schoolId, {
            from: date,
            until: date,
          })
        ).items,
      ).toHaveLength(1);
    });
  });
  it("projects early local time and includes an overnight service from the previous start date", async () => {
    const f = await fixture();
    await f.run(async () => {
      const body = input(f);
      body.days = body.days.map((day) => ({
        ...day,
        starts_at: "00:30",
        ends_at: "01:30",
      }));
      await publish(f, { days: body.days });
      const overnight = body.days.map((day) => ({
        ...day,
        starts_at: "23:30",
        ends_at: "01:00",
        end_day_offset: 1,
      }));
      await publish(f, {
        label: "Night service",
        starts_on: addDiningDays(f.date, -1),
        days: overnight,
      });
      const page = await f.dining.availability(f.borrower, f.schoolId, {
        from: f.date,
        until: f.date,
      });
      expect(page.items).toHaveLength(3);
      expect(
        page.items.some(
          (item) => item.local_date === addDiningDays(f.date, -1),
        ),
      ).toBe(true);
      const claims = (
        await sql<{
          claim_kind: string;
        }>`SELECT claim_kind FROM campus_model_schedule_occurrences WHERE school_id=${f.schoolId}::uuid`.execute(
          db,
        )
      ).rows;
      expect(claims.length).toBeGreaterThan(0);
      expect(claims.every((row) => row.claim_kind === "availability")).toBe(
        true,
      );
    });
  });
  it("keeps a cancelled unpublished session private and never calls absent counts zero", async () => {
    const f = await fixture();
    await f.run(async () => {
      const draft = await f.dining.createSession(f.user, f.schoolId, {
        ...command(),
        service_id: f.service.id,
        service_expected_revision: 1,
        label: "Private meal",
        operator_person_id: f.custodianPersonId,
        space_id: f.spaceId,
        starts_at: f.now,
        ends_at: new Date(Date.parse(f.now) + 3600000).toISOString(),
        menu_text: "Private draft",
      });
      await f.dining.act(f.user, f.schoolId, draft.id, {
        ...command(1),
        action: "cancel",
        note: "Draft was a mistake",
      });
      await expect(
        f.dining.detail(f.borrower, f.schoolId, draft.id),
      ).rejects.toThrow();
      expect(
        (
          await f.dining.availability(f.borrower, f.schoolId, {
            from: f.date,
            until: f.date,
          })
        ).total,
      ).toBe(0);
      const plan = await publish(f);
      const date = await f.dining.planDate(
        f.borrower,
        f.schoolId,
        plan.series_id,
        f.date,
      );
      if (date.origin !== "plan_date") throw new Error("Unexpected saved date");
      const opened = await f.dining.actPlanDate(
        f.borrower,
        f.schoolId,
        plan.series_id,
        f.date,
        {
          command_id: randomUUID(),
          expected_plan_version_id: date.plan_version_id,
          expected_plan_revision: date.plan_revision,
          expected_session_revision: 0,
          action: "open",
          note: "Opening this fictional service for test",
        },
      );
      const detail = await f.dining.detail(f.borrower, f.schoolId, opened.id);
      expect("count_total" in detail && detail.count_total).toBeNull();
    });
  });
  it("blocks known unresolved DST publication and models a later timezone-catalogue change with time-free cancellation and resolved replacement", async () => {
    const f = await fixture();
    await f.run(async () => {
      const body = input(f, {
        timezone: "America/New_York",
        starts_on: "2026-10-26",
        ends_on: null,
        days: [
          {
            weekday: 7,
            menu_text: "Sunday breakfast",
            starts_at: "01:30",
            ends_at: "02:30",
            end_day_offset: 0,
            space_id: f.spaceId,
            operator_person_id: f.borrowerPersonId,
            start_fold: "reject",
            end_fold: "reject",
          },
        ],
      });
      const bad = await f.dining.savePlan(f.user, f.schoolId, body);
      await expect(
        f.dining.publishPlan(f.user, f.schoolId, bad.id, {
          ...command(1),
          note: "Review",
        }),
      ).rejects.toThrow("clock-change");
      const fixed = await f.dining.savePlan(f.user, f.schoolId, {
        ...body,
        ...command(1),
        id: bad.id,
        days: body.days.map((day) => ({
          ...day,
          start_fold: "earlier",
          end_fold: "later",
          ends_at: "01:50",
        })),
      });
      const plan = await f.dining.publishPlan(f.user, f.schoolId, fixed.id, {
        ...command(fixed.revision),
        note: "Explicit fold selection",
      });
      const gap = "2028-03-12",
        choices = sharedRecurrence.localInstantChoices,
        changedCatalogue = vi
          .spyOn(sharedRecurrence, "localInstantChoices")
          .mockImplementation((date, time, zone) =>
            date === gap && zone === "America/New_York"
              ? []
              : choices(date, time, zone),
          ),
        read = await f.dining.planDate(f.user, f.schoolId, plan.series_id, gap);
      if (read.origin !== "plan_date") throw new Error("Unexpected saved date");
      expect(read.needs_time_resolution).toBe(true);
      const cancel = {
        command_id: randomUUID(),
        expected_plan_version_id: read.plan_version_id,
        expected_plan_revision: read.plan_revision,
        expected_session_revision: 0,
        action: "cancel",
        note: "Clock change closure",
      };
      const result = await f.dining.actPlanDate(
        f.user,
        f.schoolId,
        plan.series_id,
        gap,
        cancel,
      );
      expect(result.kind).toBe("plan");
      expect(
        await f.dining.actPlanDate(
          f.user,
          f.schoolId,
          plan.series_id,
          gap,
          cancel,
        ),
      ).toMatchObject(result);
      const cancelled = await f.dining.planDate(
        f.user,
        f.schoolId,
        plan.series_id,
        gap,
      );
      expect(cancelled).toMatchObject({
        origin: "plan_date",
        cancelled_for_date: true,
        starts_at: null,
        needs_time_resolution: false,
      });
      expect(
        (
          await f.dining.availability(f.borrower, f.schoolId, {
            from: gap,
            until: gap,
          })
        ).warnings,
      ).toMatchObject([{ reason: "cancelled_for_date" }]);
      const current = await f.dining.plan(f.user, f.schoolId, plan.id);
      const restored = await f.dining.actPlanDate(
        f.user,
        f.schoolId,
        plan.series_id,
        gap,
        {
          ...cancel,
          command_id: randomUUID(),
          expected_plan_revision: current.revision,
          action: "publish_changes",
          note: "Move breakfast after the clock change",
          starts_at: "2028-03-12T03:30:00-04:00",
          ends_at: "2028-03-12T04:30:00-04:00",
        },
      );
      expect(restored.kind).toBe("session");
      changedCatalogue.mockRestore();
    });
  });
  it("requires current exact authority and explicit orphan recovery, preserving old evidence", async () => {
    const f = await fixture();
    await f.run(async () => {
      const plan = await publish(f);
      await expect(
        f.dining.stopPlan(f.borrower, f.schoolId, plan.id, {
          ...command(plan.revision),
          stop_from: f.date,
          note: "Not the coordinator",
        }),
      ).rejects.toThrow();
      const transfer = await f.dining.recoverPlan(f.user, f.schoolId, plan.id, {
        ...command(plan.revision),
        coordinator_person_id: f.borrowerPersonId,
        note: "Hand weekly planning to this explicit person",
      });
      const privateDraft = await f.dining.savePlan(
        f.user,
        f.schoolId,
        input(f, { label: "Private next menu" }),
      );
      const handover = {
        ...command(privateDraft.revision),
        coordinator_person_id: f.borrowerPersonId,
        note: "Transfer this unfinished pattern explicitly",
      };
      const handed = await f.dining.recoverPlan(
        f.user,
        f.schoolId,
        privateDraft.id,
        handover,
      );
      expect(handed.access_transferred).toBe(true);
      expect(
        await f.dining.recoverPlan(
          f.user,
          f.schoolId,
          privateDraft.id,
          handover,
        ),
      ).toEqual(handed);
      expect(
        await f.dining.confirmation(
          f.user,
          f.schoolId,
          privateDraft.id,
          handover.command_id,
        ),
      ).toMatchObject({ state: "accepted", result: handed });
      await expect(
        f.dining.plan(f.user, f.schoolId, privateDraft.id),
      ).rejects.toThrow();
      await db
        .updateTable("school_memberships")
        .set({ is_active: false })
        .where("school_id", "=", f.schoolId)
        .where("user_id", "=", f.borrower.id)
        .execute();
      expect(
        await f.dining.ownedAvailability(f.borrower, f.schoolId, {
          from: f.date,
          until: f.date,
        }),
      ).toEqual({ items: [], warnings: [] });
      await expect(
        f.dining.actPlanDate(f.borrower, f.schoolId, plan.series_id, f.date, {
          command_id: randomUUID(),
          expected_plan_version_id: plan.id,
          expected_plan_revision: plan.revision,
          expected_session_revision: 0,
          action: "open",
          note: "No authority",
        }),
      ).rejects.toThrow();
      const recovered = await f.dining.recoverPlan(
        f.user,
        f.schoolId,
        plan.id,
        {
          ...command(transfer.revision),
          coordinator_person_id: f.custodianPersonId,
          note: "Restore planning after the assigned account left",
        },
      );
      expect(recovered.revision).toBe(transfer.revision + 1);
      expect(
        await f.dining.plan(f.user, f.schoolId, privateDraft.id),
      ).toMatchObject({
        id: privateDraft.id,
        recovery_only: true,
        allowed_actions: ["recover"],
      });
      expect(await f.dining.plan(f.user, f.schoolId, plan.id)).toMatchObject({
        coordinator: { id: f.custodianPersonId },
      });
      const evidence = await db
        .selectFrom("dining_weekly_receipts")
        .select(["action", "actor_person_id"])
        .where("school_id", "=", f.schoolId)
        .where("plan_id", "=", plan.id)
        .orderBy("revision")
        .execute();
      expect(evidence.map((row) => row.action)).toEqual([
        "saved",
        "published",
        "recovered",
        "recovered",
      ]);
    });
  });
});
