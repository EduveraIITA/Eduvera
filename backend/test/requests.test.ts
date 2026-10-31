import { ConflictException, ForbiddenException } from "@nestjs/common";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PostgresQueryCompiler, type CompiledQuery, type OperationNode, type Transaction } from "kysely";
import { describe, expect, it, vi } from "vitest";
import {
  attendanceDeclineAttentionHref,
  attendanceRegisterRequestItems,
  collectorDutyAttentionHref,
  dayPlanAttentionHref,
  departurePlanAttentionHref,
  eventDutyAttentionHref,
  eventFinanceAttentionHref,
  eventSessionAttentionHref,
  governancePolicyAttentionHref,
  journeyAttentionHref,
  parentDiaryAttentionHref,
  parentEventAttentionHref,
  paymentCaptureAttentionHref,
  peopleImportAttentionHref,
  principalAttendanceExceptionItems,
  principalNoticeAttentionHref,
  safeguardingReportAttentionHref,
  scheduleDraftAttentionHref,
  staffAssignmentAttentionHref,
  sortRequestItems,
  summarizeRequestItems,
  teachingAssignmentAttentionHref,
  RequestsService,
} from "../src/requests/requests.service.js";
import type { AuthUser } from "../src/common/request.js";
import type { DatabaseService } from "../src/database/database.service.js";
import { ExecutionDataPlaneScope } from "../src/database/execution-data-plane.js";
import { simulationSessionExecutionEnvironment } from "../src/auth/session-execution-environment.js";
import { executionNow } from "../src/campus-model-core/execution-time.runtime.js";
import type { Database } from "../src/database/types.js";
import type { GovernanceDecisionAuthorityPort } from "../src/governance/decision-authority.port.js";
import type { AttendanceClassWorkspace } from "../src/attendance/attendance-workspace.js";
import type { RequestInboxItem } from "../src/requests/requests.types.js";
import type { FinanceArrangementsReadService } from "../src/operations/finance-arrangements.read.js";

function item(id: string, priority: RequestInboxItem["priority"], dueAt: string, category: RequestInboxItem["category"]): RequestInboxItem {
  return {
    id,
    kind: id,
    category,
    priority,
    title: id,
    detail: "",
    status_label: "Pending",
    action_label: "Review",
    href: "/",
    source_id: id,
    subject_label: null,
    occurs_at: null,
    due_at: dueAt,
    created_at: null,
  };
}

describe("request inbox projection", () => {
  it.each(["self", "dependent"] as const)("keeps %s fee due truth with Finance instead of recomputing from original invoice dates", async relationship => {
    const compiler = new PostgresQueryCompiler(), statements: string[] = [];
    const executor = { transformQuery: (node: OperationNode) => node,
      compileQuery: (node: Parameters<PostgresQueryCompiler["compileQuery"]>[0], queryId: Parameters<PostgresQueryCompiler["compileQuery"]>[1]) => compiler.compileQuery(node, queryId),
      executeQuery: (query: CompiledQuery) => { statements.push(query.sql); return Promise.resolve({ rows: [] }); } };
    const database = { getExecutor: () => executor } as unknown as DatabaseService;
    const dueWork = vi.fn().mockResolvedValue([{ id: "invoice-1", title: "Tuition", detail: "Remaining balance: ₹20,000", status_label: "Next payment 30 Nov",
      due_at: "2026-11-30T18:29:59.999Z", created_at: "2026-10-01T09:00:00.000Z", priority: "normal" }]);
    const service = new RequestsService(database, undefined, undefined, { dueWork } as unknown as FinanceArrangementsReadService);
    const actor = { id: "account-1" } as AuthUser, scope = { school_id: "campus-1", school_name: "College", timezone: "Asia/Kolkata", student_id: "learner-1", student_name: "Sana" };
    const probe = service as unknown as { feeDueWorkspaceItems: (user: AuthUser, scope: unknown, relationship: "self" | "dependent") => Promise<RequestInboxItem[]>;
      parentItems: (user: AuthUser, scope: unknown) => Promise<RequestInboxItem[]> };
    const items = relationship === "dependent" ? await probe.parentItems(actor, scope) : await probe.feeDueWorkspaceItems(actor, scope, relationship);
    expect(dueWork).toHaveBeenCalledWith(actor, "campus-1", "learner-1", relationship);
    expect(items).toEqual([expect.objectContaining({ source_id: "invoice-1", kind: "fee_due", priority: "normal", due_at: "2026-11-30T18:29:59.999Z",
      created_at: "2026-10-01T09:00:00.000Z", href: `/areas/fees/account?scope=${relationship}&student_id=learner-1&invoice=invoice-1` })]);
    expect(statements.some(statement => statement.includes("fee_invoices"))).toBe(false);
    dueWork.mockResolvedValueOnce([{ id: "invoice-1", title: "Tuition", detail: "The agreed schedule needs review", status_label: "Payment schedule needs review",
      due_at: null, created_at: "2026-10-01T09:00:00.000Z", priority: "normal" }]);
    expect(await probe.feeDueWorkspaceItems(actor, scope, relationship)).toEqual([expect.objectContaining({ due_at: null, priority: "normal", status_label: "Payment schedule needs review" })]);
    dueWork.mockResolvedValueOnce([]);
    expect(await probe.feeDueWorkspaceItems(actor, scope, relationship)).toEqual([]);
  });

  it("does not disguise a missing Finance read adapter as a complete empty fee queue", async () => {
    const service = new RequestsService({} as DatabaseService) as unknown as { feeDueWorkspaceItems: (user: AuthUser, scope: unknown, relationship: "self") => Promise<RequestInboxItem[]> };
    await expect(service.feeDueWorkspaceItems({ id: "account" } as AuthUser, { student_id: "student" }, "self")).rejects.toThrow("Current fee obligations could not be loaded");
  });
  it("composes broad operational queues only from exact institution responsibilities", async () => {
    const service = new RequestsService({} as DatabaseService);
    const probe = service as unknown as {
      principalItems: (user: AuthUser, scope: unknown) => Promise<RequestInboxItem[]>;
      principalCanonicalItems: (user: AuthUser, scope: unknown) => Promise<RequestInboxItem[]>;
    };
    const principalItems = vi.spyOn(probe, "principalItems").mockResolvedValue([
      { ...item("attendance-review", "high", "2026-10-19T12:00:00Z", "attendance"), source_id: "attendance-review", href: "/areas/attendance/coordination" },
      { ...item("fee-review", "high", "2026-10-19T12:00:00Z", "finance"), source_id: "fee-review", href: "/areas/fees/ledger" },
    ]);
    const principalCanonicalItems = vi.spyOn(probe, "principalCanonicalItems").mockResolvedValue([]);
    const actor = { id: "10000000-0000-4000-8000-000000000001" } as AuthUser;
    const baseContext = {
      school_id: "20000000-0000-4000-8000-000000000002",
      environment_namespace_id: "live:20000000-0000-4000-8000-000000000002",
      recorded_at: "2026-10-19T12:00:00.000Z",
      school_name: "Test campus",
      timezone: "Asia/Kolkata",
      membership_roles: ["admin" as const],
      relationships: [],
      assignments: [],
    };

    await expect(service.workspaceItems(actor, baseContext)).resolves.toEqual([]);
    expect(principalItems).not.toHaveBeenCalled();

    await expect(service.workspaceItems(actor, {
      ...baseContext,
      assignments: [{
        action_key: "attendance.view",
        capability_key: "attendance",
        scope: { kind: "class", id: "30000000-0000-4000-8000-000000000003" },
      }],
    })).resolves.toEqual([]);
    expect(principalItems).not.toHaveBeenCalled();

    await expect(service.workspaceItems(actor, {
      ...baseContext,
      assignments: [{
        action_key: "attendance.view",
        capability_key: "attendance",
        scope: { kind: "institution", id: baseContext.school_id },
      }],
    })).resolves.toEqual([expect.objectContaining({ id: "attendance-review", category: "attendance" })]);
    expect(principalItems).toHaveBeenCalledTimes(1);
    expect(principalCanonicalItems).toHaveBeenCalledTimes(1);
  });

  it("requires the exact isolated namespace and checkpoint before projecting native Simulation Work", async () => {
    const executionScope = new ExecutionDataPlaneScope();
    const service = new RequestsService({} as DatabaseService, undefined, executionScope);
    const probe = service as unknown as {
      teacherItems: (user: AuthUser, scope: unknown) => Promise<RequestInboxItem[]>;
      teacherCanonicalItems: (user: AuthUser, scope: unknown) => Promise<RequestInboxItem[]>;
    };
    const schoolId = "20000000-0000-4000-8000-000000000002";
    const actor = { id: "10000000-0000-4000-8000-000000000001", active_school_id: schoolId } as AuthUser;
    const scenarioId = "30000000-0000-4000-8000-000000000003";
    const runId = "40000000-0000-4000-8000-000000000004";
    const instant = "2026-10-20T12:00:00.000Z";
    const { environment } = simulationSessionExecutionEnvironment({
      institution_id: schoolId, scenario_id: scenarioId, run_id: runId,
      namespace_id: `scenario:${scenarioId}:run:${runId}`,
      virtual_now: instant, time_zone: "Asia/Kolkata", source_snapshot_at: "2026-10-19T12:00:00.000Z",
      source_snapshot_ref: "sha256:requests-test", expires_at: "2099-01-01T00:00:00.000Z",
    }, { manifest_ref: "requests-test", checked_at: "2026-10-19T12:00:00.000Z" });
    const teacherItems = vi.spyOn(probe, "teacherItems").mockImplementation(() => Promise.resolve([
      item(executionNow().toISOString(), "high", instant, "staffing"),
    ]));
    vi.spyOn(probe, "teacherCanonicalItems").mockResolvedValue([]);
    const context = {
      school_id: schoolId, school_name: "Isolated campus", timezone: "Asia/Kolkata",
      environment_namespace_id: environment!.namespace_id, recorded_at: instant,
      membership_roles: ["staff" as const], relationships: [], assignments: [],
    };
    await expect(service.workspaceItems(actor, context)).rejects.toThrow(/not bound/);
    expect(teacherItems).not.toHaveBeenCalled();
    const result = await executionScope.run(environment!, () => service.workspaceItems(actor, context));
    expect(result).toEqual([expect.objectContaining({ id: instant })]);
    await expect(executionScope.run(environment!, () => service.workspaceItems(actor, {
      ...context, environment_namespace_id: `scenario:${scenarioId}:run:50000000-0000-4000-8000-000000000005`,
    }))).rejects.toThrow(/not bound/);
    await expect(executionScope.run(environment!, () => service.workspaceItems(actor, {
      ...context, recorded_at: "2026-10-20T12:05:00.000Z",
    }))).rejects.toThrow(/not bound/);
    await expect(executionScope.run(environment!, () => service.workspaceItems(actor, {
      ...context, environment_namespace_id: `live:${schoolId}`,
    }))).rejects.toThrow(/not bound/);
    await expect(executionScope.run(environment!, () => service.workspaceItems({
      ...actor, active_school_id: "60000000-0000-4000-8000-000000000006",
    }, context))).rejects.toThrow(ForbiddenException);
    expect(teacherItems).toHaveBeenCalledTimes(1);
  });

  it("shows transport duty approvals only to the exact configured decision owner", async () => {
    const transaction = {} as Transaction<Database>;
    const ownerId = "10000000-0000-4000-8000-000000000001";
    const schoolId = "20000000-0000-4000-8000-000000000002";
    const assertDecisionAuthority = vi.fn().mockResolvedValue({});
    const authority = { assertDecisionAuthority } as unknown as GovernanceDecisionAuthorityPort;
    const service = new RequestsService({} as DatabaseService, authority);
    const probe = service as unknown as {
      canReviewTransportDutyChange(
        user: AuthUser,
        schoolId: string,
        transaction: Transaction<Database>,
      ): Promise<boolean>;
    };

    await expect(probe.canReviewTransportDutyChange({ id: ownerId } as AuthUser, schoolId, transaction))
      .resolves.toBe(true);
    expect(assertDecisionAuthority).toHaveBeenCalledWith(
      transaction,
      schoolId,
      "transport_duty_change_decision",
      ownerId,
      expect.any(Date),
    );

    assertDecisionAuthority.mockRejectedValueOnce(new ForbiddenException("Not the current owner."));
    await expect(probe.canReviewTransportDutyChange({ id: "30000000-0000-4000-8000-000000000003" } as AuthUser, schoolId, transaction))
      .resolves.toBe(false);

    assertDecisionAuthority.mockRejectedValueOnce(new ConflictException("No configured owner."));
    await expect(probe.canReviewTransportDutyChange({ id: ownerId } as AuthUser, schoolId, transaction))
      .resolves.toBe(false);

    const source = readFileSync(resolve(process.cwd(), "src/requests/requests.service.ts"), "utf8");
    expect(source).toContain("const canReviewTransportDutyChange = await this.canReviewTransportDutyChange(user, scope.school_id, transaction)");
    expect(source).toContain("AND ${canReviewTransportDutyChange}");
  });

  it("links a diary acknowledgement to its dated item", () => {
    expect(parentDiaryAttentionHref("student/1", "diary item", "2026-10-09"))
      .toBe("/areas/messages/diary?scope=dependent&student_id=student%2F1&date=2026-10-09&diary_item=diary%20item");
  });

  it.each(["rsvp", "consent", "payment", "checklist"] as const)(
    "links an event %s request to the exact action section",
    (focus) => {
      expect(parentEventAttentionHref("event/1", "student 1", focus))
        .toBe(`/areas/events/calendar/event%2F1?scope=dependent&student_id=student+1&focus=${focus}`);
    },
  );

  it("opens principal notice exceptions in the attention recipient view", () => {
    expect(principalNoticeAttentionHref("notice/1"))
      .toBe("/areas/messages/updates/notice%2F1?focus=attention");
    expect(safeguardingReportAttentionHref("teacher", "report/1"))
      .toBe("/areas/care/concerns?section=message_reports&report=report%2F1");
  });

  it("deep-links each durable operational action to its exact workflow", () => {
    expect(eventSessionAttentionHref("teacher", "event/1", "session 1"))
      .toBe("/areas/events/assigned/event%2F1/sessions/session%201/attendance");
    expect(eventFinanceAttentionHref("principal", "event/1"))
      .toBe("/areas/events/manage/event%2F1?view=finance&focus=refunds");
    expect(eventDutyAttentionHref("teacher", "event/1"))
      .toBe("/areas/events/assigned/event%2F1?focus=duty");
    expect(journeyAttentionHref("trip/1"))
      .toBe("/areas/departure/manage/journeys/trip%2F1?focus=reconciliation");
    expect(peopleImportAttentionHref("principal", "school/1", "import 1"))
      .toBe("/more/setup/people/import?school=school%2F1&import=import%201");
    expect(governancePolicyAttentionHref("policy/1"))
      .toBe("/more/governance?section=register&policy=policy%2F1");
    expect(dayPlanAttentionHref("school/1", "2026-10-13", "class 1", "plan 1"))
      .toBe("/areas/timetable/planning/day?school=school%2F1&date=2026-10-13&class=class%201&plan=plan%201");
    expect(scheduleDraftAttentionHref("class/1", "term 1", "version 1"))
      .toBe("/areas/timetable/planning/settings?settings=pattern&class=class%2F1&term=term%201&version=version%201");
    expect(teachingAssignmentAttentionHref({ schoolId: "school/1", date: "2026-10-13", classSectionId: "class 1", termId: "term 1", weekday: 2, periodId: "period/1" }))
      .toBe("/areas/timetable/planning/settings?class=class%201&term=term%201&day=2&date=2026-10-13&period=period%2F1");
    expect(teachingAssignmentAttentionHref({ schoolId: "school/1", date: "2026-10-13", classSectionId: "class 1", termId: "term 1", weekday: 2, periodId: "period/1", dayPlanId: "plan 1" }))
      .toBe("/areas/timetable/planning/day?school=school%2F1&date=2026-10-13&class=class%201&plan=plan%201&period=period%2F1");
    expect(staffAssignmentAttentionHref("profile/1", "assignment 1"))
      .toBe("/more/setup/responsibilities?staff=profile%2F1&assignment=assignment%201");
    expect(paymentCaptureAttentionHref("invoice/1", "order 1"))
      .toBe("/areas/fees/ledger?view=review&invoice=invoice%2F1&order=order%201");
    expect(collectorDutyAttentionHref("trip/1"))
      .toBe("/areas/departure/manage?section=roster&trip=trip%2F1");
    expect(departurePlanAttentionHref("plan/1", "student 1", "2026-10-13"))
      .toBe("/areas/departure/manage?section=pickup&date=2026-10-13&student=student%201&plan=plan%2F1");
    expect(attendanceDeclineAttentionHref("student/1", "2026-10-13", "class 1"))
      .toBe("/areas/attendance/coordination?student_id=student%2F1&date=2026-10-13&class_section_id=class%201&focus=missing_followup");
  });

  it("projects only saved attendance with an authoritative schedule or assignment mismatch", () => {
    const base: AttendanceClassWorkspace = {
      class_section_id: "class-1", class_name: "Class 7A", grade: "7", section: "A", room_number: "204",
      term_id: "term-1", term_name: "Term 1", academic_year: "2026-27", starts_at: "09:00:00", ends_at: "09:45:00",
      periods_today: 1, student_count: 30, marked_count: 30, attending_count: 29, absent_count: 1,
      subjects: ["English"], assigned_teachers: ["Meera Kapoor"], assignment_kind: "regular",
      submission_status: "submitted", submitted_by_name: "Meera Kapoor", submitted_at: "2026-10-13T04:30:00.000Z",
      submission_authorized: true, instructional: true, date_open: true, can_mark: true, availability_reason: null,
    };
    const items = principalAttendanceExceptionItems("2026-10-13", [
      base,
      { ...base, class_section_id: "class-2", class_name: "Class 8A", submission_authorized: false },
      { ...base, class_section_id: "class-3", class_name: "Class 9A", instructional: false, submission_status: "in_progress" },
      { ...base, class_section_id: "class-4", class_name: "Class 10A", instructional: false, submission_status: "not_started", marked_count: 0 },
    ]);
    expect(items).toHaveLength(2);
    expect(items.map((entry) => [entry.source_id, entry.status_label, entry.href])).toEqual([
      ["class-2:term-1:2026-10-13", "Assignment mismatch", "/areas/attendance/registers?class_section_id=class-2&date=2026-10-13"],
      ["class-3:term-1:2026-10-13", "Schedule mismatch", "/areas/attendance/registers?class_section_id=class-3&date=2026-10-13"],
    ]);
  });

  it.each(["principal", "teacher"] as const)("opens %s scheduled attendance work in Registers with its exact saved session", async portal => {
    const compiler = new PostgresQueryCompiler();
    const executor = { transformQuery: (node: OperationNode) => node,
      compileQuery: (node: Parameters<PostgresQueryCompiler["compileQuery"]>[0], queryId: Parameters<PostgresQueryCompiler["compileQuery"]>[1]) => compiler.compileQuery(node, queryId),
      executeQuery: () => Promise.resolve({ rows: [
        { id: "register-1", entity_id: "session/1", title: "Algorithms", detail: "09:00–10:00 · unfinished", status_label: "Escalated register", urgent: true,
          subject_label: "Class 7A", priority: "urgent", due_at: "2026-10-13T05:00:00Z", occurs_at: "2026-10-13T03:30:00Z", created_at: null },
        { id: "slot-2", entity_id: null, title: "Networks", detail: "10:00–11:00 · not started", status_label: "Register overdue", urgent: false,
          subject_label: "Class 7A", priority: "high", due_at: "2026-10-13T06:00:00Z", occurs_at: "2026-10-13T04:30:00Z", created_at: null },
      ] }) };
    const service = new RequestsService({ getExecutor: () => executor } as unknown as DatabaseService);
    const probe = service as unknown as { subjectAttendanceCompletionItems(user: AuthUser, scope: unknown, portal: "teacher" | "principal", date: string): Promise<RequestInboxItem[]> };
    const work = await probe.subjectAttendanceCompletionItems({ id: "actor-1" } as AuthUser, { school_id: "campus-1" }, portal, "2026-10-13");
    expect(work).toEqual([
      expect.objectContaining({ kind: "attendance_session_register", action_label: portal === "principal" ? "Review register" : "Take attendance",
        href: "/areas/attendance/registers?date=2026-10-13&session_id=session%2F1", priority: "urgent" }),
      expect.objectContaining({ kind: "attendance_session_register", href: "/areas/attendance/registers?date=2026-10-13", priority: "high" }),
    ]);
  });

  it("keeps planned registers out of attention until the configured cutoff", () => {
    const register: AttendanceClassWorkspace = {
      class_section_id: "class-1", class_name: "Class 7A", grade: "7", section: "A", room_number: "204",
      term_id: "term-1", term_name: "Term 1", academic_year: "2026-27", starts_at: "09:00:00", ends_at: "09:45:00",
      periods_today: 1, student_count: 30, marked_count: 0, attending_count: 0, absent_count: 0,
      subjects: ["English"], assigned_teachers: ["Meera Kapoor"], assignment_kind: "regular",
      submission_status: "not_started", submitted_by_name: null, submitted_at: null,
      submission_authorized: true, instructional: true, date_open: true, can_mark: true, availability_reason: null,
    };

    expect(attendanceRegisterRequestItems("principal", "2026-10-13", [register], false)).toEqual([]);
    expect(attendanceRegisterRequestItems("principal", "2026-10-13", [register], true, false)).toEqual([]);
    expect(attendanceRegisterRequestItems("principal", "2026-10-13", [register], true, true)).toMatchObject([
      { source_id: "class-1", kind: "attendance_register", status_label: "Not started", priority: "normal" },
    ]);
    expect(attendanceRegisterRequestItems("principal", "2026-10-13", [{ ...register, submission_status: "submitted" }], true)).toEqual([]);
  });

  it("stacks urgent work first and orders equal priorities by deadline", () => {
    const items = sortRequestItems([
      item("normal", "normal", "2026-10-10T12:00:00Z", "governance"),
      item("later-urgent", "urgent", "2026-10-10T12:00:00Z", "transport"),
      item("first-urgent", "urgent", "2026-10-09T12:00:00Z", "attendance"),
      item("high", "high", "2026-10-08T12:00:00Z", "leave"),
    ]);
    expect(items.map((entry) => entry.id)).toEqual(["first-urgent", "later-urgent", "high", "normal"]);
  });

  it("returns compact priority and category counts", () => {
    expect(summarizeRequestItems([
      item("one", "urgent", "2026-10-09T12:00:00Z", "transport"),
      item("two", "high", "2026-10-10T12:00:00Z", "transport"),
      item("three", "normal", "2026-10-11T12:00:00Z", "governance"),
    ])).toEqual({ total: 3, urgent: 1, high: 1, normal: 1, categories: { transport: 2, governance: 1 } });
  });
});
