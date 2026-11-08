import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool, types } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "../src/database/types.js";
import type { DatabaseService } from "../src/database/database.service.js";
import { createElectiveFixture } from "./learning-elective-change.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";
import { WorkspaceRepository } from "../src/workspace/workspace.repository.js";
import { WorkspaceService } from "../src/workspace/workspace.service.js";
import { ResponsibilityProjectionService } from "../src/campus-model-core/responsibility-projection.service.js";
import { ActivityAttendanceService } from "../src/attendance/activity-attendance.service.js";
import { ActivityWorkspaceProjection } from "../src/workspace/activity-workspace.projection.js";
import { createLiveExecutionEnvironment } from "../src/campus-model-core/execution-environment.runtime.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import type { AuthenticatedRequest } from "../src/common/request.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
const url = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/elective_review_unused_test";
types.setTypeParser(1082, value => value);
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: url, max: 2 }) }) }) as DatabaseService;
beforeAll(() => { process.env.INVITATION_EMAIL_ENABLED = "false"; }); afterAll(() => db.destroy());
describe.skipIf(!enabled)("dated elective change and authoritative Finance classification", () => {
  it("commits only exact known terminal refusal outside rolled-back effects, replays it after response loss, and retains unknown server errors without false proof", async () => {
    const f = await createElectiveFixture(db), input = { ...f.input(), preview_fingerprint: "f".repeat(64) };
    const rejected = async (body = input) => {
      try { await f.service.request(f.owner, body); throw new Error("Expected exact terminal refusal"); }
      catch (cause) { if (!cause || typeof (cause as { getResponse?: unknown }).getResponse !== "function") throw cause; return (cause as { getResponse(): Record<string, unknown> }).getResponse(); }
    };
    const failure = await rejected(); expect(failure).toMatchObject({ code: "elective_change_refused", fields: { elective_change_refusal: { receipt_state: "completed", confirmation: "terminal_refusal", source_id: input.change_id, command_id: input.command_id, reviewed_request: input } } });
    expect(await rejected()).toEqual(failure);
    expect((await sql`SELECT id FROM learning_elective_changes WHERE school_id=${f.schoolId}::uuid`.execute(db)).rows).toEqual([]);
    expect((await sql`SELECT id FROM learning_elective_change_refusals WHERE school_id=${f.schoolId}::uuid`.execute(db)).rows).toHaveLength(1);
    const outcome = await db.selectFrom("campus_model_commands as command").innerJoin("campus_model_command_outcomes as outcome", "outcome.command_id", "command.id")
      .select(["command.state", "outcome.metadata"]).where("command.school_id", "=", f.schoolId).where("command.correlation_id", "=", input.command_id).executeTakeFirstOrThrow();
    expect(outcome.state).toBe("conflicted"); expect(JSON.stringify(outcome.metadata)).not.toContain(input.reason); expect(JSON.stringify(outcome.metadata)).not.toContain("reviewed_request");
    expect(await rejected({ ...input, reason: "Changed original private intent" })).not.toHaveProperty("fields.elective_change_refusal");
    const next = f.input(), event = vi.spyOn(f.electiveModel, "event").mockRejectedValueOnce(new Error("Unclassified event-store failure"));
    try { await expect(f.service.request(f.owner, next)).rejects.toThrow("Unclassified event-store failure"); } finally { event.mockRestore(); }
    expect((await sql`SELECT id FROM learning_elective_change_refusals WHERE school_id=${f.schoolId}::uuid`.execute(db)).rows).toHaveLength(1);
    expect((await sql`SELECT id FROM learning_elective_changes WHERE school_id=${f.schoolId}::uuid`.execute(db)).rows).toEqual([]);
    expect(await f.service.request(f.owner, next)).toMatchObject({ id: next.change_id, state: "waiting_for_finance" });
  }, 90_000);
  it("finishes the common midterm case through real Finance then atomic Activity successors while retaining old frozen roster and earlier expectations", async () => {
    const f = await createElectiveFixture(db), req = { authUser: f.owner, requestId: randomUUID() };
    const plan = async (offeringId: string, title: string, start: string, end: string) => {
      const draft = await f.planning.create(req, f.schoolId, { idempotency_key: randomUUID(), title, purpose: "teaching", description: "", timezone: "UTC",
        starts_on: f.date(1), ends_on: f.date(30), recurrence: "weekly", weekdays: [1, 2, 3, 4, 5, 6, 7], starts_at: start, ends_at: end, end_day_offset: 0,
        space_id: null, person_ids: [], group_ids: [], offering_id: offeringId, class_section_id: null, term_id: null, subject_id: null,
        lead_person_id: f.instructor.id, recorder_person_id: null, reviewer_person_id: null, attendance_mode: "none", location_kind: "online", location_label: "Course seminar", location_url: "" });
      return f.planning.publish(req, f.schoolId, draft.id, { idempotency_key: randomUUID(), expected_revision: draft.revision });
    };
    const sourcePlan = await plan(f.source.id, "Data Systems course", "09:00", "10:00"), destinationPlan = await plan(f.destination.id, "Statistics course", "11:00", "12:00");
    const conflictDraft = await f.planning.create(req, f.schoolId, { idempotency_key: randomUUID(), title: "Previously arranged learner consultation", purpose: "meeting", description: "", timezone: "UTC",
      starts_on: f.selection.effective_on, ends_on: f.selection.effective_on, recurrence: "once", weekdays: [], starts_at: "11:00", ends_at: "12:00", end_day_offset: 0,
      space_id: null, person_ids: [f.learner.id], group_ids: [], offering_id: null, class_section_id: null, term_id: null, subject_id: null,
      lead_person_id: null, recorder_person_id: null, reviewer_person_id: null, attendance_mode: "none", location_kind: "online", location_label: "Consultation", location_url: "" });
    const conflict = await f.planning.publish(req, f.schoolId, conflictDraft.id, { idempotency_key: randomUUID(), expected_revision: conflictDraft.revision });
    const preview = await f.service.preview(f.owner, { selection: f.selection }); expect(preview.schedule.state).toBe("revision_required"); expect(preview.schedule.impacts).toHaveLength(2);
    const input = { ...f.input(), preview_fingerprint: preview.fingerprint, catch_up: { kind: "plan" as const, summary: "Review the destination instructor's first two reading units and attend the scheduled consultation.", due_on: f.date(14) } };
    const beforeRoster = (await sql`SELECT * FROM schedule_plan_roster_sources WHERE school_id=${f.schoolId}::uuid AND version_id=ANY(${[sourcePlan.id, destinationPlan.id]}::uuid[]) ORDER BY version_id,person_id,participation_role,source_kind,source_ref`.execute(db)).rows;
    const beforePast = (await sql`SELECT * FROM schedule_activity_occurrences WHERE school_id=${f.schoolId}::uuid AND plan_version_id=ANY(${[sourcePlan.id, destinationPlan.id]}::uuid[]) AND local_date<${f.selection.effective_on}::date ORDER BY id`.execute(db)).rows;
    await f.service.request(f.owner, input); await f.classify(input.change_id);
    const refusedCommand = { command_id: randomUUID(), expected_revision: 2 };
    try { await f.service.apply(f.owner, input.change_id, refusedCommand); throw new Error("Expected timetable conflict after staged enrollment"); }
    catch (cause) { expect((cause as { getResponse(): unknown }).getResponse()).toMatchObject({ code: "elective_change_refused", fields: { elective_change_refusal: { receipt_state: "completed", reviewed_request: refusedCommand } } }); }
    expect((await sql`SELECT ends_on FROM learning_offering_enrollments WHERE id=${f.selection.source_enrollment.id}::uuid`.execute(db)).rows).toEqual([{ ends_on: null }]);
    expect((await sql`SELECT id FROM learning_offering_enrollments WHERE school_id=${f.schoolId}::uuid AND offering_id=${f.destination.id}::uuid AND person_id=${f.learner.id}::uuid`.execute(db)).rows).toEqual([]);
    expect((await sql`SELECT id FROM schedule_versions WHERE school_id=${f.schoolId}::uuid AND replaces_version_id=ANY(${[sourcePlan.id, destinationPlan.id]}::uuid[])`.execute(db)).rows).toEqual([]);
    await f.planning.cancel(req, f.schoolId, conflict.id, { idempotency_key: randomUUID(), expected_revision: conflict.revision, reason: "Reviewed consultation cancellation before accepting the new elective timetable." });
    const command = { command_id: randomUUID(), expected_revision: 2 }, result = await f.service.apply(f.owner, input.change_id, command);
    expect(result).toMatchObject({ state: "applied", schedule_revisions: expect.any(Array) }); expect(result.schedule_revisions).toHaveLength(2);
    expect(await f.service.apply(f.owner, input.change_id, command)).toEqual({ ...result, replayed: true });
    expect((await sql`SELECT * FROM schedule_plan_roster_sources WHERE school_id=${f.schoolId}::uuid AND version_id=ANY(${[sourcePlan.id, destinationPlan.id]}::uuid[]) ORDER BY version_id,person_id,participation_role,source_kind,source_ref`.execute(db)).rows).toEqual(beforeRoster);
    expect((await sql`SELECT * FROM schedule_activity_occurrences WHERE school_id=${f.schoolId}::uuid AND plan_version_id=ANY(${[sourcePlan.id, destinationPlan.id]}::uuid[]) AND local_date<${f.selection.effective_on}::date ORDER BY id`.execute(db)).rows).toEqual(beforePast);
    const newPlans = result.schedule_revisions!.map(item => item.plan_id);
    const membership = (await sql<{ offering_id: string; person_id: string }>`SELECT version.offering_id,source.person_id FROM schedule_plan_roster_sources source
      JOIN schedule_versions version ON version.id=source.version_id AND version.school_id=source.school_id
      WHERE source.school_id=${f.schoolId}::uuid AND source.version_id=ANY(${newPlans}::uuid[]) AND source.person_id=${f.learner.id}::uuid AND source.participation_role='participant'`.execute(db)).rows;
    expect(membership).toContainEqual({ offering_id: f.destination.id, person_id: f.learner.id }); expect(membership.some(row => row.offering_id === f.source.id)).toBe(false);
    expect(await f.counts()).toEqual({ invoices: 0, payments: 0, refunds: 0 });
  }, 120_000);
  it("requires explicit no-change even without invoices, applies exact future enrollment once and preserves parallel enrollment and submitted history", async () => {
    const f = await createElectiveFixture(db); let request = f.input();
    const assignment = await f.publish(f.source.id);
    await f.assignments.saveWork(f.learner.actor, assignment.assignment_id, f.learner.id, { command_id: randomUUID(), expected_revision: 0, body: "Retained original source-course submission." });
    await f.assignments.submit(f.learner.actor, assignment.assignment_id, f.learner.id, { command_id: randomUUID(), expected_revision: 1, attempt_id: randomUUID() });
    const coordinator=await db.transaction().execute(tx=>f.core.resolveAccountEndpoint(tx,{school_id:f.schoolId,user_id:f.owner.id,at:new Date().toISOString()}));
    if(!coordinator.acting)throw new Error("Expected exact current coordinator endpoint.");
    const planRequest={authUser:f.owner,requestId:randomUUID()};
    const draft=await f.planning.create(planRequest,f.schoolId,{idempotency_key:randomUUID(),title:"Reviewed source teaching studio",purpose:"teaching",timezone:"UTC",
      starts_on:f.date(2),ends_on:f.date(30),recurrence:"weekly",weekdays:[new Date(f.date(2)+"T12:00:00Z").getUTCDay()||7],starts_at:"08:00",ends_at:"09:00",
      offering_id:f.source.id,lead_person_id:f.instructor.id,recorder_person_id:coordinator.person_id,reviewer_person_id:coordinator.person_id,attendance_mode:"roll_call",location_kind:"online",location_label:"Course studio"});
    await f.planning.publish(planRequest,f.schoolId,draft.id,{idempotency_key:randomUUID(),expected_revision:draft.revision});
    const destinationDraft=await f.planning.create(planRequest,f.schoolId,{idempotency_key:randomUUID(),title:"Destination weekly seminar",purpose:"teaching",timezone:"UTC",
      starts_on:f.date(2),ends_on:f.date(120),recurrence:"weekly",weekdays:[new Date(f.date(2)+"T12:00:00Z").getUTCDay()||7],starts_at:"11:00",ends_at:"12:00",
      offering_id:f.destination.id,lead_person_id:f.instructor.id,attendance_mode:"none",location_kind:"online",location_label:"Course seminar"});
    const destinationPlan=await f.planning.publish(planRequest,f.schoolId,destinationDraft.id,{idempotency_key:randomUUID(),expected_revision:destinationDraft.revision});
    const distantSelection={...request.selection,effective_on:f.date(60)},distantBefore=await f.service.preview(f.owner,{selection:distantSelection});
    expect(distantBefore.catch_up.prior_destination_sessions).toBe(9);
    await f.planning.ensureOccurrences(f.schoolId,f.date(37),f.date(37),undefined,{source:"activity"});
    const distantAfter=await f.service.preview(f.owner,{selection:distantSelection});
    expect(distantAfter.fingerprint).toBe(distantBefore.fingerprint);expect(distantAfter.catch_up.prior_destination_sessions).toBe(9);
    expect((await sql<{revision:number}>`SELECT revision FROM schedule_versions WHERE school_id=${f.schoolId}::uuid AND id=${destinationPlan.id}::uuid`.execute(db)).rows[0]!.revision).toBe(destinationPlan.revision);
    // New past evidence changes the preview; explicitly review it before submission.
    request.preview_fingerprint = (await f.service.preview(f.owner, { selection: request.selection })).fingerprint;
    const before = await f.counts(), history = await db.selectFrom("learning_assignment_attempts").selectAll().where("school_id", "=", f.schoolId).execute();
    expect(await f.service.request(f.owner, request)).toMatchObject({ id: request.change_id, revision: 1, state: "waiting_for_finance" });
    expect(await f.service.request(f.owner, request)).toMatchObject({ revision: 1, replayed: true });
    const stored=(await sql<{selection:typeof request.selection;preview_fingerprint:string}>`SELECT selection,preview_fingerprint FROM learning_elective_changes WHERE school_id=${f.schoolId}::uuid AND id=${request.change_id}::uuid`.execute(db)).rows[0]!;
    expect((await f.service.preview(f.owner,{selection:stored.selection})).fingerprint).toBe(stored.preview_fingerprint);
    expect(await f.service.detail(f.owner,request.change_id)).toMatchObject({preview_changed:false,can_apply:false});
    const attendance=new ActivityAttendanceService(db,f.core,f.core,f.core,f.core,f.core),activities=new ActivityWorkspaceProjection(db,f.planning,attendance,f.core);
    const at = new Date(), clock = { now: () => at, read: () => ({ instant: at, iso_instant: at.toISOString(), local_date: f.today,
      local_time: "12:00:00", time_zone: "UTC" }) };
    const workspace = new WorkspaceService(new WorkspaceRepository(db, new ResponsibilityProjectionService(f.core)), clock as never,
      undefined, undefined, activities, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, f.service);
    const view = { mode: "live" as const, institution_id: f.schoolId, namespace_id: `live:${f.schoolId}` as const };
    const pending = await workspace.manifest(f.owner, null, view), task = pending.work.items.find(item => item.source?.id === request.change_id)!;
    expect(task).toMatchObject({ href: `/areas/fees/ledger?elective_review=${request.change_id}`, source_label: "Course change",
      action_label: "Review financial impact", source: { domain: "learning_elective", kind: "elective_change", action: "finance.classify", revision: 1 } });
    expect(task.core_trace?.message_ids).toHaveLength(1); expect(task.status_label).not.toBe("Source unavailable");
    const candidate = { message_id: task.core_trace!.message_ids[0]!, change_id: request.change_id, source_revision: 1 };
    expect(await f.service.financeWorkSources(f.owner, f.schoolId, [candidate])).toEqual([{ ...candidate, revision: 1 }]);
    expect(await f.service.financeWorkSources(f.learner.actor, f.schoolId, [candidate])).toEqual([]);
    expect(await f.service.financeWorkSources(f.owner, randomUUID(), [candidate])).toEqual([]);
    expect(await f.service.financeWorkSources(f.owner, f.schoolId, [{ ...candidate, change_id: randomUUID() },
      { ...candidate, message_id: randomUUID() }, { ...candidate, source_revision: 2 }, { ...candidate, change_id: "not-a-source" }])).toEqual([]);
    await expect(f.service.request(f.owner, { ...request, reason: "Changed retained intent" })).rejects.toThrow("different elective work");
    await expect(f.service.apply(f.owner, request.change_id, { command_id: randomUUID(), expected_revision: 1 })).rejects.toThrow("Finance");
    let decision = await f.classify(request.change_id);
    expect(await f.service.financeWorkSources(f.owner, f.schoolId, [candidate])).toEqual([]);
    expect((await workspace.manifest(f.owner, null, view)).work.items.some(item => item.source?.id === request.change_id)).toBe(false);
    expect(await f.service.classify(f.owner, f.schoolId, request.change_id, decision.body)).toMatchObject({ replayed: true, revision: 2 });
    const detail = await f.service.detail(f.owner, request.change_id);
    expect(detail.preview_changed).toBe(false);expect(detail.can_apply).toBe(true);expect(detail.current_preview!.fingerprint).toBe(stored.preview_fingerprint);
    expect(detail.current_preview!.prior_evidence.attendance_registers).toBe(0);
    expect(JSON.stringify(detail)).not.toContain("balance_paise"); expect(JSON.stringify(detail)).not.toContain(decision.body.reason);
    const preparedRegister=(await sql<{id:string;revision:number}>`SELECT register.id,register.revision FROM activity_attendance_registers register
      JOIN schedule_activity_occurrences occurrence ON occurrence.school_id=register.school_id AND occurrence.id=register.occurrence_id
      WHERE register.school_id=${f.schoolId}::uuid AND occurrence.plan_version_id=${draft.id}::uuid AND occurrence.local_date=${f.date(2)}::date`.execute(db)).rows[0]!;
    expect(preparedRegister.revision).toBe(0);
    const roster=(await sql<{person_id:string}>`SELECT person_id FROM activity_attendance_roster WHERE school_id=${f.schoolId}::uuid AND register_id=${preparedRegister.id}::uuid ORDER BY person_id`.execute(db)).rows;
    const markedAt=`${f.date(2)}T08:30:00.000Z`,environment=createLiveExecutionEnvironment({institution_id:f.schoolId,clock:{now:()=>new Date(markedAt),nowIso:()=>markedAt}});
    await executionEnvironmentStorage.run(environment,async()=>{
      await attendance.marks(f.owner,f.schoolId,preparedRegister.id,{expected_revision:0,records:roster.map(person=>({person_id:person.person_id,status:"present"}))},
        {authUser:f.owner,requestId:randomUUID(),headers:{"idempotency-key":randomUUID()},ip:"127.0.0.1"} as unknown as AuthenticatedRequest);
      expect(await f.service.detail(f.owner,request.change_id)).toMatchObject({preview_changed:true,can_apply:false,current_preview:{prior_evidence:{attendance_registers:1}}});
    });
    await f.service.withdraw(f.owner,request.change_id,{command_id:randomUUID(),expected_revision:2,reason:"Review newly recorded participation before confirming this future course change."});
    request={...f.input(),preview_fingerprint:(await f.service.preview(f.owner,{selection:request.selection})).fingerprint};
    await f.service.request(f.owner,request);decision=await f.classify(request.change_id);
    const approved=await f.service.detail(f.owner,request.change_id);expect(approved).toMatchObject({preview_changed:false,can_apply:true});
    const command = { command_id: randomUUID(), expected_revision: 2 }, applied = await f.service.apply(f.owner, request.change_id, command);
    expect(applied).toMatchObject({ state: "applied", revision: 3, source_enrollment_id: f.selection.source_enrollment.id, effective_on: f.selection.effective_on });
    expect(await f.service.apply(f.owner, request.change_id, command)).toEqual({ ...applied, replayed: true });
    expect(await f.service.detail(f.owner,request.change_id)).toMatchObject({state:"applied",can_apply:false,can_assign_finance:false,can_withdraw:false,
      finance:{state:"no_financial_change",decision_id:approved.finance.decision_id,ledger_basis_changed:null}});
    expect(await f.service.confirmation(f.owner, request.change_id, command.command_id, "apply")).toMatchObject({ state: "accepted", result: { id: request.change_id, command_id: command.command_id, action: "apply" } });
    const rows = await db.selectFrom("learning_offering_enrollments").select(["offering_id", "starts_on", "ends_on", "revision"]).where("school_id", "=", f.schoolId).where("person_id", "=", f.learner.id).execute();
    expect(rows).toContainEqual(expect.objectContaining({ offering_id: f.source.id, ends_on: f.selection.effective_on, revision: 2 }));
    expect(rows).toContainEqual(expect.objectContaining({ offering_id: f.destination.id, starts_on: f.selection.effective_on, ends_on: null }));
    expect(rows).toContainEqual(expect.objectContaining({ offering_id: f.parallel.id, ends_on: null, revision: 1 }));
    expect(await db.selectFrom("learning_assignment_attempts").selectAll().where("school_id", "=", f.schoolId).execute()).toEqual(history);
    expect(await f.counts()).toEqual(before);
    const safe = await db.selectFrom("campus_model_commands").select("safe_context").where("school_id", "=", f.schoolId).execute();
    expect(JSON.stringify(safe)).not.toContain(request.reason); expect(JSON.stringify(safe)).not.toContain(decision.body.reason); expect(JSON.stringify(safe)).not.toContain("ledger_basis");
    expect((await sql`SELECT id FROM fee_elective_change_reviews WHERE school_id=${f.schoolId}::uuid`.execute(db)).rows).toHaveLength(2);
  }, 90_000);
  it("keeps missing Finance handoff visibly unassigned, supports explicit assignment and retains required financial work until an exact later no-change", async () => {
    const f = await createElectiveFixture(db), input = f.input(false); await f.service.request(f.owner, input);
    expect(await f.service.detail(f.owner, input.change_id)).toMatchObject({ state: "unassigned", can_apply: false, finance: { state: "unassigned" } });
    await expect(f.service.financeWorkspace(f.owner, f.schoolId, input.change_id)).rejects.toThrow("named Finance");
    const reviewer = f.options.finance_reviewers[0]!;
    await f.service.assignFinance(f.owner, input.change_id, { command_id: randomUUID(), expected_revision: 1, reviewer: { user_id: reviewer.user_id, eligibility_hash: reviewer.eligibility_hash }, confirm_delivery: true });
    const progress = await f.classify(input.change_id, "requires_financial_review"); expect(progress.result).toMatchObject({ revision: 3, state: "requires_financial_review" });
    const pending = await f.service.financeWorkspace(f.owner, f.schoolId, input.change_id); expect(pending.can_classify).toBe(true);
    await expect(f.service.apply(f.owner, input.change_id, { command_id: randomUUID(), expected_revision: 3 })).rejects.toThrow("Finance");
    await f.classify(input.change_id);
    expect(await f.service.apply(f.owner, input.change_id, { command_id: randomUUID(), expected_revision: 4 })).toMatchObject({ state: "applied", revision: 5 });
    expect((await sql`SELECT id FROM fee_elective_change_reviews WHERE school_id=${f.schoolId}::uuid`.execute(db)).rows).toHaveLength(2);
    expect(await f.counts()).toEqual({ invoices: 0, payments: 0, refunds: 0 });
  }, 90_000);
  it("changed real person invoice basis blocks apply; renewed explicit Finance review is required and null student IDs stay null", async () => {
    const f = await createElectiveFixture(db), input = f.input(); await f.service.request(f.owner, input); await f.classify(input.change_id);
    const invoice = { invoice_id: randomUUID(), command_id: randomUUID(), beneficiary: { person_id: f.learner.id, expected_revision: f.options.person.revision }, reference: `ELEC-${randomUUID().slice(0, 8)}`,
      description: "Existing Finance owner charge for reviewed services", amount_paise: 250000, due_on: f.date(20) };
    await f.ledger.issue(f.owner, f.schoolId, invoice);
    expect(await f.service.detail(f.owner, input.change_id)).toMatchObject({ can_apply: false, finance: { ledger_basis_changed: true } });
    await expect(f.service.apply(f.owner, input.change_id, { command_id: randomUUID(), expected_revision: 2 })).rejects.toThrow("ledger changed");
    const reviewer = f.options.finance_reviewers[0]!;
    await f.service.assignFinance(f.owner, input.change_id, { command_id: randomUUID(), expected_revision: 2, reviewer: { user_id: reviewer.user_id, eligibility_hash: reviewer.eligibility_hash }, confirm_delivery: true });
    const workspace = await f.service.financeWorkspace(f.owner, f.schoolId, input.change_id);
    expect(workspace.ledger_basis.invoices).toHaveLength(1); expect(workspace.ledger_basis.invoices[0]).toMatchObject({ student_id: null, person_id: f.learner.id });
    await expect(f.service.classify(f.owner, f.schoolId, input.change_id, { command_id: randomUUID(), expected_revision: 3, expected_ledger_basis_hash: "a".repeat(64), outcome: "no_financial_change", reason: "This is a stale financial basis." })).rejects.toThrow("basis changed");
    await f.classify(input.change_id);
    expect(await f.service.apply(f.owner, input.change_id, { command_id: randomUUID(), expected_revision: 4 })).toMatchObject({ state: "applied" });
    expect(await f.counts()).toEqual({ invoices: 1, payments: 0, refunds: 0 });
  }, 90_000);
  it("current authority, exact revised sources and immutable native/Core binding refuse forgery without effects", async () => {
    const f = await createElectiveFixture(db), input = f.input(); await f.service.request(f.owner, input);
    await expect(f.service.options(f.learner.actor, f.source.id, f.learner.id)).rejects.toThrow();
    await expect(f.service.detail(f.learner.actor, input.change_id)).rejects.toThrow();
    await expect(f.service.financeWorkspace(f.learner.actor, f.schoolId, input.change_id)).rejects.toThrow();
    await expect(f.service.confirmation(f.owner, input.change_id, input.command_id, "apply")).rejects.toThrow("different elective");
    await expect(db.transaction().execute(async tx => { await sql`DELETE FROM learning_elective_changes WHERE id=${input.change_id}::uuid`.execute(tx); })).rejects.toThrow();
    await expect(db.transaction().execute(async tx => { await sql`TRUNCATE learning_elective_changes,learning_elective_change_actions,fee_elective_change_reviews,learning_elective_change_refusals`.execute(tx); })).rejects.toThrow("immutable");
    await f.classify(input.change_id);
    const learner = await f.people.detail(f.owner, f.schoolId, f.learner.id);
    await f.people.correctName({ authUser: f.owner, requestId: randomUUID() } as never, f.schoolId, learner.id, { first_name: "Updated learner", expected_revision: learner.revision, reason: "Reviewed display correction", idempotency_key: randomUUID() });
    await expect(f.service.apply(f.owner, input.change_id, { command_id: randomUUID(), expected_revision: 2 })).rejects.toThrow();
    const withdrawal = { command_id: randomUUID(), expected_revision: 2, reason: "Review the current changed person/source before sending a fresh proposal." };
    expect(await f.service.withdraw(f.owner, input.change_id, withdrawal)).toMatchObject({ state: "withdrawn", revision: 3 });
    expect(await f.service.withdraw(f.owner, input.change_id, withdrawal)).toMatchObject({ replayed: true });
    const unchanged = await db.selectFrom("learning_offering_enrollments").select("ends_on").where("id", "=", f.selection.source_enrollment.id).executeTakeFirstOrThrow(); expect(unchanged.ends_on).toBeNull();
    const stale = { command_id: randomUUID(), expected_revision: 1 };
    try { await f.service.apply(f.owner, input.change_id, stale); throw new Error("Expected exact obsolete proof"); } catch (cause) {
      expect((cause as { getResponse(): unknown }).getResponse()).toMatchObject({ code: "elective_change_obsolete", fields: { elective_change_obsolete: { source_id: input.change_id, command_id: stale.command_id, receipt_state: "absent", expected_revision: 1, current_revision: 3 } } });
    }
  }, 90_000);
});
