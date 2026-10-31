import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, type Transaction } from "kysely";
import { Pool, types as pgTypes } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthUser } from "../src/common/request.js";
import type { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import { RequestsService } from "../src/requests/requests.service.js";
import type { RequestInboxItem } from "../src/requests/requests.types.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";
import { guardianFeeReviewServices } from "./fee-review.test-support.js";
import { OperationsService } from "../src/operations/operations.service.js";
import { createLiveExecutionEnvironment } from "../src/campus-model-core/execution-environment.runtime.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import { linkFixtureStaffIdentity } from "./fixture-human-identity.test-support.js";
import type { FinanceArrangementsReadService } from "../src/operations/finance-arrangements.read.js";

const isolated = process.env.TEST_DATABASE_ISOLATED === "true" || Boolean(process.env.TEST_DATABASE_URL);

describe.skipIf(!isolated)("native Work privacy and deadline truth in isolated PostgreSQL", () => {
  let database: Kysely<Database>;
  beforeAll(() => {
    pgTypes.setTypeParser(1082, value => value);
    const pool = new Pool({ connectionString: requireIsolatedTestDatabaseUrl(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL), max: 2 });
    database = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
  });
  afterAll(async () => { await database?.destroy(); });

  async function fixture(tx: Transaction<Database>) {
    const suffix = randomUUID();
    const actor = await tx.insertInto("users").values({ username: `fee-work-${suffix}`, email: `fee-work-${suffix}@example.test`,
      password_hash: "unused-isolated-fixture", first_name: "Finance", last_name: "Reviewer", role: "admin" }).returningAll().executeTakeFirstOrThrow();
    const learner = await tx.insertInto("users").values({ username: `learner-work-${suffix}`, email: `learner-work-${suffix}@example.test`,
      password_hash: "unused-isolated-fixture", first_name: "Sana", last_name: "Learner", role: "student" }).returning("id").executeTakeFirstOrThrow();
    const school = await tx.insertInto("schools").values({ name: "Fee Work privacy test", code: `fee-work-${suffix.slice(0, 12)}`, timezone: "Asia/Kolkata" })
      .returning("id").executeTakeFirstOrThrow();
    await tx.insertInto("school_memberships").values([{ school_id: school.id, user_id: actor.id, role: "admin" },
      { school_id: school.id, user_id: learner.id, role: "student" }]).execute();
    const student = await tx.insertInto("students").values({ school_id: school.id, user_id: learner.id, admission_number: suffix })
      .returning(["id", "person_id"]).executeTakeFirstOrThrow();
    const invoice = await tx.insertInto("fee_invoices").values({ school_id: school.id, student_id: student.id, reference: `INV-${suffix}`,
      description: "Tuition", amount_paise: 3_000_000, due_on: "2020-01-01", created_by: actor.id }).returning("id").executeTakeFirstOrThrow();
    const createdAt = new Date("2026-10-20T08:15:00.000Z");
    const parent = await tx.insertInto("parents").values({ user_id: learner.id }).returning("id").executeTakeFirstOrThrow();
    await tx.insertInto("school_memberships").values({ school_id: school.id, user_id: learner.id, role: "guardian" }).execute();
    await tx.insertInto("guardian_school_profiles").values({ school_id: school.id, guardian_id: parent.id, person_id: student.person_id }).execute();
    await tx.insertInto("guardian_relationships").values({ school_id: school.id, guardian_id: parent.id, student_id: student.id, relationship: "guardian" }).execute();
    const bound = { transaction: () => ({ execute: (operation: (transaction: Transaction<Database>) => Promise<unknown>) => operation(tx) }) } as unknown as DatabaseService;
    const { core, service: reviews } = guardianFeeReviewServices(bound, new OperationsService(bound, {} as never));
    await linkFixtureStaffIdentity(bound, { school_id: school.id, user_id: actor.id, owner_user_id: actor.id, effective_from: "2026-01-01T00:00:00.000Z" });
    for (const [userId, personId] of [[learner.id, student.person_id]] as const) await core.linkAccountEndpoint(tx,
      { school_id: school.id, user_id: userId, person_id: personId, actor_user_id: actor.id, effective_from: "2026-01-01T00:00:00.000Z", effective_until: null,
        source_domain: "people", source_record_id: personId, source_revision: 1, metadata: { fixture: "fee_work_privacy" } });
    const environment = createLiveExecutionEnvironment({ institution_id: school.id, clock: { now: () => createdAt, nowIso: () => createdAt.toISOString() } });
    const guardian = { ...(await tx.selectFrom("users").selectAll().where("id", "=", learner.id).executeTakeFirstOrThrow()), active_school_id: school.id } as AuthUser;
    const run = <T>(operation: () => Promise<T>) => executionEnvironmentStorage.run(environment, operation);
    const request = await run(() => reviews.submit(guardian, school.id, invoice.id,
      { kind: "charge", note: "PRIVATE-EXPLANATION: family financial circumstances", idempotency_key: randomUUID() }));
    return { actor: { ...actor, active_school_id: school.id } as AuthUser, schoolId: school.id, requestId: request.id, createdAt, reviews, run };
  }

  it("keeps the source creation time but excludes private notes and an overdue invoice's invented reviewer deadline", async () => {
    const rollback = new Error("rollback fee Work privacy fixtures");
    try {
      await database.transaction().execute(async tx => {
        const own = await fixture(tx), other = await fixture(tx);
        const db = { transaction: () => ({ execute: (operation: (transaction: Transaction<Database>) => Promise<unknown>) => operation(tx) }) } as unknown as DatabaseService;
        const service = new RequestsService(db) as unknown as { principalItems: (user: AuthUser, scope: unknown) => Promise<RequestInboxItem[]> };
        const scope = { school_id: own.schoolId, school_name: "Fee Work privacy test", timezone: "Asia/Kolkata", student_id: null, student_name: null };
        const items = await service.principalItems(own.actor, scope);
        const review = items.find(item => item.kind === "fee_review" && item.source_id === own.requestId);
        expect(review).toMatchObject({ priority: "normal", due_at: null, occurs_at: own.createdAt.toISOString(), created_at: own.createdAt.toISOString(),
          href: `/areas/fees/ledger?view=review&review=${own.requestId}`, status_label: "Finance review needed" });
        expect(JSON.stringify(items)).not.toContain("PRIVATE-EXPLANATION");
        expect(items.some(item => item.source_id === other.requestId)).toBe(false);
        await own.run(() => own.reviews.decide(own.actor, own.schoolId, own.requestId,
          { outcome: "answered", response: "The charge has been explained privately." }));
        expect((await service.principalItems(own.actor, scope)).some(item => item.source_id === own.requestId)).toBe(false);
        throw rollback;
      });
    } catch (error) { if (error !== rollback) throw error; }
  });

  it("keeps published acknowledgements needed without recipient deadlines while retaining administrative policy review dates", async () => {
    const rollback = new Error("rollback policy Work deadline fixtures");
    try {
      await database.transaction().execute(async tx => {
        const suffix = randomUUID();
        const school = await tx.insertInto("schools").values({ name: "Synthetic policy Work campus", code: `policy-work-${suffix.slice(0, 12)}` })
          .returning("id").executeTakeFirstOrThrow();
        const accounts = await tx.insertInto("users").values((["admin", "staff", "student", "parent"] as const).map(role => ({
          username: `policy-work-${role}-${suffix}`, email: `policy-work-${role}-${suffix}@example.test`,
          password_hash: "unused-isolated-fixture", first_name: "Synthetic", last_name: role, role,
        }))).returningAll().execute();
        const actor = (role: AuthUser["role"]) => ({ ...accounts.find(account => account.role === role)!, active_school_id: school.id }) as AuthUser;
        const admin = actor("admin"), staff = actor("staff"), studentAccount = actor("student"), guardian = actor("parent");
        await tx.insertInto("school_memberships").values(accounts.map(account => ({ school_id: school.id, user_id: account.id,
          role: account.role === "parent" ? "guardian" as const : account.role }))).execute();
        const student = await tx.insertInto("students").values({ school_id: school.id, user_id: studentAccount.id, admission_number: suffix })
          .returning("id").executeTakeFirstOrThrow();
        const parent = await tx.insertInto("parents").values({ user_id: guardian.id }).returning("id").executeTakeFirstOrThrow();
        const guardianPerson = await tx.insertInto("school_people").values({ school_id: school.id, first_name: guardian.first_name, last_name: guardian.last_name })
          .returning("id").executeTakeFirstOrThrow();
        await tx.insertInto("guardian_school_profiles").values({ school_id: school.id, guardian_id: parent.id, person_id: guardianPerson.id }).execute();
        await tx.insertInto("guardian_relationships").values({ school_id: school.id, guardian_id: parent.id, student_id: student.id, relationship: "guardian" }).execute();
        const family = await tx.insertInto("institution_policy_families").values({ school_id: school.id, code: "synthetic_acknowledgement",
          title: "Synthetic recipient policy", category: "custom", capability_pack: "synthetic_test", applicable_institution_kinds: ["college"],
          default_audiences: ["student", "staff", "guardian"] })
          .returning("id").executeTakeFirstOrThrow();
        const publishedAt = new Date("2026-10-25T17:20:00.000Z");
        const policyValues = { school_id: school.id, family_id: family.id, title: "Synthetic recipient policy", body_markdown: "Isolated test policy.",
          audience_roles: ["student", "staff", "guardian"], requires_acknowledgement: true,
          effective_on: "2020-01-01", review_due_on: "2020-02-01", created_by: admin.id, reviewed_by: admin.id,
          reviewed_at: publishedAt, published_at: publishedAt };
        const acknowledge = (policyId: string, user: AuthUser, membershipRole: "student" | "staff" | "guardian") =>
          tx.insertInto("institution_policy_acknowledgements").values({ school_id: school.id, policy_version_id: policyId, user_id: user.id,
            membership_role: membershipRole, acknowledgement_text: "Synthetic exact-version acknowledgement." }).execute();
        const old = await tx.insertInto("institution_policy_versions").values({ ...policyValues, version: 1, status: "published" })
          .returning("id").executeTakeFirstOrThrow();
        await acknowledge(old.id, studentAccount, "student");
        await tx.updateTable("institution_policy_versions").set({ status: "retired", retired_at: publishedAt })
          .where("id", "=", old.id).where("revision", "=", 1).executeTakeFirstOrThrow();
        const published = await tx.insertInto("institution_policy_versions").values({ ...policyValues, version: 2, status: "published" })
          .returning("id").executeTakeFirstOrThrow();
        const review = await tx.insertInto("institution_policy_versions").values({ ...policyValues, version: 3, status: "in_review",
          submitted_by: admin.id, submitted_at: publishedAt }).returning("id").executeTakeFirstOrThrow();
        const db = { getExecutor: () => tx.getExecutor(), selectFrom: tx.selectFrom.bind(tx),
          transaction: () => ({ execute: (operation: (transaction: Transaction<Database>) => Promise<unknown>) => operation(tx) }) } as unknown as DatabaseService;
        const service = new RequestsService(db, undefined, undefined,
          { dueWork: () => Promise.resolve([]) } as unknown as FinanceArrangementsReadService) as unknown as {
          studentWorkspaceItems: (user: AuthUser, scope: unknown) => Promise<RequestInboxItem[]>;
          parentItems: (user: AuthUser, scope: unknown) => Promise<RequestInboxItem[]>;
          teacherItems: (user: AuthUser, scope: unknown) => Promise<RequestInboxItem[]>;
          principalItems: (user: AuthUser, scope: unknown) => Promise<RequestInboxItem[]>;
        };
        const scope = { school_id: school.id, school_name: "Synthetic policy Work campus", timezone: "Asia/Kolkata",
          student_id: student.id, student_name: "Synthetic student" };
        const recipients = [
          { user: studentAccount, role: "student", read: () => service.studentWorkspaceItems(studentAccount, scope) },
          { user: guardian, role: "guardian", read: () => service.parentItems(guardian, scope) },
          { user: staff, role: "staff", read: () => service.teacherItems(staff, scope) },
        ] as const;
        for (const recipient of recipients) {
          const acknowledgements = (await recipient.read()).filter(item => item.kind === "policy_acknowledgement");
          expect(acknowledgements).toEqual([expect.objectContaining({ source_id: published.id, due_at: null, priority: "normal",
            status_label: "Acknowledgement needed", created_at: publishedAt.toISOString(), occurs_at: publishedAt.toISOString() })]);
          expect(acknowledgements[0]?.href).toContain(`policy=${published.id}`);
        }
        await acknowledge(published.id, studentAccount, "student");
        expect((await recipients[0].read()).filter(item => item.kind === "policy_acknowledgement")).toEqual([]);
        for (const recipient of recipients.slice(1)) {
          expect((await recipient.read()).some(item => item.kind === "policy_acknowledgement" && item.source_id === published.id)).toBe(true);
          await acknowledge(published.id, recipient.user, recipient.role);
          expect((await recipient.read()).filter(item => item.kind === "policy_acknowledgement")).toEqual([]);
        }
        const administrativeReview = (await service.principalItems(admin, scope)).find(item => item.kind === "policy_review" && item.source_id === review.id);
        expect(administrativeReview).toMatchObject({ due_at: "2020-02-01T12:00:00.000Z", priority: "urgent", status_label: "Policy review needed" });
        throw rollback;
      });
    } catch (error) { if (error !== rollback) throw error; }
  });
});
