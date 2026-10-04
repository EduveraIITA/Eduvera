import { Component, lazy, Suspense, type ErrorInfo, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppProviders } from "./app/AppProviders";
import {
  AuthenticatedOnly,
  CompanyOnly,
  PortalOnly,
  PublicOnly,
  RoleLanding,
} from "./features/auth/RouteGuards";

const CompanyPage=lazy(()=>import('./features/onboarding/CompanyPage'));
const JoinPage=lazy(()=>import('./features/onboarding/JoinPage'));
const InvitationsPage=lazy(()=>import('./features/onboarding/InvitationsPage'));
const RolesPage = lazy(() => import("./features/roles/RolesPage"));

const LoginPage = lazy(async () => ({
  default: (await import("./features/auth/AuthPages")).LoginPage,
}));
const SignupPage = lazy(async () => ({
  default: (await import("./features/auth/AuthPages")).SignupPage,
}));
const PendingOnboardingPage = lazy(async () => ({
  default: (await import("./features/auth/AuthPages")).PendingOnboardingPage,
}));
const WorkspaceUnavailablePage = lazy(async () => ({
  default: (await import("./features/auth/AuthPages")).WorkspaceUnavailablePage,
}));

const ParentHomeRoute = lazy(async () => ({
  default: (await import("./features/school/ParentLiveRoutes")).ParentHomeRoute,
}));
const ParentAttendanceRoute = lazy(async () => ({
  default: (await import("./features/school/ParentLiveRoutes")).ParentAttendanceRoute,
}));
const ParentLeaveRoute = lazy(async () => ({
  default: (await import("./features/school/ParentLiveRoutes")).ParentLeaveRoute,
}));
const ParentDiaryRoute = lazy(async () => ({
  default: (await import("./features/school/ParentLiveRoutes")).ParentDiaryRoute,
}));
const StudentAttendanceRoute = lazy(async () => ({
  default: (await import("./features/school/StudentLiveRoutes")).StudentAttendanceRoute,
}));
const StudentHomeRoute = lazy(async () => ({
  default: (await import("./features/school/StudentLiveRoutes")).StudentHomeRoute,
}));
const StudentDiaryRoute = lazy(async () => ({
  default: (await import("./features/school/StudentLiveRoutes")).StudentDiaryRoute,
}));
const StudentCopilotRoute = lazy(async () => ({
  default: (await import("./features/school/StudentLiveRoutes")).StudentCopilotRoute,
}));
const StudentEligibilityRoute = lazy(async () => ({
  default: (await import("./features/school/StudentLiveRoutes")).StudentEligibilityRoute,
}));
const StudentLeaveNewRoute = lazy(async () => ({
  default: (await import("./features/school/StudentLiveRoutes")).StudentLeaveNewRoute,
}));
const StudentLeaveStatusRoute = lazy(async () => ({
  default: (await import("./features/school/StudentLiveRoutes")).StudentLeaveStatusRoute,
}));
const StudentTimetableRoute = lazy(async () => ({
  default: (await import("./features/school/StudentLiveRoutes")).StudentTimetableRoute,
}));
const StudentWeekGridRoute = lazy(async () => ({
  default: (await import("./features/school/StudentLiveRoutes")).StudentWeekGridRoute,
}));
const ParentTimetableRoute = lazy(async () => ({
  default: (await import("./features/school/ParentLiveRoutes")).ParentTimetableRoute,
}));
const StudentModulesPage = lazy(async () => ({
  default: (await import("./pages/student/StudentModulesPage")).StudentModulesPage,
}));
const TeacherHomeRoute = lazy(async () => ({ default: (await import("./features/operations/OperationsRoutes")).TeacherHomeRoute }));
const TeacherAttendanceRoute = lazy(async () => ({ default: (await import("./features/operations/OperationsRoutes")).TeacherAttendanceRoute }));
const TeacherTimetableRoute = lazy(async () => ({ default: (await import("./features/operations/OperationsRoutes")).TeacherTimetableRoute }));
const PrincipalHomeRoute = lazy(async () => ({ default: (await import("./features/operations/OperationsRoutes")).PrincipalHomeRoute }));
const PrincipalAttendanceRoute = lazy(async () => ({ default: (await import("./features/operations/OperationsRoutes")).PrincipalAttendanceRoute }));
const PrincipalTimetableRoute = lazy(async () => ({ default: (await import("./features/operations/OperationsRoutes")).PrincipalTimetableRoute }));
const PrincipalDayPlanPage = lazy(() => import('./features/day-plans/PrincipalDayPlanPage'));
const TeacherDayPage = lazy(() => import('./features/day-plans/TeacherDayPage'));
const PeoplePage = lazy(() => import("./features/people/PeoplePage"));
const PeopleImportPage = lazy(() => import("./features/people/PeopleImportPage"));
const ParentChatRoute = lazy(async () => ({ default: (await import("./features/chat/ChatPage")).ParentChatRoute }));
const StudentChatRoute = lazy(async () => ({ default: (await import("./features/chat/ChatPage")).StudentChatRoute }));
const TeacherChatRoute = lazy(async () => ({ default: (await import("./features/chat/ChatPage")).TeacherChatRoute }));
const PrincipalChatRoute = lazy(async () => ({ default: (await import("./features/chat/ChatPage")).PrincipalChatRoute }));
const TeacherSafeguardingRoute = lazy(async () => ({ default: (await import("./features/chat/SafeguardingPage")).TeacherSafeguardingRoute }));
const PrincipalSafeguardingRoute = lazy(async () => ({ default: (await import("./features/chat/SafeguardingPage")).PrincipalSafeguardingRoute }));
const PrincipalEventsRoute = lazy(async () => ({ default: (await import("./features/campus-events/CampusEventRoutes")).PrincipalEventsRoute }));
const PrincipalEventDetailRoute = lazy(async () => ({ default: (await import("./features/campus-events/CampusEventRoutes")).PrincipalEventDetailRoute }));
const PrincipalEventCreateRoute = lazy(async () => ({ default: (await import("./features/campus-events/CampusEventRoutes")).PrincipalEventCreateRoute }));
const PrincipalEventEditRoute = lazy(async () => ({ default: (await import("./features/campus-events/CampusEventRoutes")).PrincipalEventEditRoute }));
const PrincipalEventRegisterRoute = lazy(async () => ({ default: (await import("./features/campus-events/CampusEventRoutes")).PrincipalEventRegisterRoute }));
const TeacherEventsRoute = lazy(async () => ({ default: (await import("./features/campus-events/CampusEventRoutes")).TeacherEventsRoute }));
const TeacherEventDetailRoute = lazy(async () => ({ default: (await import("./features/campus-events/CampusEventRoutes")).TeacherEventDetailRoute }));
const TeacherEventCreateRoute = lazy(async () => ({ default: (await import("./features/campus-events/CampusEventRoutes")).TeacherEventCreateRoute }));
const TeacherEventEditRoute = lazy(async () => ({ default: (await import("./features/campus-events/CampusEventRoutes")).TeacherEventEditRoute }));
const TeacherEventRegisterRoute = lazy(async () => ({ default: (await import("./features/campus-events/CampusEventRoutes")).TeacherEventRegisterRoute }));
const ParentEventsRoute = lazy(async () => ({ default: (await import("./features/campus-events/CampusEventRoutes")).ParentEventsRoute }));
const ParentEventDetailRoute = lazy(async () => ({ default: (await import("./features/campus-events/CampusEventRoutes")).ParentEventDetailRoute }));
const StudentEventsRoute = lazy(async () => ({ default: (await import("./features/campus-events/CampusEventRoutes")).StudentEventsRoute }));
const StudentEventDetailRoute = lazy(async () => ({ default: (await import("./features/campus-events/CampusEventRoutes")).StudentEventDetailRoute }));
const ParentMoreRoute = lazy(async () => ({ default: (await import("./features/more/MorePage")).ParentMoreRoute }));
const TeacherMoreRoute = lazy(async () => ({ default: (await import("./features/more/MorePage")).TeacherMoreRoute }));
const PrincipalMoreRoute = lazy(async () => ({ default: (await import("./features/more/MorePage")).PrincipalMoreRoute }));
const ParentCalendarRoute = lazy(async () => ({ default: (await import("./features/calendar/CalendarRoutes")).ParentCalendarRoute }));
const StudentCalendarRoute = lazy(async () => ({ default: (await import("./features/calendar/CalendarRoutes")).StudentCalendarRoute }));
const TeacherCalendarRoute = lazy(async () => ({ default: (await import("./features/calendar/CalendarRoutes")).TeacherCalendarRoute }));
const PrincipalCalendarRoute = lazy(async () => ({ default: (await import("./features/calendar/CalendarRoutes")).PrincipalCalendarRoute }));
const TeacherClassesPage = lazy(() => import("./features/classes/TeacherClassesPage"));
const AdministrationPage = lazy(() => import("./features/office/AdministrationPage"));
const FeeLedgerPage = lazy(() => import("./features/office/FeeLedgerPage"));
const FamilyFeesPage = lazy(async () => ({ default: (await import("./features/office/FamilyFeesPage")).FamilyFeesPage }));
const PrincipalStaffRoute = lazy(async () => ({ default: (await import("./features/staff-operations/StaffOperationsRoutes")).PrincipalStaffRoute }));
const TeacherLeaveRoute = lazy(async () => ({ default: (await import("./features/staff-operations/StaffOperationsRoutes")).TeacherLeaveRoute }));
const TeacherResponsibilitiesRoute = lazy(async () => ({ default: (await import("./features/staff-operations/StaffOperationsRoutes")).TeacherResponsibilitiesRoute }));
const PrincipalGovernanceRoute = lazy(async () => ({ default: (await import("./features/governance/GovernanceRoutes")).PrincipalGovernanceRoute }));
const ParentPoliciesRoute = lazy(async () => ({ default: (await import("./features/governance/GovernanceRoutes")).ParentPoliciesRoute }));
const StudentPoliciesRoute = lazy(async () => ({ default: (await import("./features/governance/GovernanceRoutes")).StudentPoliciesRoute }));
const TeacherPoliciesRoute = lazy(async () => ({ default: (await import("./features/governance/GovernanceRoutes")).TeacherPoliciesRoute }));

function PageLoader() {
  return (
    <div className="route-loader" role="status" aria-live="polite">
      <span className="route-loader__mark" aria-hidden="true" />
      <span>Opening your school portal...</span>
    </div>
  );
}

interface ErrorBoundaryState {
  hasError: boolean;
}

class AppErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Edura OS UI failed to render", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="route-error">
          <span className="route-error__brand">School portal</span>
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

export function App() {
  return (
    <AppProviders>
      <AppErrorBoundary>
        <div className="app-viewport">
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/" element={<RoleLanding />} />
              <Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />
              <Route path="/signup" element={<PublicOnly><SignupPage /></PublicOnly>} />
              <Route path="/onboarding/pending" element={<AuthenticatedOnly><PendingOnboardingPage /></AuthenticatedOnly>} />
              <Route path="/company" element={<CompanyOnly><CompanyPage /></CompanyOnly>} />
              <Route path="/join" element={<JoinPage />} />
              <Route path="/principal/invitations" element={<PortalOnly portal="principal"><InvitationsPage /></PortalOnly>} />
              <Route path="/teacher/invitations" element={<PortalOnly portal="teacher"><InvitationsPage /></PortalOnly>} />
              <Route path="/teacher/students" element={<PortalOnly portal="teacher"><PeoplePage /></PortalOnly>} />
              <Route path="/teacher/students/import" element={<PortalOnly portal="teacher"><PeopleImportPage /></PortalOnly>} />
              <Route path="/workspace" element={<AuthenticatedOnly><WorkspaceUnavailablePage /></AuthenticatedOnly>} />

              <Route path="/parent" element={<Navigate to="/parent/home" replace />} />
              <Route path="/parent/home" element={<PortalOnly portal="parent"><ParentHomeRoute /></PortalOnly>} />
              <Route path="/parent/attendance" element={<PortalOnly portal="parent"><ParentAttendanceRoute /></PortalOnly>} />
              <Route path="/parent/leave" element={<PortalOnly portal="parent"><ParentLeaveRoute /></PortalOnly>} />
              <Route path="/parent/diary" element={<PortalOnly portal="parent"><ParentDiaryRoute /></PortalOnly>} />
              <Route path="/parent/timetable" element={<PortalOnly portal="parent"><ParentTimetableRoute /></PortalOnly>} />
              <Route path="/parent/messages" element={<PortalOnly portal="parent"><ParentChatRoute /></PortalOnly>} />
              <Route path="/parent/events" element={<PortalOnly portal="parent"><ParentEventsRoute /></PortalOnly>} />
              <Route path="/parent/events/:eventId" element={<PortalOnly portal="parent"><ParentEventDetailRoute /></PortalOnly>} />
              <Route path="/parent/more" element={<PortalOnly portal="parent"><ParentMoreRoute /></PortalOnly>} />
              <Route path="/parent/calendar" element={<PortalOnly portal="parent"><ParentCalendarRoute /></PortalOnly>} />
              <Route path="/parent/fees" element={<PortalOnly portal="parent"><FamilyFeesPage portal="parent" /></PortalOnly>} />
              <Route path="/parent/policies" element={<PortalOnly portal="parent"><ParentPoliciesRoute /></PortalOnly>} />

              <Route path="/student" element={<PortalOnly portal="student"><StudentHomeRoute /></PortalOnly>} />
              <Route path="/student/attendance" element={<PortalOnly portal="student"><StudentAttendanceRoute /></PortalOnly>} />
              <Route path="/student/attendance/eligibility" element={<PortalOnly portal="student"><StudentEligibilityRoute /></PortalOnly>} />
              <Route path="/student/classes" element={<Navigate to="/student/timetable" replace />} />
              <Route path="/student/leave/new" element={<PortalOnly portal="student"><StudentLeaveNewRoute /></PortalOnly>} />
              <Route path="/student/leave" element={<PortalOnly portal="student"><StudentLeaveStatusRoute /></PortalOnly>} />
              <Route path="/student/timetable" element={<PortalOnly portal="student"><StudentTimetableRoute /></PortalOnly>} />
              <Route path="/student/timetable/week" element={<PortalOnly portal="student"><StudentWeekGridRoute /></PortalOnly>} />

              <Route path="/student/copilot" element={<PortalOnly portal="student"><StudentCopilotRoute /></PortalOnly>} />
              <Route path="/student/apps" element={<PortalOnly portal="student"><StudentModulesPage /></PortalOnly>} />
              <Route path="/student/fees" element={<PortalOnly portal="student"><FamilyFeesPage portal="student" /></PortalOnly>} />
              <Route path="/student/diary" element={<PortalOnly portal="student"><StudentDiaryRoute /></PortalOnly>} />
              <Route path="/student/messages" element={<PortalOnly portal="student"><StudentChatRoute /></PortalOnly>} />
              <Route path="/student/events" element={<PortalOnly portal="student"><StudentEventsRoute /></PortalOnly>} />
              <Route path="/student/events/:eventId" element={<PortalOnly portal="student"><StudentEventDetailRoute /></PortalOnly>} />
              <Route path="/student/calendar" element={<PortalOnly portal="student"><StudentCalendarRoute /></PortalOnly>} />
              <Route path="/student/policies" element={<PortalOnly portal="student"><StudentPoliciesRoute /></PortalOnly>} />

              <Route path="/teacher" element={<PortalOnly portal="teacher"><TeacherHomeRoute /></PortalOnly>} />
              <Route path="/teacher/attendance" element={<PortalOnly portal="teacher"><TeacherAttendanceRoute /></PortalOnly>} />
              <Route path="/teacher/timetable" element={<PortalOnly portal="teacher"><TeacherDayPage /></PortalOnly>} />
              <Route path="/teacher/timetable/weekly" element={<PortalOnly portal="teacher"><TeacherTimetableRoute /></PortalOnly>} />
              <Route path="/teacher/messages" element={<PortalOnly portal="teacher"><TeacherChatRoute /></PortalOnly>} />
              <Route path="/teacher/safeguarding" element={<PortalOnly portal="teacher"><TeacherSafeguardingRoute /></PortalOnly>} />
              <Route path="/teacher/events" element={<PortalOnly portal="teacher"><TeacherEventsRoute /></PortalOnly>} />
              <Route path="/teacher/events/new" element={<PortalOnly portal="teacher"><TeacherEventCreateRoute /></PortalOnly>} />
              <Route path="/teacher/events/:eventId" element={<PortalOnly portal="teacher"><TeacherEventDetailRoute /></PortalOnly>} />
              <Route path="/teacher/events/:eventId/edit" element={<PortalOnly portal="teacher"><TeacherEventEditRoute /></PortalOnly>} />
              <Route path="/teacher/events/:eventId/sessions/:sessionId/attendance" element={<PortalOnly portal="teacher"><TeacherEventRegisterRoute /></PortalOnly>} />
              <Route path="/teacher/fees" element={<PortalOnly portal="teacher"><FeeLedgerPage /></PortalOnly>} />
              <Route path="/teacher/administration" element={<PortalOnly portal="teacher"><AdministrationPage /></PortalOnly>} />
              <Route path="/teacher/more" element={<PortalOnly portal="teacher"><TeacherMoreRoute /></PortalOnly>} />
              <Route path="/teacher/calendar" element={<PortalOnly portal="teacher"><TeacherCalendarRoute /></PortalOnly>} />
              <Route path="/teacher/classes" element={<PortalOnly portal="teacher"><TeacherClassesPage /></PortalOnly>} />
              <Route path="/teacher/leave" element={<PortalOnly portal="teacher"><TeacherLeaveRoute /></PortalOnly>} />
              <Route path="/teacher/responsibilities" element={<PortalOnly portal="teacher"><TeacherResponsibilitiesRoute /></PortalOnly>} />
              <Route path="/teacher/policies" element={<PortalOnly portal="teacher"><TeacherPoliciesRoute /></PortalOnly>} />
              <Route path="/principal" element={<PortalOnly portal="principal"><PrincipalHomeRoute /></PortalOnly>} />
              <Route path="/principal/attendance" element={<PortalOnly portal="principal"><PrincipalAttendanceRoute /></PortalOnly>} />
              <Route path="/principal/timetable" element={<PortalOnly portal="principal"><PrincipalDayPlanPage /></PortalOnly>} />
              <Route path="/principal/timetable/day" element={<PortalOnly portal="principal"><PrincipalDayPlanPage /></PortalOnly>} />
              <Route path="/principal/timetable/weekly" element={<PortalOnly portal="principal"><PrincipalTimetableRoute /></PortalOnly>} />
              <Route path="/principal/students" element={<PortalOnly portal="principal"><PeoplePage /></PortalOnly>} />
              <Route path="/principal/students/import" element={<PortalOnly portal="principal"><PeopleImportPage /></PortalOnly>} />
              <Route path="/principal/roles" element={<PortalOnly portal="principal"><RolesPage /></PortalOnly>} />
              <Route path="/principal/administration" element={<PortalOnly portal="principal"><AdministrationPage /></PortalOnly>} />
              <Route path="/principal/fees" element={<PortalOnly portal="principal"><FeeLedgerPage /></PortalOnly>} />
              <Route path="/principal/staff" element={<PortalOnly portal="principal"><PrincipalStaffRoute /></PortalOnly>} />
              <Route path="/principal/messages" element={<PortalOnly portal="principal"><PrincipalChatRoute /></PortalOnly>} />
              <Route path="/principal/safeguarding" element={<PortalOnly portal="principal"><PrincipalSafeguardingRoute /></PortalOnly>} />
              <Route path="/principal/events" element={<PortalOnly portal="principal"><PrincipalEventsRoute /></PortalOnly>} />
              <Route path="/principal/events/new" element={<PortalOnly portal="principal"><PrincipalEventCreateRoute /></PortalOnly>} />
              <Route path="/principal/events/:eventId" element={<PortalOnly portal="principal"><PrincipalEventDetailRoute /></PortalOnly>} />
              <Route path="/principal/events/:eventId/edit" element={<PortalOnly portal="principal"><PrincipalEventEditRoute /></PortalOnly>} />
              <Route path="/principal/events/:eventId/sessions/:sessionId/attendance" element={<PortalOnly portal="principal"><PrincipalEventRegisterRoute /></PortalOnly>} />
              <Route path="/principal/more" element={<PortalOnly portal="principal"><PrincipalMoreRoute /></PortalOnly>} />
              <Route path="/principal/calendar" element={<PortalOnly portal="principal"><PrincipalCalendarRoute /></PortalOnly>} />
              <Route path="/principal/governance" element={<PortalOnly portal="principal"><PrincipalGovernanceRoute /></PortalOnly>} />

              <Route path="*" element={<RoleLanding />} />
            </Routes>
          </Suspense>
        </div>
      </AppErrorBoundary>
    </AppProviders>
  );
}
