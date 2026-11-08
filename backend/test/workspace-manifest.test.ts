import "reflect-metadata";
import { describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../src/common/request.js";
import { simulationSessionExecutionEnvironment } from "../src/auth/session-execution-environment.js";
import { effectiveScheduleSchema, type WorkspaceRecord, type WorkspaceRepositorySnapshot } from "../src/workspace/workspace.contracts.js";
import { workHref, WorkspaceService } from "../src/workspace/workspace.service.js";
import { upcomingWorkspaceRecords } from "../src/workspace/upcoming-workspace.projection.js";

const ids = {
  school: "00000000-0000-4000-8000-000000000001",
  user: "00000000-0000-4000-8000-000000000002",
  agent: "00000000-0000-4000-8000-000000000003",
  team: "00000000-0000-4000-8000-000000000004",
  scope: "00000000-0000-4000-8000-000000000005",
  student: "00000000-0000-4000-8000-000000000006",
  responsibility: "00000000-0000-4000-8000-000000000007",
  message: "00000000-0000-4000-8000-000000000008",
};

const user: AuthUser = {
  id: ids.user,
  username: "operator",
  email: "operator@example.test",
  first_name: "Campus",
  last_name: "Operator",
  role: "admin",
  is_active: true,
  active_school_id: ids.school,
};

const base: WorkspaceRepositorySnapshot = {
  institution: { id: ids.school, name: "Cambridge International School", code: "cis", timezone: "Asia/Kolkata" },
  membership_roles: ["admin"],
  realm_id: "00000000-0000-4000-8000-000000000009",
  environment_namespace_id: `live:${ids.school}`,
  acting_agent_id: ids.agent,
  owner_agent_ids: [ids.agent],
  assignments: [],
  messages: [],
  relationships: [],
};

const instant = new Date("2026-10-19T04:00:00.000Z"); // Monday 09:30 IST

function service(snapshot: WorkspaceRepositorySnapshot, dependencies?: {
  requests?: { workspaceItems: ReturnType<typeof vi.fn> };
  temporal?: { listOperatingDay: ReturnType<typeof vi.fn> };
  activities?: { load: ReturnType<typeof vi.fn> };
  learning?: { projectWork: ReturnType<typeof vi.fn>; readiness: ReturnType<typeof vi.fn> };
  finance?: { work: ReturnType<typeof vi.fn> };
  authority?: { workspace: ReturnType<typeof vi.fn> };
  facilities?: { work: ReturnType<typeof vi.fn>; discovery: ReturnType<typeof vi.fn> };
  accommodation?: { work: ReturnType<typeof vi.fn>; discovery: ReturnType<typeof vi.fn> };
  dining?: { work: ReturnType<typeof vi.fn>; discovery: ReturnType<typeof vi.fn>; ownedAvailability?: ReturnType<typeof vi.fn> };
  care?: { discovery: ReturnType<typeof vi.fn> };
  visits?: { work: ReturnType<typeof vi.fn>; discovery: ReturnType<typeof vi.fn> };
  assessments?: { discovery: ReturnType<typeof vi.fn> };
}) {
  const repository = { load: vi.fn().mockResolvedValue(snapshot) };
  const clock = {
    now: vi.fn().mockReturnValue(instant),
    read: vi.fn().mockReturnValue({
      environment_kind: "live",
      namespace_id: `live:${ids.school}`,
      institution_id: ids.school,
      instant,
      iso_instant: instant.toISOString(),
      time_zone: "Asia/Kolkata",
      local_date: "2026-10-19",
      local_time: "09:30:00",
    }),
  };
  return {
    instance: new WorkspaceService(
      repository as never,
      clock as never,
      dependencies?.requests as never,
      dependencies?.temporal as never,
      dependencies?.activities as never,
      undefined,
      dependencies?.learning as never,
      dependencies?.finance as never,
      dependencies?.authority as never,
      undefined,
      undefined,
      dependencies?.facilities as never,
      dependencies?.accommodation as never,
      (dependencies?.dining ? { ...dependencies.dining, ownedAvailability: dependencies.dining.ownedAvailability ?? vi.fn().mockResolvedValue({ items: [], warnings: [] }) } : undefined) as never,
      dependencies?.visits as never,
      dependencies?.care as never,
      undefined,
      dependencies?.assessments as never,
    ),
    repository,
    clock,
  };
}

describe("responsibility-composed workspace manifest", () => {
  it('discovers only registered visitor plans without granting management or organiser private-thread access', async () => {
    const visits = { work: vi.fn().mockResolvedValue({ needs_me: [], waiting: [] }), discovery: vi.fn().mockResolvedValue({ can_manage: false, has_shared: false, has_questions: false, has_registered: true }) };
    const current = service({ ...base, membership_roles: ['member'], access_scope: 'assigned_work', assignments: [] }, { visits });
    const account = { ...user, role: 'member' as const }, environment = { mode: 'live' as const, namespace_id: `live:${ids.school}` as const, institution_id: ids.school };
    const manifest = await current.instance.manifest(account, null, environment), area = manifest.areas.find(item => item.key === 'in-out')!;
    expect(area.capabilities).toEqual(['gate.visits.registered']);
    expect(area.surfaces).toEqual([expect.objectContaining({ key: 'registered-visits', href: '/areas/in-out/visits?participant=1', capabilities: ['gate.visits.registered'] })]);
    expect(area.surfaces.some(item => /manage|operate|shared=1/.test(item.href))).toBe(false);
    visits.discovery.mockResolvedValue({ can_manage: false, has_shared: false, has_questions: false, has_registered: false });
    expect((await current.instance.manifest(account, null, environment)).areas.some(item => item.key === 'in-out')).toBe(false);
  });
  it("discovers native protected intake, assigned receipts and team setup without a fabricated responsibility or private case projection", async () => {
    const care = { discovery: vi.fn().mockResolvedValue({ can_report: true, can_manage_team: false, has_assignments: false }) };
    const current = service({ ...base, membership_roles: ["staff"], assignments: [] }, { care });
    const view = { mode: "live" as const, namespace_id: `live:${ids.school}` as const, institution_id: ids.school };
    const reportOnly = await current.instance.manifest(user, null, view);
    expect(reportOnly.areas.find(area => area.key === "care")?.surfaces).toEqual([
      expect.objectContaining({ key: "concerns", href: "/areas/care/concerns", capabilities: ["restricted_care.intake"] }),
    ]);
    care.discovery.mockResolvedValue({ can_report: true, can_manage_team: true, has_assignments: true });
    const assigned = await current.instance.manifest(user, null, view), area = assigned.areas.find(item => item.key === "care")!;
    expect(area.capabilities).toEqual(["restricted_care.assigned.view", "restricted_care.intake", "restricted_care.team.manage"]);
    expect(area.capabilities).not.toContain("safeguarding.review");
    expect(current.repository.load).toHaveBeenCalled(); expect(care.discovery).toHaveBeenCalledWith(user, ids.school);
    care.discovery.mockResolvedValue({ can_report: false, can_manage_team: false, has_assignments: false });
    expect((await current.instance.manifest(user, null, view)).areas.some(item => item.key === "care")).toBe(false);
  });
  it.each([false, true])("merges nearer Dining before five later duties and retains an unresolved warning (%s)", async (unresolved) => {
    const next = Array.from({ length: 5 }, (_, index) => ({
      id: `duty-${index}`, title: "Residence coordination", starts_at: `2026-10-${20 + index}T08:30:00Z`,
      ends_at: `2026-10-${20 + index}T10:30:00Z`, local_date: `2026-10-${20 + index}`,
      time_label: `Exact source date ${index}`, href: `/areas/timetable/schedule?date=2026-10-${20 + index}`,
    }));
    const activities = { load: vi.fn().mockResolvedValue({ assignments: [], now: [], next, work: [] }) };
    const href = "/areas/dining?series_id=series-1&date=2026-10-19";
    const dining = { ownedAvailability: vi.fn().mockResolvedValue({ items: [{
      id: "meal-1", service_id: "service-1", service_name: "Courtyard kitchen", label: "Lunch",
      source_kind: "plan_date", source_id: "version-1", source_revision: 2, session_id: null, plan_id: "series-1",
      local_date: "2026-10-19", starts_at: "2026-10-19T06:30:00Z", ends_at: "2026-10-19T08:30:00Z",
      timezone: "Asia/Kolkata", state: "planned", changed_for_date: false, updated_at: "2026-10-18T10:00:00Z", href,
    }], warnings: unresolved ? [{ plan_id: "series-1", plan_version_id: "version-1", local_date: "2026-10-19",
      weekday: 1, reason: "ambiguous_time", href }] : [] }),
    discovery: vi.fn().mockResolvedValue({ can_manage: false, has_services: true, has_published_sessions: true }),
    work: vi.fn().mockResolvedValue({ needs_me: [], waiting: [] }) };
    const result = await service(base, { activities, dining }).instance.manifest(user, null,
      { mode: "live", institution_id: ids.school, namespace_id: `live:${ids.school}` });
    expect(result.today.next.map(item => item.id)).toEqual(unresolved
      ? ["dining-time-warning:version-1:2026-10-19", "dining-availability:meal-1", "duty-0", "duty-1", "duty-2"]
      : ["dining-availability:meal-1", "duty-0", "duty-1", "duty-2", "duty-3"]);
    expect(result.today.now).toEqual([]);
    expect(result.today.attention.total).toBe(0);
    expect(result.today.next.find(item => item.id === "dining-availability:meal-1")).toMatchObject({
      starts_at: "2026-10-19T06:30:00Z", ends_at: "2026-10-19T08:30:00Z", local_date: "2026-10-19", href,
    });
    if (unresolved) expect(result.today.next[0]).not.toHaveProperty("starts_at");
  });

  it("projects complete exact-owned Dining availability through the selected clock without a duty or audience grant", async () => {
    const availability = [{ id: "meal-1", service_id: "service-1", service_name: "Community kitchen",
      source_kind: "plan_date", source_id: "version-1", source_revision: 2, session_id: null, plan_id: "series-1", local_date: "2026-10-19",
      label: "Breakfast", menu_text: "Fictional breakfast", starts_at: "2026-10-19T03:00:00Z", ends_at: "2026-10-19T05:00:00Z",
      timezone: "Asia/Kolkata", space_id: null, space_label: null, state: "planned", changed_for_date: false,
      updated_at: "2026-10-18T10:00:00Z", href: "/areas/dining?series_id=series-1&date=2026-10-19", availability_only: true, venue_reserved: false }];
    const ownedAvailability = vi.fn().mockResolvedValue({ items: availability, warnings: [] });
    const dining = { ownedAvailability, discovery: vi.fn().mockResolvedValue({ can_manage: false, has_services: true, has_published_sessions: true }),
      work: vi.fn().mockResolvedValue({ needs_me: [], waiting: [] }) };
    const current = service({ ...base, membership_roles: ["member"] }, { dining });
    const view = { mode: "live", institution_id: ids.school, namespace_id: `live:${ids.school}` } as const;
    const first = await current.instance.manifest(user, null, view);
    expect(ownedAvailability).toHaveBeenCalledWith(user, ids.school, { from: "2026-10-19", until: "2026-10-19" });
    expect(first.today.now).toEqual([expect.objectContaining({ title: "Breakfast", status_label: "Planned hours",
      href: "/areas/dining?series_id=series-1&date=2026-10-19" })]);
    expect(first.today.attention.total).toBe(0);
    expect(first.areas.some(area => area.key === "timetable" || area.key === "attendance")).toBe(false);
    ownedAvailability.mockResolvedValue({ items: [{ ...availability[0], source_revision: 3, state: "cancelled" }], warnings: [] });
    const second = await current.instance.manifest(user, null, view);
    expect(second.today.now).toEqual([]);
    expect(second.revision).not.toBe(first.revision);
  });

  it("does not conceal a Dining availability store failure as a current empty Today", async () => {
    const dining = { ownedAvailability: vi.fn().mockRejectedValue(new Error("Selected store unavailable")),
      discovery: vi.fn().mockResolvedValue({ can_manage: false, has_services: false, has_published_sessions: false }),
      work: vi.fn().mockResolvedValue({ needs_me: [], waiting: [] }) };
    const current = service({ ...base, membership_roles: ["member"] }, { dining });
    await expect(current.instance.manifest(user, null, { mode: "live", institution_id: ids.school, namespace_id: `live:${ids.school}` }))
      .rejects.toThrow("Selected store unavailable");
  });

  it("discovers exact Dining work without turning source-backed Waiting into attention or setup authority", async () => {
    const dining = { discovery: vi.fn().mockResolvedValue({ can_manage: false, has_services: true, has_published_sessions: true }),
      work: vi.fn().mockResolvedValue({ needs_me: [], waiting: [{ id: "issue-1", source_id: "issue-1", source_kind: "dining_issue",
        session_id: "session-1", issue_id: "issue-1", revision: 4, title: "Service issue", state: "waiting_for_review", action: "resolve",
        href: "/areas/dining?session_id=session-1&issue_id=issue-1", created_at: instant.toISOString(), due_at: null,
        message_id: "exact-dining-message", owner: { user_id: "coordinator", label: "Named coordinator" } }] }) };
    const current = service({ ...base, membership_roles: ["member"] }, { dining });
    const view = { mode: "live", institution_id: ids.school, namespace_id: `live:${ids.school}` } as const;
    const result = await current.instance.manifest(user, null, view);
    expect(result.areas.find(area => area.key === "dining")?.surfaces).toEqual([
      expect.objectContaining({ href: "/areas/dining", capabilities: ["dining.view"] }),
    ]);
    expect(result.areas.find(area => area.key === "calendar")).toMatchObject({
      capabilities: ["dining.view"], surfaces: [expect.objectContaining({ key: "availability", href: "/areas/calendar?surface=availability" })],
    });
    expect(result.areas.find(area => area.key === "timetable")).toBeUndefined();
    expect(result.work.counts).toEqual({ needs_me: 0, waiting: 1 });
    expect(result.today.attention.total).toBe(0);
    expect(result.work.items[0]).toMatchObject({ kind: "task", direction: "waiting", due_at: null,
      href: "/areas/dining?session_id=session-1&issue_id=issue-1",
      source: { domain: "dining", kind: "dining_issue", id: "issue-1", revision: 4, action: "await_resolve" },
      core_trace: { message_ids: ["exact-dining-message"] } });
    dining.discovery.mockResolvedValue({ can_manage: false, has_services: false, has_published_sessions: false });
    dining.work.mockResolvedValue({ needs_me: [], waiting: [] });
    const revoked = await current.instance.manifest(user, null, view);
    expect(revoked.areas.some(area => area.key === "dining")).toBe(false);
    expect(revoked.work.items).toEqual([]);
    expect(revoked.revision).not.toBe(result.revision);
  });
  it("discovers an exact resident stay without granting room setup or showing Waiting as attention", async () => {
    const current = service({ ...base, membership_roles: ["member"] }, { accommodation: {
      discovery: vi.fn().mockResolvedValue({ can_manage: false, can_offer: false, has_stays: true }),
      work: vi.fn().mockResolvedValue({ needs_me: [], waiting: [{ id: "stay-1", stay_id: "stay-1", revision: 2,
        title: "Accommodation", state: "waiting_for_review", action: "move", href: "/areas/accommodation?stay_id=stay-1",
        created_at: instant.toISOString(), due_at: null, message_id: "exact-stay-message", owner: { user_id: "coordinator", label: "Residence desk" } }] }),
    } });
    const result = await current.instance.manifest(user, null, { mode: "live", institution_id: ids.school, namespace_id: `live:${ids.school}` });
    expect(result.areas.find(area => area.key === "accommodation")?.surfaces).toEqual([
      expect.objectContaining({ href: "/areas/accommodation", capabilities: ["accommodation.view"] }),
    ]);
    expect(result.work.counts).toEqual({ needs_me: 0, waiting: 1 });
    expect(result.today.attention.total).toBe(0);
    expect(result.work.items[0]).toMatchObject({ href: "/areas/accommodation?stay_id=stay-1",
      source: { domain: "accommodation", id: "stay-1", action: "await_move" }, core_trace: { message_ids: ["exact-stay-message"] } });
  });
  it("discovers native repair access and never duplicates its stale protocol mirror", async () => {
    const current = service({ ...base, membership_roles: ["member"] }, { facilities: {
      discovery: vi.fn().mockResolvedValue({ can_manage: false, can_report: true, has_repairs: true }),
      work: vi.fn().mockResolvedValue({ needs_me: [], waiting: [{ id: "repair-1", repair_id: "repair-1", revision: 2,
        title: "Repair", state: "waiting_for_review", action: "accept", href: "/areas/facilities?repair_id=repair-1",
        created_at: instant.toISOString(), due_at: null, message_id: "exact-repair-message", owner: { user_id: "caretaker", label: "Caretaker" } }] }),
    } });
    const view = { mode: "live", institution_id: ids.school, namespace_id: `live:${ids.school}` } as const;
    const result = await current.instance.manifest(user, null, view);
    expect(result.areas.find(area => area.key === "facilities")?.surfaces).toEqual([
      expect.objectContaining({ href: "/areas/facilities", capabilities: ["facilities.view"] }),
    ]);
    expect(result.work.counts).toEqual({ needs_me: 0, waiting: 1 });
    expect(result.today.attention.total).toBe(0);
    expect(result.work.items[0]).toMatchObject({ href: "/areas/facilities?repair_id=repair-1", core_trace: { message_ids: ["exact-repair-message"] } });
  });
  it("discovers session teaching and public dates without granting planning or private learning work", async () => {
    const snapshot: WorkspaceRepositorySnapshot = { ...base, membership_roles: ["staff"], assignments: [{
      id: ids.responsibility, owner_agent_id: ids.agent, capability_key: "learning.sessions.manage", action_key: "learning.sessions.manage",
      scope: { kind: "class", id: ids.scope, label: "Class 6A" }, effective_from: "2026-10-01T00:00:00.000Z", effective_until: null,
      effective_schedule: null, authority_source_kind: "appointment", authority_source_ref: "teaching-appointment", fallback_agent_id: null,
      source_domain: "roles", source_record_id: "teaching-appointment", source_revision: 1, revision: 1, projection_source: "canonical",
    }] };
    const temporal = { listOperatingDay: vi.fn().mockResolvedValue([{
      id: "row", occurrence_id: "occurrence", occurrence_date: "2026-10-19", period_number: 2,
      class_domain_id: ids.scope, class_label: "Class 6A", title: "Programming", subject_label: "Programming",
      slot_type: "class", responsible_agent_id: ids.agent, space_label: "Lab 1",
      starts_at: "2026-10-19T03:30:00Z", ends_at: "2026-10-19T04:15:00Z", source_domain: "timetable",
    }]) };
    const result = await service(snapshot, { temporal }).instance.manifest({ ...user, role: "staff" }, null,
      { mode: "live", institution_id: ids.school, namespace_id: `live:${ids.school}` });
    expect(result.areas.find(area => area.key === "timetable")?.surfaces).toEqual([
      expect.objectContaining({ key: "sessions", href: "/areas/timetable/session", capabilities: ["learning.sessions.manage"] }),
    ]);
    expect(result.areas.some(area => ["attendance", "messages"].includes(area.key))).toBe(false);
    expect(result.areas.find(area => area.key === 'calendar')?.capabilities).toEqual(['campus_dates.published']);
    expect(result.today.now).toEqual([expect.objectContaining({ action_label: "Open session",
      href: `/areas/timetable/session?date=2026-10-19&class_section_id=${ids.scope}&period_number=2` })]);
  });
  it("discovers only current native offering and own-person Assignment contexts for a neutral member", async () => {
    const offeringId = "00000000-0000-4000-8000-000000000011", personId = "00000000-0000-4000-8000-000000000012";
    const contexts = [{ kind: "offering", id: offeringId, label: "Saturday robotics", can_manage: true, can_publish: true, can_review: true,
      href: `/areas/messages/assignments?scope=offering&offering_id=${offeringId}` },
    { kind: "person", id: personId, label: "My assignments", can_manage: false,
      href: `/areas/messages/assignments?scope=person&person_id=${personId}` }];
    const learning = { projectWork: vi.fn().mockResolvedValue([]), readiness: vi.fn().mockResolvedValue({ can_setup: false, contexts,
      operation: { state: "ready_to_create", action: "create", scope: { kind: "offering", id: offeringId }, source_revision: null } }) };
    const current = service({ ...base, membership_roles: ["member"] }, { learning });
    const view = { mode: "live" as const, institution_id: ids.school, namespace_id: `live:${ids.school}` as const };
    const available = await current.instance.manifest(user, null, view), messages = available.areas.find(area => area.key === "messages");
    expect(messages?.surfaces).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: `assignments:offering:${offeringId}`, href: contexts[0]!.href,
        capabilities: ["learning.assignments.manage"], scopes: [{ kind: "offering", id: offeringId, label: "Saturday robotics" }] }),
      expect.objectContaining({ key: `assignments:person:${personId}`, href: contexts[1]!.href,
        capabilities: ["learning.assignments.view"], scopes: [{ kind: "person", id: personId, label: "My assignments" }] }),
    ]));
    expect(messages?.surfaces.some(surface => surface.key === "assignments:setup")).toBe(false);
    expect(available.areas.some(area => ["attendance", "fees", "people"].includes(area.key))).toBe(false);
    learning.readiness.mockResolvedValue({ can_setup: false, contexts: [], operation: { state: "requires_setup", action: "unavailable", scope: null, source_revision: null } });
    const revoked = await current.instance.manifest(user, null, view);
    expect(revoked.areas.some(area => area.key === "messages")).toBe(false);
    expect(revoked.revision).not.toBe(available.revision);
  });
  it("keeps Assignment setup discovery distinct from acting teaching authority", async () => {
    const learning = { projectWork: vi.fn().mockResolvedValue([]), readiness: vi.fn().mockResolvedValue({ can_setup: false, contexts: [],
      operation: { state: "unavailable", action: "unavailable", scope: null, source_revision: null } }) };
    const current = service(base, { learning }), view = { mode: "live" as const, institution_id: ids.school, namespace_id: `live:${ids.school}` as const };
    expect((await current.instance.manifest(user, null, view)).areas.some(area => area.key === "messages")).toBe(false);
    learning.readiness.mockResolvedValue({ can_setup: true, contexts: [], operation: { state: "ready_to_create", action: "create", scope: null, source_revision: null } });
    const ready = await current.instance.manifest(user, null, view), messages = ready.areas.find(area => area.key === "messages");
    expect(messages?.surfaces).toEqual([expect.objectContaining({ key: "assignments:setup", href: "/areas/messages/assignments", capabilities: ["learning.assignments.setup"] })]);
    expect(messages?.capabilities).not.toContain("learning.assignments.manage");
    expect(messages?.capabilities).not.toContain("learning.assignments.review");
  });
  it("gives a reviewer-only offering its exact review surface, not publishing authority", async () => {
    const learning = { projectWork: vi.fn().mockResolvedValue([]), readiness: vi.fn().mockResolvedValue({ can_setup: false,
      contexts: [{ kind: "offering", id: ids.scope, label: "Programming", href: `/areas/messages/assignments?scope=offering&offering_id=${ids.scope}`,
        can_manage: false, can_publish: false, can_review: true }],
      operation: { state: "ready_to_create", action: "view", scope: { kind: "offering", id: ids.scope }, source_revision: null } }) };
    const result = await service({ ...base, membership_roles: ["member"] }, { learning }).instance.manifest(user, null,
      { mode: "live", institution_id: ids.school, namespace_id: `live:${ids.school}` });
    expect(result.areas.find(area => area.key === "messages")?.surfaces).toEqual([
      expect.objectContaining({ key: `assignments:offering:${ids.scope}`, capabilities: ["learning.assignments.review"] }),
    ]);
  });
  it("discovers Finance only from this holder's current native mandate, never an administrator title", async () => {
    const authority = { workspace: vi.fn().mockResolvedValue({ route: { state: "missing", revision: 0, reviewer: null }, candidates: [] }) };
    const current = service(base, { authority });
    const view = { mode: "live" as const, institution_id: ids.school, namespace_id: `live:${ids.school}` as const };
    const missing = await current.instance.manifest(user, null, view);
    expect(missing.areas.some(area => area.key === "fees")).toBe(false);
    authority.workspace.mockResolvedValue({ route: { state: "missing", revision: 0, reviewer: null }, candidates: [{ mandate_id: "existing-mandate", can_confirm: true, expected: { mandate_revision: 1 } }] });
    const confirmable = await current.instance.manifest(user, null, view);
    expect(confirmable.areas.find(area => area.key === "fees")?.surfaces).toContainEqual(expect.objectContaining({ key: "ledger", capabilities: ["fees.manage"] }));
    expect(confirmable.revision).not.toBe(missing.revision);
    authority.workspace.mockResolvedValue({ route: { state: "ready", revision: 1, reviewer: { user_id: "another-holder" } }, candidates: [] });
    expect((await current.instance.manifest(user, null, view)).areas.some(area => area.key === "fees")).toBe(false);
    authority.workspace.mockResolvedValue({ route: { state: "ready", revision: 1, reviewer: { user_id: ids.user } }, candidates: [] });
    expect((await current.instance.manifest(user, null, view)).areas.some(area => area.key === "fees")).toBe(true);
  });
  it("counts source-owned assignment and fee obligations, not Waiting or retained protocol mirrors", async () => {
    const learning = { readiness: vi.fn().mockResolvedValue(null), projectWork: vi.fn().mockResolvedValue([{ id: "assignment-work", assignment_id: "assignment", student_id: ids.student,
      attempt_id: "attempt", action: "review", stream: "needs_me", state: "action_required", title: "Review practice", student_label: "Sana",
      reviewer_label: "Meera", owner_user_id: ids.user, message_id: ids.message, source_revision: 1,
      href: "/areas/messages/assignments?assignment=assignment", created_at: instant.toISOString(), due_at: null }]) };
    const finance = { work: vi.fn().mockResolvedValue({ needs_me: [], waiting: [{ id: "fee-request", invoice_id: "invoice", student_id: ids.student,
      revision: 1, created_at: instant.toISOString(), message_id: "fee-message", due_at: null, href: "/areas/fees/account?invoice=invoice",
      title: "Instalment request", reviewer: { user_id: "other", label: "Imran" }, state: "waiting_for_review" }] }) };
    const mirror = { id: ids.message, reaction_kind: "learning_assignment_review", subject: "Old protocol title", summary: "Not a native obligation",
      message_kind: "task", state: "queued", response_due_at: null, expires_at: null, source_domain: "learning_assignments", payload: {},
      queued_at: instant.toISOString(), updated_at: instant.toISOString() };
    const current = service({ ...base, messages: [mirror as never] }, { learning, finance });
    const view = { mode: "live" as const, institution_id: ids.school, namespace_id: `live:${ids.school}` as const };
    const pending = await current.instance.manifest(user, null, view);
    expect(pending.work.counts).toEqual({ needs_me: 1, waiting: 1 });
    expect(pending.today.attention.total).toBe(1);
    expect(pending.work.items.some(item => item.title === "Old protocol title")).toBe(false);
    learning.projectWork.mockResolvedValue([]); finance.work.mockResolvedValue({ needs_me: [], waiting: [] });
    const closed = await current.instance.manifest(user, null, view);
    expect(closed.work.total).toBe(0);
    expect(closed.today.attention.total).toBe(0);
    expect(closed.revision).not.toBe(pending.revision);
  });
  it("contributes class practice only from the exact learning publisher assignment, without Attendance or a title grant", async () => {
    const publisher: WorkspaceRepositorySnapshot = { ...base, membership_roles: ["staff"], assignments: [{
      id: ids.responsibility, owner_agent_id: ids.agent, capability_key: "learning.work.publish", action_key: "learning.work.publish",
      scope: { kind: "class", id: ids.scope, label: "Class 7A" }, effective_from: "2026-10-01T00:00:00Z", effective_until: null,
      effective_schedule: null, authority_source_kind: "explicit_assignment", authority_source_ref: "assignment-1", fallback_agent_id: null,
      source_domain: "staff_operations", source_record_id: "assignment-1", source_revision: 1, revision: 1, projection_source: "canonical",
    }] };
    const view = { mode: "live" as const, institution_id: ids.school, namespace_id: `live:${ids.school}` as const };
    const assigned = await service(publisher).instance.manifest(user, null, view);
    expect(assigned.areas.find(area => area.key === "messages")?.surfaces).toEqual([{ key: `diary:class:${ids.scope}`, label: "Class 7A practice",
      description: "Publish practice for this assigned class", href: `/areas/messages/diary?scope=class&class_section_id=${ids.scope}`,
      capabilities: ["learning.work.publish"], scopes: [{ kind: "class", id: ids.scope, label: "Class 7A" }] }]);
    expect(assigned.areas.some(area => area.key === "attendance")).toBe(false);
    expect((await service({ ...publisher, assignments: [] }).instance.manifest(user, null, view)).areas.some(area => area.key === "messages")).toBe(false);
  });

  it("projects source-owned attendance review into Work and Today, then clears it on source closure", async () => {
    const item = { id: "activity-attendance-review:register-1", kind: "task", urgency: "normal",
      title: "Review attendance · Programming", status_label: "Awaiting review", detail: "Submitted for your review.",
      href: "/areas/attendance/registers?date=2026-10-01&register_id=register-1",
      action_label: "Review register", source_label: "Attendance", tone: "attention" };
    const activities = { load: vi.fn().mockResolvedValue({ assignments: [], now: [], next: [], work: [item] }) };
    const current = service(base, { activities });
    const view = { mode: "live" as const, institution_id: ids.school, namespace_id: `live:${ids.school}` as const };
    const pending = await current.instance.manifest(user, null, view);
    expect(pending.work).toEqual({ total: 1, counts: { needs_me: 1, waiting: 0 }, coverage: "complete", items: [item] });
    expect(pending.today.attention).toEqual({ total: 1, overdue: 0, due_soon: 0 });
    expect(pending.areas.find(area => area.key === "attendance")?.attention_count).toBe(1);
    activities.load.mockResolvedValue({ assignments: [], now: [], next: [], work: [] });
    const closed = await current.instance.manifest(user, null, view);
    expect(closed.work).toEqual({ total: 0, counts: { needs_me: 0, waiting: 0 }, coverage: "complete", items: [] });
    expect(closed.today.attention.total).toBe(0);
    expect(closed.revision).not.toBe(pending.revision);
  });

  it.each([false, true])("discovers current native assessment assignments without broad staff/report authority (simulation=%s)", async simulation => {
    const assessments = { discovery: vi.fn().mockResolvedValue({ has_assigned: false, can_plan_course: false }) };
    const current = service({ ...base, membership_roles: ["staff"], assignments: [] }, { assessments });
    const view = simulation ? { mode: "simulation" as const, institution_id: ids.school,
      namespace_id: "scenario:11111111-1111-4111-8111-111111111111:run:22222222-2222-4222-8222-222222222222" as const,
      scenario_id: "11111111-1111-4111-8111-111111111111", run_id: "22222222-2222-4222-8222-222222222222",
      virtual_clock: { now: instant.toISOString(), time_zone: "Asia/Kolkata" },
      source_snapshot_at: "2026-10-18T00:00:00.000Z", expires_at: "2026-10-20T00:00:00.000Z" }
      : { mode: "live" as const, institution_id: ids.school, namespace_id: `live:${ids.school}` as const };
    // An account title and ordinary staff membership are insufficient.
    const absent = await current.instance.manifest(user, null, view);
    expect(absent.areas.some(area => area.key === "assessments" || area.key === "reports")).toBe(false);
    assessments.discovery.mockResolvedValue({ has_assigned: true, can_plan_course: false });
    const assigned = await current.instance.manifest(user, null, view);
    expect(assessments.discovery).toHaveBeenCalledWith(user, ids.school);
    expect(assigned.context.environment.namespace_id).toBe(view.namespace_id);
    expect(assigned.areas.find(area => area.key === "assessments")).toMatchObject({ capabilities: ["assessments.view"],
      scopes: [{ kind: "self", label: "My assessment assignments" }],
      surfaces: [{ key: "assigned", href: "/areas/assessments/assigned", capabilities: ["assessments.view"] }] });
    expect(assigned.areas.some(area => area.key === "reports")).toBe(false);
    expect(assigned.work.items).toEqual([]);
    expect(assigned.revision).not.toBe(absent.revision);
    assessments.discovery.mockResolvedValue({ has_assigned: false, can_plan_course: false });
    const revoked = await current.instance.manifest(user, null, view);
    expect(revoked.areas.some(area => area.key === "assessments")).toBe(false);
    expect(revoked.revision).not.toBe(assigned.revision);
    assessments.discovery.mockResolvedValue({ has_assigned: false, can_plan_course: true });
    const firstCourseTest = await current.instance.manifest(user, null, view);
    expect(firstCourseTest.areas.find(area => area.key === "assessments")).toMatchObject({ capabilities: ["assessments.mark"],
      surfaces: [{ key: "assigned", href: "/areas/assessments/assigned", capabilities: ["assessments.mark"] }] });
    expect(firstCourseTest.areas.some(area => area.key === "reports")).toBe(false);
  });

  it("treats administrator membership as setup authority plus institution oversight", async () => {
    const result = await service(base).instance.manifest(user, null, {
      mode: "live", institution_id: ids.school, namespace_id: `live:${ids.school}`,
    });

    expect(result.areas).toEqual([
      expect.objectContaining({key:"attendance",capabilities:["attendance.view"]}),
      expect.objectContaining({
        key: "timetable",
        capabilities: ["schedule.manage"],
        scopes: [{ kind: "institution", id: ids.school, label: "Cambridge International School" }],
        surfaces: [expect.objectContaining({
          key: "planning",
          href: "/areas/timetable/planning",
          capabilities: ["schedule.manage"],
        })],
      }),
      expect.objectContaining({
        key: "calendar", href: "/areas/calendar", capabilities: ["schedule.manage"],
        scopes: [{ kind: "institution", id: ids.school, label: "Cambridge International School" }],
        surfaces: [expect.objectContaining({ key: "manage", href: "/areas/calendar?surface=manage", capabilities: ["schedule.manage"] })],
      }),
      expect.objectContaining({ key: "assessments", capabilities: ["assessments.moderate"],
        surfaces: [expect.objectContaining({ key: "manage", href: "/areas/assessments/manage" })] }),
      expect.objectContaining({ key: "reports", capabilities: ["reports.comment"],
        surfaces: [expect.objectContaining({ key: "remarks", href: "/areas/reports/remarks" })] }),
      expect.objectContaining({
        key: "insights",
        capabilities: ["insights.manage"],
        scopes: [{ kind: "institution", id: ids.school, label: "Cambridge International School" }],
        surfaces: [expect.objectContaining({
          key: "institution",
          href: "/areas/insights?scope=institution",
          capabilities: ["insights.manage"],
        })],
      }),
      expect.objectContaining({key:"people",capabilities:["sis.manage"],surfaces:[
        expect.objectContaining({key:"participants",label:"People & groups",href:"/areas/people/participants"}),
        expect.objectContaining({key:"records",label:"Enrollment records",href:"/areas/people/records"}),
        expect.objectContaining({key:"import",label:"Enroll from file",href:"/areas/people/import"}),
      ]}),
    ]);
    expect(result.work.items).toEqual([]);
    expect(result.context.time_zone).toBe("Asia/Kolkata");
    expect(result.more.setup.map((item) => item.href)).toEqual([
      "/more/setup/institution",
      "/more/setup/people",
      "/more/setup/people/invitations",
      "/more/setup/organization",
      "/more/setup/responsibilities",
      "/more/setup/capabilities",
    ]);
    expect(result.more.groups.find((group) => group.key === "account")?.items.map((item) => item.href)).toEqual([
      "/more/account",
      "/more/account/security",
    ]);
    expect(result.more.groups.find((group) => group.key === "oversight")?.items.map((item) => item.href)).toEqual([
      "/more/simulation",
      "/more/verification",
    ]);
    const campusEntries = result.more.groups.flatMap(group => group.items).filter(item => item.icon === "building");
    expect(campusEntries).toEqual([expect.objectContaining({ key: "virtual-campus", href: "/more/virtual-campus", label: "Virtual campus" })]);
    expect(result.more.groups.find((group) => group.key === "setup")?.items).toEqual([expect.objectContaining({
      key: "setup",
      href: "/more/setup",
    })]);
    expect(result.more.groups.flatMap((group) => group.items).some((item) => item.href.startsWith("/more/development"))).toBe(false);
    expect(result.more.groups.find((group) => group.key === "participation")?.items.find((item) => item.key === "feedback")).toMatchObject({
      href: "/more/feedback",
      capabilities: ["teacher_feedback.coordinate"],
      scopes: [{ kind: "institution", id: ids.school, label: "Cambridge International School" }],
    });
    expect(JSON.stringify(result)).not.toMatch(/principal|portal/i);
  });

  it("composes separately scoped duties and team-owned work without selecting a role portal", async () => {
    const snapshot: WorkspaceRepositorySnapshot = {
      ...base,
      membership_roles: ["staff"],
      owner_agent_ids: [ids.agent, ids.team],
      assignments: [{
        id: ids.responsibility,
        owner_agent_id: ids.agent,
        capability_key: "attendance",
        action_key: "attendance.record",
        scope: { kind: "class", id: ids.scope, label: "Class 6A" },
        effective_from: "2026-10-01T00:00:00.000Z",
        effective_until: null,
        effective_schedule: {
          time_zone: "Asia/Kolkata",
          weekly_windows: [{ days: [1], starts_at: "09:00", ends_at: "09:45" }],
        },
        authority_source_kind: "appointment",
        authority_source_ref: "class-assignment:6a",
        fallback_agent_id: null,
        source_domain: "academic_structure",
        source_record_id: "class-assignment:6a",
        source_revision: 2,
        revision: 2,
        projection_source: "canonical",
      }],
      messages: [{
        id: ids.message,
        message_kind: "task",
        state: "delivered",
        subject: "Attendance register needs completion",
        summary: "Class 6A has not been submitted.",
        payload: { date: "2026-10-19", class_section_id: ids.scope },
        reaction_kind: "attendance_completion_task",
        source_domain: "attendance",
        response_due_at: "2026-10-19T04:30:00.000Z",
        expires_at: null,
        queued_at: "2026-10-19T03:55:00.000Z",
        updated_at: "2026-10-19T03:56:00.000Z",
      }],
    };
    const result = await service(snapshot).instance.manifest({ ...user, role: "staff" }, null, {
      mode: "live", institution_id: ids.school, namespace_id: `live:${ids.school}`,
    });

    expect(result.today.now[0]).toMatchObject({ title: "Class 6A", status_label: "Now", href: "/areas/attendance" });
    expect(result.work.items[0]).toMatchObject({
      kind: "task",
      urgency: "due_soon",
      href: `/areas/attendance/registers?date=2026-10-19&class_section_id=${ids.scope}`,
    });
    expect(result.areas.find((area) => area.key === "attendance")).toEqual(expect.objectContaining({
      key: "attendance",
      capabilities: ["attendance.record"],
      scopes: [{ kind: "class", id: ids.scope, label: "Class 6A" }],
      surfaces: [
        expect.objectContaining({
          key: "registers",
          href: "/areas/attendance/registers",
          capabilities: ["attendance.record"],
          scopes: [{ kind: "class", id: ids.scope, label: "Class 6A" }],
        }),
        expect.objectContaining({ key: "thresholds", href: "/areas/attendance/thresholds" }),
      ],
    }));
    expect(result.areas.find((area) => area.key === "people")).toEqual(expect.objectContaining({
      key: "people",
      capabilities: ["attendance.record"],
      scopes: [{ kind: "class", id: ids.scope, label: "Class 6A" }],
      surfaces: [expect.objectContaining({
        key: "classes",
        href: "/areas/people/classes",
        capabilities: ["attendance.record"],
        scopes: [{ kind: "class", id: ids.scope, label: "Class 6A" }],
      })],
    }));
    expect(result.more.setup).toEqual([]);
    expect(result.more.groups.find((group) => group.key === "participation")?.items.map((item) => item.key)).toEqual([
      "policies",
    ]);
    expect(result.more.groups.find((group) => group.key === "work")?.items[0]?.href).toBe("/areas/responsibilities/mine");
  });

  it("contributes assigned Insights only from effective analytical responsibilities", async () => {
    const result = await service({
      ...base,
      membership_roles: ["staff"],
      assignments: [{
        id: ids.responsibility,
        owner_agent_id: ids.agent,
        capability_key: "attendance",
        action_key: "attendance.view",
        scope: { kind: "class", id: ids.scope, label: "Class 6A" },
        effective_from: "2026-10-01T00:00:00.000Z",
        effective_until: null,
        effective_schedule: null,
        authority_source_kind: "appointment",
        authority_source_ref: "class-insights:6a",
        fallback_agent_id: null,
        source_domain: "academic_structure",
        source_record_id: "class-insights:6a",
        source_revision: 1,
        revision: 1,
        projection_source: "canonical",
      }],
    }).instance.manifest({ ...user, role: "staff" }, null, {
      mode: "live", institution_id: ids.school, namespace_id: `live:${ids.school}`,
    });

    expect(result.areas.find((area) => area.key === "insights")).toEqual(expect.objectContaining({
      capabilities: ["attendance.view"],
      scopes: [{ kind: "class", id: ids.scope, label: "Class 6A" }],
      surfaces: [expect.objectContaining({
        key: "assigned",
        href: "/areas/insights?scope=assigned",
        capabilities: ["attendance.view"],
      })],
    }));
  });

  it("keeps an administrator's assigned Insights separate from their institution contribution", async () => {
    const result = await service({ ...base, assignments: [{
      id: ids.responsibility, owner_agent_id: ids.agent, capability_key: "attendance", action_key: "attendance.view",
      scope: { kind: "class", id: ids.scope, label: "Class 6A" }, effective_from: "2026-10-01T00:00:00.000Z", effective_until: null,
      effective_schedule: null, authority_source_kind: "appointment", authority_source_ref: "class-insights:6a", fallback_agent_id: null,
      source_domain: "academic_structure", source_record_id: "class-insights:6a", source_revision: 1, revision: 1, projection_source: "canonical",
    }] }).instance.manifest(user, null, { mode: "live", institution_id: ids.school, namespace_id: `live:${ids.school}` });
    const insights = result.areas.find(area => area.key === "insights")!;
    expect(insights.surfaces.find(surface => surface.key === "assigned")).toMatchObject({
      href: "/areas/insights?scope=assigned", capabilities: ["attendance.view"], scopes: [{ kind: "class", id: ids.scope, label: "Class 6A" }],
    });
    expect(insights.surfaces.find(surface => surface.key === "institution")).toMatchObject({ href: "/areas/insights?scope=institution", capabilities: ["insights.manage"] });
  });

  it("composes delegated setup links from exact capabilities without administrator-only tools", async () => {
    const result = await service({
      ...base,
      membership_roles: ["staff"],
      assignments: ["sis.manage", "members.invite"].map((actionKey, index) => ({
        id: index === 0 ? ids.responsibility : "00000000-0000-4000-8000-000000000014",
        owner_agent_id: ids.agent,
        capability_key: actionKey.split(".")[0]!,
        action_key: actionKey,
        scope: { kind: "institution" as const, id: ids.school, label: "Cambridge International School" },
        effective_from: "2026-10-01T00:00:00.000Z",
        effective_until: null,
        effective_schedule: null,
        authority_source_kind: "permission_assignment",
        authority_source_ref: `delegated:${actionKey}`,
        fallback_agent_id: null,
        source_domain: "access_assignments",
        source_record_id: `delegated:${actionKey}`,
        source_revision: 1,
        revision: 1,
        projection_source: "canonical" as const,
      })),
    }).instance.manifest({ ...user, role: "staff" }, null, {
      mode: "live", institution_id: ids.school, namespace_id: `live:${ids.school}`,
    });

    expect(result.more.setup.map((item) => item.key)).toEqual(["institution", "people", "invitations", "capabilities"]);
    expect(result.areas.find((item) => item.key === "people")?.surfaces).toEqual([
      expect.objectContaining({ key: "participants", href: "/areas/people/participants", capabilities: ["sis.manage"] }),
      expect.objectContaining({ key: "records", href: "/areas/people/records", capabilities: ["sis.manage"] }),
      expect.objectContaining({ key: "import", href: "/areas/people/import", capabilities: ["sis.manage"] }),
      expect.objectContaining({ key: "invitations", href: "/more/setup/people/invitations", capabilities: ["members.invite"] }),
    ]);
    expect(result.more.groups.some((group) => group.key === "oversight")).toBe(false);
    expect(result.more.groups.flatMap((group) => group.items).some((item) => item.key === "simulation")).toBe(false);
    expect(result.more.groups.flatMap((group) => group.items).every((item) => !/\/(principal|teacher|parent|student)\//.test(item.href))).toBe(true);
  });

  it("contributes Simulation to every customer institution administrator without development controls", async () => {
    const result = await service({ ...base, institution: { ...base.institution, code: "customer-1" } }).instance.manifest(user, null, {
      mode: "live", institution_id: ids.school, namespace_id: `live:${ids.school}`,
    });
    expect(result.more.groups.find((group) => group.key === "oversight")?.items).toContainEqual(expect.objectContaining({
      key: "simulation",
      href: "/more/simulation",
    }));
    expect(result.more.groups.flatMap((group) => group.items).some((item) => item.href.startsWith("/more/development"))).toBe(false);
    expect(result.more.groups.some((group) => group.key === "connections")).toBe(true);
  });

  it("adds explicit operational responsibility alongside administrator schedule planning", async () => {
    const result = await service({
      ...base,
      assignments: [{
        id: ids.responsibility,
        owner_agent_id: ids.agent,
        capability_key: "gate",
        action_key: "gate.manage",
        scope: { kind: "institution", id: ids.school, label: "Cambridge International School" },
        effective_from: "2026-10-01T00:00:00.000Z",
        effective_until: null,
        effective_schedule: null,
        authority_source_kind: "appointment",
        authority_source_ref: "gate-duty:1",
        fallback_agent_id: null,
        source_domain: "access_assignments",
        source_record_id: "gate-duty:1:gate.manage",
        source_revision: 1,
        revision: 1,
        projection_source: "canonical",
      }],
    }).instance.manifest(user, null, {
      mode: "live", institution_id: ids.school, namespace_id: `live:${ids.school}`,
    });

    expect(result.areas).toEqual([
      expect.objectContaining({key:"attendance",capabilities:["attendance.view"]}),
      expect.objectContaining({ key: "timetable", capabilities: ["schedule.manage"] }),
      expect.objectContaining({ key: "calendar", capabilities: ["schedule.manage"] }),
      expect.objectContaining({
        key: "in-out",
        capabilities: ["gate.manage"],
        surfaces: [
          expect.objectContaining({ key: "visits", href: "/areas/in-out/visits" }),
          expect.objectContaining({ key: "operate", href: "/areas/in-out/operate" }),
          expect.objectContaining({ key: "manage", href: "/areas/in-out/manage" }),
        ],
      }),
      expect.objectContaining({ key: "assessments", capabilities: ["assessments.moderate"] }),
      expect.objectContaining({ key: "reports", capabilities: ["reports.comment"] }),
      expect.objectContaining({ key: "insights", capabilities: ["insights.manage"] }),
      expect.objectContaining({key:"people",capabilities:["sis.manage"]}),
    ]);
    expect(result.areas.find(item=>item.key==='attendance')?.capabilities).not.toContain('attendance.record');
    expect(result.more.setup.length).toBeGreaterThan(0);
  });

  it("gives a delegated In & Out operator visits and movements without entry-point administration", async () => {
    const result = await service({
      ...base,
      membership_roles: ["staff"],
      assignments: [{
        id: ids.responsibility,
        owner_agent_id: ids.agent,
        capability_key: "gate",
        action_key: "gate.manage",
        scope: { kind: "institution", id: ids.school, label: "Cambridge International School" },
        effective_from: "2026-10-01T00:00:00.000Z",
        effective_until: null,
        effective_schedule: null,
        authority_source_kind: "appointment",
        authority_source_ref: "gate-duty:staff",
        fallback_agent_id: null,
        source_domain: "access_assignments",
        source_record_id: "gate-duty:staff:gate.manage",
        source_revision: 1,
        revision: 1,
        projection_source: "canonical",
      }],
    }).instance.manifest({ ...user, role: "staff" }, null, {
      mode: "live", institution_id: ids.school, namespace_id: `live:${ids.school}`,
    });

    expect(result.areas.find((item) => item.key === "in-out")?.surfaces).toEqual([
      expect.objectContaining({ key: "visits", href: "/areas/in-out/visits", capabilities: ["gate.manage"] }),
      expect.objectContaining({ key: "operate", href: "/areas/in-out/operate", capabilities: ["gate.manage"] }),
    ]);
  });

  it("provides learner and guardian relationship areas without turning a relationship into a role portal", async () => {
    const result = await service({
      ...base,
      membership_roles: ["guardian"],
      acting_agent_id: null,
      owner_agent_ids: [],
      relationships: [{
        relationship: "dependent",
        student_id: ids.student,
        student_label: "Aarav Sharma",
        class_section_id: ids.scope,
        class_label: "Class 6A",
        enrollment_revision: 3,
      }],
    }).instance.manifest({ ...user, role: "parent" }, null, {
      mode: "live", institution_id: ids.school, namespace_id: `live:${ids.school}`,
    });

    expect(result.areas.map((item) => item.key)).toEqual([
      "attendance", "timetable", "calendar", "assessments", "events", "messages", "departure", "reports", "insights", "fees",
    ]);
    expect(result.areas[0]?.scopes).toEqual([
      { kind: "dependent", id: ids.student, label: "Aarav Sharma" },
      { kind: "class", id: ids.scope, label: "Class 6A" },
    ]);
    expect(result.areas[0]?.surfaces[0]).toMatchObject({
      key: `records:dependent:${ids.student}`,
      label: "Aarav Sharma attendance",
      href: `/areas/attendance/records?scope=dependent&student_id=${ids.student}`,
      capabilities: ["attendance.view"],
      scopes: [
        { kind: "dependent", id: ids.student, label: "Aarav Sharma" },
        { kind: "class", id: ids.scope, label: "Class 6A" },
      ],
    });
    expect(result.areas[0]?.surfaces[1]).toMatchObject({
      key: `leave:dependent:${ids.student}`,
      label: "Aarav Sharma leave",
      href: `/areas/attendance/leave?scope=dependent&student_id=${ids.student}`,
      capabilities: ["attendance.view"],
    });
    expect(result.areas.find((item) => item.key === "timetable")?.surfaces).toEqual([
      expect.objectContaining({
        key: `schedule:dependent:${ids.student}`,
        label: "Aarav Sharma timetable",
        href: `/areas/timetable/schedule?scope=dependent&student_id=${ids.student}`,
      }),
    ]);
    expect(result.areas.find((item) => item.key === "calendar")).toMatchObject({
      href: "/areas/calendar", capabilities: ["timetable.view"],
      scopes: result.areas.find((item) => item.key === "timetable")!.scopes,
      surfaces: [expect.objectContaining({
        key: `calendar:dependent:${ids.student}`,
        label: "Aarav Sharma calendar",
        href: `/areas/calendar?scope=dependent&student_id=${ids.student}`,
        capabilities: ["timetable.view"],
      })],
    });
    expect(result.areas.find((item) => item.key === "insights")?.surfaces).toEqual([
      expect.objectContaining({
        key: `overview:dependent:${ids.student}`,
        label: "Aarav Sharma insights",
        href: `/areas/insights?scope=dependent&student_id=${ids.student}`,
        capabilities: ["insights.view"],
        scopes: expect.arrayContaining([{ kind: "dependent", id: ids.student, label: "Aarav Sharma" }]),
      }),
    ]);
    expect(result.more.groups.find((group) => group.key === "participation")?.items.find((item) => item.key === "feedback")).toMatchObject({
      href: "/more/feedback",
      capabilities: ["teacher_feedback.respond"],
      scopes: [{ kind: "dependent", id: ids.student, label: "Aarav Sharma" }],
    });
    expect(result.more.setup).toEqual([]);
  });

  it("composes feedback coordination and response together when both authorities are present", async () => {
    const result = await service({
      ...base,
      membership_roles: ["admin", "guardian"],
      relationships: [{
        relationship: "dependent",
        student_id: ids.student,
        student_label: "Aarav Sharma",
        class_section_id: ids.scope,
        class_label: "Class 6A",
        enrollment_revision: 3,
      }],
    }).instance.manifest(user, null, {
      mode: "live", institution_id: ids.school, namespace_id: `live:${ids.school}`,
    });

    expect(result.more.groups.find((group) => group.key === "participation")?.items.find((item) => item.key === "feedback")).toMatchObject({
      capabilities: ["teacher_feedback.coordinate", "teacher_feedback.respond"],
      scopes: [
        { kind: "institution", id: ids.school, label: "Cambridge International School" },
        { kind: "dependent", id: ids.student, label: "Aarav Sharma" },
      ],
    });
  });

  it.each(["live", "simulation"] as const)("discovers only the learner's own departure plan in the selected %s world", async (mode) => {
    const namespace = mode === "live" ? `live:${ids.school}` as const
      : "scenario:11111111-1111-4111-8111-111111111111:run:22222222-2222-4222-8222-222222222222" as const;
    const current = service({
      ...base, membership_roles: ["student"], acting_agent_id: null, owner_agent_ids: [],
      environment_namespace_id: namespace,
      relationships: [{ relationship: "self", student_id: ids.student, student_label: "My learner record",
        class_section_id: ids.scope, class_label: "MTech Demo", enrollment_revision: 1 }],
    });
    const selected = mode === "live" ? { environment: null,
      view: { mode, institution_id: ids.school, namespace_id: namespace as `live:${string}` } }
      : simulationSessionExecutionEnvironment({ institution_id: ids.school, scenario_id: "11111111-1111-4111-8111-111111111111",
        run_id: "22222222-2222-4222-8222-222222222222", namespace_id: namespace as `scenario:${string}:run:${string}`,
        virtual_now: instant.toISOString(), time_zone: "Asia/Kolkata", source_snapshot_at: "2026-10-18T00:00:00.000Z",
        source_snapshot_ref: "captured-self-relationship", expires_at: "2026-10-20T00:00:00.000Z", run_status: "running" },
      { manifest_ref: "self-departure-test", checked_at: instant.toISOString() });
    const result = await current.instance.manifest({ ...user, role: "student" }, selected.environment, selected.view);
    expect(result.areas.find(area => area.key === "departure")).toMatchObject({
      capabilities: ["departure.view"],
      surfaces: [{ key: `plan:self:${ids.student}`, href: `/areas/departure/plan?scope=self&student_id=${ids.student}`,
        capabilities: ["departure.view"], scopes: [{ kind: "self", id: ids.student, label: "My learner record" },
          { kind: "class", id: ids.scope, label: "MTech Demo" }] }],
    });
    expect(result.areas.find(area => area.key === "departure")?.surfaces.some(surface =>
      surface.key === "manage" || surface.key === "operate" || surface.key.includes("dependent"))).toBe(false);
    expect(result.more.setup).toEqual([]);
    expect(current.repository.load).toHaveBeenCalledWith(expect.objectContaining({ execution_environment: selected.environment }));
    expect(result.context.environment.namespace_id).toBe(namespace);
  });

  it("keeps operational, self and each dependent surface independently addressable", async () => {
    const secondStudent = "00000000-0000-4000-8000-000000000010";
    const result = await service({
      ...base,
      membership_roles: ["student", "guardian", "staff"],
      assignments: [
        {
          id: ids.responsibility,
          owner_agent_id: ids.agent,
          capability_key: "attendance",
          action_key: "attendance.record",
          scope: { kind: "class", id: ids.scope, label: "Class 6A" },
          effective_from: "2026-10-01T00:00:00.000Z",
          effective_until: null,
          effective_schedule: null,
          authority_source_kind: "appointment",
          authority_source_ref: "class-assignment:6a",
          fallback_agent_id: null,
          source_domain: "academic_structure",
          source_record_id: "class-assignment:6a",
          source_revision: 1,
          revision: 1,
          projection_source: "canonical",
        },
        {
          id: "00000000-0000-4000-8000-000000000011",
          owner_agent_id: ids.agent,
          capability_key: "timetable",
          action_key: "timetable.view",
          scope: { kind: "institution", id: ids.school, label: "Cambridge International School" },
          effective_from: "2026-10-01T00:00:00.000Z",
          effective_until: null,
          effective_schedule: null,
          authority_source_kind: "appointment",
          authority_source_ref: "staff-schedule:1",
          fallback_agent_id: null,
          source_domain: "academic_structure",
          source_record_id: "staff-schedule:1",
          source_revision: 1,
          revision: 1,
          projection_source: "canonical",
        },
        {
          id: "00000000-0000-4000-8000-000000000012",
          owner_agent_id: ids.agent,
          capability_key: "followups",
          action_key: "followups.coordinate",
          scope: { kind: "institution", id: ids.school, label: "Cambridge International School" },
          effective_from: "2026-10-01T00:00:00.000Z",
          effective_until: null,
          effective_schedule: null,
          authority_source_kind: "appointment",
          authority_source_ref: "attendance-coordination:1",
          fallback_agent_id: null,
          source_domain: "attendance",
          source_record_id: "attendance-coordination:1",
          source_revision: 1,
          revision: 1,
          projection_source: "canonical",
        },
      ],
      relationships: [
        {
          relationship: "self",
          student_id: ids.student,
          student_label: "Campus Operator",
          class_section_id: ids.scope,
          class_label: "Class 6A",
          enrollment_revision: 1,
        },
        {
          relationship: "dependent",
          student_id: secondStudent,
          student_label: "Mira Sharma",
          class_section_id: null,
          class_label: null,
          enrollment_revision: 1,
        },
      ],
    }).instance.manifest({ ...user, role: "staff" }, null, {
      mode: "live", institution_id: ids.school, namespace_id: `live:${ids.school}`,
    });

    expect(result.areas.find((item) => item.key === "attendance")?.surfaces).toEqual([
      expect.objectContaining({ key: "registers", href: "/areas/attendance/registers" }),
      expect.objectContaining({ key: "thresholds", href: "/areas/attendance/thresholds" }),
      expect.objectContaining({ key: "coordination", href: "/areas/attendance/coordination" }),
      expect.objectContaining({
        key: `records:self:${ids.student}`,
        href: `/areas/attendance/records?scope=self&student_id=${ids.student}`,
        scopes: expect.arrayContaining([{ kind: "self", id: ids.student, label: "Campus Operator" }]),
      }),
      expect.objectContaining({
        key: `leave:self:${ids.student}`,
        href: `/areas/attendance/leave?scope=self&student_id=${ids.student}`,
        scopes: expect.arrayContaining([{ kind: "self", id: ids.student, label: "Campus Operator" }]),
      }),
      expect.objectContaining({
        key: `records:dependent:${secondStudent}`,
        href: `/areas/attendance/records?scope=dependent&student_id=${secondStudent}`,
        scopes: [{ kind: "dependent", id: secondStudent, label: "Mira Sharma" }],
      }),
      expect.objectContaining({
        key: `leave:dependent:${secondStudent}`,
        href: `/areas/attendance/leave?scope=dependent&student_id=${secondStudent}`,
        scopes: [{ kind: "dependent", id: secondStudent, label: "Mira Sharma" }],
      }),
      expect.objectContaining({
        key: `follow-ups:dependent:${secondStudent}`,
        href: `/areas/attendance/follow-ups?scope=dependent&student_id=${secondStudent}`,
        scopes: [{ kind: "dependent", id: secondStudent, label: "Mira Sharma" }],
      }),
    ]);
    expect(result.areas.find((item) => item.key === "timetable")?.surfaces).toEqual([
      expect.objectContaining({ key: "schedule", href: "/areas/timetable/schedule" }),
      expect.objectContaining({
        key: `schedule:self:${ids.student}`,
        href: `/areas/timetable/schedule?scope=self&student_id=${ids.student}`,
      }),
      expect.objectContaining({
        key: `schedule:dependent:${secondStudent}`,
        href: `/areas/timetable/schedule?scope=dependent&student_id=${secondStudent}`,
      }),
    ]);
    expect(result.areas.find((item) => item.key === "calendar")?.surfaces).toEqual([
      expect.objectContaining({ key: "assigned", href: "/areas/calendar?surface=assigned", capabilities: ["timetable.view"] }),
      expect.objectContaining({ key: `calendar:self:${ids.student}`, href: `/areas/calendar?scope=self&student_id=${ids.student}`, capabilities: ["timetable.view"] }),
      expect.objectContaining({ key: `calendar:dependent:${secondStudent}`, href: `/areas/calendar?scope=dependent&student_id=${secondStudent}`, capabilities: ["timetable.view"] }),
    ]);
    expect(result.areas.find((item) => item.key === "messages")?.surfaces).toEqual([
      expect.objectContaining({
        key: `conversations:self:${ids.student}`,
        href: `/areas/messages/conversations?scope=self&student_id=${ids.student}`,
      }),
      expect.objectContaining({
        key: `updates:self:${ids.student}`,
        href: `/areas/messages/updates?scope=self&student_id=${ids.student}`,
      }),
      expect.objectContaining({
        key: `diary:self:${ids.student}`,
        href: `/areas/messages/diary?scope=self&student_id=${ids.student}`,
      }),
      expect.objectContaining({
        key: `assignments:self:${ids.student}`,
        href: `/areas/messages/assignments?scope=self&student_id=${ids.student}`,
      }),
      expect.objectContaining({
        key: `conversations:dependent:${secondStudent}`,
        href: `/areas/messages/conversations?scope=dependent&student_id=${secondStudent}`,
      }),
      expect.objectContaining({
        key: `updates:dependent:${secondStudent}`,
        href: `/areas/messages/updates?scope=dependent&student_id=${secondStudent}`,
      }),
      expect.objectContaining({
        key: `diary:dependent:${secondStudent}`,
        href: `/areas/messages/diary?scope=dependent&student_id=${secondStudent}`,
      }),
      expect.objectContaining({
        key: `assignments:dependent:${secondStudent}`,
        href: `/areas/messages/assignments?scope=dependent&student_id=${secondStudent}`,
      }),
    ]);
  });

  it("uses concrete canonical surfaces instead of self-linking Area roots", async () => {
    const result = await service({
      ...base,
      membership_roles: ["staff"],
      assignments: [
        {
          id: ids.responsibility,
          owner_agent_id: ids.agent,
          capability_key: "sis",
          action_key: "sis.manage",
          scope: { kind: "institution", id: ids.school, label: "Cambridge International School" },
          effective_from: "2026-10-01T00:00:00.000Z",
          effective_until: null,
          effective_schedule: null,
          authority_source_kind: "appointment",
          authority_source_ref: "student-records:1",
          fallback_agent_id: null,
          source_domain: "academic_structure",
          source_record_id: "student-records:1",
          source_revision: 1,
          revision: 1,
          projection_source: "canonical",
        },
        {
          id: "00000000-0000-4000-8000-000000000013",
          owner_agent_id: ids.agent,
          capability_key: "fees",
          action_key: "fees.manage",
          scope: { kind: "institution", id: ids.school, label: "Cambridge International School" },
          effective_from: "2026-10-01T00:00:00.000Z",
          effective_until: null,
          effective_schedule: null,
          authority_source_kind: "appointment",
          authority_source_ref: "finance:1",
          fallback_agent_id: null,
          source_domain: "finance",
          source_record_id: "finance:1",
          source_revision: 1,
          revision: 1,
          projection_source: "canonical",
        },
        {
          id: "00000000-0000-4000-8000-000000000015",
          owner_agent_id: ids.agent,
          capability_key: "staff",
          action_key: "staff.leave.request",
          scope: { kind: "institution", id: ids.school, label: "Cambridge International School" },
          effective_from: "2026-10-01T00:00:00.000Z",
          effective_until: null,
          effective_schedule: null,
          authority_source_kind: "appointment",
          authority_source_ref: "staff:1",
          fallback_agent_id: null,
          source_domain: "staff_operations",
          source_record_id: "staff:1",
          source_revision: 1,
          revision: 1,
          projection_source: "canonical",
        },
      ],
    }).instance.manifest({ ...user, role: "staff" }, null, {
      mode: "live", institution_id: ids.school, namespace_id: `live:${ids.school}`,
    });

    expect(result.areas.find((item) => item.key === "people")?.surfaces).toEqual([
      expect.objectContaining({ key: "participants", href: "/areas/people/participants" }),
      expect.objectContaining({ key: "records", href: "/areas/people/records" }),
      expect.objectContaining({ key: "import", href: "/areas/people/import" }),
    ]);
    expect(result.areas.find((item) => item.key === "fees")?.surfaces).toEqual([
      expect.objectContaining({ key: "ledger", href: "/areas/fees/ledger" }),
    ]);
    expect(result.areas.find((item) => item.key === "responsibilities")?.surfaces).toEqual([
      expect.objectContaining({ key: "mine", href: "/areas/responsibilities/mine" }),
      expect.objectContaining({ key: "coverage", href: "/areas/responsibilities/coverage" }),
      expect.objectContaining({ key: "leave", href: "/areas/responsibilities/leave" }),
    ]);
    expect(result.areas.every((area) => area.surfaces.every((surface) => surface.href !== area.href))).toBe(true);
  });

  it("keeps ThatCampus AI discoverable through its canonical conversation", async () => {
    const result = await service({
      ...base,
      membership_roles: ["staff"],
      assignments: [{
        id: ids.responsibility,
        owner_agent_id: ids.agent,
        capability_key: "ai",
        action_key: "ai.use",
        scope: { kind: "institution", id: ids.school, label: "Cambridge International School" },
        effective_from: "2026-10-01T00:00:00.000Z",
        effective_until: null,
        effective_schedule: null,
        authority_source_kind: "permission_assignment",
        authority_source_ref: "assistant:1",
        fallback_agent_id: null,
        source_domain: "access_assignments",
        source_record_id: "assistant:1:ai.use",
        source_revision: 1,
        revision: 1,
        projection_source: "canonical",
      }],
    }).instance.manifest({ ...user, role: "staff" }, null, {
      mode: "live", institution_id: ids.school, namespace_id: `live:${ids.school}`,
    });

    expect(result.areas.find((item) => item.key === "assistant")?.surfaces).toEqual([
      expect.objectContaining({
        key: "conversation",
        href: "/areas/assistant/conversation",
        capabilities: ["ai.use"],
      }),
    ]);
  });

  it("qualifies the entire manifest with the server-selected Simulation namespace and virtual time", async () => {
    const namespace = "scenario:11111111-1111-4111-8111-111111111111:run:22222222-2222-4222-8222-222222222222" as const;
    const snapshot = { ...base, environment_namespace_id: namespace };
    const harness = service(snapshot);
    const result = await harness.instance.manifest(user, {
      kind: "simulation",
      institution_id: ids.school,
      namespace_id: namespace,
      source_live_namespace_id: `live:${ids.school}`,
      scenario_id: "11111111-1111-4111-8111-111111111111",
      run_id: "22222222-2222-4222-8222-222222222222",
      truth_mode: "transient_virtual",
      lifecycle: "transient_virtual_fork",
      virtual_clock: {
        now: () => instant,
        nowIso: () => instant.toISOString(),
        advanceBy: () => instant.toISOString(),
        advanceTo: () => instant.toISOString(),
      },
      source_snapshot_ref: "snapshot-1",
      coverage_gate: { status: "passed", manifest_ref: "manifest-1", checked_at: instant.toISOString() },
      expires_at: "2026-10-20T00:00:00.000Z",
      capabilities: {
        mode: "sink_only",
        production_domain_commands: false,
        production_operational_messages: false,
        external_notifications: false,
        connector_calls: false,
        production_evidence_writes: false,
        production_authority_lookups: false,
        scenario_event_sink: true,
        scenario_message_sink: true,
        scenario_artifact_sink: true,
      },
    }, {
      mode: "simulation",
      institution_id: ids.school,
      namespace_id: namespace,
      scenario_id: "11111111-1111-4111-8111-111111111111",
      run_id: "22222222-2222-4222-8222-222222222222",
      virtual_clock: { now: instant.toISOString(), time_zone: "Asia/Kolkata" },
      source_snapshot_at: "2026-10-18T00:00:00.000Z",
      expires_at: "2026-10-20T00:00:00.000Z",
    });

    expect(result.context.environment).toEqual({
      kind: "simulation",
      namespace_id: namespace,
      virtual_now: instant.toISOString(),
      expires_at: "2026-10-20T00:00:00.000Z",
    });
    expect(result.areas.find((area) => area.key === "calendar")).toMatchObject({
      href: "/areas/calendar", capabilities: ["schedule.manage"],
      scopes: result.areas.find((area) => area.key === "timetable")!.scopes,
      surfaces: [expect.objectContaining({ key: "manage", href: "/areas/calendar?surface=manage" })],
    });
    expect(harness.repository.load).toHaveBeenCalledWith(expect.objectContaining({
      execution_environment: expect.objectContaining({ kind: "simulation", namespace_id: namespace }),
    }));
    expect(result.more.groups.find((group) => group.key === "oversight")?.items).toContainEqual(expect.objectContaining({
      key: "simulation",
      href: "/more/simulation",
    }));
    expect(result.more.groups.find((group) => group.key === "connections")?.items).toEqual([
      expect.objectContaining({
        key: "connections",
        label: "Contained connections",
        href: "/more/connections",
        description: expect.stringMatching(/run-local previews.*nothing is delivered to Live providers/i),
      }),
    ]);
  });

  it("does not grant contained Connections to a simulated member without an authorized connection scope", async () => {
    const result = await service({
      ...base,
      membership_roles: ["staff"],
      assignments: [],
      relationships: [],
    }).instance.manifest({ ...user, role: "staff" }, null, {
      mode: "simulation",
      institution_id: ids.school,
      namespace_id: "scenario:11111111-1111-4111-8111-111111111111:run:22222222-2222-4222-8222-222222222222",
      scenario_id: "11111111-1111-4111-8111-111111111111",
      run_id: "22222222-2222-4222-8222-222222222222",
      virtual_clock: { now: instant.toISOString(), time_zone: "Asia/Kolkata" },
      source_snapshot_at: "2026-10-18T00:00:00.000Z",
      expires_at: "2026-10-20T00:00:00.000Z",
    });

    expect(result.more.groups.some((group) => group.key === "connections")).toBe(false);
    expect(result.areas.some((area) => area.key === "timetable")).toBe(false);
    expect(result.areas.find(area => area.key === 'calendar')?.capabilities).toEqual(['campus_dates.published']);
  });

  it("projects real operating-day occurrences into Today with exact responsibility actions", async () => {
    const temporal = { listOperatingDay: vi.fn().mockResolvedValue([
      {
        id: "occurrence-row-1", occurrence_id: "occurrence-1", occurrence_date: "2026-10-19",
        period_number: 1, class_entity_id: "class-entity", class_domain_id: ids.scope,
        class_label: "Class 6A", period_domain_id: "period-1", subject_entity_id: "subject-entity",
        subject_label: "Mathematics", space_entity_id: "space-entity", space_label: "Classroom 201",
        responsible_agent_id: ids.agent, responsible_agent_label: "Campus Operator", title: "Mathematics",
        slot_type: "class", starts_at: "2026-10-19T03:30:00.000Z", ends_at: "2026-10-19T04:15:00.000Z",
        source_domain: "timetable", source_record_id: "slot-1", source_revision: 2, change_kind: "published",
      },
      {
        id: "occurrence-row-2", occurrence_id: "occurrence-2", occurrence_date: "2026-10-19",
        period_number: 2, class_entity_id: "class-entity", class_domain_id: ids.scope,
        class_label: "Class 6A", period_domain_id: "period-2", subject_entity_id: "subject-entity-2",
        subject_label: "Science", space_entity_id: "space-entity", space_label: "Laboratory 1",
        responsible_agent_id: ids.agent, responsible_agent_label: "Campus Operator", title: "Science",
        slot_type: "class", starts_at: "2026-10-19T04:20:00.000Z", ends_at: "2026-10-19T05:05:00.000Z",
        source_domain: "day_plan", source_record_id: "plan-1", source_revision: 3, change_kind: "overridden",
      },
    ]) };
    const snapshot: WorkspaceRepositorySnapshot = {
      ...base,
      membership_roles: ["staff"],
      assignments: [{
        id: ids.responsibility,
        owner_agent_id: ids.agent,
        capability_key: "attendance",
        action_key: "attendance.record",
        scope: { kind: "class", id: ids.scope, label: "Class 6A" },
        effective_from: "2026-10-01T00:00:00.000Z",
        effective_until: null,
        effective_schedule: null,
        authority_source_kind: "appointment",
        authority_source_ref: "class-assignment:6a",
        fallback_agent_id: null,
        source_domain: "academic_structure",
        source_record_id: "class-assignment:6a",
        source_revision: 1,
        revision: 1,
        projection_source: "canonical",
      }],
    };
    const result = await service(snapshot, { temporal }).instance.manifest({ ...user, role: "staff" }, null, {
      mode: "live", institution_id: ids.school, namespace_id: `live:${ids.school}`,
    });

    expect(temporal.listOperatingDay).toHaveBeenCalledWith({
      school_id: ids.school,
      date: "2026-10-19",
      recorded_as_of: instant.toISOString(),
    });
    expect(result.today.now).toEqual([expect.objectContaining({
      title: "Mathematics · Class 6A",
      status_label: "Now",
      starts_at: "2026-10-19T03:30:00.000Z", ends_at: "2026-10-19T04:15:00.000Z", local_date: "2026-10-19",
      href: `/areas/attendance/registers?date=2026-10-19&class_section_id=${ids.scope}`,
      source_label: "Published timetable",
    })]);
    expect(result.today.next).toEqual([expect.objectContaining({
      title: "Science · Class 6A",
      status_label: "Next",
      starts_at: "2026-10-19T04:20:00.000Z", ends_at: "2026-10-19T05:05:00.000Z", local_date: "2026-10-19",
      source_label: "Published day plan",
    })]);
  });

  it("projects domain obligations through the selected Live or isolated Simulation context", async () => {
    const requests = { workspaceItems: vi.fn().mockResolvedValue([{
      id: "dependent:student:notice-response:1",
      kind: "notice_response",
      category: "communication",
      priority: "high",
      title: "Confirm the field trip",
      detail: "Choose a response for Aarav.",
      status_label: "Response needed",
      action_label: "Open update",
      href: `/areas/messages/updates/notice-1?scope=dependent&student_id=${ids.student}`,
      source_id: "notice-1",
      subject_label: "Aarav Sharma",
      occurs_at: "2026-10-19T03:30:00.000Z",
      due_at: "2026-10-19T05:00:00.000Z",
      created_at: "2026-10-19T03:30:00.000Z",
    }]) };
    const snapshot: WorkspaceRepositorySnapshot = {
      ...base,
      membership_roles: ["guardian"],
      acting_agent_id: null,
      owner_agent_ids: [],
      relationships: [{
        relationship: "dependent",
        student_id: ids.student,
        student_label: "Aarav Sharma",
        class_section_id: ids.scope,
        class_label: "Class 6A",
        enrollment_revision: 1,
      }],
    };
    const live = await service(snapshot, { requests }).instance.manifest({ ...user, role: "parent" }, null, {
      mode: "live", institution_id: ids.school, namespace_id: `live:${ids.school}`,
    });
    expect(requests.workspaceItems).toHaveBeenCalledWith(expect.objectContaining({ id: ids.user }), expect.objectContaining({
      membership_roles: ["guardian"],
      relationships: [expect.objectContaining({ relationship: "dependent", student_id: ids.student })],
    }));
    expect(live.work.items).toEqual([expect.objectContaining({
      kind: "request",
      title: "Confirm the field trip",
      href: `/areas/messages/updates/notice-1?scope=dependent&student_id=${ids.student}`,
    })]);

    requests.workspaceItems.mockClear();
    const simulationNamespace = "scenario:11111111-1111-4111-8111-111111111111:run:22222222-2222-4222-8222-222222222222" as const;
    const simulated = await service({ ...snapshot, environment_namespace_id: simulationNamespace }, { requests }).instance.manifest(
      { ...user, role: "parent" },
      null,
      {
        mode: "simulation",
        institution_id: ids.school,
        namespace_id: simulationNamespace,
        scenario_id: "11111111-1111-4111-8111-111111111111",
        run_id: "22222222-2222-4222-8222-222222222222",
        virtual_clock: { now: instant.toISOString(), time_zone: "Asia/Kolkata" },
        source_snapshot_at: instant.toISOString(),
        expires_at: "2026-10-20T00:00:00.000Z",
      },
    );
    expect(requests.workspaceItems).toHaveBeenCalledWith(expect.objectContaining({ id: ids.user }), expect.objectContaining({
      environment_namespace_id: simulationNamespace,
      recorded_at: instant.toISOString(),
    }));
    expect(simulated.work.items).toEqual([expect.objectContaining({ title: "Confirm the field trip" })]);
  });
});

describe("bounded Today schedule ordering", () => {
  it("sorts source instants across offsets, dates and years without interpreting labels or changing records", () => {
    const overnight: WorkspaceRecord = { id: "overnight", title: "Residence coordination", starts_at: "2026-12-31T22:00:00+05:30",
      ends_at: "2027-01-01T06:00:00+05:30", local_date: "2026-12-31", time_label: "Thu, Dec 31, 2026, 10:00 PM",
      href: "/areas/timetable/schedule?date=2026-12-31" };
    const earlier = { ...overnight, id: "earlier", starts_at: "2026-12-31T16:00:00Z" };
    const later = { ...overnight, id: "later", starts_at: "2027-01-01T00:00:00Z" };
    const input = [later, overnight, earlier];
    expect(upcomingWorkspaceRecords(input)).toEqual([earlier, overnight, later]);
    expect(input).toEqual([later, overnight, earlier]);
    expect(upcomingWorkspaceRecords(input)[1]).toBe(overnight);
  });

  it("keeps source time warnings first and normal untimed context in source order without guessing instants", () => {
    const dated: WorkspaceRecord = { id: "dated", title: "Lunch", starts_at: "2026-10-26T06:30:00Z" };
    const legacy: WorkspaceRecord = { id: "legacy", title: "Main gate", time_label: "Mon · 08:00" };
    const unresolved: WorkspaceRecord = { id: "unresolved", title: "Dining time needs review", local_date: "2026-10-25", tone: "attention" };
    const malformed: WorkspaceRecord = { id: "malformed", title: "Scheduled activity", starts_at: "Not an instant", time_label: "2026-10-24T06:30:00Z" };
    expect(upcomingWorkspaceRecords([dated, legacy, unresolved, malformed])).toEqual([unresolved, dated, legacy, malformed]);
    expect(legacy).not.toHaveProperty("starts_at");
    expect(unresolved).not.toHaveProperty("starts_at");
  });

  it("does not let five neutral untimed duties hide a nearer dated meal, while retaining every source record", () => {
    const duties = Array.from({ length: 5 }, (_, index): WorkspaceRecord => Object.freeze({
      id: `duty-${index}`, title: "Residence coordination", time_label: "Mon · 14:00", tone: "neutral",
    }));
    const meal: WorkspaceRecord = Object.freeze({ id: "meal", title: "Lunch", starts_at: "2026-10-26T06:30:00Z" });
    const warning: WorkspaceRecord = Object.freeze({ id: "warning", title: "Published hours need review", tone: "critical" });
    const input = Object.freeze([...duties, meal, warning]);
    const result = upcomingWorkspaceRecords(input);
    expect(result).toEqual([warning, meal, ...duties]);
    expect(result.slice(0, 5).map(item => item.id)).toEqual(["warning", "meal", "duty-0", "duty-1", "duty-2"]);
    expect(result.map(item => item.id).sort()).toEqual(input.map(item => item.id).sort());
    expect(input).toEqual([...duties, meal, warning]);
    expect(result.every(item => input.includes(item))).toBe(true);
  });

  it("breaks simultaneous-source ties by stable identity and retains distinct same-title occurrences", () => {
    const record = (id: string): WorkspaceRecord => ({ id, title: "Residence coordination", starts_at: "2026-10-26T08:30:00Z" });
    const a = record("a"), b = record("b"), c = record("c");
    expect(upcomingWorkspaceRecords([c, a, b])).toEqual([a, b, c]);
    expect(upcomingWorkspaceRecords([b, c, a])).toEqual([a, b, c]);
  });
});

describe("workspace boundary contracts", () => {
  it("accepts only a valid effective weekly schedule", () => {
    expect(effectiveScheduleSchema.safeParse({
      time_zone: "Asia/Kolkata",
      weekly_windows: [{ days: [1, 2], starts_at: "09:00", ends_at: "10:00" }],
    }).success).toBe(true);
    expect(effectiveScheduleSchema.safeParse({
      time_zone: "not/a-zone",
      weekly_windows: [{ days: [0], starts_at: "10:00", ends_at: "09:00" }],
    }).success).toBe(false);
  });

  it("never echoes a persona-prefixed action path from an operational message", () => {
    const href = workHref({
      id: ids.message,
      reaction_kind: "assessment_invigilation_offer",
      payload: { assessment_id: ids.scope, action_path: "/teacher/assessments?unsafe=true" },
    });
    expect(href).toBe(`/areas/assessments/assigned?assessment=${ids.scope}&focus=invigilation`);
    expect(href).not.toContain("teacher");
  });

  it("uses the canonical Staff work and Departure namespaces for coordinated work", () => {
    expect(workHref({
      id: ids.message,
      reaction_kind: "coverage_offer",
      payload: { coverage_task_id: ids.scope, source_revision: 2 },
    })).toBe(`/areas/responsibilities/coverage?coverage=${ids.scope}&coverage_revision=2`);
    expect(workHref({
      id: ids.message,
      reaction_kind: "transport_duty_offer",
      payload: { trip_id: ids.scope, duty_change_id: ids.message, source_revision: 3 },
    })).toBe(`/areas/departure/operate/${ids.scope}?swap=${ids.message}&swap_revision=3`);
  });
});
