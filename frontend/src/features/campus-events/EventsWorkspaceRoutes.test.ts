import { describe, expect, it } from "vitest";
import type { WorkspaceManifest } from "../workspace/types";
import { resolveEventsWorkspaceAccess } from "./EventsWorkspaceRoutes";

const manifest: WorkspaceManifest = {
  revision: "workspace-1",
  generated_at: "2026-10-18T08:00:00.000Z",
  context: {
    institution_id: "school-1",
    institution_label: "Cambridge International School",
    environment: { kind: "live", namespace_id: "live-school-1" },
  },
  today: { now: [], attention: { total: 0, overdue: 0, due_soon: 0 }, next: [] },
  work: { total: 0, items: [] },
  areas: [{
    key: "events",
    label: "Events",
    href: "/areas/events",
    capabilities: ["events.view", "events.manage"],
    scopes: [{ kind: "institution", id: "school-1", label: "Cambridge International School" }],
    surfaces: [
      {
        key: "manage",
        label: "Event coordination",
        href: "/areas/events/manage",
        capabilities: ["events.manage"],
        scopes: [{ kind: "institution", id: "school-1" }],
      },
      {
        key: "calendar:dependent:student-1",
        label: "Aarav events",
        href: "/areas/events/calendar?scope=dependent&student_id=student-1",
        capabilities: ["events.view"],
        scopes: [{ kind: "dependent", id: "student-1", label: "Aarav Yadav" }],
      },
    ],
  }],
  more: { setup: [], other: [] },
  freshness: { state: "current", as_of: "8:00 AM", source_revision: "source-1" },
};

describe("Events workspace access", () => {
  it("uses the manifest institution and explicit management surface without a portal role", () => {
    expect(resolveEventsWorkspaceAccess(manifest, "manage", new URLSearchParams())).toMatchObject({
      schoolId: "school-1",
      basePath: "/areas/events/manage",
      operationsKind: "manage",
      surface: { key: "manage" },
    });
  });

  it("requires the exact relationship contribution and preserves its human label", () => {
    expect(resolveEventsWorkspaceAccess(manifest, "calendar", new URLSearchParams("scope=dependent&student_id=student-1"))).toMatchObject({
      relationship: "dependent",
      studentId: "student-1",
      relationshipLabel: "Aarav Yadav",
      basePath: "/areas/events/calendar",
    });
    expect(resolveEventsWorkspaceAccess(manifest, "calendar", new URLSearchParams("scope=dependent&student_id=student-2"))).toBeNull();
    expect(resolveEventsWorkspaceAccess(manifest, "calendar", new URLSearchParams("student_id=student-1"))).toBeNull();
  });

  it("does not manufacture an assigned surface from a management capability", () => {
    expect(resolveEventsWorkspaceAccess(manifest, "assigned", new URLSearchParams())).toBeNull();
  });
});
