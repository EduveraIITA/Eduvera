import "reflect-metadata";
import { PostgresQueryCompiler, sql, type CompiledQuery, type OperationNode } from "kysely";
import { describe, expect, it, vi } from "vitest";
import { AnalyticsService } from "../src/analytics/analytics.service.js";
import { assignedAnalyticsAssessmentPermission, assignedAnalyticsClassPermission, type AssignedAnalyticsScope } from "../src/analytics/assigned-analytics-access.js";
import type { AuthUser } from "../src/common/request.js";
import type { DatabaseService } from "../src/database/database.service.js";
import { ExecutionDataPlaneScope } from "../src/database/execution-data-plane.js";
import { createSimulationExecutionEnvironment } from "../src/campus-model-core/execution-environment.runtime.js";
import { executionNow } from "../src/campus-model-core/execution-time.runtime.js";

const school = "10000000-0000-4000-8000-000000000001", actorId = "10000000-0000-4000-8000-000000000002", classA = "10000000-0000-4000-8000-000000000003", classB = "10000000-0000-4000-8000-000000000004", term = "10000000-0000-4000-8000-000000000005";
const actor = { id: actorId, active_school_id: school, role: "admin", is_active: true } as AuthUser;
type Probe = { attendance(scope: unknown, monthly: boolean, classes: unknown[]): Promise<null>; assessments(scope: unknown): Promise<null> };

/** The real Kysely compiler is used; the executor has no PostgreSQL driver.
 * Its membership fixture applies the compiled role predicate, so the original
 * staff-only query reproduces the director's refusal instead of passing a mock. */
function fixture(options: { roles?: string[]; permissions?: string[]; classes?: string[]; active?: boolean } = {}) {
  const compiler = new PostgresQueryCompiler(), world = new ExecutionDataPlaneScope();
  const observed: Array<{ query: CompiledQuery; namespace: string | null; instant: string }> = [];
  const roles = options.roles ?? ["admin"], permissions = options.permissions ?? ["attendance.view"];
  const executor = {
    transformQuery: (node: OperationNode) => node,
    compileQuery: (node: Parameters<PostgresQueryCompiler["compileQuery"]>[0], queryId: Parameters<PostgresQueryCompiler["compileQuery"]>[1]) => compiler.compileQuery(node, queryId),
    executeQuery: async (query: CompiledQuery) => {
      observed.push({ query, namespace: world.current()?.namespace_id ?? null, instant: executionNow().toISOString() });
      if (query.sql.includes("FROM school_memberships member JOIN schools school")) {
        const roleParameter = /member\.role=\$(\d+)/.exec(query.sql);
        const allowed = roleParameter ? [String(query.parameters[Number(roleParameter[1]) - 1])] : query.sql.includes("member.role IN ('admin','staff')") ? ["staff", "admin"] : [];
        const role = ["staff", "admin", "guardian", "student", "member"].find(value => roles.includes(value) && allowed.includes(value));
        return { rows: role && options.active !== false ? [{ timezone: "Asia/Kolkata", today: world.current() ? executionNow().toISOString().slice(0, 10) : "2026-10-29", membership_role: role }] : [] };
      }
      if (query.sql.includes("SELECT membership.role")) return { rows: options.active !== false && roles.length ? [{ role: roles.includes("admin") ? "admin" : roles[0] }] : [] };
      if (query.sql.includes("SELECT id,name,starts_on,ends_on,attendance_threshold FROM academic_terms")) return { rows: [{ id: term, name: "Current term", starts_on: "2026-07-01", ends_on: "2026-12-31", attendance_threshold: 75 }] };
      if (query.sql.includes("SELECT DISTINCT capability.permission")) return { rows: permissions.map(permission => ({ permission })) };
      if (query.sql.includes("WITH campus AS")) return { rows: permissions.map(permission => ({ permission, source_type: "assignment", source_id: "assignment", source_name: "Assigned duty", scope_label: "Exact class", starts_on: "2026-07-01", ends_on: null })) };
      if (query.sql.includes("SELECT c.id,'Class '||c.grade||c.section AS name")) return { rows: (options.classes ?? (permissions.length ? [classA] : [])).map(id => ({ id, name: id === classA ? "Class A" : "Class B" })) };
      throw new Error(`Unexpected query in the read-only analytics fixture: ${query.sql.slice(0, 70)}`);
    },
  };
  const db = { getExecutor: () => executor } as unknown as DatabaseService;
  const schoolService = { studentForUser: vi.fn(() => { throw new Error("Family data must not be consulted in assigned-work reads."); }) };
  const service = new AnalyticsService(db, schoolService as never), probe = service as unknown as Probe;
  const attendance = vi.spyOn(probe, "attendance").mockResolvedValue(null), assessments = vi.spyOn(probe, "assessments").mockResolvedValue(null);
  return { service, db, observed, world, attendance, assessments, schoolService };
}

describe("neutral assigned-work Insights eligibility", () => {
  it("accepts an administrator-only director without converting My work to institution analytics", async () => {
    const f = fixture();
    const result = await f.service.overview({ ...actor, role: "member" }, school, "teacher", { period: "30" });
    expect(result).toMatchObject({ portal: "teacher", scope_label: "Your assigned work", student: null, selected_student: null, institution: null, registers: null });
    expect(result.classes).toEqual([{ id: classA, name: "Class A" }]);
    expect(f.attendance).toHaveBeenCalledWith(expect.objectContaining({ admin: false, family: false, assignedAdministrator: true, school, user: actorId }), false, result.classes);
    expect(f.assessments).not.toHaveBeenCalled(); expect(f.schoolService.studentForUser).not.toHaveBeenCalled();
    expect(f.observed.some(item => item.query.sql.includes("SELECT membership.role"))).toBe(false);
    expect(f.observed.some(item => item.query.sql.includes("capability.permission IN ('attendance.view','assessments.view')"))).toBe(true);
  });

  it("does not manufacture analytical sections from an administrator title or blanket permissions", async () => {
    const f = fixture({ permissions: [] });
    expect(await f.service.overview(actor, school, "teacher", {})).toMatchObject({ classes: [], attendance: null, assessments: null, institution: null, registers: null });
    expect(f.attendance).not.toHaveBeenCalled(); expect(f.assessments).not.toHaveBeenCalled();
  });

  it("retains staff and dual-membership resource checks rather than using admin bypasses", async () => {
    for (const roles of [["staff"], ["admin", "staff"]]) {
      const f = fixture({ roles });
      await f.service.overview(actor, school, "teacher", {});
      expect(f.attendance).toHaveBeenCalledWith(expect.objectContaining({ assignedAdministrator: false, admin: false }), true, expect.any(Array));
      const classes = f.observed.find(item => item.query.sql.includes("SELECT c.id,"))!.query.sql;
      expect(classes).toContain("staff_has_class_permission("); expect(classes).toContain("staff_has_resource_permission(");
    }
  });

  it("rejects another class and forbids individual student filters in assigned-work context", async () => {
    const f = fixture();
    await expect(f.service.overview(actor, school, "teacher", { class_id: classB })).rejects.toThrow(/class is not available/);
    await expect(f.service.overview(actor, school, "teacher", { student_id: classB })).rejects.toThrow(/filter is not available/);
    await expect(f.service.overview(actor, school, "teacher", {}, { id: classB, name: "Other learner" })).rejects.toThrow(/Principal access/);
  });

  it("keeps inactive accounts, family memberships and other campuses outside staff eligibility", async () => {
    for (const roles of [["guardian"], ["student"], ["member"], []]) {
      const f = fixture({ roles }); await expect(f.service.overview(actor, school, "teacher", {})).rejects.toThrow(/Active access/); expect(f.attendance).not.toHaveBeenCalled();
    }
    const inactive = fixture({ active: false }); await expect(inactive.service.overview(actor, school, "teacher", {})).rejects.toThrow(/Active access/);
    const otherCampus = fixture(); await expect(otherCampus.service.overview({ ...actor, active_school_id: classB }, school, "teacher", {})).rejects.toThrow(/Select this institution/); expect(otherCampus.observed).toEqual([]);
  });

  it("does not let assigned administrator eligibility substitute for guardian/student membership", async () => {
    for (const audience of ["parent", "student"]) { const f = fixture(); await expect(f.service.overview(actor, school, audience, {})).rejects.toThrow(/Active access/); expect(f.schoolService.studentForUser).not.toHaveBeenCalled(); }
    const f = fixture({ roles: ["staff"] }); await expect(f.service.overview(actor, school, "principal", {})).rejects.toThrow(/Active access/);
  });

  it("uses each selected world's same read adapter and virtual clock without a Live fallback", async () => {
    const f = fixture();
    const environment = (suffix: string, at: string) => createSimulationExecutionEnvironment({ institution_id: school,
      scenario_id: `20000000-0000-4000-8000-00000000000${suffix}`, run_id: `30000000-0000-4000-8000-00000000000${suffix}`,
      source_snapshot_ref: "sha256:source", coverage_gate: { status: "passed", manifest_ref: "test:analytics", checked_at: at },
      virtual_clock: { now: () => new Date(at), nowIso: () => at, advanceBy: () => { throw new Error("Read only"); }, advanceTo: () => { throw new Error("Read only"); } }, expires_at: "2099-01-01T00:00:00Z" });
    const a = environment("1", "2026-10-29T10:00:00Z"), b = environment("2", "2026-11-01T10:00:00Z");
    const responses = await Promise.all([f.world.run(a, () => f.service.overview(actor, school, "teacher", {})), f.world.run(b, () => f.service.overview(actor, school, "teacher", {}))]);
    expect(responses.map(value => value.range.to)).toEqual(["2026-10-29", "2026-11-01"]);
    expect(responses.map(value => value.generated_at)).toEqual([new Date(a.virtual_clock.nowIso()).toISOString(), new Date(b.virtual_clock.nowIso()).toISOString()]);
    for (const observed of f.observed) expect(observed.instant).toBe(new Date(observed.namespace === a.namespace_id ? a.virtual_clock.nowIso() : b.virtual_clock.nowIso()).toISOString());
    expect(new Set(f.observed.map(value => value.namespace))).toEqual(new Set([a.namespace_id, b.namespace_id]));
  });
});

describe("assigned administrator resource authorization SQL", () => {
  const scope: AssignedAnalyticsScope = { school, user: actorId, today: "2026-10-29", assignedAdministrator: true };
  it("keeps the action on the same dated class/institution binding and rechecks active membership/account", () => {
    const f = fixture(), compiled = sql`SELECT ${assignedAnalyticsClassPermission(scope, classA, "2026-09-15")}`.compile(f.db);
    expect(compiled.sql).toContain("binding.role_active AND binding.status='active'");
    expect(compiled.sql).toContain("=ANY(binding.permissions)"); expect(compiled.sql).toContain("binding.context_kind='class' AND binding.scope_id=");
    expect(compiled.sql).toContain("binding.context_kind='institution' AND binding.scope_id="); expect(compiled.sql).toContain("member.role='admin' AND member.is_active"); expect(compiled.sql).toContain("account.is_active");
    expect(compiled.sql.match(/BETWEEN binding.starts_on/g)).toHaveLength(2);
    expect(compiled.parameters).toContain("2026-10-29"); expect(compiled.parameters).toContain("2026-09-15"); expect(compiled.parameters).toContain(classA); expect(compiled.parameters).toContain(actorId); expect(compiled.parameters.filter(value => value === school).length).toBeGreaterThan(0);
    expect(compiled.parameters).not.toContain(classB); expect(compiled.sql).not.toContain("schedule_teacher_assigned");
  });
  it("does not borrow an assessment action from a different resource or a class relationship", () => {
    const f = fixture(), compiled = sql`SELECT ${assignedAnalyticsAssessmentPermission(scope, classA)}`.compile(f.db);
    expect(compiled.sql).toContain("binding.context_kind='assessment' AND binding.scope_id="); expect(compiled.parameters).toContain("assessments.view"); expect(compiled.parameters).toContain(classA);
    expect(compiled.sql).not.toContain("binding.context_kind='class'"); expect(compiled.sql).not.toContain("binding.context_kind='institution'"); expect(compiled.parameters).not.toContain(true);
  });
});
