import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { CampusEventsService } from "../src/campus-events/campus-events.service.js";
import type { AuthUser } from "../src/common/request.js";
import type { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import { SchoolEventService } from "../src/school/school-event.service.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";
import { ownedParticipationTestServices } from './owned-participation.test-support.js';

const isolated = process.env.TEST_DATABASE_ISOLATED === "true";
const pool = new Pool({ connectionString: isolated
  ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/unused", max: 1 });
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
afterAll(async () => { await db.destroy(); });

describe.skipIf(!isolated)("event editor staff catalogue identities", () => {
  it("returns each active campus account once, preserving distinct people who share a name", async () => {
    const rollback = new Error("rollback isolated catalogue fixture");
    try {
      await db.transaction().execute(async (transaction) => {
        const suffix = randomUUID().slice(0, 8);
        const school = await transaction.insertInto("schools").values({
          name: "Catalogue campus", code: `catalog-${suffix}`, timezone: "Asia/Kolkata",
        }).returning("id").executeTakeFirstOrThrow();
        const otherSchool = await transaction.insertInto("schools").values({
          name: "Other catalogue campus", code: `other-${suffix}`, timezone: "Asia/Kolkata",
        }).returning("id").executeTakeFirstOrThrow();
        const accounts = await transaction.insertInto("users").values(
          ["owner", "dual", "namesake", "inactive-account", "inactive-member", "other-campus"].map((kind) => ({
            username: `${kind}-${suffix}`, email: `${kind}-${suffix}@example.invalid`,
            password_hash: "!", first_name: kind === "owner" ? "Catalogue" : "Same", last_name: kind === "owner" ? "Owner" : "Name",
            role: "admin" as const, is_active: kind !== "inactive-account",
          })),
        ).returningAll().execute();
        const [owner, dual, namesake, inactiveAccount, inactiveMember, outsider] = accounts;
        await transaction.insertInto("school_memberships").values([
          { school_id: school.id, user_id: owner!.id, role: "admin" },
          { school_id: school.id, user_id: dual!.id, role: "admin" },
          { school_id: school.id, user_id: dual!.id, role: "staff" },
          { school_id: school.id, user_id: namesake!.id, role: "staff" },
          { school_id: school.id, user_id: inactiveAccount!.id, role: "staff" },
          { school_id: school.id, user_id: inactiveMember!.id, role: "staff", is_active: false },
          { school_id: otherSchool.id, user_id: outsider!.id, role: "staff" },
        ]).execute();
        const scopedDb = transaction as unknown as DatabaseService;
        const participation=ownedParticipationTestServices(scopedDb);
        const service = new CampusEventsService(scopedDb, new SchoolEventService(scopedDb),participation.bridge,participation.authorities,participation.core,participation.footprints,participation.planning);
        const actor: AuthUser = { ...owner!, active_school_id: school.id };
        const catalog = await service.catalog(actor, school.id);

        expect(catalog.staff.map((person) => person.user_id).sort()).toEqual([owner!.id, dual!.id, namesake!.id].sort());
        expect(catalog.staff.filter((person) => person.name === "Same Name")).toHaveLength(2);
        expect(catalog.staff.filter((person) => person.user_id === dual!.id)).toHaveLength(1);
        await expect(service.catalog(actor, otherSchool.id)).rejects.toThrow("active school");
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  });
});
