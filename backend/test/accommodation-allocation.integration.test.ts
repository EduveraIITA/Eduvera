import { createHash, randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import type { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import { accommodationOffer } from "../src/facilities/accommodation/accommodation.contracts.js";
import { createAccommodationFixture } from "./accommodation.test-support.js";
import { resourceLoanRequest } from "./resource-loans.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true",
  url = enabled
    ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL)
    : "postgresql://invalid.invalid/accommodation_allocation_unused_test";
const db = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: url, max: 3 }),
  }),
}) as DatabaseService;
afterAll(() => db.destroy());
type Fixture = Awaited<ReturnType<typeof createAccommodationFixture>>;
const command = (expected_revision = 0) => ({
  command_id: randomUUID(),
  expected_revision,
});
const instant = (f: Fixture, minutes: number) =>
  new Date(Date.parse(f.now) + minutes * 60_000).toISOString();
async function room(f: Fixture) {
  const space = await f.topology.createSpace(
    f.user,
    f.schoolId,
    {
      campus_id: f.campusId,
      name: "Fictional allocation room",
      code: `ALLOC-${randomUUID().slice(0, 8)}`,
      kind: "residential_room",
      capacity: null,
      is_bookable: false,
    },
    resourceLoanRequest(f.user),
  );
  const type = await f.accommodation.saveRoomType(f.user, f.schoolId, {
    ...command(),
    name: `Allocation ${randomUUID().slice(0, 8)}`,
    default_capacity: 1,
    allocation_mode: "whole_room",
  });
  return f.accommodation.saveRoom(f.user, f.schoolId, {
    ...command(),
    space_id: space.id,
    room_type_id: type.id,
    sleeping_capacity: 1,
    allocation_mode: "whole_room",
  });
}
const input = (f: Fixture, roomId: string) => ({
  ...command(),
  resident_person_id: f.borrowerPersonId,
  coordinator_person_id: f.custodianPersonId,
  recorder_person_id: f.custodianPersonId,
  room_id: roomId,
  starts_at: instant(f, -1),
  ends_at: instant(f, 60),
  access_mode: "no_tracked_item",
});

describe.skipIf(!enabled)("Explicit coordinator room allocation", () => {
  it("confirms an allocation without a resident decision or physical claim, then keeps a current occupied stay quiet", async () => {
    const f = await createAccommodationFixture(db);
    await f.run(async () => {
      const registered = await room(f),
        allocation = {
          ...input(f, registered.id),
          arrangement_basis: "coordinator_allocation",
        };
      let stay = await f.accommodation.offer(f.user, f.schoolId, allocation);
      expect(stay).toMatchObject({
        id: allocation.command_id,
        revision: 1,
        state: "accepted",
        arrangement_basis: "coordinator_allocation",
        accepted_at: f.now,
        actual_move_in_at: null,
        allowed_actions: {
          accept: false,
          record_response: false,
          extend: false,
          change_end: true,
          move_in: true,
        },
        history: [{ action: "allocated", response: null, method: null, observed_at: null }],
      });
      expect((await f.accommodation.work(f.borrower, f.schoolId)).needs_me).toEqual([]);
      expect(await f.accommodation.offer(f.user, f.schoolId, allocation)).toMatchObject({ id: stay.id, revision: 1 });
      await expect(f.accommodation.offer(f.user, f.schoolId, { ...allocation, arrangement_basis: "resident_offer" })).rejects.toThrow("different accommodation");
      await expect(f.accommodation.act(f.borrower, f.schoolId, stay.id, { ...command(1), action: "accept" })).rejects.toThrow("no resident decision");
      await expect(f.accommodation.act(f.user, f.schoolId, stay.id, { ...command(1), action: "record_response", response: "accept", response_for: "offer", observed_at: f.now, method: "in_person", note: "Would be a false response" })).rejects.toThrow("no resident decision");

      stay = await f.accommodation.act(f.user, f.schoolId, stay.id, {
        ...command(1), action: "move_in", observed_at: f.now, method: "in_person",
      });
      expect(stay).toMatchObject({ revision: 2, actual_move_in_at: f.now, allowed_actions: { move_out: true } });
      expect(await f.accommodation.work(f.user, f.schoolId)).toEqual({ needs_me: [], waiting: [] });
      const change = { ...command(2), action: "change_end", ends_at: instant(f, 120), note: "Coordinator revised the planned stay" };
      stay = await f.accommodation.act(f.user, f.schoolId, stay.id, change);
      expect(stay).toMatchObject({ revision: 3, planned_ends_at: instant(f, 120), proposed_ends_at: null, actual_move_in_at: f.now });
      if (!("history" in stay)) throw new Error("The exact coordinator must retain stay access.");
      expect(stay.history[0]).toMatchObject({ action: "end_changed", response: null, observed_at: null });
      expect(await f.accommodation.act(f.user, f.schoolId, stay.id, change)).toMatchObject({ revision: 3 });
      await expect(f.accommodation.act(f.user, f.schoolId, stay.id, { ...change, ends_at: instant(f, 180) })).rejects.toThrow("different accommodation");
      expect(await f.accommodation.work(f.user, f.schoolId)).toEqual({ needs_me: [], waiting: [] });
      const receipts = await db.selectFrom("accommodation_receipts").selectAll().where("stay_id", "=", stay.id).orderBy("revision").execute();
      expect(receipts.map((row) => row.action)).toEqual(["allocated", "moved_in", "end_changed"]);
      expect(receipts.every((row) => row.arrangement_basis === "coordinator_allocation" && row.response === null)).toBe(true);
      expect(receipts[1]).toMatchObject({ method: "in_person" });
      expect(await db.selectFrom("campus_model_commands").select(["command_type", "state"]).where("id", "=", receipts[0]!.command_id).executeTakeFirstOrThrow()).toEqual({ command_type: "accommodation.allocated", state: "accepted" });
      await expect(sql`UPDATE accommodation_stays SET arrangement_basis='resident_offer',revision=revision+1 WHERE id=${stay.id}::uuid`.execute(db)).rejects.toThrow("arrangement commitment");

      const nextPerson = await f.people.create(resourceLoanRequest(f.user), f.schoolId, { first_name: "Fictional next resident", last_name: "", idempotency_key: randomUUID() });
      await expect(f.accommodation.offer(f.user, f.schoolId, { ...allocation, ...command(), resident_person_id: nextPerson.id })).rejects.toThrow("capacity");
    });
  }, 30_000);

  it("keeps omitted-basis legacy offer hashes and resident-response requirements intact", async () => {
    const f = await createAccommodationFixture(db);
    await f.run(async () => {
      const registered = await room(f), offer = input(f, registered.id), parsed = accommodationOffer.parse(offer);
      expect(parsed).not.toHaveProperty("arrangement_basis");
      const stay = await f.accommodation.offer(f.user, f.schoolId, offer);
      expect(stay).toMatchObject({ state: "offered", arrangement_basis: "resident_offer", accepted_at: null, actual_move_in_at: null });
      const retained = await db.selectFrom("campus_model_commands").select("safe_context").where("school_id", "=", f.schoolId).where("command_type", "=", "accommodation.offered").where("safe_context", "@>", JSON.stringify({ source_id: stay.id })).executeTakeFirstOrThrow();
      expect(retained.safe_context).toMatchObject({ payload_hash: createHash("sha256").update(JSON.stringify({ source_id: stay.id, action: "offered", ...parsed })).digest("hex") });
      expect(await f.accommodation.offer(f.user, f.schoolId, offer)).toMatchObject({ id: stay.id, revision: 1 });
      await expect(f.accommodation.act(f.user, f.schoolId, stay.id, { ...command(1), action: "change_end", ends_at: instant(f, 120), note: "Not a direct allocation" })).rejects.toThrow("assignment change");
      expect((await f.accommodation.work(f.borrower, f.schoolId)).needs_me).toMatchObject([{ stay_id: stay.id, action: "respond" }]);
    });
  }, 30_000);
});
