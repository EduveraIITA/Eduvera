import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import { createLiveExecutionEnvironment } from "../src/campus-model-core/execution-environment.runtime.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import { createAccommodationFixture } from "./accommodation.test-support.js";
import { resourceLoanRequest } from "./resource-loans.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";
const enabled = process.env.TEST_DATABASE_ISOLATED === "true",
  url = enabled
    ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL)
    : "postgresql://invalid.invalid/accommodation_unused_test";
const db = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: url, max: 6 }),
  }),
}) as DatabaseService;
beforeAll(() => {
  process.env.INVITATION_EMAIL_ENABLED = "false";
});
afterAll(() => db.destroy());
type Fixture = Awaited<ReturnType<typeof createAccommodationFixture>>;
const command = (expected_revision = 0) => ({
  command_id: randomUUID(),
  expected_revision,
});
const instant = (f: Fixture, minutes: number) =>
  new Date(Date.parse(f.now) + minutes * 60_000).toISOString();
async function room(
  f: Fixture,
  capacity = 1,
  mode: "whole_room" | "shared" = "whole_room",
) {
  const space = await f.topology.createSpace(
    f.user,
    f.schoolId,
    {
      campus_id: f.campusId,
      name: "Fictional hostel room",
      code: `ROOM-${randomUUID().slice(0, 8)}`,
      kind: "residential_room",
      capacity: null,
      is_bookable: false,
    },
    resourceLoanRequest(f.user),
  );
  const type = await f.accommodation.saveRoomType(f.user, f.schoolId, {
    ...command(),
    name: `Temporary ${randomUUID().slice(0, 8)}`,
    default_capacity: capacity,
    allocation_mode: mode,
  });
  return f.accommodation.saveRoom(f.user, f.schoolId, {
    ...command(),
    space_id: space.id,
    room_type_id: type.id,
    sleeping_capacity: capacity,
    allocation_mode: mode,
  });
}
const offer = (
  f: Fixture,
  roomId: string,
  extra: Record<string, unknown> = {},
) => ({
  ...command(),
  resident_person_id: f.borrowerPersonId,
  coordinator_person_id: f.custodianPersonId,
  recorder_person_id: f.custodianPersonId,
  room_id: roomId,
  starts_at: instant(f, -1),
  ends_at: instant(f, 60),
  access_mode: "no_tracked_item",
  ...extra,
});
const action = (
  f: Fixture,
  id: string,
  revision: number,
  kind: string,
  extra: Record<string, unknown> = {},
) =>
  f.accommodation.act(f.user, f.schoolId, id, {
    ...command(revision),
    action: kind,
    ...extra,
  });
async function passive(f: Fixture, name: string) {
  return f.people.create(resourceLoanRequest(f.user), f.schoolId, {
    first_name: name,
    last_name: "",
    idempotency_key: randomUUID(),
  });
}
const at = <T>(f: Fixture, minutes: number, fn: () => Promise<T>) =>
  executionEnvironmentStorage.run(
    createLiveExecutionEnvironment({
      institution_id: f.schoolId,
      clock: {
        now: () => new Date(instant(f, minutes)),
        nowIso: () => instant(f, minutes),
      },
    }),
    fn,
  );
describe.skipIf(!enabled)("Accommodation native DT and capacity", () => {
  it("retains typed setup, exact offers, resident agreement, actual move and closure as separate native commands", async () => {
    const f = await createAccommodationFixture(db);
    await f.run(async () => {
      const registered = await room(f),
        input = offer(f, registered.id),
        stay = await f.accommodation.offer(f.user, f.schoolId, input);
      expect(stay).toMatchObject({
        id: input.command_id,
        revision: 1,
        state: "offered",
        resident: { id: f.borrowerPersonId },
        actual_move_in_at: null,
      });
      expect(
        await f.accommodation.offer(f.user, f.schoolId, input),
      ).toMatchObject({ id: stay.id, revision: 1 });
      await expect(
        f.accommodation.offer(f.user, f.schoolId, {
          ...input,
          instructions: "Changed exact commitment",
        }),
      ).rejects.toThrow("different accommodation");
      expect(
        (await f.accommodation.work(f.borrower, f.schoolId)).needs_me,
      ).toMatchObject([{ stay_id: stay.id, action: "respond" }]);
      await expect(
        action(f, stay.id, 1, "move_in", { observed_at: f.now }),
      ).rejects.toThrow("Accept");
      await expect(action(f, stay.id, 1, "accept")).rejects.toThrow(
        "exact current",
      );
      expect(
        await f.accommodation.act(f.borrower, f.schoolId, stay.id, {
          ...command(1),
          action: "accept",
        }),
      ).toMatchObject({
        state: "accepted",
        revision: 2,
        actual_move_in_at: null,
      });
      expect((await f.accommodation.work(f.user, f.schoolId)).needs_me).toMatchObject([
        { stay_id: stay.id, action: "move_in", title: expect.any(String), detail: "Fictional hostel room" },
      ]);
      expect(
        await action(f, stay.id, 2, "move_in", { observed_at: f.now }),
      ).toMatchObject({ revision: 3, actual_move_in_at: f.now });
      expect(await f.accommodation.work(f.user, f.schoolId)).toEqual({ needs_me: [], waiting: [] });
      expect(await f.accommodation.work(f.borrower, f.schoolId)).toEqual({ needs_me: [], waiting: [] });
      expect(await f.accommodation.detail(f.user, f.schoolId, stay.id)).toMatchObject({
        revision: 3, actual_move_in_at: f.now, actual_move_out_at: null,
        allowed_actions: { move_out: true },
      });
      await expect(
        action(f, stay.id, 3, "cancel", { note: "Changed mind" }),
      ).rejects.toThrow("actual move-out");
      expect(
        await action(f, stay.id, 3, "move_out", {
          observed_at: f.now,
          destination_note: "Returned to original room",
        }),
      ).toMatchObject({ revision: 4, actual_move_out_at: f.now });
      expect(
        (await f.accommodation.work(f.user, f.schoolId)).needs_me[0],
      ).toMatchObject({ action: "coordinate" });
      expect(await action(f, stay.id, 4, "close")).toMatchObject({
        state: "closed",
        revision: 5,
      });
      expect(await f.accommodation.work(f.user, f.schoolId)).toEqual({
        needs_me: [],
        waiting: [],
      });
      const native = await db
        .selectFrom("accommodation_receipts")
        .selectAll()
        .where("stay_id", "=", stay.id)
        .orderBy("revision")
        .execute();
      expect(native.map((row) => row.action)).toEqual([
        "offered",
        "accepted",
        "moved_in",
        "moved_out",
        "closed",
      ]);
      expect(
        await db
          .selectFrom("campus_model_commands")
          .select(["state", "source_domain"])
          .where("id", "=", native[0]!.command_id)
          .executeTakeFirstOrThrow(),
      ).toEqual({ state: "accepted", source_domain: "accommodation" });
      expect(
        (
          await sql<{
            count: string;
          }>`SELECT count(*)::text AS count FROM campus_model_agent_authorities WHERE school_id=${f.schoolId}::uuid AND constraints->>'source_record_id'=${stay.id} AND revoked_at IS NULL`.execute(
            db,
          )
        ).rows[0],
      ).toMatchObject({ count: "0" });
    });
  }, 60_000);
  it("keeps future arrival quiet and reviews an ended stay without inferring a physical departure or deadline", async () => {
    const f = await createAccommodationFixture(db);
    const created = await f.run(async () => {
      const registered = await room(f),
        stay = await f.accommodation.offer(f.user, f.schoolId, offer(f, registered.id, {
          starts_at: instant(f, 30), ends_at: instant(f, 90),
        }));
      await f.accommodation.act(f.borrower, f.schoolId, stay.id, { ...command(1), action: "accept" });
      expect(await f.accommodation.work(f.user, f.schoolId)).toEqual({ needs_me: [], waiting: [] });
      return stay;
    });
    await at(f, 30, async () => {
      expect((await f.accommodation.work(f.user, f.schoolId)).needs_me).toMatchObject([
        { stay_id: created.id, action: "move_in", due_at: null },
      ]);
      await action(f, created.id, 2, "move_in", { observed_at: instant(f, 30) });
      expect(await f.accommodation.work(f.user, f.schoolId)).toEqual({ needs_me: [], waiting: [] });
    });
    await at(f, 90, async () => {
      const before = await f.accommodation.detail(f.user, f.schoolId, created.id);
      expect((await f.accommodation.work(f.user, f.schoolId)).needs_me).toMatchObject([
        { stay_id: created.id, action: "review_end", due_at: null, detail: "Fictional hostel room" },
      ]);
      expect(await f.accommodation.detail(f.user, f.schoolId, created.id)).toMatchObject({
        revision: before.revision, actual_move_in_at: instant(f, 30), actual_move_out_at: null,
      });
    });
  }, 60_000);
  it("does not invent another move-in when only the coordinator becomes unavailable during an ordinary stay", async () => {
    const f = await createAccommodationFixture(db);
    await f.run(async () => {
      const registered = await room(f),
        person = await passive(f, "Current resident"),
        stay = await f.accommodation.offer(f.user, f.schoolId, offer(f, registered.id, {
          resident_person_id: person.id, coordinator_person_id: f.borrowerPersonId,
        }));
      await f.accommodation.act(f.borrower, f.schoolId, stay.id, {
        ...command(1), action: "record_response", response: "accept", response_for: "offer",
        observed_at: f.now, method: "in_person", note: "Fictional resident agreed at the desk.",
      });
      await action(f, stay.id, 2, "move_in", { observed_at: f.now });
      await db.updateTable("school_memberships").set({ is_active: false })
        .where("school_id", "=", f.schoolId).where("user_id", "=", f.borrower.id).execute();
      expect(await f.accommodation.work(f.user, f.schoolId)).toEqual({ needs_me: [], waiting: [] });
      expect(await f.accommodation.detail(f.user, f.schoolId, stay.id)).toMatchObject({
        actual_move_in_at: f.now, actual_move_out_at: null, coordinator_unavailable: true,
        recorder_unavailable: false, allowed_actions: { move_out: true },
      });
    });
  }, 60_000);
  it("calculates peak concurrency over half-open boundaries, and locks room and person against concurrent conflicting offers", async () => {
    const f = await createAccommodationFixture(db);
    await f.run(async () => {
      const shared = await room(f, 2, "shared"),
        people = await Promise.all(
          ["Alpha", "Beta", "Gamma", "Delta"].map((name) => passive(f, name)),
        );
      await f.accommodation.offer(
        f.user,
        f.schoolId,
        offer(f, shared.id, {
          resident_person_id: people[0]!.id,
          starts_at: instant(f, 10),
          ends_at: instant(f, 20),
        }),
      );
      await f.accommodation.offer(
        f.user,
        f.schoolId,
        offer(f, shared.id, {
          resident_person_id: people[1]!.id,
          starts_at: instant(f, 20),
          ends_at: instant(f, 30),
        }),
      );
      await f.accommodation.offer(
        f.user,
        f.schoolId,
        offer(f, shared.id, {
          resident_person_id: people[2]!.id,
          starts_at: instant(f, 10),
          ends_at: instant(f, 30),
        }),
      );
      await expect(
        f.accommodation.offer(
          f.user,
          f.schoolId,
          offer(f, shared.id, {
            resident_person_id: people[3]!.id,
            starts_at: instant(f, 15),
            ends_at: instant(f, 25),
          }),
        ),
      ).rejects.toThrow("no capacity");
      const single = await room(f),
        results = await Promise.allSettled([
          f.accommodation.offer(
            f.user,
            f.schoolId,
            offer(f, single.id, {
              resident_person_id: people[0]!.id,
              starts_at: instant(f, 60),
              ends_at: instant(f, 120),
            }),
          ),
          f.accommodation.offer(
            f.user,
            f.schoolId,
            offer(f, single.id, {
              resident_person_id: people[1]!.id,
              starts_at: instant(f, 60),
              ends_at: instant(f, 120),
            }),
          ),
        ]);
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      const other = await room(f);
      await expect(
        f.accommodation.offer(
          f.user,
          f.schoolId,
          offer(f, other.id, {
            resident_person_id: people[2]!.id,
            starts_at: instant(f, 15),
            ends_at: instant(f, 25),
          }),
        ),
      ).rejects.toThrow("overlapping");
    });
  }, 60_000);
  it("records assisted provenance and leaves declined extension agreement unchanged", async () => {
    const f = await createAccommodationFixture(db);
    await f.run(async () => {
      const registered = await room(f),
        person = await passive(f, "Passive resident"),
        stay = await f.accommodation.offer(
          f.user,
          f.schoolId,
          offer(f, registered.id, { resident_person_id: person.id }),
        );
      await expect(
        action(f, stay.id, 1, "record_response", {
          response: "accept",
          response_for: "offer",
        }),
      ).rejects.toThrow("how and when");
      expect(
        await action(f, stay.id, 1, "record_response", {
          response: "accept",
          response_for: "offer",
          observed_at: f.now,
          method: "in_person",
          note: "Resident explicitly agreed at the desk.",
        }),
      ).toMatchObject({ state: "accepted", accepted_at: f.now });
      expect(
        await action(f, stay.id, 2, "extend", {
          ends_at: instant(f, 120),
          note: "Repair estimate moved to tomorrow.",
        }),
      ).toMatchObject({
        planned_ends_at: instant(f, 60),
        proposed_ends_at: instant(f, 120),
      });
      expect(
        await action(f, stay.id, 3, "record_response", {
          response: "decline",
          response_for: "extension",
          observed_at: f.now,
          method: "phone",
          note: "Resident declined this extension on the phone.",
        }),
      ).toMatchObject({
        state: "accepted",
        planned_ends_at: instant(f, 60),
        proposed_ends_at: null,
      });
      const receipt = await db
        .selectFrom("accommodation_receipts")
        .selectAll()
        .where("stay_id", "=", stay.id)
        .where("revision", "=", 2)
        .executeTakeFirstOrThrow();
      expect(receipt).toMatchObject({
        actor_person_id: f.custodianPersonId,
        method: "in_person",
        response: "accept",
        response_for: "offer",
      });
    });
  }, 60_000);
  it("never frees actual occupancy when the planned end passes, including unnamed shared capacity", async () => {
    const f = await createAccommodationFixture(db);
    const stay = await f.run(async () => {
      const shared = await room(f, 1, "shared"),
        created = await f.accommodation.offer(
          f.user,
          f.schoolId,
          offer(f, shared.id),
        );
      await f.accommodation.act(f.borrower, f.schoolId, created.id, {
        ...command(1),
        action: "accept",
      });
      await action(f, created.id, 2, "move_in", { observed_at: f.now });
      return { id: created.id, room: shared.id };
    });
    await at(f, 61, async () => {
      expect(
        await f.accommodation.detail(f.borrower, f.schoolId, stay.id),
      ).toMatchObject({ overstayed: true, actual_move_out_at: null });
      const person = await passive(f, "Waiting resident");
      await expect(
        f.accommodation.offer(
          f.user,
          f.schoolId,
          offer(f, stay.room, {
            resident_person_id: person.id,
            starts_at: instant(f, 62),
            ends_at: instant(f, 120),
          }),
        ),
      ).rejects.toThrow("no capacity");
    });
  }, 60_000);
  it("keeps temporary-key custody separate, blocks empty linkage closure and required-access capacity release until actual return", async () => {
    const f = await createAccommodationFixture(db);
    await f.run(async () => {
      const shared = await room(f, 1, "shared"),
        created = await f.accommodation.offer(
          f.user,
          f.schoolId,
          offer(f, shared.id, { access_mode: "tracked_required" }),
        );
      await f.accommodation.act(f.borrower, f.schoolId, created.id, {
        ...command(1),
        action: "accept",
      });
      await action(f, created.id, 2, "move_in", { observed_at: f.now });
      await action(f, created.id, 3, "move_out", {
        observed_at: f.now,
        destination_note: "Original room",
      });
      await expect(action(f, created.id, 4, "close")).rejects.toThrow(
        "temporary access",
      );
      const loan = await f.resources.issue(f.user, f.schoolId, {
        ...command(),
        holding_id: f.holdingId,
        borrower_person_id: f.borrowerPersonId,
        due_at: instant(f, 120),
        custody_confirmed: true,
        custody_purpose: "Temporary room access for fictional stay.",
      });
      expect(
        await f.accommodation.linkAccess(f.user, f.schoolId, created.id, {
          ...command(4),
          loan_id: loan.id,
          return_required: true,
        }),
      ).toMatchObject({ revision: 5, access_settled: false });
      const person = await passive(f, "Next resident");
      await expect(
        f.accommodation.offer(
          f.user,
          f.schoolId,
          offer(f, shared.id, { resident_person_id: person.id }),
        ),
      ).rejects.toThrow("no capacity");
      const detail = await f.resources.detail(f.user, f.schoolId, loan.id),
        item = detail.parts.find((part) => part.kind === "item")!;
      await f.resources.recordReturn(f.user, f.schoolId, loan.id, {
        ...command(1),
        observed_at: f.now,
        parts: [{ part_id: item.id, quantity: 1, condition: "usable" }],
        reason: "Temporary access item physically returned.",
      });
      expect(
        await f.accommodation.detail(f.borrower, f.schoolId, created.id),
      ).toMatchObject({ access_settled: true });
      expect(
        (await f.accommodation.work(f.user, f.schoolId)).needs_me[0],
      ).toMatchObject({ action: "coordinate" });
      expect(await action(f, created.id, 5, "close")).toMatchObject({
        state: "closed",
      });
      expect(
        await f.accommodation.offer(
          f.user,
          f.schoolId,
          offer(f, shared.id, { resident_person_id: person.id }),
        ),
      ).toMatchObject({ state: "offered" });
    });
  }, 60_000);
  it("keeps setup rights separate from exact delegated movement, uses source revisions, and rejects unrelated private access", async () => {
    const f = await createAccommodationFixture(db);
    const other = await createAccommodationFixture(db);
    await f.run(async () => {
      const registered = await room(f),
        created = await f.accommodation.offer(
          f.user,
          f.schoolId,
          offer(f, registered.id, {
            resident_person_id: f.custodianPersonId,
            recorder_person_id: f.borrowerPersonId,
          }),
        );
      await action(f, created.id, 1, "accept");
      await expect(
        f.accommodation.saveRoomType(f.borrower, f.schoolId, {
          ...command(),
          name: "Unauthorized type",
          default_capacity: 1,
          allocation_mode: "whole_room",
        }),
      ).rejects.toThrow();
      expect(
        await f.accommodation.act(f.borrower, f.schoolId, created.id, {
          ...command(2),
          action: "move_in",
          observed_at: f.now,
        }),
      ).toMatchObject({ actual_move_in_at: f.now });
      await expect(
        action(f, created.id, 2, "extend", {
          ends_at: instant(f, 120),
          note: "Stale extension",
        }),
      ).rejects.toMatchObject({ response: { code: "accommodation_obsolete" } });
      await other.run(async () => {
        await expect(
          f.accommodation.detail(other.user, other.schoolId, created.id),
        ).rejects.toThrow("unavailable");
      });
    });
  }, 60_000);
  it("requires immutable native evidence and rejects direct historical rewrites", async () => {
    const f = await createAccommodationFixture(db);
    await f.run(async () => {
      const registered = await room(f),
        created = await f.accommodation.offer(
          f.user,
          f.schoolId,
          offer(f, registered.id),
        );
      await expect(
        db
          .updateTable("accommodation_receipts")
          .set({ note: "rewrite" })
          .where("stay_id", "=", created.id)
          .execute(),
      ).rejects.toThrow("append-only");
      await expect(
        db
          .updateTable("accommodation_stays")
          .set({ revision: 2, state: "cancelled" })
          .where("id", "=", created.id)
          .execute(),
      ).rejects.toThrow("immutable operation");
      const payloads = await db
        .selectFrom("event_outbox")
        .select("payload")
        .where("school_id", "=", f.schoolId)
        .where("event_type", "=", "accommodation.updated")
        .execute();
      expect(JSON.stringify(payloads)).not.toContain("resident");
      expect((await sql`SELECT 1`.execute(db)).rows).toHaveLength(1);
    });
  }, 60_000);
  it("retracts a mistaken departure with signed evidence, refuses an overlapping later actual resident, and safely retracts an unused arrival", async () => {
    const f = await createAccommodationFixture(db);
    await f.run(async () => {
      const registered = await room(f),
        created = await f.accommodation.offer(
          f.user,
          f.schoolId,
          offer(f, registered.id),
        );
      await f.accommodation.act(f.borrower, f.schoolId, created.id, {
        ...command(1),
        action: "accept",
      });
      await action(f, created.id, 2, "move_in", { observed_at: f.now });
      await action(f, created.id, 3, "move_out", {
        observed_at: f.now,
        destination_note: "Mistaken departure entry",
      });
      const departure = await db
        .selectFrom("accommodation_receipts")
        .select("id")
        .where("stay_id", "=", created.id)
        .where("action", "=", "moved_out")
        .executeTakeFirstOrThrow();
      const corrected = await action(f, created.id, 4, "correct_move", {
        movement: "move_out",
        retract: true,
        supersedes_receipt_id: departure.id,
        note: "Resident has not left; desk entry was mistaken.",
      });
      expect(corrected).toMatchObject({
        state: "accepted",
        actual_move_in_at: f.now,
        actual_move_out_at: null,
        destination_note: "",
        revision: 5,
      });
      expect(
        await db
          .selectFrom("accommodation_receipts")
          .select([
            "movement_kind",
            "movement_retracted",
            "supersedes_receipt_id",
          ])
          .where("stay_id", "=", created.id)
          .where("revision", "=", 5)
          .executeTakeFirstOrThrow(),
      ).toEqual({
        movement_kind: "move_out",
        movement_retracted: true,
        supersedes_receipt_id: departure.id,
      });
      await expect(
        action(f, created.id, 5, "correct_move", {
          movement: "move_out",
          retract: true,
          supersedes_receipt_id: departure.id,
          note: "Already corrected before",
        }),
      ).rejects.toThrow("superseded");
      const arrival = await db
        .selectFrom("accommodation_receipts")
        .select("id")
        .where("stay_id", "=", created.id)
        .where("action", "=", "moved_in")
        .executeTakeFirstOrThrow();
      expect(
        await action(f, created.id, 5, "correct_move", {
          movement: "move_in",
          retract: true,
          supersedes_receipt_id: arrival.id,
          note: "Both moves were desk mistakes; no custody or actual departure occurred.",
        }),
      ).toMatchObject({
        state: "accepted",
        actual_move_in_at: null,
        actual_move_out_at: null,
        revision: 6,
      });
      await action(f, created.id, 6, "move_in", { observed_at: f.now });
      await action(f, created.id, 7, "move_out", {
        observed_at: f.now,
        destination_note: "Resident actually returned to original room",
      });
      const lastDeparture = await db
        .selectFrom("accommodation_receipts")
        .select("id")
        .where("stay_id", "=", created.id)
        .where("revision", "=", 8)
        .executeTakeFirstOrThrow();
      const next = await f.accommodation.offer(
        f.user,
        f.schoolId,
        offer(f, registered.id, { resident_person_id: f.custodianPersonId }),
      );
      await action(f, next.id, 1, "accept");
      await action(f, next.id, 2, "move_in", { observed_at: f.now });
      await expect(
        action(f, created.id, 8, "correct_move", {
          movement: "move_out",
          retract: true,
          supersedes_receipt_id: lastDeparture.id,
          note: "Cannot restore old occupancy over the next actual resident.",
        }),
      ).rejects.toThrow("physically occupied");
      expect(
        await f.accommodation.detail(f.borrower, f.schoolId, created.id),
      ).toMatchObject({ revision: 8, actual_move_out_at: f.now });
    });
  }, 60_000);
  it("keeps canonical hostel ancestors and named furniture stable, with explicit type defaults and source-bound movement options", async () => {
    const f = await createAccommodationFixture(db);
    await f.run(async () => {
      const hostel = await f.topology.createSpace(
        f.user,
        f.schoolId,
        {
          campus_id: f.campusId,
          name: "Fictional Cedar Hostel",
          code: `HOSTEL-${randomUUID().slice(0, 8)}`,
          kind: "hostel",
          is_bookable: false,
        },
        resourceLoanRequest(f.user),
      );
      const physical = await f.topology.createSpace(
        f.user,
        f.schoolId,
        {
          campus_id: f.campusId,
          parent_space_id: hostel.id,
          name: "Room Seven",
          code: `ROOM-${randomUUID().slice(0, 8)}`,
          kind: "residential_room",
          is_bookable: false,
        },
        resourceLoanRequest(f.user),
      );
      const typeInput = {
          ...command(),
          name: `Twin ${randomUUID().slice(0, 8)}`,
          default_capacity: 2,
          allocation_mode: "shared",
        },
        type = await f.accommodation.saveRoomType(
          f.user,
          f.schoolId,
          typeInput,
        );
      const registered = await f.accommodation.saveRoom(f.user, f.schoolId, {
        ...command(),
        space_id: physical.id,
        room_type_id: type.id,
        sleeping_capacity: 2,
        allocation_mode: "shared",
      });
      expect(registered.location_path.map((ref) => ref.label)).toEqual([
        "Resources room",
        "Fictional Cedar Hostel",
        "Room Seven",
      ]);
      expect(
        await f.accommodation.setupConfirmation(
          f.user,
          f.schoolId,
          typeInput.command_id,
        ),
      ).toMatchObject({
        state: "accepted",
        result: { id: type.id, kind: "room_type", revision: 1 },
      });
      await f.accommodation.saveRoomType(f.user, f.schoolId, {
        ...command(1),
        id: type.id,
        name: type.name,
        default_capacity: 6,
        allocation_mode: "shared",
        reason: "New rooms may use a larger default.",
      });
      expect(
        await f.accommodation.room(f.user, f.schoolId, registered.id),
      ).toMatchObject({ sleeping_capacity: 2 });
      await expect(
        db
          .updateTable("campus_spaces")
          .set({ status: "inactive" })
          .where("id", "=", String(hostel.id))
          .execute(),
      ).rejects.toThrow("containing hostel");
      await expect(
        db
          .updateTable("campus_spaces")
          .set({ status: "inactive" })
          .where("id", "=", String(physical.id))
          .execute(),
      ).rejects.toThrow("residential");
      const stay = await f.accommodation.offer(
        f.user,
        f.schoolId,
        offer(f, registered.id, {
          resident_person_id: f.custodianPersonId,
          recorder_person_id: f.borrowerPersonId,
        }),
      );
      expect(
        (
          await f.accommodation.options(f.borrower, f.schoolId, {
            stay_id: stay.id,
          })
        ).spaces.some((space) => space.id === physical.id),
      ).toBe(true);
      await expect(
        f.accommodation.saveRoom(f.user, f.schoolId, {
          ...command(1),
          id: registered.id,
          space_id: physical.id,
          room_type_id: type.id,
          sleeping_capacity: 1,
          allocation_mode: "shared",
          reason: "Cannot shrink an offered room.",
        }),
      ).rejects.toThrow("Settle current offers");
    });
  }, 60_000);
  it("keeps unrelated managers out of private stays while exposing minimal explicit orphan recovery", async () => {
    const f = await createAccommodationFixture(db);
    await f.run(async () => {
      const registered = await room(f),
        input = offer(f, registered.id, {
          coordinator_person_id: f.borrowerPersonId,
          recorder_person_id: f.borrowerPersonId,
          instructions: "Private resident instructions",
        }),
        created = await f.accommodation.offer(f.user, f.schoolId, input);
      expect(created).toMatchObject({ access_transferred: true });
      await expect(
        f.accommodation.detail(f.user, f.schoolId, created.id),
      ).rejects.toThrow("private");
      expect(
        (await f.accommodation.workspace(f.user, f.schoolId)).stays,
      ).toEqual([]);
      await db
        .updateTable("school_memberships")
        .set({ is_active: false })
        .where("school_id", "=", f.schoolId)
        .where("user_id", "=", f.borrower.id)
        .execute();
      const recovery = await f.accommodation.detail(
        f.user,
        f.schoolId,
        created.id,
      );
      expect(recovery).toMatchObject({ recovery_only: true, history: [] });
      expect(recovery).not.toHaveProperty("resident");
      expect(JSON.stringify(recovery)).not.toContain("Private resident");
      expect(
        (await f.accommodation.work(f.user, f.schoolId)).needs_me,
      ).toMatchObject([{ stay_id: created.id, action: "recover" }]);
      expect((await f.accommodation.work(f.user, f.schoolId)).needs_me[0]).not.toHaveProperty("detail");
      expect(
        await action(f, created.id, 1, "reassign", {
          coordinator_person_id: f.custodianPersonId,
          recorder_person_id: f.custodianPersonId,
          note: "Named coordinator no longer has current campus app access.",
        }),
      ).toMatchObject({
        revision: 2,
        recovery_only: false,
        coordinator: { id: f.custodianPersonId },
      });
    });
  }, 60_000);
});
