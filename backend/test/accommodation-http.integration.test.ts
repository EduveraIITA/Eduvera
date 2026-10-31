import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect } from "kysely";
import { Pool, types } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import type { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import {
  academicScaffoldingCounts,
  createLearningOfferingFixture,
} from "./learning-offerings.test-support.js";
import {
  IsolatedAppHttp,
  type IsolatedHttpSession,
} from "./isolated-app-http.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
const source = enabled
  ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL)
  : "postgresql://invalid.invalid/accommodation_http_unused_test";
types.setTypeParser(1082, (value) => value);
const db = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: source, max: 3 }),
  }),
}) as DatabaseService;
const app = new IsolatedAppHttp();
interface Ref {
  id: string;
  revision: number;
}
interface Stay extends Ref {
  state: string;
  accepted_at: string | null;
  actual_move_in_at: string | null;
  actual_move_out_at: string | null;
  access_settled: boolean;
  history: Array<{ id: string; action: string }>;
}
interface Loan extends Ref {
  parts: Array<{ id: string; kind: string }>;
}
interface Manifest {
  areas: Array<{ key: string }>;
  work: {
    items: Array<{
      direction: string;
      href: string;
      source?: { kind: string; id: string };
    }>;
  };
}
const command = (expected_revision = 0) => ({
  command_id: randomUUID(),
  expected_revision,
});
const work = async (session: IsolatedHttpSession, id: string) =>
  (await session.json<Manifest>("/api/v1/workspace/")).work.items.filter(
    (item) => item.href === `/areas/accommodation?stay_id=${id}`,
  );

describe.runIf(enabled)(
  "Accommodation through the ordinary compiled authenticated application",
  () => {
    beforeAll(() => app.start(source), 30_000);
    afterAll(async () => {
      await app.stop();
      await db.destroy();
    }, 10_000);
    it("builds canonical hostel/room context, respects resident consent and settles real temporary-key custody independently", async () => {
      process.env.INVITATION_EMAIL_ENABLED = "false";
      const f = await createLearningOfferingFixture(db),
        password = `Fictional-Accommodation-${randomUUID()}!`;
      await db
        .updateTable("users")
        .set({ password_hash: await hashPassword(password) })
        .where("id", "in", [
          f.owner.id,
          f.learner.actor.id,
          f.secondLearner.actor.id,
        ])
        .execute();
      const owner = app.session(),
        resident = app.session(),
        other = app.session();
      for (const [session, actor] of [
        [owner, f.owner],
        [resident, f.learner.actor],
        [other, f.secondLearner.actor],
      ] as const)
        await session.login(actor.email, password, f.schoolId);
      const identity = await db.transaction().execute((tx) =>
        f.core.resolveAccountEndpoint(tx, {
          school_id: f.schoolId,
          user_id: f.owner.id,
          at: new Date().toISOString(),
        }),
      );
      const base = `/api/v1/schools/${f.schoolId}/facilities/accommodation`,
        topology = `/api/v1/schools/${f.schoolId}/institution-setup`;
      expect((await app.session().request(`${base}/workspace`)).status).toBe(
        401,
      );
      await owner.json("/api/v1/onboarding/goals/", "PUT", {
        goals: ["accommodation"],
      });
      const campus = await owner.json<Ref>(`${topology}/campuses/`, "POST", {
        name: "Fictional Riverview campus",
        code: `QA-${randomUUID().slice(0, 8)}`,
        campus_type: "main",
        is_primary: true,
        timezone: "UTC",
      });
      const hostel = await owner.json<Ref>(`${topology}/spaces/`, "POST", {
        campus_id: campus.id,
        name: "Fictional Maple hostel",
        code: "MAPLE",
        kind: "hostel",
        is_bookable: false,
      });
      const space = await owner.json<Ref>(`${topology}/spaces/`, "POST", {
        campus_id: campus.id,
        parent_space_id: hostel.id,
        name: "Fictional Room 102",
        code: "MAPLE-102",
        kind: "residential_room",
        is_bookable: false,
      });
      const typeInput = {
        ...command(),
        name: "Fictional single room",
        default_capacity: 1,
        allocation_mode: "whole_room",
      };
      expect(
        (await resident.request(`${base}/room-types`, "POST", typeInput))
          .status,
      ).toBe(403);
      expect(
        (await owner.request(`${base}/room-types`, "POST", typeInput, false))
          .status,
      ).toBe(403);
      const type = await owner.json<Ref>(
        `${base}/room-types`,
        "POST",
        typeInput,
      );
      const room = await owner.json<Ref>(`${base}/rooms`, "POST", {
        ...command(),
        space_id: space.id,
        room_type_id: type.id,
        sleeping_capacity: 1,
        allocation_mode: "whole_room",
      });
      const offer = {
        ...command(),
        resident_person_id: f.learner.id,
        room_id: room.id,
        coordinator_person_id: identity.person_id,
        recorder_person_id: identity.person_id,
        starts_at: new Date(Date.now() - 1000).toISOString(),
        ends_at: new Date(Date.now() + 86_400_000).toISOString(),
        access_mode: "tracked_required",
        instructions: "PRIVATE fictional desk instructions",
      };
      let stay = await owner.json<Stay>(`${base}/stays`, "POST", offer);
      expect(stay).toMatchObject({
        id: offer.command_id,
        state: "offered",
        revision: 1,
        actual_move_in_at: null,
      });
      expect(await owner.json(`${base}/stays`, "POST", offer)).toMatchObject({
        id: stay.id,
        revision: 1,
      });
      expect(
        (
          await owner.request(`${base}/stays`, "POST", {
            ...offer,
            instructions: "Changed commitment",
          })
        ).status,
      ).toBe(409);
      const path = `${base}/stays/${stay.id}`;
      expect((await other.request(path)).status).toBe(403);
      expect(await work(resident, stay.id)).toMatchObject([
        { direction: "needs_me" },
      ]);
      expect(JSON.stringify(await work(resident, stay.id))).not.toContain(
        "PRIVATE fictional",
      );
      const act = async (
        session: IsolatedHttpSession,
        action: string,
        extra: Record<string, unknown> = {},
      ) => {
        stay = await session.json<Stay>(`${path}/actions`, "POST", {
          ...command(stay.revision),
          action,
          ...extra,
        });
      };
      expect(
        (
          await owner.request(`${path}/actions`, "POST", {
            ...command(stay.revision),
            action: "accept",
          })
        ).status,
      ).toBe(403);
      await act(resident, "accept");
      expect(stay).toMatchObject({
        state: "accepted",
        actual_move_in_at: null,
      });
      const move = command(stay.revision);
      stay = await owner.json<Stay>(`${path}/actions`, "POST", {
        ...move,
        action: "move_in",
        observed_at: new Date().toISOString(),
      });
      expect(stay.actual_move_in_at).not.toBeNull();
      expect(
        await owner.json(`${path}/confirmation?command_id=${move.command_id}`),
      ).toMatchObject({
        state: "accepted",
        result: { id: stay.id, revision: stay.revision },
      });
      const resources = `/api/v1/schools/${f.schoolId}/resources`;
      const key = await owner.json<Ref>(`${resources}/items`, "POST", {
        command_id: randomUUID(),
        campus_id: campus.id,
        name: "Fictional temporary room key",
        asset_tag: `KEY-${randomUUID().slice(0, 8)}`,
      });
      let loan = await owner.json<Loan>(`${resources}/loans`, "POST", {
        ...command(),
        holding_id: key.id,
        borrower_person_id: f.learner.id,
        due_at: offer.ends_at,
        custody_confirmed: true,
        custody_purpose:
          "Fictional temporary access item actually issued at the desk.",
      });
      stay = await owner.json<Stay>(`${path}/access-loans`, "POST", {
        ...command(stay.revision),
        loan_id: loan.id,
        return_required: true,
      });
      expect(stay.access_settled).toBe(false);
      await act(owner, "move_out", {
        observed_at: new Date().toISOString(),
        destination_note: "Fictional original room after repair check",
      });
      expect(stay.actual_move_out_at).not.toBeNull();
      expect(stay.access_settled).toBe(false);
      const mistakenDeparture = stay.history.find(
        (receipt) => receipt.action === "moved_out",
      )!;
      await act(owner, "correct_move", {
        movement: "move_out",
        retract: true,
        supersedes_receipt_id: mistakenDeparture.id,
        note: "Fictional desk entry was mistaken; resident has not yet left.",
      });
      expect(stay.actual_move_out_at).toBeNull();
      expect(stay.access_settled).toBe(false);
      await act(owner, "move_out", {
        observed_at: new Date().toISOString(),
        destination_note: "Fictional original room after the actual move",
      });
      expect(
        (
          await owner.request(`${path}/actions`, "POST", {
            ...command(stay.revision),
            action: "close",
          })
        ).status,
      ).toBe(422);
      const part = loan.parts.find((item) => item.kind === "item")!;
      loan = await owner.json<Loan>(
        `${resources}/loans/${loan.id}/returns`,
        "POST",
        {
          ...command(loan.revision),
          observed_at: new Date().toISOString(),
          reason: "Fictional temporary key physically returned to desk",
          parts: [{ part_id: part.id, quantity: 1, condition: "usable" }],
        },
      );
      stay = await resident.json<Stay>(path);
      expect(stay.access_settled).toBe(true);
      await act(owner, "close");
      expect(stay.state).toBe("closed");
      expect(await work(owner, stay.id)).toEqual([]);
      expect(await work(resident, stay.id)).toEqual([]);
      expect(
        (await owner.json<Manifest>("/api/v1/workspace/")).areas,
      ).toContainEqual(expect.objectContaining({ key: "accommodation" }));
      expect(await academicScaffoldingCounts(db, f.schoolId)).toEqual({
        students: 0,
        staff: 0,
        classes: 0,
        terms: 0,
        enrollments: 0,
        guardians: 0,
        roles: 0,
        schedules: 0,
      });
      await db
        .updateTable("school_memberships")
        .set({ is_active: false })
        .where("school_id", "=", f.schoolId)
        .where("user_id", "=", f.learner.actor.id)
        .execute();
      expect((await resident.request(path)).status).toBe(403);
    }, 120_000);

    it("assigns a room directly without a resident-decision task, and clears movement work after actual check-in", async () => {
      const f = await createLearningOfferingFixture(db),
        password = `Fictional-Direct-Room-${randomUUID()}!`;
      await db.updateTable("users").set({ password_hash: await hashPassword(password) }).where("id", "in", [f.owner.id, f.learner.actor.id]).execute();
      const owner = app.session(), resident = app.session();
      await owner.login(f.owner.email, password, f.schoolId);
      await resident.login(f.learner.actor.email, password, f.schoolId);
      const identity = await db.transaction().execute((tx) => f.core.resolveAccountEndpoint(tx, {
        school_id: f.schoolId, user_id: f.owner.id, at: new Date().toISOString(),
      }));
      const base = `/api/v1/schools/${f.schoolId}/facilities/accommodation`,
        topology = `/api/v1/schools/${f.schoolId}/institution-setup`;
      const campus = await owner.json<Ref>(`${topology}/campuses/`, "POST", {
        name: "Fictional direct-allocation campus", code: `DIRECT-${randomUUID().slice(0, 8)}`,
        campus_type: "main", is_primary: true, timezone: "UTC",
      });
      const space = await owner.json<Ref>(`${topology}/spaces/`, "POST", {
        campus_id: campus.id, name: "Fictional Room 203", code: "ROOM-203",
        kind: "residential_room", is_bookable: false,
      });
      const type = await owner.json<Ref>(`${base}/room-types`, "POST", {
        ...command(), name: "Fictional single allocation", default_capacity: 1, allocation_mode: "whole_room",
      });
      const room = await owner.json<Ref>(`${base}/rooms`, "POST", {
        ...command(), space_id: space.id, room_type_id: type.id, sleeping_capacity: 1, allocation_mode: "whole_room",
      });
      const allocation = {
        ...command(), arrangement_basis: "coordinator_allocation", resident_person_id: f.learner.id,
        room_id: room.id, coordinator_person_id: identity.person_id, recorder_person_id: identity.person_id,
        starts_at: new Date(Date.now() - 1000).toISOString(), ends_at: new Date(Date.now() + 86_400_000).toISOString(),
        access_mode: "no_tracked_item",
      };
      let stay = await owner.json<Stay>(`${base}/stays`, "POST", allocation);
      expect(stay).toMatchObject({ state: "accepted", arrangement_basis: "coordinator_allocation", revision: 1,
        actual_move_in_at: null, history: [{ action: "allocated", response: null, method: null }],
        allowed_actions: { record_response: false, change_end: true },
      });
      expect(await owner.json(`${base}/stays`, "POST", allocation)).toMatchObject({ id: stay.id, revision: 1 });
      // Allocation needs no resident decision. The resident may still truthfully
      // see that the recorder has not yet recorded the physical check-in.
      const residentBeforeCheckIn = await work(resident, stay.id);
      expect(residentBeforeCheckIn).toMatchObject([{ direction: "waiting" }]);
      expect(residentBeforeCheckIn.filter((item) => item.direction === "needs_me")).toEqual([]);
      const path = `${base}/stays/${stay.id}`;
      expect((await resident.request(`${path}/actions`, "POST", { ...command(1), action: "accept" })).status).toBe(422);
      stay = await owner.json<Stay>(`${path}/actions`, "POST", {
        ...command(1), action: "move_in", observed_at: new Date().toISOString(), method: "in_person",
      });
      expect(stay).toMatchObject({ actual_move_out_at: null, allowed_actions: { move_out: true } });
      expect(stay.actual_move_in_at).not.toBeNull();
      expect(await work(owner, stay.id)).toEqual([]);
      expect(await work(resident, stay.id)).toEqual([]);
      stay = await owner.json<Stay>(`${path}/actions`, "POST", {
        ...command(stay.revision), action: "change_end", ends_at: new Date(Date.now() + 172_800_000).toISOString(),
        note: "Coordinator confirmed a revised planned end",
      });
      expect(stay).toMatchObject({ revision: 3, proposed_ends_at: null });
      expect(stay.history[0]).toMatchObject({ action: "end_changed", response: null });
      expect(await work(owner, stay.id)).toEqual([]);
    }, 45_000);
  },
);
