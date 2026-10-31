import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createInvalidationBatcher,
  FULL_SYNC_INVALIDATIONS,
  resolveSchoolEvent,
  schoolEventMatchesScope,
  SCHOOL_EVENT_TYPES,
  type SchoolEventType,
} from "./schoolEventProtocol";

function eventData(type: string, payload: Record<string, unknown>) {
  return JSON.stringify({
    id: "event-1",
    type,
    created_at: "2026-09-12T06:00:00.000Z",
    payload,
  });
}

afterEach(() => vi.useRealTimers());

describe("school event protocol", () => {
  it("retains server campus/namespace metadata and rejects foreign or missing selected scope", () => {
    const envelope = { ...JSON.parse(eventData("chat.updated", { refresh: ["messages"] })) as Record<string, unknown>,
      school_id: "campus-a", namespace_id: "live:campus-a" };
    const resolved = resolveSchoolEvent(JSON.stringify(envelope), "chat.updated", "member").envelope!;
    expect(resolved).toMatchObject({ school_id: "campus-a", namespace_id: "live:campus-a" });
    expect(schoolEventMatchesScope(resolved, { institutionId: "campus-a", namespaceId: "live:campus-a" })).toBe(true);
    expect(schoolEventMatchesScope(resolved, { institutionId: "campus-b", namespaceId: "live:campus-a" })).toBe(false);
    expect(schoolEventMatchesScope(resolved, { institutionId: "campus-a", namespaceId: "scenario:a:run:one" })).toBe(false);
    expect(schoolEventMatchesScope({ ...resolved, school_id: undefined }, { institutionId: "campus-a" })).toBe(false);
    expect(schoolEventMatchesScope({ ...resolved, namespace_id: undefined }, { namespaceId: "live:campus-a" })).toBe(false);
    expect(resolveSchoolEvent(JSON.stringify({ ...envelope, school_id: 1 }), "chat.updated").envelope).toBeNull();
    expect(resolveSchoolEvent(JSON.stringify({ ...envelope, namespace_id: [] }), "chat.updated").envelope).toBeNull();
  });
  it("refreshes a private shared visit and Work only within its selected world", async () => {
    const client = new QueryClient(), prefix = ["execution-environment", "simulation", "simulation:campus:guest-a", "guest-a"];
    const selected = [...prefix, "gate-visits", "school", "guest", "shared"];
    const sibling = ["execution-environment", "simulation", "simulation:campus:guest-b", "guest-b", "gate-visits", "school", "guest", "shared"];
    const live = ["execution-environment", "live", "gate-visits", "school", "guest", "shared"];
    for (const key of [selected, sibling, live]) client.setQueryData(key, { question: null });
    const result = resolveSchoolEvent(eventData("gate.visit_shared.updated", { visit_id: "visit", action: "replied", revision: 2,
      refresh: ["gate-visits", "workspace", "attention"] }), "gate.visit_shared.updated", "guest");
    expect(result.usedFallback).toBe(false);
    expect(result.invalidations).toContainEqual({ queryKey: ["gate-visits"], environmentScoped: true });
    expect(result.invalidations).not.toContainEqual({ queryKey: ["gate-approvals"] });
    const batcher = createInvalidationBatcher(client, 75, prefix); batcher.enqueue(result.invalidations); await batcher.flush();
    expect(client.getQueryState(selected)?.isInvalidated).toBe(true);
    expect(client.getQueryState(sibling)?.isInvalidated).toBe(false);
    expect(client.getQueryState(live)?.isInvalidated).toBe(false);
  });
  it("refreshes public asset signals in only the selected world without opening private Repairs", async () => {
    const client = new QueryClient(), prefix = ["execution-environment", "simulation", "simulation:campus:assets-a", "assets-a"];
    const selected = [...prefix, "campus-view", "operations", "school", "member"];
    const sibling = ["execution-environment", "simulation", "simulation:campus:assets-b", "assets-b", "campus-view", "operations", "school", "member"];
    const live = ["execution-environment", "live", "campus-view", "operations", "school", "member"];
    for (const key of [selected, sibling, live]) client.setQueryData(key, { assets: [] });
    const result = resolveSchoolEvent(eventData("campus_assets.updated", { campus_id: "campus", holding_id: "lamp", revision: 3, refresh: ["campus-assets"] }), "campus_assets.updated", "member");
    expect(result.usedFallback).toBe(false);
    expect(result.invalidations).toContainEqual({ queryKey: ["campus-view"], environmentScoped: true });
    expect(result.invalidations).not.toContainEqual({ queryKey: ["facilities"], environmentScoped: true });
    const batcher = createInvalidationBatcher(client, 75, prefix); batcher.enqueue(result.invalidations); await batcher.flush();
    expect(client.getQueryState(selected)?.isInvalidated).toBe(true);
    expect(client.getQueryState(sibling)?.isInvalidated).toBe(false);
    expect(client.getQueryState(live)?.isInvalidated).toBe(false);
  });
  it("refreshes arranged visits only in the selected world without inventing approval or attention work", async () => {
    const client = new QueryClient(), prefix = ["execution-environment", "simulation", "simulation:campus:visits-a", "visits-a"];
    const selected = [...prefix, "gate-visits", "school", "coordinator"];
    const sibling = ["execution-environment", "simulation", "simulation:campus:visits-b", "visits-b", "gate-visits", "school", "coordinator"];
    const live = ["execution-environment", "live", "gate-visits", "school", "coordinator"];
    for (const key of [selected, sibling, live]) client.setQueryData(key, { items: [] });
    const result = resolveSchoolEvent(eventData("gate.visit_arrangement.updated", { source_id: "visit", revision: 2, refresh: ["gate-visits"] }), "gate.visit_arrangement.updated", "coordinator");
    expect(result.usedFallback).toBe(false);
    expect(result.invalidations).toContainEqual({ queryKey: ["gate-visits"], environmentScoped: true });
    expect(result.invalidations).not.toContainEqual({ queryKey: ["gate-approvals"] });
    const batcher = createInvalidationBatcher(client, 75, prefix); batcher.enqueue(result.invalidations); await batcher.flush();
    expect(client.getQueryState(selected)?.isInvalidated).toBe(true);
    expect(client.getQueryState(sibling)?.isInvalidated).toBe(false);
    expect(client.getQueryState(live)?.isInvalidated).toBe(false);
    expect(FULL_SYNC_INVALIDATIONS).toContainEqual({ queryKey: ["gate-visits"], environmentScoped: true });
  });
  it("refreshes published campus scenes only in the selected execution world", async () => {
    const client = new QueryClient(), prefix = ["execution-environment", "simulation", "simulation:campus:scene-a", "scene-a"];
    const selected = [...prefix, "campus-scenes", "simulation:campus:scene-a", "school", "campus", "published"];
    const sibling = ["execution-environment", "simulation", "simulation:campus:scene-b", "scene-b", "campus-scenes", "simulation:campus:scene-b", "school", "campus", "published"];
    const live = ["execution-environment", "live", "campus-scenes", "live:school", "school", "campus", "published"];
    for (const key of [selected, sibling, live]) client.setQueryData(key, { scene: null });
    const result = resolveSchoolEvent(eventData("campus_scenes.updated", { refresh: ["campus-scenes", "campus-view"] }), "campus_scenes.updated", "member");
    expect(result.usedFallback).toBe(false);
    expect(result.invalidations).toContainEqual({ queryKey: ["campus-scenes"], environmentScoped: true });
    const batcher = createInvalidationBatcher(client, 75, prefix); batcher.enqueue(result.invalidations); await batcher.flush();
    expect(client.getQueryState(selected)?.isInvalidated).toBe(true);
    expect(client.getQueryState(sibling)?.isInvalidated).toBe(false);
    expect(client.getQueryState(live)?.isInvalidated).toBe(false);
    expect(FULL_SYNC_INVALIDATIONS).toContainEqual({ queryKey: ["campus-scenes"], environmentScoped: true });
  });
  it("refreshes published Dining Calendar in only the selected world even with narrow producer hints", async () => {
    const client = new QueryClient(), prefix = ["execution-environment", "simulation", "simulation:campus:dining-a", "dining-a"];
    const selected = [...prefix, "calendar", "dining", "school", "actor", "2026-10-25", 1];
    const sibling = ["execution-environment", "simulation", "simulation:campus:dining-b", "dining-b", "calendar", "dining", "school", "actor", "2026-10-25", 1];
    const live = ["execution-environment", "live", "calendar", "dining", "school", "actor", "2026-10-25", 1];
    for (const key of [selected, sibling, live]) client.setQueryData(key, { items: [] });
    const result = resolveSchoolEvent(eventData("dining.updated", { refresh: ["dining"] }), "dining.updated", "actor");
    expect(result.invalidations).toContainEqual({ queryKey: ["calendar"], environmentScoped: true });
    const batcher = createInvalidationBatcher(client, 75, prefix); batcher.enqueue(result.invalidations); await batcher.flush();
    expect(client.getQueryState(selected)?.isInvalidated).toBe(true);
    expect(client.getQueryState(sibling)?.isInvalidated).toBe(false);
    expect(client.getQueryState(live)?.isInvalidated).toBe(false);
    expect(FULL_SYNC_INVALIDATIONS).toContainEqual({ queryKey: ["calendar"], environmentScoped: true });
  });
  it("refreshes Accommodation and custody-dependent settlement only in the selected world", async () => {
    const client = new QueryClient(), prefix = ["execution-environment", "simulation", "simulation:campus:stays-a", "stays-a"];
    const selected = [...prefix, "accommodation", "school", "warden"], sibling = ["execution-environment", "simulation", "simulation:campus:stays-b", "stays-b", "accommodation", "school", "warden"], live = ["execution-environment", "live", "accommodation", "school", "warden"];
    for (const key of [selected, sibling, live]) client.setQueryData(key, { stays: [] });
    const result = resolveSchoolEvent(eventData("accommodation.updated", { source_id: "stay-1", revision: 2, refresh: ["accommodation"] }), "accommodation.updated", "warden");
    expect(result.usedFallback).toBe(false);
    expect(result.invalidations).toEqual(expect.arrayContaining([{ queryKey: ["accommodation"], environmentScoped: true }, { queryKey: ["responsibility-workspace"] }, { queryKey: ["attention"] }]));
    const batcher = createInvalidationBatcher(client, 75, prefix); batcher.enqueue(result.invalidations); await batcher.flush();
    expect(client.getQueryState(selected)?.isInvalidated).toBe(true); expect(client.getQueryState(sibling)?.isInvalidated).toBe(false); expect(client.getQueryState(live)?.isInvalidated).toBe(false);
    expect(FULL_SYNC_INVALIDATIONS).toContainEqual({ queryKey: ["accommodation"], environmentScoped: true });
    expect(resolveSchoolEvent(eventData("resources.updated", { refresh: ["resources"] }), "resources.updated", "warden").invalidations).toContainEqual({ queryKey: ["accommodation"], environmentScoped: true });
  });
  it("refreshes exact Repairs projections only within the selected execution world", async () => {
    const client = new QueryClient(), prefix = ["execution-environment", "simulation", "simulation:campus:repairs-a", "repairs-a"];
    const selected = [...prefix, "facilities", "school", "handler"], sibling = ["execution-environment", "simulation", "simulation:campus:repairs-b", "repairs-b", "facilities", "school", "handler"], live = ["execution-environment", "live", "facilities", "school", "handler"];
    for (const key of [selected, sibling, live]) client.setQueryData(key, { repairs: [] });
    const result = resolveSchoolEvent(eventData("facilities.updated", { repair_id: "repair-1", revision: 2, refresh: ["facilities"] }), "facilities.updated", "handler");
    expect(result.usedFallback).toBe(false);
    expect(result.invalidations).toEqual(expect.arrayContaining([{ queryKey: ["facilities"], environmentScoped: true }, { queryKey: ["responsibility-workspace"] }, { queryKey: ["attention"] }]));
    const batcher = createInvalidationBatcher(client, 75, prefix); batcher.enqueue(result.invalidations); await batcher.flush();
    expect(client.getQueryState(selected)?.isInvalidated).toBe(true); expect(client.getQueryState(sibling)?.isInvalidated).toBe(false); expect(client.getQueryState(live)?.isInvalidated).toBe(false);
    expect(FULL_SYNC_INVALIDATIONS).toContainEqual({ queryKey: ["facilities"], environmentScoped: true });
  });
  it("refreshes borrowing and native Work only in the selected environment", async () => {
    const client = new QueryClient();
    const prefix = ["execution-environment", "simulation", "simulation:campus:resources-a", "resources-a"];
    const selected = [...prefix, "resources", "school", "custodian"];
    const sibling = ["execution-environment", "simulation", "simulation:campus:resources-b", "resources-b", "resources", "school", "custodian"];
    const live = ["execution-environment", "live", "resources", "school", "custodian"];
    for (const key of [selected, sibling, live]) client.setQueryData(key, { loans: [] });
    const result = resolveSchoolEvent(eventData("resources.updated", { refresh: ["resources"] }), "resources.updated", "custodian");
    expect(result.usedFallback).toBe(false);
    expect(result.invalidations).toEqual(expect.arrayContaining([
      { queryKey: ["resources"], environmentScoped: true },
      { queryKey: ["responsibility-workspace"] },
      { queryKey: ["attention"] },
    ]));
    const batcher = createInvalidationBatcher(client, 75, prefix);
    batcher.enqueue(result.invalidations);
    await batcher.flush();
    expect(client.getQueryState(selected)?.isInvalidated).toBe(true);
    expect(client.getQueryState(sibling)?.isInvalidated).toBe(false);
    expect(client.getQueryState(live)?.isInvalidated).toBe(false);
    expect(FULL_SYNC_INVALIDATIONS).toContainEqual({ queryKey: ["resources"], environmentScoped: true });
  });
  it("accepts shared participation and People hints without a fallback and refreshes their canonical surfaces", () => {
    const result = resolveSchoolEvent(eventData("attendance.participation.updated", { register_id: "register-1",
      refresh: ["attendance", "activities", "workspace", "today"] }), "attendance.participation.updated", "recorder-1");
    expect(SCHOOL_EVENT_TYPES).toContain("attendance.participation.updated");
    expect(result.usedFallback).toBe(false);
    expect(result.invalidations).toEqual(expect.arrayContaining([
      { queryKey: ["activities"], environmentScoped: true }, { queryKey: ["responsibility-workspace"] },
    ]));
    const people = resolveSchoolEvent(eventData("people.updated", { refresh: ["people.participants", "activities.catalogue"] }), "people.updated");
    expect(people.usedFallback).toBe(false);
    expect(people.invalidations).toContainEqual({ queryKey: ["people.participation-groups"], environmentScoped: true });
    expect(people.invalidations).toContainEqual({ queryKey: ["activities"], environmentScoped: true });
    expect(people.invalidations).toContainEqual({ queryKey: ["staff-operations"] });
  });

  it("binds common feature invalidation to the selected run rather than Live or another simulation", async () => {
    const client = new QueryClient(), invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue();
    const prefix = ["execution-environment", "simulation", "simulation:campus:run-a", "run-a"];
    const batcher = createInvalidationBatcher(client, 75, prefix);
    batcher.enqueue([{ queryKey: ["activities"], environmentScoped: true }, { queryKey: ["people.participants"], environmentScoped: true }]);
    await batcher.flush();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: [...prefix, "activities"], exact: undefined });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: [...prefix, "people.participants"], exact: undefined });
    expect(invalidate.mock.calls.every(([input]) => input?.queryKey?.[1] === "simulation")).toBe(true);
    expect(FULL_SYNC_INVALIDATIONS).toContainEqual({ queryKey: ["activities"], environmentScoped: true });
  });
  it("refreshes the qualified Live invitation list without invalidating another world's cache", async () => {
    const client = new QueryClient();
    const liveKey = ["execution-environment", "live", "invitations", "school"];
    const simulationKey = ["execution-environment", "simulation", "world", "run", "invitations", "school"];
    client.setQueryData(liveKey, { invitations: [] });
    client.setQueryData(simulationKey, { invitations: [] });
    const result = resolveSchoolEvent(eventData("people.updated", {}), "people.updated");
    const batcher = createInvalidationBatcher(client);
    batcher.enqueue(result.invalidations);
    await batcher.flush();
    expect(client.getQueryState(liveKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(simulationKey)?.isInvalidated).toBe(false);
    expect(FULL_SYNC_INVALIDATIONS).toContainEqual({ queryKey: ["invitations"], environmentScoped: true });
  });
  it.each(["campus_event.updated", "assessment.updated"])("refreshes the common calendar and queue from the authorized owning event %s", (type) => {
    const result = resolveSchoolEvent(eventData(type, { refresh: type === "campus_event.updated" ? ["campus-events"] : ["assessments"] }), type, "operator-1");
    expect(result.usedFallback).toBe(false);
    expect(result.invalidations).toEqual(expect.arrayContaining([
      { queryKey: ["activities"], environmentScoped: true },
      { queryKey: ["responsibility-workspace"] },
      { queryKey: ["attendance-model"] },
    ]));
  });
  it.each(['campus_dates.published', 'campus_dates.corrected', 'campus_dates.cancelled'])(
    'refreshes only the selected-world Calendar for a public-date invalidation %s', type => {
      const result = resolveSchoolEvent(eventData(type, { refresh: ['calendar'] }), type, 'operator-1');
      expect(result.usedFallback).toBe(false);
      expect(result.invalidations).toEqual(expect.arrayContaining([{ queryKey: ['calendar'], environmentScoped: true }]));
      expect(result.invalidations.some(item => ['notifications', 'attention', 'attendance-model', 'activities'].includes(String(item.queryKey[0])))).toBe(false);
      expect(SCHOOL_EVENT_TYPES).toContain(type);
    });
  it('refreshes gate desks and pending approval popups on visitor decisions',()=>{
    const resolution=resolveSchoolEvent(eventData('gate.visitor.updated',{refresh:['gate','notifications']}),'gate.visitor.updated','host');
    expect(resolution.usedFallback).toBe(false);
    expect(resolution.invalidations).toEqual(expect.arrayContaining([{queryKey:['gate']},{queryKey:['gate-admin']},{queryKey:['gate-approvals']},{queryKey:['notifications','host']}]));
  });
  it("subscribes to every current attention-producing custom event name", () => {
    expect(SCHOOL_EVENT_TYPES).toEqual(expect.arrayContaining([
      "staff.responsibility.offered",
      "staff.responsibility.active",
      "staff.responsibility.accepted",
      "staff.responsibility.declined",
      "staff.leave.submitted",
      "staff.leave.approved",
      "staff.leave.rejected",
      "staff.leave.withdrawn",
      "staff.coverage.offered",
      "staff.coverage.accepted",
      "staff.coverage.declined",
      "governance.policy.submitted",
      "governance.policy.published",
      "governance.policy.rejected",
      "governance.policy.acknowledged",
      "restricted_care.case.opened",
      "restricted_care.case.reassigned",
      "restricted_care.case.triage",
      "restricted_care.case.active",
      "restricted_care.case.closed",
      "restricted_care.case.entry_added",
      "restricted_care.reporting.assessed",
      "restricted_care.external_report.recorded",
      "assessment.updated",
      "academic_report.updated",
      "teacher_feedback.updated",
    ]));
  });

  it.each(["transport.updated","departure.updated"])("refreshes every departure view on %s without an unknown-event fallback",type=>{
    const result=resolveSchoolEvent(eventData(type,{refresh:["departure","parent.home","principal.home","teacher.home"]}),type,"guardian-1");
    expect(result.usedFallback).toBe(false);
    expect(result.invalidations).toContainEqual({queryKey:["departure"]});
    expect(FULL_SYNC_INVALIDATIONS).toContainEqual({queryKey:["departure"]});
  });
  it("refreshes enrollment and family lists on a people event", () => {
    const result=resolveSchoolEvent(eventData("people.updated",{student_id:"new-student",class_section_id:"class-7a"}),"people.updated","admin-1");
    expect(result.usedFallback).toBe(false);
    expect(result.invalidations).toEqual(expect.arrayContaining([
      {queryKey:["school","people"]},
      {queryKey:["school","parent"]},
      {queryKey:["school","accessible-students"]},
      {queryKey:["school","student","timetable"]},
      {queryKey:["gate-students"]},
      {queryKey:["office","fee-students"]},
      {queryKey:["campus-event-consent-authorities"]},
      {queryKey:["invitations"],environmentScoped:true},
      {queryKey:["notice-references"]},
      {queryKey:["calendar"]},
      {queryKey:["institution-activation"]},
      {queryKey:["teacher-attendance"]},
      {queryKey:["campus-view"],environmentScoped:true},
      {queryKey:["attention"]},
    ]));
  });
  it("maps allowlisted refresh hints to the affected student, parent, operations, and notification caches", () => {
    const result = resolveSchoolEvent(
      eventData("attendance.updated", {
        student_id: "student-1",
        class_section_id: "class-7a",
        date: "2026-09-12",
        refresh: [
          "student.home",
          "student.attendance",
          "student.eligibility",
          "parent.home",
          "parent.attendance",
          "teacher.attendance",
          "teacher.home",
          "principal.home",
          "principal.attendance",
          "principal.attendance-history",
          "notifications",
        ],
      }),
      "attendance.updated",
      "user-1",
    );

    expect(result.usedFallback).toBe(false);
    expect(result.invalidations).toEqual(expect.arrayContaining([
      { queryKey: ["school", "student", "attendance"] },
      { queryKey: ["school", "parent", "attendance", "student-1"] },
      { queryKey: ["school", "parent", "attendance", "default"] },
      { queryKey: ["teacher-attendance"] },
      { queryKey: ["principal-register"] },
      { queryKey: ["principal-register-history"] },
      { queryKey: ["attendance-model"] },
      { queryKey: ["attendance-continuity"] },
      { queryKey: ["campus-view"], environmentScoped: true },
      { queryKey: ["notifications", "user-1"] },
    ]));
  });

  it("maps the register lifecycle producer contract to teacher and principal register caches", () => {
    const result = resolveSchoolEvent(
      eventData("attendance.register.submitted", {
        class_section_id: "class-7a",
        session_id: "session-physics-7a",
        date: "2026-09-12",
        refresh: [
          "teacher.attendance",
          "teacher.home",
          "principal.home",
          "principal.attendance",
          "principal.attendance-history",
        ],
      }),
      "attendance.register.submitted",
      "principal-1",
    );

    expect(result.usedFallback).toBe(false);
    expect(result.invalidations).toEqual(expect.arrayContaining([
      { queryKey: ["teacher-attendance"] },
      { queryKey: ["teacher-home", "2026-09-12"] },
      { queryKey: ["principal-home", "2026-09-12"] },
      { queryKey: ["principal-register"] },
      { queryKey: ["principal-register-history"] },
      { queryKey: ["attendance-model"] },
      { queryKey: ["attendance-continuity"] },
      { queryKey: ["campus-view"], environmentScoped: true },
    ]));
  });

  it("maps an overdue register alert to the responsible operations views and notifications", () => {
    const result = resolveSchoolEvent(
      eventData("attendance.register.overdue", {
        class_section_id: "class-7a",
        date: "2026-09-12",
        refresh: ["teacher.home", "teacher.attendance", "principal.home", "principal.attendance", "notifications"],
      }),
      "attendance.register.overdue",
      "teacher-1",
    );

    expect(result.usedFallback).toBe(false);
    expect(result.invalidations).toEqual(expect.arrayContaining([
      { queryKey: ["teacher-home", "2026-09-12"] },
      { queryKey: ["teacher-attendance"] },
      { queryKey: ["principal-home", "2026-09-12"] },
      { queryKey: ["principal-register"] },
      { queryKey: ["attendance-model"] },
      { queryKey: ["attendance-continuity"] },
      { queryKey: ["campus-view"], environmentScoped: true },
      { queryKey: ["notifications", "teacher-1"] },
    ]));
  });

  it("uses event defaults when a valid envelope omits refresh hints", () => {
    const access=resolveSchoolEvent(eventData("staff.access.updated",{}),"staff.access.updated","teacher-1");
    expect(access.usedFallback).toBe(false);
    expect(access.invalidations).toContainEqual({queryKey:["staff-operations"]});
    const leave = resolveSchoolEvent(eventData("leave.updated", { student_id: "student-1" }), "leave.updated", "guardian-1");
    expect(leave.usedFallback).toBe(false);
    expect(leave.invalidations).toEqual(expect.arrayContaining([
      { queryKey: ["school", "student", "leave"] },
      { queryKey: ["school", "student", "leave-status"] },
      { queryKey: ["school", "parent", "leave"] },
      { queryKey: ["school", "principal", "student-leave"] },
      { queryKey: ["analytics"] },
      { queryKey: ["notifications", "guardian-1"] },
    ]));
  });

  it.each<Array<[SchoolEventType, string]>>([
    ["staff.leave.submitted", "staff-operations"],
    ["governance.policy.published", "governance"],
    ["restricted_care.case.opened", "restricted-care"],
    ["assessment.updated", "assessments"],
    ["academic_report.updated", "academic-reports"],
    ["teacher_feedback.updated", "teacher-feedback"],
    ["InstitutionActivated", "institution-activation"],
  ])("accepts the %s producer contract and refreshes its canonical domain", (type, domainRoot) => {
    const result = resolveSchoolEvent(eventData(type, {}), type, "user-1");

    expect(result.usedFallback).toBe(false);
    expect(result.invalidations).toEqual(expect.arrayContaining([
      { queryKey: [domainRoot] },
      { queryKey: ["requests"] },
      { queryKey: ["attention"] },
    ]));
  });

  it("accepts the staff leave producer's legacy refresh aliases without falling back", () => {
    const result = resolveSchoolEvent(eventData("staff.leave.approved", {
      refresh: ["principal.staff", "teacher.leave", "principal.timetable"],
    }), "staff.leave.approved", "user-1");

    expect(result.usedFallback).toBe(false);
    expect(result.invalidations).toEqual([
      { queryKey: ["staff-operations"] },
      { queryKey: ["principal-timetable"] },
      { queryKey: ["requests"] },
      { queryKey: ["attention"] },
    ]);
  });

  it("removes completed diary actions from linked family home caches", () => {
    const result = resolveSchoolEvent(
      eventData("diary.updated", { student_id: "student-1" }),
      "diary.updated",
      "guardian-1",
    );
    expect(result.usedFallback).toBe(false);
    expect(result.invalidations).toEqual([
      { queryKey: ["school", "student", "home"] },
      { queryKey: ["school", "student", "diary"] },
      { queryKey: ["school", "parent", "home", "student-1"] },
      { queryKey: ["school", "parent", "home", "default"] },
      { queryKey: ["school", "parent", "diary", "student-1"] },
      { queryKey: ["school", "parent", "diary", "default"] },
      { queryKey: ["learning-assignments"], environmentScoped: true },
      { queryKey: ["teaching-sessions"], environmentScoped: true },
      { queryKey: ["responsibility-workspace"] },
      { queryKey: ["requests"] },
      { queryKey: ["attention"] },
    ]);
  });

  it("refreshes the selected family Home fee projection after every ledger change", () => {
    const result = resolveSchoolEvent(
      eventData("fees.updated", {
        student_id: "student-1",
        refresh: ["fees"],
      }),
      "fees.updated",
      "guardian-1",
    );

    expect(result.usedFallback).toBe(false);
    expect(result.invalidations).toEqual(expect.arrayContaining([
      { queryKey: ["office", "fees"], environmentScoped: true },
      { queryKey: ["office", "fee-gateway-review"], environmentScoped: true },
      { queryKey: ["school", "parent", "home", "student-1"] },
      { queryKey: ["school", "parent", "home", "default"] },
      { queryKey: ["principal-home"] },
      { queryKey: ["principal-insights"] },
      { queryKey: ["finance-arrangements"], environmentScoped: true },
      { queryKey: ["responsibility-workspace"] },
    ]));
  });

  it("refreshes the administration catalog and dependent timetable after a catalog edit", () => {
    const result = resolveSchoolEvent(
      eventData("administration.updated", { refresh: ["principal.administration", "principal.timetable"] }),
      "administration.updated",
      "principal-1",
    );
    expect(result.usedFallback).toBe(false);
    expect(result.invalidations).toEqual(expect.arrayContaining([
      { queryKey: ["office", "administration"] },
      { queryKey: ["institution-setup"] },
      { queryKey: ["invitations"], environmentScoped: true },
      { queryKey: ["operating-rules"] },
      { queryKey: ["workflow-rules"] },
      { queryKey: ["chat", "policy"] },
      { queryKey: ["principal-timetable"] },
      { queryKey: ["calendar"] },
      { queryKey: ["institution-activation"] },
      { queryKey: ["campus-view"], environmentScoped: true },
      { queryKey: ["analytics"] },
      { queryKey: ["requests"] },
      { queryKey: ["attention"] },
    ]));
  });

  it("refreshes live campus setup without falling back on its named outbox event", () => {
    const result = resolveSchoolEvent(
      eventData("institution.setup.updated", {
        refresh: ["principal.administration"],
      }),
      "institution.setup.updated",
      "admin-1",
    );

    expect(result.usedFallback).toBe(false);
    expect(result.invalidations).toEqual(expect.arrayContaining([
      { queryKey: ["office", "administration"] },
      { queryKey: ["institution-setup"] },
      { queryKey: ["operating-rules"] },
      { queryKey: ["campus-view"], environmentScoped: true },
      { queryKey: ["requests"] },
      { queryKey: ["attention"] },
    ]));
  });

  it("refreshes role timetable summaries together with their detailed timetable", () => {
    const result = resolveSchoolEvent(
      eventData("timetable.updated", { student_id: "student-1" }),
      "timetable.updated",
      "guardian-1",
    );

    expect(result.usedFallback).toBe(false);
    expect(result.invalidations).toEqual(expect.arrayContaining([
      { queryKey: ["school", "student", "timetable"] },
      { queryKey: ["school", "student", "timetable-summary"] },
      { queryKey: ["school", "parent", "timetable", "student-1"] },
      { queryKey: ["school", "parent", "timetable-summary", "student-1"] },
      { queryKey: ["school", "parent", "timetable-summary", "default"] },
      { queryKey: ["calendar"] },
      { queryKey: ["institution-activation"] },
      { queryKey: ["campus-view"], environmentScoped: true },
    ]));
  });

  it("keeps date-scoped teacher Home refreshes while also refreshing its timetable projection", () => {
    const result = resolveSchoolEvent(
      eventData("timetable.updated", { date: "2026-09-12", refresh: ["teacher.home"] }),
      "timetable.updated",
      "teacher-1",
    );

    expect(result.invalidations).toEqual(expect.arrayContaining([
      { queryKey: ["teacher-home", "2026-09-12"] },
      { queryKey: ["teacher-home", "timetable"] },
      { queryKey: ["calendar"] },
    ]));
  });

  it("refreshes schedule and class-update projections after a day-plan change", () => {
    const result = resolveSchoolEvent(
      eventData("day_plan.updated", { date: "2026-09-12", refresh: ["day-plans", "teacher.home"] }),
      "day_plan.updated",
      "teacher-1",
    );

    expect(result.invalidations).toEqual(expect.arrayContaining([
      { queryKey: ["school", "day-plans"] },
      { queryKey: ["teacher-class-updates"] },
      { queryKey: ["teacher-home", "timetable"] },
      { queryKey: ["calendar"] },
      { queryKey: ["analytics"] },
    ]));
  });

  it.each([
    "not json",
    eventData("attendance.updated", { refresh: ["untrusted.cache"] }),
    eventData("leave.updated", { student_id: 12 }),
  ])("falls back to a safe full sync for malformed or untrusted data", (data) => {
    const result = resolveSchoolEvent(data, "attendance.updated", "user-1");
    expect(result.usedFallback).toBe(true);
    expect(result.invalidations).toEqual(FULL_SYNC_INVALIDATIONS);
    expect(result.invalidations).toEqual(expect.arrayContaining([
      { queryKey: ["principal-register-history"] },
      { queryKey: ["attendance-model"] },
      { queryKey: ["attendance-continuity"] },
      { queryKey: ["campus-view"], environmentScoped: true },
      { queryKey: ["campus-events"] },
      { queryKey: ["campus-event"] },
      { queryKey: ["campus-event-register"] },
      { queryKey: ["campus-event-finance"] },
      { queryKey: ["campus-event-consent-authorities"] },
      { queryKey: ["institution-setup"] },
      { queryKey: ["operating-rules"] },
      { queryKey: ["teacher-class-updates"] },
    ]));
  });

  it("coalesces repeated invalidations into one 75ms batch", async () => {
    vi.useFakeTimers();
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
    const batcher = createInvalidationBatcher(queryClient, 75);

    batcher.enqueue([{ queryKey: ["school", "student", "attendance"] }]);
    batcher.enqueue([
      { queryKey: ["school", "student", "attendance"] },
      { queryKey: ["notifications", "user-1"] },
    ]);

    await vi.advanceTimersByTimeAsync(74);
    expect(invalidate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["school", "student", "attendance"], exact: undefined });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["notifications", "user-1"], exact: undefined });
  });
  it("refreshes the follow-up inbox without refreshing unrelated school screens", () => {
    const result = resolveSchoolEvent(eventData("coordination.updated", { student_id: "student-1", refresh: ["coordination"] }), "coordination.updated", "guardian-1");
    expect(result.usedFallback).toBe(false);
    expect(result.invalidations).toEqual([
      { queryKey: ["school", "coordination"] },
      { queryKey: ["requests"] },
      { queryKey: ["attention"] },
    ]);
  });

  it("refreshes event lists, details, registers and notifications for campus event updates", () => {
    const result = resolveSchoolEvent(
      eventData("campus_event.updated", { student_id: "student-1" }),
      "campus_event.updated",
      "guardian-1",
    );

    expect(result.usedFallback).toBe(false);
    expect(result.invalidations).toEqual(expect.arrayContaining([
      { queryKey: ["campus-events"] },
      { queryKey: ["campus-event"] },
      { queryKey: ["campus-event-register"] },
      { queryKey: ["campus-event-finance"] },
      { queryKey: ["campus-event-consent-authorities"] },
      { queryKey: ["school", "student", "home"] },
      { queryKey: ["school", "parent", "home", "student-1"] },
      { queryKey: ["school", "parent", "home", "default"] },
      { queryKey: ["teacher-home"] },
      { queryKey: ["principal-home"] },
      { queryKey: ["principal-insights"] },
      { queryKey: ["notifications", "guardian-1"] },
      { queryKey: ["calendar"] },
      { queryKey: ["campus-view"], environmentScoped: true },
      { queryKey: ["requests"] },
      { queryKey: ["attention"] },
    ]));
  });

  it("refreshes the exact notice, Requests, bell and shared attention projection", () => {
    const result = resolveSchoolEvent(
      eventData("notice.updated", {
        student_id: "student-1",
        refresh: ["notices", "requests", "notifications", "parent.home"],
      }),
      "notice.updated",
      "guardian-1",
    );

    expect(result.usedFallback).toBe(false);
    expect(result.invalidations).toEqual(expect.arrayContaining([
      { queryKey: ["notices"] },
      { queryKey: ["notice"] },
      { queryKey: ["requests"] },
      { queryKey: ["notifications", "guardian-1"] },
      { queryKey: ["school", "parent", "home", "student-1"] },
      { queryKey: ["attention"] },
    ]));
  });

  it("refreshes conversations, notifications and shared request projections for a chat update", () => {
    const result = resolveSchoolEvent(
      eventData("chat.updated", { refresh: ["messages", "notifications", "attention"] }),
      "chat.updated",
      "guardian-1",
    );

    expect(result.usedFallback).toBe(false);
    expect(result.invalidations).toEqual([
      { queryKey: ["chat"] },
      { queryKey: ["notifications", "guardian-1"] },
      { queryKey: ["attention"] },
      { queryKey: ["requests"] },
    ]);
  });
});
