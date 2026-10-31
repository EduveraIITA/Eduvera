import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuditService } from "../src/common/audit.service.js";
import type { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import { InstitutionOnboardingService } from "../src/institution-onboarding/institution-onboarding.service.js";
import { ProgressiveWorkspaceProvisioner } from "../src/institution-onboarding/progressive-workspace.provisioner.js";
import { diningDestination, readDiningReadiness, resolveDiningContinuation } from "../src/institution-onboarding/dining-readiness.js";
import { createDiningFixture } from "./dining.test-support.js";
import { resourceLoanRequest } from "./resource-loans.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";
import { diningPlanHref } from "../src/dining/dining.contracts.js";
import { createLiveExecutionEnvironment } from "../src/campus-model-core/execution-environment.runtime.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
const url = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/dining_readiness_unused_test";
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: url, max: 3 }) }) }) as DatabaseService;
beforeAll(() => { process.env.INVITATION_EMAIL_ENABLED = "false"; });
afterAll(() => db.destroy());
const command = (expected_revision = 0) => ({ command_id: randomUUID(), expected_revision });

describe.skipIf(!enabled)("Dining first operation remains native, actor and source qualified", () => {
  it("starts with an exact weekly draft/publication and rechecks named operator access without manufacturing dated service", async () => {
    const f = await createDiningFixture(db);
    await f.run(async () => {
      const onboarding = new InstitutionOnboardingService(db, new AuditService(db), new ProgressiveWorkspaceProvisioner(f.core), f.core, f.core);
      await onboarding.setGoals(f.owner, { goals: ["dining"] }, resourceLoanRequest(f.owner));
      const service = await f.dining.saveService(f.owner, f.schoolId, { ...command(), name: "Fictional weekly counter", coordinator_person_id: f.custodianPersonId });
      const plan = await f.dining.savePlan(f.owner, f.schoolId, { ...command(), service_id: service.id,
        service_expected_revision: service.revision, label: "Weekly lunch", timezone: "Asia/Kolkata", starts_on: "2026-10-24",
        days: [{ weekday: 6, menu_text: "Fictional rice and vegetables", starts_at: "12:00", ends_at: "14:00", operator_person_id: f.borrowerPersonId }] });
      const path = diningPlanHref(plan.id);
      expect((await readDiningReadiness(db, f.core, f.owner, f.schoolId)).operation).toMatchObject({ state: "draft_recorded",
        action: "publish", scope: { kind: "plan", id: plan.id }, source_revision: plan.revision, destination: path });
      expect((await readDiningReadiness(db, f.core, f.borrower, f.schoolId)).operation).toMatchObject({ state: "unavailable", scope: null });
      await onboarding.setResume(f.owner, { goal: "dining", step: "operating", path }, resourceLoanRequest(f.owner));
      expect((await onboarding.workspace(f.owner)).resume).toMatchObject({ goal: "dining", step: "first_use", path });
      const publish = { ...command(plan.revision) };
      await f.dining.publishPlan(f.owner, f.schoolId, plan.id, publish);
      expect((await readDiningReadiness(db, f.core, f.owner, f.schoolId)).operation).toMatchObject({ state: "menu_published",
        scope: { kind: "plan", id: plan.id }, source_revision: plan.revision + 1, destination: path });
      expect((await onboarding.workspace(f.owner)).resume).toMatchObject({ goal: "dining", step: "operating", path });
      expect((await readDiningReadiness(db, f.core, f.borrower, f.schoolId)).operation).toMatchObject({ state: "menu_published",
        action: "view", scope: { kind: "plan", id: plan.id } });
      const retained = await db.selectFrom("progressive_onboarding_workspaces").selectAll().where("school_id", "=", f.schoolId).executeTakeFirstOrThrow();
      await f.dining.publishPlan(f.owner, f.schoolId, plan.id, publish);
      expect(await db.selectFrom("progressive_onboarding_workspaces").selectAll().where("school_id", "=", f.schoolId).executeTakeFirstOrThrow()).toEqual(retained);
      const future = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" })
        .format(new Date(Date.parse(f.now) + 7 * 86_400_000));
      const replacement = await f.dining.revisePlan(f.owner, f.schoolId, plan.id, { ...command(plan.revision + 1),
        starts_on: future, note: "Change future weeks only" });
      await f.dining.publishPlan(f.owner, f.schoolId, replacement.id, command(replacement.revision));
      expect((await readDiningReadiness(db, f.core, f.owner, f.schoolId)).operation.scope).toEqual({ kind: "plan", id: plan.id });
      expect(await resolveDiningContinuation(db, f.core, f.owner, f.schoolId, path)).not.toBeNull();
      expect(await resolveDiningContinuation(db, f.core, f.owner, f.schoolId, diningPlanHref(replacement.id))).not.toBeNull();
      expect((await onboarding.workspace(f.owner)).resume).toMatchObject({ step: "operating", path });
      // The source's local cutoff is already effective while the UTC campus
      // date is still yesterday; readiness must use the selected source clock.
      const after = new Date(`${future}T00:15:00+05:30`).toISOString();
      await executionEnvironmentStorage.run(createLiveExecutionEnvironment({ institution_id: f.schoolId,
        clock: { now: () => new Date(after), nowIso: () => after } }), async () => {
        expect(await resolveDiningContinuation(db, f.core, f.owner, f.schoolId, path)).toBeNull();
        expect((await readDiningReadiness(db, f.core, f.owner, f.schoolId)).operation.scope).toEqual({ kind: "plan", id: replacement.id });
      });
      expect(await db.selectFrom("dining_sessions").select("id").where("school_id", "=", f.schoolId).execute()).toEqual([]);
      await db.updateTable("school_memberships").set({ is_active: false }).where("school_id", "=", f.schoolId).where("user_id", "=", f.borrower.id).execute();
      expect(await resolveDiningContinuation(db, f.core, f.borrower, f.schoolId, path)).toBeNull();
      expect((await readDiningReadiness(db, f.core, f.borrower, f.schoolId)).operation).toMatchObject({ state: "unavailable", scope: null });
      const reference = await f.dining.saveService(f.owner, f.schoolId, { ...command(), name: "Fictional externally owned menu",
        coordinator_person_id: f.custodianPersonId, menu_mode: "reference", operations_mode: "native", source_label: "Fictional provider" });
      const referencePlan = await f.dining.savePlan(f.owner, f.schoolId, { ...command(), service_id: reference.id,
        service_expected_revision: reference.revision, label: "Provider serving hours", timezone: "UTC", starts_on: f.now.slice(0, 10),
        days: [{ weekday: 6, starts_at: "12:00", ends_at: "14:00", operator_person_id: f.custodianPersonId }] });
      await f.dining.publishPlan(f.owner, f.schoolId, referencePlan.id, command(referencePlan.revision));
      expect(await resolveDiningContinuation(db, f.core, f.owner, f.schoolId, diningPlanHref(referencePlan.id))).toBeNull();
    });
  }, 60_000);

  it("starts Dining alone, retains a draft without claiming publication, then resumes the accepted menu", async () => {
    const f = await createDiningFixture(db);
    await f.run(async () => {
      const onboarding = new InstitutionOnboardingService(db, new AuditService(db), new ProgressiveWorkspaceProvisioner(f.core), f.core, f.core);
      const resume = () => db.selectFrom("progressive_onboarding_workspaces").select(["resume_step", "resume_goal_key", "resume_path", "revision"])
        .where("school_id", "=", f.schoolId).executeTakeFirstOrThrow();
      await onboarding.setGoals(f.owner, { goals: ["dining"] }, resourceLoanRequest(f.owner));
      expect((await readDiningReadiness(db, f.core, f.owner, f.schoolId)).operation).toMatchObject({ state: "needs_service", action: "configure" });
      const service = await f.dining.saveService(f.owner, f.schoolId, { ...command(), name: "Fictional walk-in counter",
        coordinator_person_id: f.custodianPersonId });
      expect((await readDiningReadiness(db, f.core, f.owner, f.schoolId)).operation).toMatchObject({ state: "ready_to_plan" });
      const session = await f.dining.createSession(f.owner, f.schoolId, { ...command(), service_id: service.id,
        service_expected_revision: service.revision, label: "Lunch", operator_person_id: f.custodianPersonId,
        starts_at: f.now, ends_at: new Date(Date.parse(f.now) + 60 * 60_000).toISOString(), menu_text: "Rice and vegetables" });
      const path = diningDestination(session.id);
      expect((await readDiningReadiness(db, f.core, f.owner, f.schoolId)).operation).toMatchObject({ state: "draft_recorded",
        action: "publish", scope: { kind: "session", id: session.id }, source_revision: 1 });
      await onboarding.setResume(f.owner, { goal: "dining", step: "operating", path }, resourceLoanRequest(f.owner));
      expect(await resume()).toMatchObject({ resume_goal_key: "dining", resume_step: "first_use", resume_path: path });
      const publish = { ...command(session.revision), action: "publish" };
      await f.dining.act(f.owner, f.schoolId, session.id, publish);
      expect(await resume()).toMatchObject({ resume_goal_key: "dining", resume_step: "operating", resume_path: path });
      expect((await onboarding.workspace(f.owner)).resume).toMatchObject({ goal: "dining", step: "operating", path });
      expect((await readDiningReadiness(db, f.core, f.owner, f.schoolId)).operation).toMatchObject({ state: "menu_published",
        environment_namespace_id: `live:${f.schoolId}`, source_revision: 2, destination: path });
      expect((await readDiningReadiness(db, f.core, f.borrower, f.schoolId)).operation).toMatchObject({ state: "unavailable", scope: null });
      const retained = await resume();
      await f.dining.act(f.owner, f.schoolId, session.id, publish);
      expect(await resume()).toEqual(retained);
      expect(await db.selectFrom("class_sections").select("id").where("school_id", "=", f.schoolId).execute()).toEqual([]);
      expect(await db.selectFrom("fee_invoices").select("id").where("school_id", "=", f.schoolId).execute()).toEqual([]);
    });
  }, 60_000);

  it("rechecks assigned operator identity and never labels a reference menu as native first use", async () => {
    const f = await createDiningFixture(db);
    await f.run(async () => {
      const service = await f.dining.saveService(f.owner, f.schoolId, { ...command(), name: "Fictional counter",
        coordinator_person_id: f.custodianPersonId });
      const session = await f.dining.createSession(f.owner, f.schoolId, { ...command(), service_id: service.id,
        service_expected_revision: service.revision, label: "Lunch", operator_person_id: f.borrowerPersonId,
        starts_at: f.now, ends_at: new Date(Date.parse(f.now) + 60 * 60_000).toISOString(), menu_text: "Vegetable lunch" });
      expect((await readDiningReadiness(db, f.core, f.borrower, f.schoolId)).operation)
        .toMatchObject({ state: "draft_recorded", action: "view", scope: { id: session.id } });
      await f.dining.act(f.owner, f.schoolId, session.id, { ...command(session.revision), action: "publish" });
      expect((await readDiningReadiness(db, f.core, f.borrower, f.schoolId)).operation).toMatchObject({ state: "menu_published" });
      await db.updateTable("school_memberships").set({ is_active: false }).where("school_id", "=", f.schoolId).where("user_id", "=", f.borrower.id).execute();
      expect((await readDiningReadiness(db, f.core, f.borrower, f.schoolId)).operation).toMatchObject({ state: "unavailable", scope: null });
      expect(await resolveDiningContinuation(db, f.core, f.borrower, f.schoolId, diningDestination(session.id))).toBeNull();
      expect(await f.dining.work(f.borrower, f.schoolId)).toEqual({ needs_me: [], waiting: [] });
      await expect(f.dining.act(f.borrower, f.schoolId, session.id, { ...command(2), action: "open" })).rejects.toThrow(/access|campus/i);
      expect((await f.dining.work(f.owner, f.schoolId)).needs_me).toEqual(expect.arrayContaining([
        expect.objectContaining({ source_id: session.id, state: "route_unavailable", action: "recover" }),
      ]));
      const reference = await f.dining.saveService(f.owner, f.schoolId, { ...command(), name: "Provider menu only",
        coordinator_person_id: f.custodianPersonId, menu_mode: "reference", operations_mode: "native", source_label: "Fictional provider" });
      const referencedSession = await f.dining.createSession(f.owner, f.schoolId, { ...command(), service_id: reference.id,
        service_expected_revision: reference.revision, label: "External menu", operator_person_id: f.custodianPersonId,
        starts_at: f.now, ends_at: new Date(Date.parse(f.now) + 60 * 60_000).toISOString() });
      await f.dining.act(f.owner, f.schoolId, referencedSession.id, { ...command(referencedSession.revision), action: "publish" });
      expect(await resolveDiningContinuation(db, f.core, f.owner, f.schoolId, diningDestination(referencedSession.id))).toBeNull();
    });
  }, 60_000);
});
