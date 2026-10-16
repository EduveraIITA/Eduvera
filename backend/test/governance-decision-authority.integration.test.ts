import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, type Transaction } from "kysely";
import { Pool, types as pgTypes } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../src/database/types.js";
import { GovernanceService } from "../src/governance/governance.service.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const isolated = process.env.TEST_DATABASE_ISOLATED === "true" || Boolean(process.env.TEST_DATABASE_URL);
const suite = isolated ? describe : describe.skip;

interface AuthorityFixture {
  schoolId: string;
  ownerId: string;
  personId: string;
  officeId: string;
  appointmentId: string;
  ruleId: string;
  sourceId: string;
}

suite("governance decision authority against isolated PostgreSQL", () => {
  let pool: Pool;
  let database: Kysely<Database>;
  const governance = new GovernanceService({} as never, {} as never);

  beforeAll(() => {
    pgTypes.setTypeParser(1082, (value) => value);
    pool = new Pool({ connectionString: requireIsolatedTestDatabaseUrl(testDatabaseUrl), max: 4 });
    database = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
  });

  afterAll(async () => {
    await database?.destroy();
  });

  async function fixture(tx: Transaction<Database>, date = "2026-10-17"): Promise<AuthorityFixture> {
    const suffix = randomUUID();
    const owner = await tx.insertInto("users").values({
      username: `authority-owner-${suffix}`,
      email: `authority-owner-${suffix}@example.test`,
      password_hash: "test-only",
      first_name: "Current",
      last_name: "Principal",
      role: "staff",
    }).returning("id").executeTakeFirstOrThrow();
    const school = await tx.insertInto("schools").values({
      name: "Authority integration institution",
      code: `auth-${suffix.slice(0, 12)}`,
      timezone: "Asia/Kolkata",
      created_by_user_id: owner.id,
    }).returning("id").executeTakeFirstOrThrow();
    await tx.insertInto("school_memberships").values({
      school_id: school.id,
      user_id: owner.id,
      role: "staff",
      is_active: true,
    }).execute();
    const person = await tx.insertInto("school_people").values({
      school_id: school.id,
      first_name: "Current",
      last_name: "Principal",
      contact_email: `authority-person-${suffix}@example.test`,
    }).returning("id").executeTakeFirstOrThrow();
    const source = await tx.insertInto("institution_authority_sources").values({
      school_id: school.id,
      code: "staff_leave_authority",
      title: "Staff leave decision authority",
      source_kind: "appointment_order",
      issuer: "Authority integration institution",
      jurisdiction: "Karnataka, India",
      reference: `ORDER-${suffix}`,
      provision: "Staff leave decisions",
      evidence_reference: `document:ORDER-${suffix}`,
      verification_state: "verified",
      effective_from: date,
      effective_until: date,
      verified_by: owner.id,
      verified_at: new Date("2026-10-16T12:00:00.000Z"),
      created_by: owner.id,
    }).returning("id").executeTakeFirstOrThrow();
    const office = await tx.insertInto("institution_governance_offices").values({
      school_id: school.id,
      code: "principal",
      title: "Principal",
      purpose: "Decide staff leave within the confirmed institution route.",
      authority_source_id: source.id,
      status: "active",
      created_by: owner.id,
    }).returning("id").executeTakeFirstOrThrow();
    const appointment = await tx.insertInto("institution_governance_appointments").values({
      school_id: school.id,
      office_id: office.id,
      seat_id: null,
      person_id: person.id,
      linked_user_id: owner.id,
      appointment_kind: "appointed",
      starts_on: date,
      ends_on: date,
      status: "active",
      authority_source_id: source.id,
      evidence_reference: `document:ORDER-${suffix}`,
      created_by: owner.id,
    }).returning("id").executeTakeFirstOrThrow();
    const rule = await tx.insertInto("institution_decision_matter_rules").values({
      school_id: school.id,
      code: "staff_leave_decision",
      title: "Staff leave decision",
      category: "people",
      initiation_summary: "A staff member submits leave.",
      review_summary: "The current officeholder reviews the request.",
      decision_summary: "The current Principal decides.",
      execution_summary: "The staff domain records the authorized decision.",
      decision_mode: "individual",
      decision_office_id: office.id,
      decision_body_id: null,
      standing_mandate_id: null,
      authority_source_ids: [source.id],
      conditions_summary: "Current appointment, account, membership and authority source are required.",
      material_fields: ["staff_member", "leave_dates", "request_revision"],
      status: "confirmed",
      effective_from: date,
      effective_until: date,
      created_by: owner.id,
    }).returning("id").executeTakeFirstOrThrow();
    return {
      schoolId: school.id,
      ownerId: owner.id,
      personId: person.id,
      officeId: office.id,
      appointmentId: appointment.id,
      ruleId: rule.id,
      sourceId: source.id,
    };
  }

  async function isolatedFixture(test: (tx: Transaction<Database>, value: AuthorityFixture) => Promise<void>) {
    const rollback = new Error("rollback governance authority integration fixture");
    try {
      await database.transaction().execute(async (tx) => {
        await test(tx, await fixture(tx));
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  }

  it("keeps identical matter routes and officeholders isolated by institution", async () => {
    const rollback = new Error("rollback cross-tenant authority fixture");
    try {
      await database.transaction().execute(async (tx) => {
        const first = await fixture(tx);
        const second = await fixture(tx);
        const at = new Date("2026-10-16T18:30:00.000Z");
        const firstReceipt = await governance.resolveDecisionOwner(tx, first.schoolId, "staff_leave_decision", at);
        const secondReceipt = await governance.resolveDecisionOwner(tx, second.schoolId, "staff_leave_decision", at);
        expect(firstReceipt).toMatchObject({ user_id: first.ownerId, rule: { id: first.ruleId } });
        expect(secondReceipt).toMatchObject({ user_id: second.ownerId, rule: { id: second.ruleId } });
        await expect(governance.assertDecisionAuthority(
          tx,
          second.schoolId,
          "staff_leave_decision",
          first.ownerId,
          at,
        )).rejects.toThrow(/current officeholder/i);
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  });

  it("fails closed after either account or membership deactivation", async () => {
    await isolatedFixture(async (tx, value) => {
      const at = new Date("2026-10-16T18:30:00.000Z");
      await tx.updateTable("users").set({ is_active: false }).where("id", "=", value.ownerId).execute();
      await expect(governance.resolveDecisionOwner(tx, value.schoolId, "staff_leave_decision", at))
        .rejects.toThrow(/active institution account/i);
      await tx.updateTable("users").set({ is_active: true }).where("id", "=", value.ownerId).execute();
      await tx.updateTable("school_memberships").set({ is_active: false })
        .where("school_id", "=", value.schoolId).where("user_id", "=", value.ownerId).execute();
      await expect(governance.resolveDecisionOwner(tx, value.schoolId, "staff_leave_decision", at))
        .rejects.toThrow(/active institution account/i);
    });
  });

  it("uses the institution timezone, includes the end date and honors current revocation", async () => {
    await isolatedFixture(async (tx, value) => {
      await expect(governance.resolveDecisionOwner(
        tx,
        value.schoolId,
        "staff_leave_decision",
        new Date("2026-10-16T18:29:59.000Z"),
      )).rejects.toThrow(/no confirmed decision route/i);
      await expect(governance.resolveDecisionOwner(
        tx,
        value.schoolId,
        "staff_leave_decision",
        new Date("2026-10-16T18:30:00.000Z"),
      )).resolves.toMatchObject({
        effective_date: "2026-10-17",
        decision_mode: "individual",
        appointment: { ends_on: "2026-10-17" },
        rule: { effective_until: "2026-10-17" },
        sources: [{ effective_until: "2026-10-17" }],
      });
      await tx.updateTable("institution_authority_sources").set({
        verification_state: "superseded",
        verified_by: null,
        verified_at: null,
      })
        .where("id", "=", value.sourceId).execute();
      await expect(governance.resolveDecisionOwner(
        tx,
        value.schoolId,
        "staff_leave_decision",
        new Date("2026-10-16T18:30:00.000Z"),
      )).rejects.toThrow(/missing, unconfirmed or expired authority evidence/i);
      await tx.updateTable("institution_authority_sources").set({
        verification_state: "verified",
        verified_by: value.ownerId,
        verified_at: new Date("2026-10-16T12:00:00.000Z"),
      }).where("id", "=", value.sourceId).execute();
      await tx.updateTable("institution_governance_appointments").set({ status: "suspended" })
        .where("id", "=", value.appointmentId).execute();
      await expect(governance.resolveDecisionOwner(
        tx,
        value.schoolId,
        "staff_leave_decision",
        new Date("2026-10-16T18:30:00.000Z"),
      )).rejects.toThrow(/no effective officeholder/i);
    });
  });

  it("holds a shared authority lock until the evaluating transaction completes", async () => {
    const value = await database.transaction().execute((tx) => fixture(tx));
    let releaseEvaluation!: () => void;
    let evaluationStarted!: () => void;
    const release = new Promise<void>((resolve) => { releaseEvaluation = resolve; });
    const started = new Promise<void>((resolve) => { evaluationStarted = resolve; });
    const at = new Date("2026-10-16T18:30:00.000Z");
    const evaluation = database.transaction().execute(async (tx) => {
      const receipt = await governance.resolveDecisionOwner(tx, value.schoolId, "staff_leave_decision", at);
      evaluationStarted();
      await release;
      return receipt;
    });
    await started;

    const updater = await pool.connect();
    let updateSettled = false;
    let update: Promise<void> | undefined;
    try {
      await updater.query("BEGIN");
      await updater.query("SET LOCAL lock_timeout='2s'");
      update = updater.query(
        "UPDATE institution_governance_appointments SET status='suspended' WHERE school_id=$1 AND id=$2",
        [value.schoolId, value.appointmentId],
      ).then(() => { updateSettled = true; });
      await new Promise((resolve) => setTimeout(resolve, 75));
      expect(updateSettled).toBe(false);
      releaseEvaluation();
      await expect(evaluation).resolves.toMatchObject({ appointment: { id: value.appointmentId, status: "active" } });
      await update;
      expect(updateSettled).toBe(true);
    } finally {
      releaseEvaluation();
      await evaluation.catch(() => undefined);
      await update?.catch(() => undefined);
      await updater.query("ROLLBACK").catch(() => undefined);
      updater.release();
      await database.deleteFrom("institution_decision_matter_rules").where("school_id", "=", value.schoolId).execute();
      await database.deleteFrom("institution_governance_appointments").where("school_id", "=", value.schoolId).execute();
      await database.deleteFrom("institution_governance_offices").where("school_id", "=", value.schoolId).execute();
      await database.deleteFrom("institution_authority_sources").where("school_id", "=", value.schoolId).execute();
      await database.deleteFrom("school_people").where("id", "=", value.personId).execute();
      await database.deleteFrom("schools").where("id", "=", value.schoolId).execute();
      await database.deleteFrom("users").where("id", "=", value.ownerId).execute();
    }
  });
});
