import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { StudentTimetablePage } from "../../pages/student/StudentTimetablePage";
import type { WorkspaceManifest } from "../workspace/types";
import { calendarDestination, resolveTimetableWorkspaceAccess } from "./TimetableWorkspaceRoutes";

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
    key: "timetable",
    label: "Timetable",
    href: "/areas/timetable",
    capabilities: ["schedule.view", "schedule.manage"],
    scopes: [{ kind: "institution", id: "school-1", label: "Cambridge International School" }],
    surfaces: [{
      key: "schedule",
      label: "Assigned schedule",
      href: "/areas/timetable/schedule",
      capabilities: ["schedule.view"],
      scopes: [{ kind: "class", id: "class-6a", label: "Class 6A" }],
    }, {
      key: "planning",
      label: "Timetable planning",
      href: "/areas/timetable/planning",
      capabilities: ["schedule.manage"],
      scopes: [{ kind: "institution", id: "school-1" }],
    }, {
      key: "schedule:dependent:student-1",
      label: "Aarav timetable",
      href: "/areas/timetable/schedule?scope=dependent&student_id=student-1",
      capabilities: ["schedule.view"],
      scopes: [{ kind: "dependent", id: "student-1", label: "Aarav Yadav" }],
    }],
  }],
  more: { setup: [], other: [] },
  freshness: { state: "current", as_of: "8:00 AM", source_revision: "source-1" },
};

describe("Timetable workspace access", () => {
  it("prefers assigned work when no relationship was explicitly selected", () => {
    expect(resolveTimetableWorkspaceAccess(manifest, "schedule", new URLSearchParams("date=2026-10-18"))).toMatchObject({
      kind: "schedule",
      institutionId: "school-1",
      surface: { key: "schedule" },
    });
  });

  it("requires the exact learner relationship instead of inferring a portal", () => {
    expect(resolveTimetableWorkspaceAccess(manifest, "schedule", new URLSearchParams("scope=dependent&student_id=student-1"))).toMatchObject({
      relationship: "dependent",
      studentId: "student-1",
      relationshipLabel: "Aarav Yadav",
      surface: { key: "schedule:dependent:student-1" },
    });
    expect(resolveTimetableWorkspaceAccess(manifest, "schedule", new URLSearchParams("scope=dependent&student_id=student-2"))).toBeNull();
    expect(resolveTimetableWorkspaceAccess(manifest, "schedule", new URLSearchParams("student_id=student-1"))).toBeNull();
  });

  it("does not manufacture planning authority from a schedule contribution", () => {
    const scheduleOnly: WorkspaceManifest = {
      ...manifest,
      areas: [{ ...manifest.areas[0]!, surfaces: manifest.areas[0]!.surfaces.filter((surface) => surface.key !== "planning") }],
    };
    expect(resolveTimetableWorkspaceAccess(scheduleOnly, "planning", new URLSearchParams())).toBeNull();
  });

  it("does not guess a learner when only relationship schedules are available", () => {
    const relationshipOnly: WorkspaceManifest = {
      ...manifest,
      areas: [{ ...manifest.areas[0]!, surfaces: manifest.areas[0]!.surfaces.filter((surface) => surface.key.startsWith("schedule:")) }],
    };
    expect(resolveTimetableWorkspaceAccess(relationshipOnly, "schedule", new URLSearchParams())).toBeNull();
  });

  it("links to the independent Calendar while retaining the selected date, view and exact relationship", () => {
    const query = new URLSearchParams("scope=dependent&student_id=student-1&date=2026-10-20&view=week");
    const access = resolveTimetableWorkspaceAccess(manifest, "schedule", query)!;
    expect(calendarDestination(access, query)).toBe("/areas/calendar?scope=dependent&student_id=student-1&date=2026-10-20&view=week");
    const planning = resolveTimetableWorkspaceAccess(manifest, "planning", new URLSearchParams())!;
    expect(calendarDestination(planning, query)).toBe("/areas/calendar?surface=manage&date=2026-10-20&view=week");
  });
});

describe("Timetable workspace presentation", () => {
  afterEach(cleanup);

  it("renders the published schedule body without a Student or Parent portal shell", () => {
    render(<MemoryRouter><StudentTimetablePage
      presentation="workspace"
      days={[]}
      className="Class 6A"
      studentName="Aarav Yadav"
      termLabel="Term 1 - 2026-27"
    /></MemoryRouter>);

    expect(screen.getByText("No timetable published")).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });
});
