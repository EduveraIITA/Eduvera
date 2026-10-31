import "reflect-metadata";
import type { ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedRequest, AuthUser } from "../src/common/request.js";
import type { DatabaseService } from "../src/database/database.service.js";
import { ExecutionDataPlaneScope } from "../src/database/execution-data-plane.js";
import { RequestsService } from "../src/requests/requests.service.js";
import { PermissionGuard } from "../src/roles/permission.guard.js";
import type { RolesService } from "../src/roles/roles.service.js";
import type { WorkspaceRepositorySnapshot } from "../src/workspace/workspace.contracts.js";
import { WorkspaceService } from "../src/workspace/workspace.service.js";

const schoolId = "00000000-0000-4000-8000-000000000001";
const personId = "00000000-0000-4000-8000-000000000002";
const agentId = "00000000-0000-4000-8000-000000000003";
const user: AuthUser = {
  id: "00000000-0000-4000-8000-000000000004", username: "campus-member", email: "member@example.test",
  first_name: "Campus", last_name: "Member", role: "member", is_active: true, active_school_id: schoolId,
};
const at = new Date("2026-10-20T06:30:00.000Z");
const snapshot: WorkspaceRepositorySnapshot = {
  institution: { id: schoolId, name: "Purpose-neutral campus", timezone: "Asia/Kolkata" },
  membership_roles: ["member"], realm_id: schoolId, environment_namespace_id: `live:${schoolId}`,
  acting_agent_id: agentId, owner_agent_ids: [agentId], assignments: [], messages: [], relationships: [],
};

async function manifest(source = snapshot, actor = user) {
  const workspace = new WorkspaceService({ load: vi.fn().mockResolvedValue(source) } as never, {
    now: () => at,
    read: () => ({ instant: at, iso_instant: at.toISOString(), local_date: "2026-10-20", local_time: "12:00:00",
      institution_id: schoolId, time_zone: "Asia/Kolkata", environment_kind: "live", namespace_id: `live:${schoolId}` }),
  } as never);
  return workspace.manifest(actor, null, { mode: "live", institution_id: schoolId, namespace_id: `live:${schoolId}` });
}

describe("neutral campus app membership", () => {
  it("opens the stable personal shell without inventing setup, staff or learner relationships", async () => {
    const result = await manifest();
    expect(result.areas).toEqual([expect.objectContaining({ key: 'calendar', capabilities: ['campus_dates.published'], scopes: [],
      surfaces: [expect.objectContaining({ key: 'assigned', scopes: [], capabilities: ['campus_dates.published'] })] })]);
    expect(result.work).toEqual({ total: 0, counts: { needs_me: 0, waiting: 0 }, coverage: "complete", items: [] });
    expect(result.today.now).toEqual([]);
    expect(result.today.next).toEqual([]);
    expect(result.more.setup).toEqual([]);
    expect(result.more.groups.find(group => group.key === "account")?.items.map(item => item.href))
      .toEqual(["/more/account", "/more/account/security"]);
    expect(result.more.groups.some(group => group.key === "oversight" || group.key === "setup")).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/staff tools|teacher|principal|student_id|guardian/i);
  });

  it("can project a separately established own-participation relationship, not planning authority", async () => {
    const result = await manifest({ ...snapshot, assignments: [{
      id: `activity:participation:${personId}`, owner_agent_id: agentId,
      capability_key: "timetable.view", action_key: "timetable.view",
      scope: { kind: "self", id: personId, label: "My scheduled activities" },
      effective_from: at.toISOString(), effective_until: null, effective_schedule: null,
      authority_source_kind: "participation_expectation", authority_source_ref: personId,
      fallback_agent_id: null, source_domain: "timetable", source_record_id: personId,
      source_revision: 1, revision: 1, projection_source: "canonical",
    }] });
    expect(result.areas).toEqual([
      expect.objectContaining({ key: "timetable", capabilities: ["timetable.view"] }),
      expect.objectContaining({ key: "calendar", href: "/areas/calendar", capabilities: ["timetable.view"], surfaces: [expect.objectContaining({ key: "assigned", capabilities: ["timetable.view"] })] }),
    ]);
    expect(result.areas[0]?.surfaces.map(item => item.key)).not.toContain("planning");
    expect(result.more.setup).toEqual([]);
    expect(result.areas.some(item => item.key === "attendance")).toBe(false);
  });

  it("does not inherit a different institution's administrator account category", async () => {
    const result = await manifest(snapshot, { ...user, role: "admin" });
    expect(result.areas).toEqual([expect.objectContaining({ key: 'calendar', capabilities: ['campus_dates.published'], scopes: [] })]);
    expect(result.areas[0]?.capabilities).not.toContain('calendar.manage');
    expect(result.more.setup).toEqual([]);
    expect(result.more.groups.some(group => group.key === "oversight")).toBe(false);
  });

  it("does not read staff, student, guardian or institution work queues merely for app membership", async () => {
    const executeQuery = vi.fn(() => { throw new Error("Neutral membership must not enter a persona query."); });
    const requests = new RequestsService({ executeQuery } as unknown as DatabaseService);
    expect(await requests.workspaceItems(user, {
      school_id: schoolId, school_name: snapshot.institution.name, timezone: snapshot.institution.timezone,
      environment_namespace_id: snapshot.environment_namespace_id, recorded_at: at.toISOString(),
      membership_roles: ["member"], relationships: [], assignments: [],
    })).toEqual([]);
    expect(executeQuery).not.toHaveBeenCalled();
  });

  it.each(["sis.manage", "members.invite", "attendance.record"])("denies the controller permission %s without a separately established grant", async permission => {
    const effective = vi.fn().mockResolvedValue({ role: "member", permissions: [] });
    const guard = new PermissionGuard({ getAllAndOverride: () => permission } as unknown as Reflector,
      {} as DatabaseService, { effective } as unknown as RolesService, new ExecutionDataPlaneScope());
    const request = { authUser: user, params: {}, query: {}, body: {} } as AuthenticatedRequest;
    class AdministrativeController {}
    const context = { getHandler: () => () => undefined, getClass: () => AdministrativeController,
      switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
    await expect(guard.canActivate(context)).rejects.toThrow(`does not allow this action (${permission})`);
    expect(effective).toHaveBeenCalledWith(user, schoolId);
  });
});
