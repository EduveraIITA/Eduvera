import { describe, expect, it } from "vitest";
import type { WorkspaceManifest } from "../workspace/types";
import { calendarSourceScope, calendarTimetableDestination, resolveCalendarWorkspaceAccess } from "./WorkspaceCalendarRoute";

const manifest: WorkspaceManifest = {
  revision: "workspace-calendar-test",
  generated_at: "2026-10-18T00:00:00.000Z",
  context: {
    institution_id: "school-1",
    institution_label: "Test campus",
    scope_label: null,
    date_label: "18 October",
    environment: { kind: "live", namespace_id: "live:school-1" },
  },
  today: { now: [], attention: { total: 0, overdue: 0, due_soon: 0 }, next: [], completed_automatically: [] },
  work: { total: 0, items: [] },
  areas: [{
    key: "calendar",
    label: "Calendar",
    description: "Dates and schedules",
    href: "/areas/calendar",
    icon: "calendar",
    attention_count: 0,
    capabilities: ["timetable.view", "timetable.manage"],
    scopes: [],
    surfaces: [
      { key: "assigned", label: "Activity calendar", href: "/areas/calendar?surface=assigned", capabilities: ["timetable.view"], scopes: [] },
      { key: "manage", label: "Campus calendar", href: "/areas/calendar?surface=manage", capabilities: ["timetable.manage"], scopes: [] },
      {
        key: "calendar:self:student-1",
        label: "My calendar",
        href: "/areas/calendar?scope=self&student_id=student-1",
        capabilities: ["timetable.view"],
        scopes: [{ kind: "self", id: "student-1", label: "Aarav" }],
      },
      {
        key: "calendar:dependent:student-2",
        label: "Mira calendar",
        href: "/areas/calendar?scope=dependent&student_id=student-2",
        capabilities: ["timetable.view"],
        scopes: [{ kind: "dependent", id: "student-2", label: "Mira" }],
      },
    ],
  }, {
    key: "timetable", label: "Timetable", href: "/areas/timetable", attention_count: 0,
    capabilities: ["timetable.view", "timetable.manage"], scopes: [],
    surfaces: [
      { key: "schedule", label: "My schedule", href: "/areas/timetable/schedule", capabilities: ["timetable.view"], scopes: [] },
      { key: "planning", label: "Timetable planning", href: "/areas/timetable/planning", capabilities: ["timetable.manage"], scopes: [] },
      { key: "schedule:dependent:student-2", label: "Mira timetable", href: "/areas/timetable/schedule?scope=dependent&student_id=student-2", capabilities: ["timetable.view"], scopes: [{ kind: "dependent", id: "student-2", label: "Mira" }] },
    ],
  }],
  more: { groups: [], setup: [], other: [] },
  freshness: { state: "current", as_of: "Now", source_revision: "one" },
};

describe("calendar responsibility resolution", () => {
  const learnerManifest = (): WorkspaceManifest => ({ ...manifest, areas: [{ ...manifest.areas[0]!, surfaces: [
    { key: "assigned", label: "Activity calendar", href: "/areas/calendar?surface=assigned", capabilities: ["timetable.view"], scopes: [{ kind: "self", id: "person-1", label: "My scheduled activities" }] },
    manifest.areas[0]!.surfaces.find((surface) => surface.key === "calendar:self:student-1")!,
    { key: "availability", label: "Dining hours", href: "/areas/calendar?surface=availability", capabilities: ["dining.view"], scopes: [{ kind: "institution", id: "school-1" }] },
  ] }] });

  it("defaults to the sole exact own-learner calendar instead of duplicating that person's activity context", () => {
    expect(resolveCalendarWorkspaceAccess(learnerManifest(), new URLSearchParams()))
      .toMatchObject({ kind: "self", studentId: "student-1", relationshipLabel: "Aarav" });
    expect(resolveCalendarWorkspaceAccess(learnerManifest(), new URLSearchParams("surface=assigned"))?.kind).toBe("assigned");
    expect(resolveCalendarWorkspaceAccess(learnerManifest(), new URLSearchParams("surface=availability"))?.kind).toBe("availability");
  });

  it.each(["class", "team", "institution"] as const)("retains an independent %s responsibility rather than silently choosing a learner context", kind => {
    const learner = learnerManifest();
    const scoped = { ...learner, areas: [{ ...learner.areas[0]!, surfaces: learner.areas[0]!.surfaces.map(surface => surface.key === "assigned"
      ? { ...surface, scopes: [...surface.scopes, { kind, id: "responsibility-1" }] } : surface) }] };
    expect(resolveCalendarWorkspaceAccess(scoped, new URLSearchParams())?.kind).toBe("assigned");
  });

  it("does not prefer self over management, incomplete self evidence, or an additional dependent context", () => {
    const learner = learnerManifest(), area = learner.areas[0]!;
    const withSurfaces = (surfaces: typeof area.surfaces) => ({ ...learner, areas: [{ ...area, surfaces }] });
    const manage = manifest.areas[0]!.surfaces.find(surface => surface.key === "manage")!;
    const dependent = manifest.areas[0]!.surfaces.find(surface => surface.key === "calendar:dependent:student-2")!;
    expect(resolveCalendarWorkspaceAccess(withSurfaces([...area.surfaces, manage]), new URLSearchParams())?.kind).toBe("assigned");
    expect(resolveCalendarWorkspaceAccess(withSurfaces([...area.surfaces, dependent]), new URLSearchParams())?.kind).toBe("assigned");
    expect(resolveCalendarWorkspaceAccess(withSurfaces(area.surfaces.map(surface => surface.key.startsWith("calendar:self:") ? { ...surface, scopes: [] } : surface)), new URLSearchParams())?.kind).toBe("assigned");
    expect(resolveCalendarWorkspaceAccess(withSurfaces(area.surfaces.map(surface => surface.key === "assigned" ? { ...surface, scopes: [] } : surface)), new URLSearchParams())?.kind).toBe("assigned");
    expect(resolveCalendarWorkspaceAccess(withSurfaces(area.surfaces.filter(surface => surface.key !== "assigned")), new URLSearchParams())?.kind).toBe("self");
  });

  it("resolves exact relationship calendars without a role or portal", () => {
    const access = resolveCalendarWorkspaceAccess(manifest, new URLSearchParams("scope=dependent&student_id=student-2"));
    expect(access).toMatchObject({ kind: "dependent", studentId: "student-2", relationshipLabel: "Mira" });
  });

  it("resolves assigned and manage calendars only from contributed surfaces", () => {
    expect(resolveCalendarWorkspaceAccess(manifest, new URLSearchParams("surface=assigned"))?.kind).toBe("assigned");
    expect(resolveCalendarWorkspaceAccess(manifest, new URLSearchParams("surface=manage"))?.kind).toBe("manage");
    expect(resolveCalendarWorkspaceAccess({ ...manifest, areas: [] }, new URLSearchParams("surface=manage"))).toBeNull();
  });

  it("fails closed for mismatched relationship scope", () => {
    expect(resolveCalendarWorkspaceAccess(manifest, new URLSearchParams("scope=dependent&student_id=student-1"))).toBeNull();
    expect(resolveCalendarWorkspaceAccess(manifest, new URLSearchParams("scope=unknown"))).toBeNull();
  });

  it("opens only a server-contributed Dining availability surface without granting Timetable", () => {
    const availability = { ...manifest, areas: [{ ...manifest.areas[0]!, capabilities: ["dining.view"], surfaces: [
      { key: "availability", label: "Dining hours", href: "/areas/calendar?surface=availability", capabilities: ["dining.view"], scopes: [] },
    ] }] };
    const access = resolveCalendarWorkspaceAccess(availability, new URLSearchParams())!;
    expect(access.kind).toBe("availability");
    expect(calendarTimetableDestination(access, new URLSearchParams("date=2026-10-20"))).toBeNull();
    expect(resolveCalendarWorkspaceAccess(availability, new URLSearchParams("surface=assigned"))).toBeNull();
    expect(resolveCalendarWorkspaceAccess(manifest, new URLSearchParams("surface=availability"))).toBeNull();
  });

  it("does not infer a Calendar contribution from a Timetable-only or foreign manifest", () => {
    expect(resolveCalendarWorkspaceAccess({ ...manifest, areas: manifest.areas.filter((area) => area.key === "timetable") }, new URLSearchParams())).toBeNull();
    const mismatched = { ...manifest, areas: manifest.areas.map((area) => ({ ...area, surfaces: area.surfaces.map((surface) => ({ ...surface, scopes: [] })) })) };
    expect(resolveCalendarWorkspaceAccess(mismatched, new URLSearchParams("scope=dependent&student_id=student-2"))).toBeNull();
  });

  it("requires an explicit choice when several relationship calendars are available", () => {
    const relationships = { ...manifest, areas: manifest.areas.map((area) => ({ ...area, surfaces: area.surfaces.filter((surface) => surface.key.startsWith("calendar:")) })) };
    expect(resolveCalendarWorkspaceAccess(relationships, new URLSearchParams())).toBeNull();
    expect(resolveCalendarWorkspaceAccess(relationships, new URLSearchParams("scope=self"))).toMatchObject({ kind: "self", studentId: "student-1" });
    expect(resolveCalendarWorkspaceAccess(relationships, new URLSearchParams("scope=dependent&student_id=foreign"))).toBeNull();
  });

  it("links back to the exact contributed Timetable, retaining date and relationship but not calendar attention", () => {
    const access = resolveCalendarWorkspaceAccess(manifest, new URLSearchParams("scope=dependent&student_id=student-2"))!;
    expect(calendarTimetableDestination(access, new URLSearchParams("date=2026-10-20&view=month&calendar_change_id=change-1&attention_notification_id=n1")))
      .toBe("/areas/timetable/schedule?scope=dependent&student_id=student-2&date=2026-10-20");
    const manage = resolveCalendarWorkspaceAccess(manifest, new URLSearchParams("surface=manage"))!;
    expect(calendarTimetableDestination(manage, new URLSearchParams("date=2026-10-20&view=day&school=s1&class=c1")))
      .toBe("/areas/timetable/planning?date=2026-10-20&school=s1&class=c1&view=day");
    expect(calendarTimetableDestination({ ...access, manifest: { ...manifest, areas: manifest.areas.filter((area) => area.key !== "timetable") } }, new URLSearchParams())).toBeNull();
  });

  it("uses available Timetable authority without making Calendar a planning mode", () => {
    const assigned = resolveCalendarWorkspaceAccess(manifest, new URLSearchParams("surface=assigned"))!;
    expect(calendarTimetableDestination(assigned, new URLSearchParams("date=2026-10-20&view=agenda")))
      .toBe("/areas/timetable/planning?date=2026-10-20&view=agenda");
    const scheduleOnly = { ...assigned, manifest: { ...manifest, areas: manifest.areas.map((area) => area.key === "timetable" ? { ...area, surfaces: area.surfaces.filter((surface) => surface.key === "schedule") } : area) } };
    expect(calendarTimetableDestination(scheduleOnly, new URLSearchParams("view=week"))).toBe("/areas/timetable/schedule");
  });

  it("does not infer Events or Assessments access from Calendar or Timetable authority", () => {
    const access = resolveCalendarWorkspaceAccess(manifest, new URLSearchParams("surface=manage"))!;
    expect(calendarSourceScope(access)).toEqual({ schoolId: "school-1", timeZone: "UTC", surfaceKey: "manage", studentId: undefined, eventHref: undefined, assessmentHref: undefined, includeDining: false });
  });

  it("derives each non-family source independently, preferring its contributed coordination surface", () => {
    const areas = ["events", "assessments"].map((key) => ({ key, label: key, href: `/areas/${key}`, attention_count: 0, capabilities: [], scopes: [], surfaces: [
      { key: "assigned", label: "Assigned", href: `/areas/${key}/assigned`, capabilities: [], scopes: [] },
      ...(key === "events" ? [{ key: "manage", label: "Manage", href: `/areas/${key}/manage`, capabilities: [], scopes: [] }] : []),
    ] }));
    const scoped = { ...manifest, areas: [...manifest.areas, ...areas], context: { ...manifest.context, time_zone: "Pacific/Auckland" } };
    const access = resolveCalendarWorkspaceAccess(scoped, new URLSearchParams("surface=assigned"))!;
    expect(calendarSourceScope(access)).toMatchObject({ timeZone: "Pacific/Auckland", eventHref: "/areas/events/manage", assessmentHref: "/areas/assessments/assigned" });
  });

  it("requires exact independently contributed person and relationship evidence for every source", () => {
    const source = (key: string, stem: string, student: string, kind = "dependent") => ({ key, label: key, href: `/areas/${key}`, attention_count: 0, capabilities: [], scopes: [], surfaces: [
      { key: `${stem}:${kind}:${student}`, label: "Dates", href: `/areas/${key}/${stem}?scope=${kind}&student_id=${student}`, capabilities: [], scopes: [{ kind: kind as "self" | "dependent", id: student, label: "Mira" }] },
    ] });
    const scoped = { ...manifest, areas: [...manifest.areas, source("events", "calendar", "student-2"), source("assessments", "results", "student-2")] };
    const access = resolveCalendarWorkspaceAccess(scoped, new URLSearchParams("scope=dependent&student_id=student-2"))!;
    expect(calendarSourceScope(access)).toMatchObject({ studentId: "student-2", eventHref: "/areas/events/calendar?scope=dependent&student_id=student-2", assessmentHref: "/areas/assessments/results?scope=dependent&student_id=student-2" });
    const wrongContext = { ...access, manifest: { ...scoped, areas: [...manifest.areas, source("events", "calendar", "student-1"), source("assessments", "results", "student-2", "self")] } };
    expect(calendarSourceScope(wrongContext)).toMatchObject({ eventHref: undefined, assessmentHref: undefined });
    const noEvidence = { ...access, manifest: { ...scoped, areas: scoped.areas.map((area) => area.key === "calendar" ? area : { ...area, surfaces: area.surfaces.map((surface) => ({ ...surface, scopes: [] })) }) } };
    expect(calendarSourceScope(noEvidence)).toMatchObject({ eventHref: undefined, assessmentHref: undefined });
    expect(calendarTimetableDestination(noEvidence, new URLSearchParams())).toBeNull();
  });

  it.each([
    "/areas/events/calendar?scope=dependent&student_id=another-person",
    "/areas/events/manage?scope=dependent&student_id=student-2",
    "https://outside.example/areas/events/calendar?scope=dependent&student_id=student-2",
  ])("does not emit a source link with mismatched owning route or person (%s)", (href) => {
    const access = resolveCalendarWorkspaceAccess(manifest, new URLSearchParams("scope=dependent&student_id=student-2"))!;
    const events = { key: "events", label: "Events", href: "/areas/events", attention_count: 0, capabilities: [], scopes: [], surfaces: [{ key: "calendar:dependent:student-2", label: "Mira events", href, capabilities: [], scopes: [{ kind: "dependent" as const, id: "student-2", label: "Mira" }] }] };
    expect(calendarSourceScope({ ...access, manifest: { ...manifest, areas: [...manifest.areas, events] } }).eventHref).toBeUndefined();
  });

  it("retains a service-only scope without borrowing other independently available source contexts", () => {
    const service = { key: "availability", label: "Dining hours", href: "/areas/calendar?surface=availability", capabilities: ["dining.view"], scopes: [] };
    const scoped = { ...manifest, areas: manifest.areas.map((area) => area.key === "calendar" ? { ...area, surfaces: [...area.surfaces, service] } : area) };
    const access = resolveCalendarWorkspaceAccess(scoped, new URLSearchParams("surface=availability"))!;
    expect(calendarSourceScope(access)).toMatchObject({ surfaceKey: "availability", includeDining: true, eventHref: undefined, assessmentHref: undefined });
  });
});
