import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { assertSpaceCanBecomeResidential } from "../src/common/campus-space-use.js";
import { ResponsibilityProjectionService } from "../src/campus-model-core/responsibility-projection.service.js";
import type { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import { ActivityPlanningService } from "../src/schedule-planning/activity-planning.service.js";
import {
  createResourceLoanFixture,
  resourceLoanRequest,
} from "./resource-loans.test-support.js";
import { createAccommodationFixture } from "./accommodation.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
const db = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new Pool({
      connectionString: enabled
        ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL)
        : "postgresql://invalid.invalid/accommodation_space_unused_test",
      max: 3,
    }),
  }),
}) as DatabaseService;
afterAll(() => db.destroy());

describe.runIf(enabled)(
  "dedicated accommodation and owning campus space commitments",
  () => {
    it("checks beyond a materialized month and retains cancelled activity history without blocking residential conversion", async () => {
      process.env.INVITATION_EMAIL_ENABLED = "false";
      const f = await createResourceLoanFixture(db);
      await f.run(async () => {
        const space = z
          .object({ id: z.uuid() })
          .parse(
            await f.topology.createSpace(
              f.user,
              f.schoolId,
              {
                campus_id: f.campusId,
                name: "Fictional future use room",
                code: `ROOM-${randomUUID().slice(0, 8)}`,
                kind: "other",
                capacity: 40,
              },
              resourceLoanRequest(f.user),
            ),
          );
        await db
          .transaction()
          .execute((tx) =>
            assertSpaceCanBecomeResidential(tx, f.schoolId, space.id, f.now),
          );
        const day = new Date(Date.parse(f.now) + 45 * 86400000)
          .toISOString()
          .slice(0, 10);
        const planning = new ActivityPlanningService(
          db,
          f.events,
          f.core,
          f.core,
          f.core,
          new ResponsibilityProjectionService(f.core),
        );
        const draft = z
          .object({ id: z.uuid() })
          .parse(
            await planning.create(resourceLoanRequest(f.user), f.schoolId, {
              idempotency_key: randomUUID(),
              title: "Fictional future room meeting",
              purpose: "meeting",
              timezone: "UTC",
              starts_on: day,
              recurrence: "weekly",
              weekdays: [1, 2, 3, 4, 5, 6, 7],
              starts_at: "09:00",
              ends_at: "10:00",
              space_id: space.id,
              person_ids: [f.custodianPersonId],
              attendance_mode: "none",
            }),
          );
        const published = z
          .object({ id: z.uuid(), revision: z.number() })
          .parse(
            await planning.publish(
              resourceLoanRequest(f.user),
              f.schoolId,
              draft.id,
              { idempotency_key: randomUUID(), expected_revision: 1 },
            ),
          );
        await expect(
          db
            .transaction()
            .execute((tx) =>
              assertSpaceCanBecomeResidential(tx, f.schoolId, space.id, f.now),
            ),
        ).rejects.toThrow("published activity");
        await planning.cancel(
          resourceLoanRequest(f.user),
          f.schoolId,
          published.id,
          {
            idempotency_key: randomUUID(),
            expected_revision: published.revision,
            reason:
              "Fictional room will be dedicated to accommodation instead.",
          },
        );
        await expect(
          db
            .transaction()
            .execute((tx) =>
              assertSpaceCanBecomeResidential(tx, f.schoolId, space.id, f.now),
            ),
        ).resolves.toBeUndefined();
        expect(
          (
            await sql<{
              state: string;
            }>`SELECT state FROM schedule_versions WHERE id=${published.id}::uuid`.execute(
              db,
            )
          ).rows[0],
        ).toEqual({ state: "cancelled" });
        const retained = (
          await sql<{
            state: string;
          }>`SELECT state FROM schedule_activity_occurrences WHERE school_id=${f.schoolId}::uuid AND plan_version_id=${published.id}::uuid`.execute(
            db,
          )
        ).rows;
        expect(retained.length).toBeGreaterThan(0);
        expect(retained.every((item) => item.state === "cancelled")).toBe(true);
      });
    }, 60_000);
    it("allows an unfinished activity draft but refuses publishing it into a dedicated residential room", async () => {
      process.env.INVITATION_EMAIL_ENABLED = "false";
      const f = await createAccommodationFixture(db);
      await f.run(async () => {
        const space = z
          .object({ id: z.uuid() })
          .parse(
            await f.topology.createSpace(
              f.user,
              f.schoolId,
              {
                campus_id: f.campusId,
                name: "Fictional dedicated twin room",
                code: `ROOM-${randomUUID().slice(0, 8)}`,
                kind: "residential_room",
              },
              resourceLoanRequest(f.user),
            ),
          );
        const type = await f.accommodation.saveRoomType(f.user, f.schoolId, {
          command_id: randomUUID(),
          expected_revision: 0,
          name: "Fictional twin",
          default_capacity: 2,
          allocation_mode: "shared",
        });
        await f.accommodation.saveRoom(f.user, f.schoolId, {
          command_id: randomUUID(),
          expected_revision: 0,
          space_id: space.id,
          room_type_id: type.id,
          sleeping_capacity: 2,
          allocation_mode: "shared",
        });
        const planning = new ActivityPlanningService(
          db,
          f.events,
          f.core,
          f.core,
          f.core,
          new ResponsibilityProjectionService(f.core),
        );
        const day = new Date(Date.parse(f.now) + 86400000)
          .toISOString()
          .slice(0, 10);
        const draft = z
          .object({ id: z.uuid() })
          .parse(
            await planning.create(resourceLoanRequest(f.user), f.schoolId, {
              idempotency_key: randomUUID(),
              title: "Fictional incompatible room meeting",
              purpose: "meeting",
              timezone: "UTC",
              starts_on: day,
              recurrence: "once",
              starts_at: "09:00",
              ends_at: "10:00",
              space_id: space.id,
              person_ids: [f.custodianPersonId],
              attendance_mode: "none",
            }),
          );
        await expect(
          planning.publish(resourceLoanRequest(f.user), f.schoolId, draft.id, {
            idempotency_key: randomUUID(),
            expected_revision: 1,
          }),
        ).rejects.toThrow("dedicated to accommodation");
        expect(
          (
            await sql<{
              state: string;
            }>`SELECT state FROM schedule_versions WHERE id=${draft.id}::uuid`.execute(
              db,
            )
          ).rows[0],
        ).toEqual({ state: "draft" });
      });
    }, 60_000);
  },
);
