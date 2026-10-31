import { describe, expect, it } from "vitest";
import { DEFAULT_STAFF_PERMISSIONS } from "../src/roles/permissions.js";
import { rolePermissions } from "../src/roles/scoped-role-policy.js";
import { progressiveCapabilitySchema } from "../src/institution-activation/progressive-setup.contracts.js";
import { RolesService } from "../src/roles/roles.service.js";
import { diningDestination, parseDiningContinuation, readDiningReadiness, vettedDiningResume } from "../src/institution-onboarding/dining-readiness.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import { simulationRequestEnvironment } from "../src/database/simulation-world.service.js";
import { retainOperatingDestination } from "../src/institution-onboarding/operating-resume.js";
import { diningWork, hasNativeWorkflowProjection } from "../src/workspace/workflow-work.projection.js";
import { workspaceAreaForCapability } from "../src/workspace/workspace-area.catalogue.js";
import type { DiningWorkRecord } from "../src/dining/dining.contracts.js";
import type { AuthUser } from "../src/common/request.js";
import { diningPlanHref } from "../src/dining/dining.contracts.js";

describe("Dining progressive entry and exact native work", () => {
  const id = "cd0e6b39-b8d3-4b32-ad73-2526487152d8";
  const user = { id, active_school_id: id, is_active: true } as AuthUser;
  it("retains only one exact dated menu, never provider or identity input", () => {
    expect(parseDiningContinuation(diningDestination(id))).toEqual({ session_id: id });
    expect(parseDiningContinuation(diningPlanHref(id))).toEqual({ plan_id: id });
    for (const path of [`https://example.test/areas/dining?session_id=${id}`, `//example.test/areas/dining?session_id=${id}`,
      `/areas/dining?session_id=${id}&session_id=${id}`, `/areas/dining?session_id=${id}&service_id=${id}`,
      `/areas/dining?session_id=${id}&run_id=${id}`, `/areas/dining?session_id=${id}#history`,
      "/areas/dining?session_id=arbitrary", `/areas/dining/other?session_id=${id}`,
      `/areas/dining?plan_id=${id}&session_id=${id}`, `/areas/dining?series_id=${id}&date=2026-10-25`,
      `/areas/dining?plan_id=${id}&plan_id=${id}`, `/areas/dining?plan_id=${id}&run_id=${id}`]) {
      expect(parseDiningContinuation(path), path).toBeNull();
    }
  });
  it("adds Dining without inventing default Staff or class-based setup authority", () => {
    expect(progressiveCapabilitySchema.parse("dining")).toBe("dining");
    expect(DEFAULT_STAFF_PERMISSIONS).not.toContain("dining.manage");
    expect(rolePermissions("institution", ["dining.manage"])).toEqual(["dining.manage"]);
    for (const scope of ["class", "event", "assessment", "trip"]) {
      expect(() => rolePermissions(scope, ["dining.manage"])).toThrow();
    }
    expect(workspaceAreaForCapability("dining.coordinate")).toMatchObject({ key: "dining", href: "/areas/dining" });
  });
  it("rejects an assigned-resource management exception before any database write", async () => {
    const roles = new RolesService({} as never);
    await expect(roles.addException({} as never, id, id, { permission: "dining.manage", scope_kind: "assigned_resources",
      reason: "Fictional dining duty", valid_from: "2026-10-24", valid_until: "2026-10-25" }))
      .rejects.toThrow("institution-scoped access exception");
  });
  it("never promotes missing canonical identity or somebody else's continuation to first operation", async () => {
    expect((await readDiningReadiness({} as never, undefined, user, id)).operation)
      .toMatchObject({ state: "unavailable", action: "unavailable", scope: null, source_revision: null, requires_recheck: true });
    expect(await vettedDiningResume({} as never, undefined, user, { school_id: id,
      owner_user_id: "another-owner", resume_path: diningDestination(id) }))
      .toEqual({ step: "first_use", path: "/areas/dining" });
  });
  it("uses the selected clock and does not advance Live onboarding from Simulation", async () => {
    const environment = simulationRequestEnvironment({ institution_id: id, scenario_id: id, run_id: id,
      virtual_now: "2026-10-24T10:00:00Z", source_snapshot_ref: "snapshot", manifest_ref: "test", checked_at: "2026-10-24T10:00:00Z" });
    await executionEnvironmentStorage.run(environment, async () => {
      expect((await readDiningReadiness({} as never, undefined, user, id)).operation)
        .toMatchObject({ environment_namespace_id: `scenario:${id}:run:${id}`,
          evaluated_at: "2026-10-24T10:00:00.000Z", state: "unavailable" });
      await expect(retainOperatingDestination({} as never, user, id, "dining", diningDestination(id),
        { onlyPending: true, source: "accepted_dining_publication" })).resolves.toBeUndefined();
    });
  });
  const work = { id, source_id: id, source_kind: "dining_issue", session_id: id, issue_id: id, revision: 3,
    title: "Service issue", state: "review_needed", href: `/areas/dining?session_id=${id}&issue_id=${id}`,
    created_at: "2026-10-24T10:00:00Z", due_at: null, message_id: "exact-message", owner: { user_id: id, label: "Named coordinator" },
    action: "resolve" } as DiningWorkRecord;
  it("projects exact issue identity, retained message and owner without an invented due time", () => {
    expect(diningWork(work, "needs_me")).toMatchObject({ direction: "needs_me", state: "action_required",
      source: { domain: "dining", kind: "dining_issue", id, action: "resolve", revision: 3 },
      core_trace: { message_ids: ["exact-message"] }, href: work.href, owner: work.owner, due_at: null });
    expect(diningWork(work, "waiting")).toMatchObject({ direction: "waiting", state: "waiting_for_review",
      status_label: "Waiting for Named coordinator", source: { action: "await_resolve" }, due_at: null });
  });
  it("keeps native source recovery visible without pretending a new recipient received the old message", () => {
    expect(diningWork({ ...work, action: "recover", state: "route_unavailable", message_id: null }, "needs_me"))
      .toMatchObject({ state: "route_unavailable", action_label: "Review routing", tone: "attention" });
    expect(diningWork({ ...work, message_id: null }, "needs_me")).not.toHaveProperty("core_trace");
  });
  it("suppresses only the registered native Dining protocol mirror", () => {
    expect(hasNativeWorkflowProjection({ source_domain: "dining", reaction_kind: "dining_issue_action" })).toBe(true);
    expect(hasNativeWorkflowProjection({ source_domain: "dining", reaction_kind: "dining_session_action" })).toBe(true);
    expect(hasNativeWorkflowProjection({ source_domain: "other", reaction_kind: "dining_issue_action" })).toBe(false);
    expect(hasNativeWorkflowProjection({ source_domain: "dining", reaction_kind: "future_unowned_protocol" })).toBe(false);
  });
});
