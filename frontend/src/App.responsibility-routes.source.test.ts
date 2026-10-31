import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(join(process.cwd(), "src", "App.tsx"), "utf8");

function route(path: string) {
  return appSource.split("\n").find((line) => line.includes(`path="${path}"`)) ?? "";
}

describe("responsibility-composed application routes", () => {
  it("mounts evolved Attendance and Events workspaces instead of persona routes", () => {
    expect(route("/areas/attendance/registers")).toContain("ResponsibilityAttendanceRegistersRoute");
    expect(route("/areas/attendance/coordination")).toContain("ResponsibilityAttendanceCoordinationRoute");
    expect(route("/areas/events/assigned")).toContain("WorkspaceEventsAssignedRoute");
    expect(route("/areas/events/manage")).toContain("WorkspaceEventsManageRoute");
    expect(route("/areas/events/calendar")).toContain("WorkspaceEventsCalendarRoute");
    expect(appSource).toContain('{ from: "/parent/attendance", to: "/areas/attendance/records", defaultSearch: { scope: "dependent" } }');
    expect(appSource).toContain('{ from: "/student/attendance", to: "/areas/attendance/records", defaultSearch: { scope: "self" } }');
    expect(route("/parent/attendance")).toBe("");
    expect(route("/student/attendance")).toBe("");
  });

  it("mounts the complete evolved Timetable workspace", () => {
    expect(route("/areas/timetable/schedule")).toContain("WorkspaceTimetableScheduleRoute");
    expect(route("/areas/timetable/planning")).toContain("WorkspaceTimetablePlanningRoute");
    expect(route("/areas/timetable/planning/day")).toContain("WorkspaceTimetableDayPlanRoute");
    expect(route("/areas/timetable/planning/settings")).toContain("WorkspaceTimetableSettingsRoute");
    expect(appSource).toContain('{ from: "/parent/timetable", to: "/areas/timetable/schedule", defaultSearch: { scope: "dependent" } }');
    expect(appSource).toContain('{ from: "/student/timetable", to: "/areas/timetable/schedule", defaultSearch: { scope: "self" } }');
    expect(appSource).toContain('{ from: "/teacher/timetable/weekly", to: "/areas/timetable/schedule", defaultSearch: { view: "week" } }');
    expect(appSource).toContain('{ from: "/principal/timetable/day", to: "/areas/timetable/planning/day" }');
    expect(route("/parent/timetable")).toBe("");
    expect(route("/student/timetable")).toBe("");
    expect(route("/teacher/timetable/weekly")).toBe("");
    expect(route("/principal/timetable/day")).toBe("");
  });

  it("gives Calendar its own canonical Area and redirects old scoped bookmarks", () => {
    expect(route("/areas/calendar")).toContain("WorkspaceCalendarRoute");
    expect(route("/areas/timetable/calendar")).toContain('LegacyRouteRedirect to="/areas/calendar"');
    expect(route("/areas/timetable/calendar")).not.toContain("WorkspaceCalendarRoute");
    expect(appSource).toContain('{ from: "/parent/calendar", to: "/areas/calendar", defaultSearch: { scope: "dependent" } }');
    expect(appSource).toContain('{ from: "/student/calendar", to: "/areas/calendar", defaultSearch: { scope: "self" } }');
    expect(appSource).toContain('{ from: "/teacher/calendar", to: "/areas/calendar", defaultSearch: { surface: "assigned" } }');
    expect(appSource).toContain('{ from: "/principal/calendar", to: "/areas/calendar", defaultSearch: { surface: "manage" } }');
    expect(route("/parent/calendar")).toBe("");
    expect(route("/student/calendar")).toBe("");
    expect(route("/teacher/calendar")).toBe("");
    expect(route("/principal/calendar")).toBe("");
  });

  it("keeps Messages canonical and converts persona bookmarks into scoped redirects", () => {
    expect(route("/areas/messages/conversations")).toContain("WorkspaceRelationshipMessagesRoute");
    expect(appSource).toContain('{ from: "/parent/messages", to: "/areas/messages/conversations", defaultSearch: { scope: "dependent" } }');
    expect(appSource).toContain('{ from: "/student/messages", to: "/areas/messages/conversations", defaultSearch: { scope: "self" } }');
    expect(appSource).toContain('{ from: "/teacher/messages", to: "/areas/messages/conversations" }');
    expect(appSource).toContain('{ from: "/principal/messages", to: "/areas/messages/conversations" }');
    expect(route("/parent/messages")).toBe("");
    expect(route("/student/messages")).toBe("");
    expect(route("/teacher/messages")).toBe("");
    expect(route("/principal/messages")).toBe("");
  });

  it("composes notices and diary into Messages without keeping persona screens", () => {
    expect(route("/areas/messages/updates")).toContain("WorkspaceUpdatesRoute");
    expect(route("/areas/messages/updates/:noticeId")).toContain("WorkspaceUpdateDetailRoute");
    expect(route("/areas/messages/updates/new")).toContain("WorkspaceUpdateCreateRoute");
    expect(route("/areas/messages/diary")).toContain("WorkspaceDiaryRoute");
    expect(appSource).toContain('{ from: "/parent/notices", to: "/areas/messages/updates", defaultSearch: { scope: "dependent" } }');
    expect(appSource).toContain('{ from: "/student/diary", to: "/areas/messages/diary", defaultSearch: { scope: "self" } }');
    expect(appSource).toContain('{ from: "/teacher/notices", to: "/areas/messages/updates" }');
    expect(appSource).toContain('{ from: "/principal/notices", to: "/areas/messages/updates" }');
    expect(route("/parent/notices")).toBe("");
    expect(route("/student/diary")).toBe("");
    expect(route("/teacher/notices")).toBe("");
    expect(route("/principal/notices")).toBe("");
  });

  it("routes assessment and result bookmarks into the evolved workspaces", () => {
    expect(route("/areas/assessments/assigned")).toContain("WorkspaceAssignedAssessmentsRoute");
    expect(route("/areas/assessments/manage")).toContain("WorkspaceManagedAssessmentsRoute");
    expect(route("/areas/assessments/results")).toContain("WorkspaceRelationshipResultsRoute");
    expect(appSource).toContain('{ from: "/parent/results", to: "/areas/assessments/results", defaultSearch: { scope: "dependent" } }');
    expect(appSource).toContain('{ from: "/student/results", to: "/areas/assessments/results", defaultSearch: { scope: "self" } }');
    expect(appSource).toContain('{ from: "/teacher/assessments", to: "/areas/assessments/assigned" }');
    expect(appSource).toContain('{ from: "/principal/assessments", to: "/areas/assessments/manage" }');
    expect(route("/parent/results")).toBe("");
    expect(route("/student/results")).toBe("");
    expect(route("/teacher/assessments")).toBe("");
    expect(route("/principal/assessments")).toBe("");
  });

  it("uses the evolved Events workspace for canonical work and persona bookmarks", () => {
    expect(route("/areas/events/assigned/:eventId/edit")).toContain("WorkspaceEventsAssignedEditRoute");
    expect(route("/areas/events/manage/:eventId/sessions/:sessionId/attendance")).toContain("WorkspaceEventsManageRegisterRoute");
    expect(route("/areas/events/calendar/:eventId")).toContain("WorkspaceEventsCalendarDetailRoute");
    expect(appSource).toContain('{ from: "/parent/events", to: "/areas/events/calendar", defaultSearch: { scope: "dependent" } }');
    expect(appSource).toContain('{ from: "/student/events", to: "/areas/events/calendar", defaultSearch: { scope: "self" } }');
    expect(appSource).toContain('{ from: "/teacher/events", to: "/areas/events/assigned" }');
    expect(appSource).toContain('{ from: "/principal/events", to: "/areas/events/manage" }');
    expect(route("/parent/events")).toBe("");
    expect(route("/student/events")).toBe("");
    expect(route("/teacher/events")).toBe("");
    expect(route("/principal/events")).toBe("");
  });

  it("uses one reports and remarks workspace without selecting a staff persona", () => {
    expect(route("/areas/reports/remarks")).toContain("WorkspaceAcademicReportsRoute");
    expect(appSource).toContain('{ from: "/teacher/report-cards", to: "/areas/reports/remarks" }');
    expect(appSource).toContain('{ from: "/principal/report-cards", to: "/areas/reports/remarks" }');
    expect(route("/teacher/report-cards")).toBe("");
    expect(route("/principal/report-cards")).toBe("");
  });

  it("uses one protected student-care workspace without selecting a staff persona", () => {
    expect(route("/areas/care")).toContain("WorkspaceCareHomeRoute");
    expect(route("/areas/care/concerns")).toContain("WorkspaceCareRoute");
    expect(appSource).toContain('{ from: "/teacher/safeguarding", to: "/areas/care/concerns" }');
    expect(appSource).toContain('{ from: "/principal/safeguarding", to: "/areas/care/concerns" }');
    expect(route("/teacher/safeguarding")).toBe("");
    expect(route("/principal/safeguarding")).toBe("");
  });

  it("keeps self and dependent fee records in one relationship-scoped workspace", () => {
    expect(route("/areas/fees")).toContain("WorkspaceFeesRoute");
    expect(route("/areas/fees/ledger")).toContain("WorkspaceFeeLedgerRoute");
    expect(route("/areas/fees/account")).toContain("WorkspaceFeeAccountRoute");
    expect(appSource).toContain('{ from: "/parent/fees", to: "/areas/fees/account", defaultSearch: { scope: "dependent" } }');
    expect(appSource).toContain('{ from: "/student/fees", to: "/areas/fees/account", defaultSearch: { scope: "self" } }');
    expect(route("/parent/fees")).toBe("");
    expect(route("/student/fees")).toBe("");
  });

  it("composes departure planning, journey operation and coordination without persona pages", () => {
    expect(route("/areas/departure/plan")).toContain("WorkspaceRelationshipDepartureRoute");
    expect(route("/areas/departure/operate/:tripId")).toContain("CollectorJourneyPage");
    expect(route("/areas/departure/manage")).toContain("WorkspaceDepartureManagementPage");
    expect(route("/areas/departure/manage/journeys/:tripId")).toContain("JourneyDetailPage");
    expect(appSource).toContain('{ from: "/parent/departure", to: "/areas/departure/plan", defaultSearch: { scope: "dependent" } }');
    expect(appSource).toContain('{ from: "/student/departure", to: "/areas/departure/plan", defaultSearch: { scope: "self" } }');
    expect(appSource).toContain('{ from: "/teacher/transport", to: "/areas/departure/operate" }');
    expect(appSource).toContain('{ from: "/principal/departure", to: "/areas/departure/manage" }');
    expect(route("/parent/departure")).toBe("");
    expect(route("/student/departure")).toBe("");
    expect(route("/teacher/transport")).toBe("");
    expect(route("/principal/departure")).toBe("");
  });

  it("mounts the server-composed More route table and bookmark redirects", () => {
    expect(appSource).toContain("canonicalMoreRouteDefinitions.map");
    expect(appSource).toContain("canonicalSetupRouteDefinitions.map");
    expect(appSource).toContain("...legacyMoreRedirectDefinitions");
    expect(route("/parent/policies")).toBe("");
    expect(route("/teacher/policies")).toBe("");
    expect(route("/principal/governance")).toBe("");
    expect(route("/principal/campus")).toBe("");
  });

  it("uses Today and Work as projections rather than persona home and request pages", () => {
    expect(route("/today")).toContain('WorkspaceRoutePage view="today"');
    expect(route("/work")).toContain('WorkspaceRoutePage view="work"');
    for (const path of ["/parent/home", "/student", "/teacher", "/principal"]) {
      expect(appSource).toContain(`{ from: "${path}", to: "/today" }`);
      expect(route(path)).toBe("");
    }
    for (const path of ["/parent/requests", "/teacher/requests", "/principal/requests"]) {
      expect(appSource).toContain(`{ from: "${path}", to: "/work" }`);
      expect(route(path)).toBe("");
    }
  });

  it("composes responsibilities, coverage and leave without keeping staff persona pages", () => {
    expect(route("/areas/responsibilities/mine")).toContain("WorkspaceResponsibilitiesRoute");
    expect(route("/areas/responsibilities/coverage")).toContain("WorkspaceCoverageRoute");
    expect(route("/areas/responsibilities/leave")).toContain("WorkspaceStaffLeaveRoute");
    expect(route("/areas/attendance/leave")).toContain("WorkspaceRelationshipLeaveRoute");
    expect(route("/areas/attendance/leave/review")).toContain("WorkspaceStudentLeaveReviewRoute");
    expect(appSource).toContain('{ from: "/teacher/leave", to: "/areas/responsibilities/leave" }');
    expect(appSource).toContain('{ from: "/principal/student-leave", to: "/areas/attendance/leave/review" }');
    expect(route("/teacher/leave")).toBe("");
    expect(route("/principal/student-leave")).toBe("");
  });

  it("mounts responsibility-composed People and In & Out workspaces", () => {
    expect(route("/areas/people")).toContain('WorkspaceAreaRoutePage areaKey="people"');
    expect(route("/areas/people/records")).toContain("WorkspacePeopleRecordsRoute");
    expect(route("/areas/people/import")).toContain("WorkspacePeopleImportRoute");
    expect(route("/areas/in-out/operate")).toContain("WorkspaceInOutOperateRoute");
    expect(route("/areas/in-out/manage")).toContain("WorkspaceInOutManageRoute");
    expect(route("/work/in-out/approvals")).toContain("WorkspaceInOutApprovalsRoute");
    expect(appSource).toContain('{ from: "/teacher/students", to: "/areas/people/records" }');
    expect(appSource).toContain('{ from: "/principal/students/import", to: "/areas/people/import" }');
    expect(route("/teacher/students")).toBe("");
    expect(route("/principal/students/import")).toBe("");
  });

  it("moves attendance follow-up and thresholds into the Attendance Area", () => {
    expect(route("/areas/attendance/follow-ups")).toContain("WorkspaceAttendanceFollowupsRoute");
    expect(route("/areas/attendance/thresholds")).toContain("WorkspaceAttendanceThresholdsRoute");
    expect(appSource).toContain('{ from: "/principal/followups", to: "/areas/attendance/follow-ups" }');
    expect(appSource).toContain('{ from: "/principal/attendance/thresholds", to: "/areas/attendance/thresholds" }');
    expect(route("/principal/followups")).toBe("");
    expect(route("/principal/attendance/thresholds")).toBe("");
  });
});
