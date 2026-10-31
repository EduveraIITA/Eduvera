import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Transaction } from "kysely";
import type { Database } from "../src/database/types.js";
import type { AuthUser } from "../src/common/request.js";
import type { ExecutionEnvironment } from "../src/campus-model-core/execution-environment.contracts.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import { retainAssignmentsContinuation, retainOperatingDestination } from "../src/institution-onboarding/operating-resume.js";

const { execute, statements } = vi.hoisted(() => ({
  execute: vi.fn(), statements: [] as Array<{ text: string; values: unknown[] }>,
}));
vi.mock("kysely", () => ({ sql: (parts: TemplateStringsArray, ...values: unknown[]) => {
  statements.push({ text: parts.join("?"), values }); return { execute };
} }));
const db = {} as Transaction<Database>;
const user = { id: "owner" } as AuthUser;
const assignment = { id: "11111111-1111-4111-8111-111111111111", author_id: user.id,
  context_kind: "learning_offering" as const, offering_id: "22222222-2222-4222-8222-222222222222",
  class_section_id: null, term_id: null, state: "draft", revision: 2 };
beforeEach(() => { execute.mockReset(); statements.length = 0; });

describe("accepted-operation onboarding continuation", () => {
  it("never queries Live preferences for a simulated, foreign-author or non-operating Assignment source", async () => {
    await executionEnvironmentStorage.run({ kind: "simulation" } as ExecutionEnvironment,
      () => retainAssignmentsContinuation(db, user, "campus", assignment));
    await retainAssignmentsContinuation(db, user, "campus", { ...assignment, author_id: "another-author" });
    await retainAssignmentsContinuation(db, user, "campus", { ...assignment, state: "withdrawn" });
    await retainAssignmentsContinuation(db, user, "campus", { ...assignment, revision: 0 });
    expect(execute).not.toHaveBeenCalled(); expect(statements).toHaveLength(0);
  });
  it.each(["draft", "published"])("retains the accepted %s Assignment only for its current owner and pending primary", async state => {
    execute.mockResolvedValueOnce({ rows: [{ id: "workspace", revision: 9 }] }).mockResolvedValueOnce({ rows: [] });
    await retainAssignmentsContinuation(db, user, "campus", { ...assignment, state });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(statements[0]?.text).toContain("workspace.school_id=");
    expect(statements[0]?.text).toContain("workspace.owner_user_id=");
    expect(statements[0]?.text).toContain("workspace.resume_goal_key='assignments' AND workspace.resume_step='first_use'");
    expect(statements[0]?.text).toContain("selected.goal_key='assignments'");
    expect(statements[0]?.text).toContain("membership.role='admin' AND membership.is_active");
    const audit = statements[1]?.values.find(value => typeof value === "string" && value.startsWith("{"));
    expect(JSON.parse(audit as string)).toMatchObject({ step: state === "draft" ? "first_use" : "operating", goal: "assignments",
      assignment_id: assignment.id, source_revision: 2, environment_namespace_id: "live:campus",
      source: state === "draft" ? "accepted_assignment_draft" : "accepted_assignment_publication" });
  });
  it("does not append an Assignment audit when another primary or owner prevents the transition", async () => {
    execute.mockResolvedValueOnce({ rows: [] });
    await retainAssignmentsContinuation(db, user, "campus", assignment);
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it("never queries or mutates Live onboarding during a selected simulation", async () => {
    await executionEnvironmentStorage.run({ kind: "simulation" } as ExecutionEnvironment,
      () => retainOperatingDestination(db, user, "campus", "attendance", "/areas/attendance/registers", { onlyPending: true }));
    expect(execute).not.toHaveBeenCalled(); expect(statements).toHaveLength(0);
  });
  it("conditions the transition on current campus, owner, selected goal and active admin membership", async () => {
    execute.mockResolvedValueOnce({ rows: [] });
    await retainOperatingDestination(db, user, "campus", "attendance", "/areas/attendance/registers", { onlyPending: true });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(statements[0]?.text).toContain("workspace.school_id=");
    expect(statements[0]?.text).toContain("workspace.owner_user_id=");
    expect(statements[0]?.text).toContain("selection.goal_key=");
    expect(statements[0]?.text).toContain("workspace.resume_step='first_use'");
    expect(statements[0]?.text).toContain("workspace.resume_goal_key=");
    expect(statements[0]?.text).toContain("membership.role='admin' AND membership.is_active");
    expect(statements[0]?.values).toContain(false);
  });
  it("retains one matching accepted-publication audit and no query-controlled redirect", async () => {
    execute.mockResolvedValueOnce({ rows: [{ id: "workspace", revision: 7 }] }).mockResolvedValueOnce({ rows: [] });
    await retainOperatingDestination(db, user, "campus", "attendance", "/areas/attendance/registers", {
      onlyPending: true, source: "accepted_activity_publication",
    });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(statements[1]?.values).toContain(JSON.stringify({ step: "operating", goal: "attendance",
      path: "/areas/attendance/registers", source: "accepted_activity_publication" }));
  });
  it("preserves the existing accepted capability-setup caller semantics", async () => {
    execute.mockResolvedValueOnce({ rows: [{ id: "workspace", revision: 8 }] }).mockResolvedValueOnce({ rows: [] });
    await retainOperatingDestination(db, user, "campus", "gate", "/areas/in-out/operate");
    expect(statements[0]?.values).toContain(true);
    expect(statements[1]?.values).toContain(JSON.stringify({ step: "operating", goal: "gate",
      path: "/areas/in-out/operate", source: "accepted_capability_setup" }));
  });
});
