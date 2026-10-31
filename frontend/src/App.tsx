import { Component, lazy, Suspense, type ErrorInfo, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppProviders } from "./app/AppProviders";
import { RouteScrollCommitMarker } from "./features/navigation/RouteScrollRestoration";
import { PortalScreenFrame } from "./features/navigation/PortalScreenFrame";
import { ThatCampusLoader } from "./components/ThatCampusLoader";
import {
  AuthenticatedOnly,
  CompanyOnly,
  WorkspaceOnly,
  PublicOnly,
  RoleLanding,
} from "./features/auth/RouteGuards";
import { WorkspaceSurfaceOnly } from "./features/workspace/WorkspaceSurfaceOnly";
import {
  LegacyRouteRedirect,
  type LegacyRouteRedirectProps,
} from "./features/navigation/LegacyRouteRedirect";
import {
  canonicalMoreRouteDefinitions,
  legacyMoreRedirectDefinitions,
} from "./features/more/MoreWorkspaceRoutes";
import { canonicalSetupRouteDefinitions } from "./features/setup/SetupWorkspaceRoutes";

const WorkspaceInOutOperateRoute=lazy(async()=>({default:(await import("./features/gate/InOutWorkspaceRoutes")).WorkspaceInOutOperateRoute}));
const WorkspaceInOutManageRoute=lazy(async()=>({default:(await import("./features/gate/InOutWorkspaceRoutes")).WorkspaceInOutManageRoute}));
const WorkspaceVisitsRoute=lazy(async()=>({default:(await import("./features/gate/InOutWorkspaceRoutes")).WorkspaceVisitsRoute}));
const WorkspaceInOutApprovalsRoute=lazy(async()=>({default:(await import("./features/gate/InOutWorkspaceRoutes")).WorkspaceInOutApprovalsRoute}));
const CompanyPage=lazy(()=>import('./features/onboarding/CompanyPage'));
const WorkspaceInsightsRoute = lazy(async () => ({ default: (await import('./features/analytics/InsightsWorkspaceRoutes')).WorkspaceInsightsRoute }));
const LegacyInsightsRedirect = lazy(async () => ({ default: (await import('./features/analytics/InsightNavigation')).LegacyInsightsRedirect }));
const SelfServiceOnboardingPage=lazy(()=>import('./features/onboarding/SelfServiceOnboardingPage'));
const JoinPage=lazy(()=>import('./features/onboarding/JoinPage'));

const LoginPage = lazy(async () => ({
  default: (await import("./features/auth/AuthPages")).LoginPage,
}));
const SignupPage = lazy(async () => ({
  default: (await import("./features/auth/AuthPages")).SignupPage,
}));
const PublicDemoPage = lazy(() => import("./features/auth/PublicDemoPage"));
const AccountSecurityPage = lazy(async () => ({
  default: (await import("./features/auth/AccountSecurityPages")).AccountSecurityPage,
}));
const ForgotPasswordPage = lazy(async () => ({
  default: (await import("./features/auth/AccountSecurityPages")).ForgotPasswordPage,
}));
const ResetPasswordPage = lazy(async () => ({
  default: (await import("./features/auth/AccountSecurityPages")).ResetPasswordPage,
}));
const WorkspaceUnavailablePage = lazy(async () => ({
  default: (await import("./features/auth/AuthPages")).WorkspaceUnavailablePage,
}));
const WorkspaceRoutePage = lazy(async () => ({
  default: (await import("./features/workspace/WorkspaceRoutePage")).WorkspaceRoutePage,
}));
const WorkspaceAreaRoutePage = lazy(async () => ({
  default: (await import("./features/workspace/WorkspaceAreaRoutePage")).WorkspaceAreaRoutePage,
}));
const WorkspaceAttendanceRecordsRoute = lazy(async () => ({
  default: (await import("./features/workspace/WorkspaceRelationshipRoutes")).WorkspaceAttendanceRecordsRoute,
}));
const ResponsibilityAttendanceRegistersRoute = lazy(async () => ({
  default: (await import("./features/operations/OperationsRoutes")).ResponsibilityAttendanceRegistersRoute,
}));
const ResponsibilityAttendanceCoordinationRoute = lazy(async () => ({
  default: (await import("./features/operations/OperationsRoutes")).ResponsibilityAttendanceCoordinationRoute,
}));
const WorkspaceAttendanceFollowupsRoute = lazy(async () => ({
  default: (await import("./features/attendance/AttendanceInsightRoutes")).WorkspaceAttendanceFollowupsRoute,
}));
const WorkspaceAttendanceThresholdsRoute = lazy(async () => ({
  default: (await import("./features/attendance/AttendanceInsightRoutes")).WorkspaceAttendanceThresholdsRoute,
}));
const WorkspaceTimetableScheduleRoute = lazy(async () => ({
  default: (await import("./features/timetable/TimetableWorkspaceRoutes")).WorkspaceTimetableScheduleRoute,
}));
const WorkspaceTimetablePlanningRoute = lazy(async () => ({
  default: (await import("./features/timetable/TimetableWorkspaceRoutes")).WorkspaceTimetablePlanningRoute,
}));
const WorkspaceTimetableDayPlanRoute = lazy(async () => ({
  default: (await import("./features/timetable/TimetableWorkspaceRoutes")).WorkspaceTimetableDayPlanRoute,
}));
const WorkspaceTimetableSettingsRoute = lazy(async () => ({
  default: (await import("./features/timetable/TimetableWorkspaceRoutes")).WorkspaceTimetableSettingsRoute,
}));
const WorkspaceCalendarRoute = lazy(async () => ({
  default: (await import("./features/calendar/WorkspaceCalendarRoute")).WorkspaceCalendarRoute,
}));
const WorkspaceRelationshipMessagesRoute = lazy(async () => ({
  default: (await import("./features/workspace/WorkspaceRelationshipRoutes")).WorkspaceRelationshipMessagesRoute,
}));
const WorkspaceRelationshipResultsRoute = lazy(async () => ({
  default: (await import("./features/workspace/WorkspaceRelationshipRoutes")).WorkspaceRelationshipResultsRoute,
}));
const WorkspaceRelationshipDepartureRoute = lazy(async () => ({
  default: (await import("./features/workspace/WorkspaceRelationshipRoutes")).WorkspaceRelationshipDepartureRoute,
}));
const WorkspaceAssignedAssessmentsRoute = lazy(async () => ({
  default: (await import("./features/assessments/AssessmentRoutes")).WorkspaceAssignedAssessmentsRoute,
}));
const WorkspaceManagedAssessmentsRoute = lazy(async () => ({
  default: (await import("./features/assessments/AssessmentRoutes")).WorkspaceManagedAssessmentsRoute,
}));
const WorkspaceEventsManageRoute = lazy(async () => ({
  default: (await import("./features/campus-events/EventsWorkspaceRoutes")).WorkspaceEventsManageRoute,
}));
const WorkspaceEventsManageDetailRoute = lazy(async () => ({
  default: (await import("./features/campus-events/EventsWorkspaceRoutes")).WorkspaceEventsManageDetailRoute,
}));
const WorkspaceEventsManageCreateRoute = lazy(async () => ({
  default: (await import("./features/campus-events/EventsWorkspaceRoutes")).WorkspaceEventsManageCreateRoute,
}));
const WorkspaceEventsManageEditRoute = lazy(async () => ({
  default: (await import("./features/campus-events/EventsWorkspaceRoutes")).WorkspaceEventsManageEditRoute,
}));
const WorkspaceEventsManageRegisterRoute = lazy(async () => ({
  default: (await import("./features/campus-events/EventsWorkspaceRoutes")).WorkspaceEventsManageRegisterRoute,
}));
const WorkspaceEventsAssignedRoute = lazy(async () => ({
  default: (await import("./features/campus-events/EventsWorkspaceRoutes")).WorkspaceEventsAssignedRoute,
}));
const WorkspaceEventsAssignedDetailRoute = lazy(async () => ({
  default: (await import("./features/campus-events/EventsWorkspaceRoutes")).WorkspaceEventsAssignedDetailRoute,
}));
const WorkspaceEventsAssignedEditRoute = lazy(async () => ({
  default: (await import("./features/campus-events/EventsWorkspaceRoutes")).WorkspaceEventsAssignedEditRoute,
}));
const WorkspaceEventsAssignedRegisterRoute = lazy(async () => ({
  default: (await import("./features/campus-events/EventsWorkspaceRoutes")).WorkspaceEventsAssignedRegisterRoute,
}));
const WorkspaceEventsCalendarRoute = lazy(async () => ({
  default: (await import("./features/campus-events/EventsWorkspaceRoutes")).WorkspaceEventsCalendarRoute,
}));
const WorkspaceEventsCalendarDetailRoute = lazy(async () => ({
  default: (await import("./features/campus-events/EventsWorkspaceRoutes")).WorkspaceEventsCalendarDetailRoute,
}));
const WorkspaceAssistantPage = lazy(async () => ({
  default: (await import("./features/assistant/AssistantPage")).WorkspaceAssistantPage,
}));

const WorkspacePeopleRecordsRoute = lazy(async () => ({ default: (await import("./features/people/PeopleWorkspaceRoutes")).WorkspacePeopleRecordsRoute }));
const PeopleParticipantsPage = lazy(async () => ({ default: (await import("./features/people/PeopleParticipantsPage")).PeopleParticipantsPage }));
const PersonProfilePage = lazy(async () => ({ default: (await import("./features/people/PersonProfilePage")).PersonProfilePage }));
const PeopleGroupDetailPage = lazy(async () => ({ default: (await import("./features/people/PeopleGroupDetailPage")).PeopleGroupDetailPage }));
const WorkspacePeopleImportRoute = lazy(async () => ({ default: (await import("./features/people/PeopleWorkspaceRoutes")).WorkspacePeopleImportRoute }));
const WorkspaceAssignedClassesRoute = lazy(async () => ({ default: (await import("./features/classes/PeopleClassWorkspaceRoutes")).WorkspaceAssignedClassesRoute }));
const WorkspaceAssignedClassRoute = lazy(async () => ({ default: (await import("./features/classes/PeopleClassWorkspaceRoutes")).WorkspaceAssignedClassRoute }));
const WorkspaceCareHomeRoute = lazy(async () => ({ default: (await import("./features/restricted-care/CareWorkspaceRoutes")).WorkspaceCareHomeRoute }));
const WorkspaceCareRoute = lazy(async () => ({ default: (await import("./features/restricted-care/CareWorkspaceRoutes")).WorkspaceCareRoute }));
const WorkspaceFeesRoute = lazy(async () => ({ default: (await import("./features/office/FeesWorkspaceRoutes")).WorkspaceFeesRoute }));
const WorkspaceFeeLedgerRoute = lazy(async () => ({ default: (await import("./features/office/FeesWorkspaceRoutes")).WorkspaceFeeLedgerRoute }));
const NativeFeeReviewRecoveryRoute = lazy(async () => ({ default: (await import("./features/office/NativeFeeReviewRecovery")).NativeFeeReviewRecoveryRoute }));
const WorkspaceFeeAccountRoute = lazy(async () => ({ default: (await import("./features/office/FeesWorkspaceRoutes")).WorkspaceFeeAccountRoute }));
const ResourcesWorkspaceRoute = lazy(async () => ({ default: (await import("./features/resources/ResourcesWorkspaceRoute")).ResourcesWorkspaceRoute }));
const FacilitiesWorkspaceRoute = lazy(async () => ({ default: (await import("./features/facilities/FacilitiesWorkspaceRoute")).FacilitiesWorkspaceRoute }));
const AccommodationWorkspaceRoute = lazy(async () => ({ default: (await import("./features/accommodation/AccommodationWorkspaceRoute")).AccommodationWorkspaceRoute }));
const DiningWorkspaceRoute = lazy(async () => ({ default: (await import("./features/dining/DiningWorkspaceRoute")).DiningWorkspaceRoute }));
const WorkspaceResponsibilitiesRoute = lazy(async () => ({ default: (await import("./features/staff-operations/StaffOperationsRoutes")).WorkspaceResponsibilitiesRoute }));
const WorkspaceCoverageRoute = lazy(async () => ({ default: (await import("./features/staff-operations/StaffOperationsRoutes")).WorkspaceCoverageRoute }));
const WorkspaceStaffLeaveRoute = lazy(async () => ({ default: (await import("./features/staff-operations/StaffOperationsRoutes")).WorkspaceStaffLeaveRoute }));
const AuthorizedStaffLeaveDecisionRoute = lazy(async () => ({ default: (await import("./features/staff-operations/StaffOperationsRoutes")).AuthorizedStaffLeaveDecisionRoute }));
const WorkspaceAcademicReportsRoute = lazy(async () => ({ default: (await import("./features/academic-reports/AcademicReportRoutes")).WorkspaceAcademicReportsRoute }));
const CollectorJourneyPage = lazy(() => import("./features/departure/CollectorJourneyPage"));
const WorkspaceDepartureManagementPage = lazy(async () => ({
  default: (await import("./features/departure/PrincipalDeparturePage")).WorkspaceDepartureManagementPage,
}));
const JourneyDetailPage = lazy(() => import("./features/departure/JourneyDetailPage"));
const WorkspaceRelationshipLeaveRoute = lazy(async () => ({ default: (await import("./features/student-leave/LeaveWorkspaceRoutes")).WorkspaceRelationshipLeaveRoute }));
const WorkspaceStudentLeaveReviewRoute = lazy(async () => ({ default: (await import("./features/student-leave/PrincipalStudentLeavePage")).WorkspaceStudentLeaveReviewRoute }));
const WorkspaceUpdatesRoute = lazy(async () => ({ default: (await import("./features/notices/UpdatesWorkspaceRoutes")).WorkspaceUpdatesRoute }));
const WorkspaceUpdateDetailRoute = lazy(async () => ({ default: (await import("./features/notices/UpdatesWorkspaceRoutes")).WorkspaceUpdateDetailRoute }));
const WorkspaceUpdateCreateRoute = lazy(async () => ({ default: (await import("./features/notices/UpdatesWorkspaceRoutes")).WorkspaceUpdateCreateRoute }));
const WorkspaceUpdateEditRoute = lazy(async () => ({ default: (await import("./features/notices/UpdatesWorkspaceRoutes")).WorkspaceUpdateEditRoute }));
const WorkspaceDiaryRoute = lazy(async () => ({ default: (await import("./features/notices/DiaryWorkspaceRoute")).WorkspaceDiaryRoute }));
const LearningAssignmentsRoute = lazy(() => import("./features/learning/LearningAssignmentsRoute"));
const TeachingSessionRoute = lazy(() => import("./features/teaching-sessions/TeachingSessionRoute"));

interface ErrorBoundaryState {
  hasError: boolean;
}

class AppErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ThatCampus UI failed to render", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="route-error">
          <span className="route-error__brand">ThatCampus</span>
          <h1>We couldn't open this view.</h1>
          <p>Your data is safe. Reload the page to try again.</p>
          <button type="button" onClick={() => window.location.reload()}>
            Reload app
          </button>
        </main>
      );
    }

    return this.props.children;
  }
}

interface LegacyRedirectDefinition {
  readonly from: string;
  readonly to: LegacyRouteRedirectProps["to"];
  readonly defaultSearch?: LegacyRouteRedirectProps["defaultSearch"];
  readonly dropSearch?: LegacyRouteRedirectProps["dropSearch"];
}

function legacyAdministrationDestination(search: URLSearchParams) {
  switch (search.get("section")) {
    case "campus": return "/more/setup/institution/campus";
    case "setup": return "/more/setup/institution/academics";
    case "access": return "/more/setup/people/access";
    case "audit": return "/more/setup/institution/history";
    case "promotion": return "/more/setup/institution/promotion";
    case "rules": return "/more/setup/institution/operating-rules";
    default: return "/more/setup/institution";
  }
}

const legacyRedirectRoutes: readonly LegacyRedirectDefinition[] = [
  { from: "/gate", to: "/areas/in-out/operate" },
  { from: "/teacher/gate", to: "/areas/in-out/operate" },
  { from: "/principal/gate", to: "/areas/in-out/manage" },

  { from: "/principal/assistant", to: "/areas/assistant/conversation" },
  { from: "/teacher/assistant", to: "/areas/assistant/conversation" },
  { from: "/parent/assistant", to: "/areas/assistant/conversation" },
  { from: "/student/assistant", to: "/areas/assistant/conversation" },

  { from: "/parent", to: "/today" },
  { from: "/parent/home", to: "/today" },
  { from: "/parent/requests", to: "/work" },
  { from: "/parent/leave", to: "/areas/attendance/leave", defaultSearch: { scope: "dependent" } },
  { from: "/parent/more", to: "/more" },
  { from: "/parent/attendance", to: "/areas/attendance/records", defaultSearch: { scope: "dependent" } },
  { from: "/parent/timetable", to: "/areas/timetable/schedule", defaultSearch: { scope: "dependent" } },
  { from: "/parent/calendar", to: "/areas/calendar", defaultSearch: { scope: "dependent" } },
  { from: "/parent/notices", to: "/areas/messages/updates", defaultSearch: { scope: "dependent" } },
  { from: "/parent/notices/:noticeId", to: ({ noticeId }) => `/areas/messages/updates/${encodeURIComponent(noticeId ?? "")}`, defaultSearch: { scope: "dependent" } },
  { from: "/parent/diary", to: "/areas/messages/diary", defaultSearch: { scope: "dependent" } },
  { from: "/parent/messages", to: "/areas/messages/conversations", defaultSearch: { scope: "dependent" } },
  { from: "/parent/results", to: "/areas/assessments/results", defaultSearch: { scope: "dependent" } },
  { from: "/parent/events", to: "/areas/events/calendar", defaultSearch: { scope: "dependent" } },
  { from: "/parent/events/:eventId", to: ({ eventId }) => `/areas/events/calendar/${encodeURIComponent(eventId ?? "")}`, defaultSearch: { scope: "dependent" } },
  { from: "/parent/fees", to: "/areas/fees/account", defaultSearch: { scope: "dependent" } },
  { from: "/parent/departure", to: "/areas/departure/plan", defaultSearch: { scope: "dependent" } },

  { from: "/student/apps", to: "/more" },
  { from: "/student", to: "/today" },
  { from: "/student/leave", to: "/areas/attendance/leave", defaultSearch: { scope: "self" } },
  { from: "/student/leave/new", to: "/areas/attendance/leave", defaultSearch: { scope: "self", view: "apply" } },
  { from: "/student/attendance", to: "/areas/attendance/records", defaultSearch: { scope: "self" } },
  { from: "/student/attendance/eligibility", to: "/areas/attendance/records", defaultSearch: { scope: "self", view: "eligibility" } },
  { from: "/student/copilot", to: "/areas/attendance/records", defaultSearch: { scope: "self", view: "copilot" } },
  { from: "/student/timetable", to: "/areas/timetable/schedule", defaultSearch: { scope: "self" } },
  { from: "/student/timetable/week", to: "/areas/timetable/schedule", defaultSearch: { scope: "self", view: "week" } },
  { from: "/student/calendar", to: "/areas/calendar", defaultSearch: { scope: "self" } },
  { from: "/student/diary", to: "/areas/messages/diary", defaultSearch: { scope: "self" } },
  { from: "/student/messages", to: "/areas/messages/conversations", defaultSearch: { scope: "self" } },
  { from: "/student/results", to: "/areas/assessments/results", defaultSearch: { scope: "self" } },
  { from: "/student/events", to: "/areas/events/calendar", defaultSearch: { scope: "self" } },
  { from: "/student/events/:eventId", to: ({ eventId }) => `/areas/events/calendar/${encodeURIComponent(eventId ?? "")}`, defaultSearch: { scope: "self" } },
  { from: "/student/fees", to: "/areas/fees/account", defaultSearch: { scope: "self" } },
  { from: "/student/departure", to: "/areas/departure/plan", defaultSearch: { scope: "self" } },
  { from: "/student/classes", to: "/areas/timetable/schedule", defaultSearch: { scope: "self" } },
  { from: "/teacher/classes", to: "/areas/people/classes" },
  { from: "/teacher/classes/:classId", to: ({ classId }) => `/areas/people/classes/${encodeURIComponent(classId ?? "")}` },

  { from: "/teacher/attendance", to: "/areas/attendance/registers" },
  { from: "/teacher", to: "/today" },
  { from: "/teacher/requests", to: "/work" },
  { from: "/teacher/leave", to: "/areas/responsibilities/leave" },
  { from: "/teacher/timetable", to: "/areas/timetable/schedule", defaultSearch: { view: "day" } },
  { from: "/teacher/timetable/weekly", to: "/areas/timetable/schedule", defaultSearch: { view: "week" } },
  { from: "/teacher/calendar", to: "/areas/calendar", defaultSearch: { surface: "assigned" } },
  { from: "/teacher/fees", to: "/areas/fees/ledger" },
  { from: "/teacher/administration", to: (_parameters, search) => legacyAdministrationDestination(search), dropSearch: ["section"] },
  { from: "/teacher/invitations", to: "/more/setup/people/invitations" },
  { from: "/teacher/students", to: "/areas/people/records" },
  { from: "/teacher/students/import", to: "/areas/people/import" },
  { from: "/teacher/more", to: "/more" },
  { from: "/teacher/messages", to: "/areas/messages/conversations" },
  { from: "/teacher/assessments", to: "/areas/assessments/assigned" },
  { from: "/teacher/events", to: "/areas/events/assigned" },
  { from: "/teacher/events/new", to: "/areas/assessments/assigned", defaultSearch: { create: "class-test" } },
  { from: "/teacher/events/:eventId", to: ({ eventId }) => `/areas/events/assigned/${encodeURIComponent(eventId ?? "")}` },
  { from: "/teacher/events/:eventId/edit", to: ({ eventId }) => `/areas/events/assigned/${encodeURIComponent(eventId ?? "")}/edit` },
  { from: "/teacher/events/:eventId/sessions/:sessionId/attendance", to: ({ eventId, sessionId }) => `/areas/events/assigned/${encodeURIComponent(eventId ?? "")}/sessions/${encodeURIComponent(sessionId ?? "")}/attendance` },
  { from: "/teacher/notices", to: "/areas/messages/updates" },
  { from: "/teacher/notices/new", to: "/areas/messages/updates/new" },
  { from: "/teacher/notices/:noticeId", to: ({ noticeId }) => `/areas/messages/updates/${encodeURIComponent(noticeId ?? "")}` },
  { from: "/teacher/notices/:noticeId/edit", to: ({ noticeId }) => `/areas/messages/updates/${encodeURIComponent(noticeId ?? "")}/edit` },
  { from: "/teacher/report-cards", to: "/areas/reports/remarks" },
  { from: "/teacher/safeguarding", to: "/areas/care/concerns" },
  { from: "/teacher/transport", to: "/areas/departure/operate" },
  { from: "/teacher/transport/:tripId", to: ({ tripId }) => `/areas/departure/operate/${encodeURIComponent(tripId ?? "")}` },

  { from: "/principal/attendance", to: "/areas/attendance/coordination" },
  { from: "/principal", to: "/today" },
  { from: "/principal/requests", to: "/work" },
  { from: "/principal/followups", to: "/areas/attendance/follow-ups" },
  { from: "/principal/attendance/thresholds", to: "/areas/attendance/thresholds" },
  { from: "/principal/student-leave", to: "/areas/attendance/leave/review" },
  { from: "/principal/timetable", to: "/areas/timetable/planning" },
  { from: "/principal/timetable/day", to: "/areas/timetable/planning/day" },
  { from: "/principal/timetable/weekly", to: "/areas/timetable/planning/settings" },
  { from: "/principal/calendar", to: "/areas/calendar", defaultSearch: { surface: "manage" } },
  { from: "/principal/fees", to: "/areas/fees/ledger" },
  { from: "/principal/administration", to: (_parameters, search) => legacyAdministrationDestination(search), dropSearch: ["section"] },
  { from: "/principal/get-started", to: "/more/setup/capabilities" },
  { from: "/principal/invitations", to: "/more/setup/people/invitations" },
  { from: "/principal/organization", to: "/more/setup/organization" },
  { from: "/principal/students", to: "/areas/people/records" },
  { from: "/principal/students/import", to: "/areas/people/import" },
  { from: "/principal/roles", to: "/more/setup/responsibilities", defaultSearch: { section: "roles" } },
  { from: "/principal/staff", to: "/more/setup/responsibilities" },
  {
    from: "/principal/staff/:staffProfileId",
    to: ({ staffProfileId }) => `/more/setup/responsibilities/${encodeURIComponent(staffProfileId ?? "")}`,
  },
  { from: "/principal/more", to: "/more" },
  { from: "/principal/messages", to: "/areas/messages/conversations" },
  { from: "/principal/assessments", to: "/areas/assessments/manage" },
  { from: "/principal/events", to: "/areas/events/manage" },
  { from: "/principal/events/new", to: "/areas/events/manage/new" },
  { from: "/principal/events/:eventId", to: ({ eventId }) => `/areas/events/manage/${encodeURIComponent(eventId ?? "")}` },
  { from: "/principal/events/:eventId/edit", to: ({ eventId }) => `/areas/events/manage/${encodeURIComponent(eventId ?? "")}/edit` },
  { from: "/principal/events/:eventId/sessions/:sessionId/attendance", to: ({ eventId, sessionId }) => `/areas/events/manage/${encodeURIComponent(eventId ?? "")}/sessions/${encodeURIComponent(sessionId ?? "")}/attendance` },
  { from: "/principal/notices", to: "/areas/messages/updates" },
  { from: "/principal/notices/new", to: "/areas/messages/updates/new" },
  { from: "/principal/notices/:noticeId", to: ({ noticeId }) => `/areas/messages/updates/${encodeURIComponent(noticeId ?? "")}` },
  { from: "/principal/notices/:noticeId/edit", to: ({ noticeId }) => `/areas/messages/updates/${encodeURIComponent(noticeId ?? "")}/edit` },
  { from: "/principal/report-cards", to: "/areas/reports/remarks" },
  { from: "/principal/safeguarding", to: "/areas/care/concerns" },
  { from: "/principal/departure", to: "/areas/departure/manage" },
  { from: "/principal/departure/journeys/:tripId", to: ({ tripId }) => `/areas/departure/manage/journeys/${encodeURIComponent(tripId ?? "")}` },
  ...legacyMoreRedirectDefinitions,
];

export function App() {
  return (
    <AppProviders>
      <AppErrorBoundary>
        <PortalScreenFrame>
          <Suspense fallback={<ThatCampusLoader label="Opening your campus workspace…" />}>
            <RouteScrollCommitMarker />
            <Routes>
              <Route path="/" element={<RoleLanding />} />
              <Route path="/today" element={<AuthenticatedOnly><WorkspaceRoutePage view="today" /></AuthenticatedOnly>} />
              <Route path="/work" element={<AuthenticatedOnly><WorkspaceRoutePage view="work" /></AuthenticatedOnly>} />
              <Route path="/areas" element={<AuthenticatedOnly><WorkspaceRoutePage view="areas" /></AuthenticatedOnly>} />
              <Route path="/more" element={<AuthenticatedOnly><WorkspaceRoutePage view="more" /></AuthenticatedOnly>} />
              {canonicalMoreRouteDefinitions.map(({ path, Component }) => <Route
                key={`canonical-more-${path}`}
                path={path}
                element={<WorkspaceOnly><Component /></WorkspaceOnly>}
              />)}
              {canonicalSetupRouteDefinitions.map(({ path, Component }) => <Route
                key={`canonical-setup-${path}`}
                path={path}
                element={<WorkspaceOnly><Component /></WorkspaceOnly>}
              />)}
              <Route path="/areas/attendance" element={<WorkspaceOnly><WorkspaceAreaRoutePage areaKey="attendance" /></WorkspaceOnly>} />
              <Route path="/areas/attendance/registers" element={<WorkspaceOnly><ResponsibilityAttendanceRegistersRoute /></WorkspaceOnly>} />
              <Route path="/areas/attendance/coordination" element={<WorkspaceOnly><ResponsibilityAttendanceCoordinationRoute /></WorkspaceOnly>} />
              <Route path="/areas/attendance/follow-ups" element={<WorkspaceOnly><WorkspaceAttendanceFollowupsRoute /></WorkspaceOnly>} />
              <Route path="/areas/attendance/thresholds" element={<WorkspaceOnly><WorkspaceAttendanceThresholdsRoute /></WorkspaceOnly>} />
              <Route path="/areas/attendance/records" element={<WorkspaceOnly><WorkspaceAttendanceRecordsRoute /></WorkspaceOnly>} />
              <Route path="/areas/attendance/leave" element={<WorkspaceOnly><WorkspaceRelationshipLeaveRoute /></WorkspaceOnly>} />
              <Route path="/areas/attendance/leave/review" element={<WorkspaceOnly><WorkspaceStudentLeaveReviewRoute /></WorkspaceOnly>} />
              <Route path="/areas/timetable" element={<WorkspaceOnly><WorkspaceAreaRoutePage areaKey="timetable" /></WorkspaceOnly>} />
              <Route path="/areas/timetable/schedule" element={<WorkspaceOnly><WorkspaceTimetableScheduleRoute /></WorkspaceOnly>} />
              <Route path="/areas/timetable/session" element={<WorkspaceOnly><TeachingSessionRoute /></WorkspaceOnly>} />
              <Route path="/areas/timetable/planning" element={<WorkspaceOnly><WorkspaceTimetablePlanningRoute /></WorkspaceOnly>} />
              <Route path="/areas/timetable/planning/day" element={<WorkspaceOnly><WorkspaceTimetableDayPlanRoute /></WorkspaceOnly>} />
              <Route path="/areas/timetable/planning/settings" element={<WorkspaceOnly><WorkspaceTimetableSettingsRoute /></WorkspaceOnly>} />
              <Route path="/areas/calendar" element={<WorkspaceOnly><WorkspaceCalendarRoute /></WorkspaceOnly>} />
              <Route path="/areas/timetable/calendar" element={<WorkspaceOnly><LegacyRouteRedirect to="/areas/calendar" /></WorkspaceOnly>} />
              <Route path="/areas/assistant/conversation" element={<WorkspaceOnly><WorkspaceAssistantPage /></WorkspaceOnly>} />
              <Route path="/areas/insights" element={<WorkspaceOnly><WorkspaceInsightsRoute /></WorkspaceOnly>} />
              {(["attendance", "results", "progress", "institution", "registers", "review", "recording", "followups", "learning-review", "operations", "finance"] as const).map(topic => <Route
                key={`canonical-insights-${topic}`}
                path={`/areas/insights/${topic}`}
                element={<WorkspaceOnly><WorkspaceInsightsRoute topic={topic} /></WorkspaceOnly>}
              />)}
              <Route path="/areas/insights/review/:studentId" element={<WorkspaceOnly><WorkspaceInsightsRoute topic="review" /></WorkspaceOnly>} />
              <Route path="/areas/messages" element={<WorkspaceOnly><WorkspaceAreaRoutePage areaKey="messages" /></WorkspaceOnly>} />
              <Route path="/areas/messages/conversations" element={<WorkspaceOnly><WorkspaceRelationshipMessagesRoute /></WorkspaceOnly>} />
              <Route path="/areas/messages/updates/new" element={<WorkspaceOnly><WorkspaceUpdateCreateRoute /></WorkspaceOnly>} />
              <Route path="/areas/messages/updates/:noticeId/edit" element={<WorkspaceOnly><WorkspaceUpdateEditRoute /></WorkspaceOnly>} />
              <Route path="/areas/messages/updates/:noticeId" element={<WorkspaceOnly><WorkspaceUpdateDetailRoute /></WorkspaceOnly>} />
              <Route path="/areas/messages/updates" element={<WorkspaceOnly><WorkspaceUpdatesRoute /></WorkspaceOnly>} />
              <Route path="/areas/messages/diary" element={<WorkspaceOnly><WorkspaceDiaryRoute /></WorkspaceOnly>} />
              <Route path="/areas/messages/assignments" element={<WorkspaceOnly><LearningAssignmentsRoute /></WorkspaceOnly>} />
              <Route path="/areas/assessments" element={<WorkspaceOnly><WorkspaceAreaRoutePage areaKey="assessments" /></WorkspaceOnly>} />
              <Route path="/areas/assessments/results" element={<WorkspaceOnly><WorkspaceRelationshipResultsRoute areaKey="assessments" /></WorkspaceOnly>} />
              <Route path="/areas/assessments/assigned" element={<WorkspaceOnly><WorkspaceSurfaceOnly areaKey="assessments" surfaceKey="assigned"><WorkspaceAssignedAssessmentsRoute /></WorkspaceSurfaceOnly></WorkspaceOnly>} />
              <Route path="/areas/assessments/manage" element={<WorkspaceOnly><WorkspaceSurfaceOnly areaKey="assessments" surfaceKey="manage"><WorkspaceManagedAssessmentsRoute /></WorkspaceSurfaceOnly></WorkspaceOnly>} />
              <Route path="/areas/events" element={<WorkspaceOnly><WorkspaceAreaRoutePage areaKey="events" /></WorkspaceOnly>} />
              <Route path="/areas/events/calendar" element={<WorkspaceOnly><WorkspaceEventsCalendarRoute /></WorkspaceOnly>} />
              <Route path="/areas/events/calendar/:eventId" element={<WorkspaceOnly><WorkspaceEventsCalendarDetailRoute /></WorkspaceOnly>} />
              <Route path="/areas/events/assigned" element={<WorkspaceOnly><WorkspaceEventsAssignedRoute /></WorkspaceOnly>} />
              <Route path="/areas/events/assigned/:eventId" element={<WorkspaceOnly><WorkspaceEventsAssignedDetailRoute /></WorkspaceOnly>} />
              <Route path="/areas/events/assigned/:eventId/edit" element={<WorkspaceOnly><WorkspaceEventsAssignedEditRoute /></WorkspaceOnly>} />
              <Route path="/areas/events/assigned/:eventId/sessions/:sessionId/attendance" element={<WorkspaceOnly><WorkspaceEventsAssignedRegisterRoute /></WorkspaceOnly>} />
              <Route path="/areas/events/manage" element={<WorkspaceOnly><WorkspaceEventsManageRoute /></WorkspaceOnly>} />
              <Route path="/areas/events/manage/new" element={<WorkspaceOnly><WorkspaceEventsManageCreateRoute /></WorkspaceOnly>} />
              <Route path="/areas/events/manage/:eventId" element={<WorkspaceOnly><WorkspaceEventsManageDetailRoute /></WorkspaceOnly>} />
              <Route path="/areas/events/manage/:eventId/edit" element={<WorkspaceOnly><WorkspaceEventsManageEditRoute /></WorkspaceOnly>} />
              <Route path="/areas/events/manage/:eventId/sessions/:sessionId/attendance" element={<WorkspaceOnly><WorkspaceEventsManageRegisterRoute /></WorkspaceOnly>} />
              <Route path="/areas/reports" element={<WorkspaceOnly><WorkspaceAreaRoutePage areaKey="reports" /></WorkspaceOnly>} />
              <Route path="/areas/reports/progress" element={<WorkspaceOnly><WorkspaceRelationshipResultsRoute areaKey="reports" /></WorkspaceOnly>} />
              <Route path="/areas/reports/remarks" element={<WorkspaceOnly><WorkspaceSurfaceOnly areaKey="reports" surfaceKey="remarks"><WorkspaceAcademicReportsRoute /></WorkspaceSurfaceOnly></WorkspaceOnly>} />
              <Route path="/areas/departure" element={<WorkspaceOnly><WorkspaceAreaRoutePage areaKey="departure" /></WorkspaceOnly>} />
              <Route path="/areas/departure/plan" element={<WorkspaceOnly><WorkspaceRelationshipDepartureRoute /></WorkspaceOnly>} />
              <Route path="/areas/departure/operate" element={<WorkspaceOnly><WorkspaceSurfaceOnly areaKey="departure" surfaceKey="operate"><CollectorJourneyPage /></WorkspaceSurfaceOnly></WorkspaceOnly>} />
              <Route path="/areas/departure/operate/:tripId" element={<WorkspaceOnly><WorkspaceSurfaceOnly areaKey="departure" surfaceKey="operate"><CollectorJourneyPage /></WorkspaceSurfaceOnly></WorkspaceOnly>} />
              <Route path="/areas/departure/manage" element={<WorkspaceOnly><WorkspaceSurfaceOnly areaKey="departure" surfaceKey="manage"><WorkspaceDepartureManagementPage /></WorkspaceSurfaceOnly></WorkspaceOnly>} />
              <Route path="/areas/departure/manage/journeys/:tripId" element={<WorkspaceOnly><WorkspaceSurfaceOnly areaKey="departure" surfaceKey="manage"><JourneyDetailPage /></WorkspaceSurfaceOnly></WorkspaceOnly>} />
              <Route path="/areas/responsibilities" element={<WorkspaceOnly><WorkspaceAreaRoutePage areaKey="responsibilities" /></WorkspaceOnly>} />
              <Route path="/areas/responsibilities/mine" element={<WorkspaceOnly><WorkspaceSurfaceOnly areaKey="responsibilities" surfaceKey="mine"><WorkspaceResponsibilitiesRoute /></WorkspaceSurfaceOnly></WorkspaceOnly>} />
              <Route path="/areas/responsibilities/coverage" element={<WorkspaceOnly><WorkspaceSurfaceOnly areaKey="responsibilities" surfaceKey="coverage"><WorkspaceCoverageRoute /></WorkspaceSurfaceOnly></WorkspaceOnly>} />
              <Route path="/areas/responsibilities/leave" element={<WorkspaceOnly><WorkspaceSurfaceOnly areaKey="responsibilities" surfaceKey="leave"><WorkspaceStaffLeaveRoute /></WorkspaceSurfaceOnly></WorkspaceOnly>} />
              <Route path="/areas/care" element={<WorkspaceOnly><WorkspaceCareHomeRoute /></WorkspaceOnly>} />
              <Route path="/areas/resources" element={<WorkspaceOnly><ResourcesWorkspaceRoute /></WorkspaceOnly>} />
              <Route path="/areas/facilities" element={<WorkspaceOnly><FacilitiesWorkspaceRoute /></WorkspaceOnly>} />
              <Route path="/areas/accommodation" element={<WorkspaceOnly><AccommodationWorkspaceRoute /></WorkspaceOnly>} />
              <Route path="/areas/dining" element={<WorkspaceOnly><DiningWorkspaceRoute /></WorkspaceOnly>} />
              <Route path="/areas/care/concerns" element={<WorkspaceOnly><WorkspaceSurfaceOnly areaKey="care" surfaceKey="concerns"><WorkspaceCareRoute /></WorkspaceSurfaceOnly></WorkspaceOnly>} />
              <Route path="/areas/in-out" element={<WorkspaceOnly><WorkspaceAreaRoutePage areaKey="in-out" /></WorkspaceOnly>} />
              <Route path="/areas/in-out/visits" element={<WorkspaceOnly><WorkspaceSurfaceOnly areaKey="in-out" surfaceKey="visits"><WorkspaceVisitsRoute /></WorkspaceSurfaceOnly></WorkspaceOnly>} />
              <Route path="/areas/in-out/operate" element={<WorkspaceOnly><WorkspaceSurfaceOnly areaKey="in-out" surfaceKey="operate"><WorkspaceInOutOperateRoute /></WorkspaceSurfaceOnly></WorkspaceOnly>} />
              <Route path="/areas/in-out/manage" element={<WorkspaceOnly><WorkspaceSurfaceOnly areaKey="in-out" surfaceKey="manage"><WorkspaceInOutManageRoute /></WorkspaceSurfaceOnly></WorkspaceOnly>} />
              <Route path="/work/in-out/approvals" element={<WorkspaceOnly><WorkspaceInOutApprovalsRoute /></WorkspaceOnly>} />
              <Route path="/areas/people" element={<WorkspaceOnly><WorkspaceAreaRoutePage areaKey="people" /></WorkspaceOnly>} />
              <Route path="/areas/people/participants" element={<WorkspaceOnly><WorkspaceSurfaceOnly areaKey="people" surfaceKey="participants"><PeopleParticipantsPage /></WorkspaceSurfaceOnly></WorkspaceOnly>} />
              <Route path="/areas/people/participants/:personId" element={<WorkspaceOnly><WorkspaceSurfaceOnly areaKey="people" surfaceKey="participants"><PersonProfilePage /></WorkspaceSurfaceOnly></WorkspaceOnly>} />
              <Route path="/areas/people/groups/:groupId" element={<WorkspaceOnly><WorkspaceSurfaceOnly areaKey="people" surfaceKey="participants"><PeopleGroupDetailPage /></WorkspaceSurfaceOnly></WorkspaceOnly>} />
              <Route path="/areas/people/records" element={<WorkspaceOnly><WorkspaceSurfaceOnly areaKey="people" surfaceKey="records"><WorkspacePeopleRecordsRoute /></WorkspaceSurfaceOnly></WorkspaceOnly>} />
              <Route path="/areas/people/import" element={<WorkspaceOnly><WorkspaceSurfaceOnly areaKey="people" surfaceKey="import"><WorkspacePeopleImportRoute /></WorkspaceSurfaceOnly></WorkspaceOnly>} />
              <Route path="/areas/people/classes" element={<WorkspaceOnly><WorkspaceAssignedClassesRoute /></WorkspaceOnly>} />
              <Route path="/areas/people/classes/:classId" element={<WorkspaceOnly><WorkspaceAssignedClassRoute /></WorkspaceOnly>} />
              <Route path="/areas/fees" element={<WorkspaceOnly><WorkspaceFeesRoute /></WorkspaceOnly>} />
              <Route path="/areas/fees/ledger" element={<WorkspaceOnly><WorkspaceFeeLedgerRoute /></WorkspaceOnly>} />
              <Route path="/areas/fees/account" element={<WorkspaceOnly><WorkspaceFeeAccountRoute /></WorkspaceOnly>} />
              {legacyRedirectRoutes.map(({ from, to, defaultSearch, dropSearch }) => <Route
                key={`legacy-redirect-${from}`}
                path={from}
                element={<LegacyRouteRedirect
                  to={to}
                  {...(defaultSearch ? { defaultSearch } : {})}
                  {...(dropSearch ? { dropSearch } : {})}
                />}
              />)}
              <Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />
              <Route path="/demo" element={<PublicDemoPage />} />
              <Route path="/signup" element={<PublicOnly><SignupPage /></PublicOnly>} />
              <Route path="/forgot-password" element={<PublicOnly><ForgotPasswordPage /></PublicOnly>} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="/account/security" element={<AuthenticatedOnly><AccountSecurityPage /></AuthenticatedOnly>} />
              <Route path="/onboarding/start" element={<AuthenticatedOnly><SelfServiceOnboardingPage /></AuthenticatedOnly>} />
              <Route path="/onboarding/pending" element={<Navigate to="/onboarding/start" replace />} />
              <Route path="/company" element={<CompanyOnly><CompanyPage /></CompanyOnly>} />
              <Route path="/company/institutions/:id" element={<CompanyOnly><CompanyPage /></CompanyOnly>} />
              <Route path="/join" element={<JoinPage />} />
              <Route path="/workspace" element={<AuthenticatedOnly><WorkspaceUnavailablePage /></AuthenticatedOnly>} />
              <Route path="/work/staff-leave" element={<AuthenticatedOnly><AuthorizedStaffLeaveDecisionRoute /></AuthenticatedOnly>} />
              <Route path="/work/fee-reviews/:reviewId" element={<AuthenticatedOnly><NativeFeeReviewRecoveryRoute /></AuthenticatedOnly>} />
              {(["principal", "teacher", "parent", "student"] as const).flatMap(portal => ["analytics", "insights"].map(section => <Route
                key={`legacy-${section}-${portal}`}
                path={`/${portal}/${section}/*`}
                element={<WorkspaceOnly><LegacyInsightsRedirect /></WorkspaceOnly>}
              />))}

              <Route path="*" element={<RoleLanding />} />
            </Routes>
          </Suspense>
        </PortalScreenFrame>
      </AppErrorBoundary>
    </AppProviders>
  );
}
