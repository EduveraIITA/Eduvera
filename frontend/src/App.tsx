import { Component, lazy, Suspense, type ErrorInfo, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppProviders } from "./app/AppProviders";
import {
  AuthenticatedOnly,
  PortalOnly,
  PublicOnly,
  RoleLanding,
} from "./features/auth/RouteGuards";

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
const ParentChatRoute = lazy(async () => ({ default: (await import("./features/chat/ChatPage")).ParentChatRoute }));
const StudentChatRoute = lazy(async () => ({ default: (await import("./features/chat/ChatPage")).StudentChatRoute }));
const TeacherChatRoute = lazy(async () => ({ default: (await import("./features/chat/ChatPage")).TeacherChatRoute }));
const PrincipalChatRoute = lazy(async () => ({ default: (await import("./features/chat/ChatPage")).PrincipalChatRoute }));

function PageLoader() {
  return (
    <div className="route-loader" role="status" aria-live="polite">
      <span className="route-loader__mark" aria-hidden="true" />
      <span>Opening Edura OS…</span>
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
          <span className="route-error__brand">Edura OS</span>
          <h1>We couldn’t open this view.</h1>
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
              <Route path="/workspace" element={<AuthenticatedOnly><WorkspaceUnavailablePage /></AuthenticatedOnly>} />

              <Route path="/parent" element={<Navigate to="/parent/home" replace />} />
              <Route path="/parent/home" element={<PortalOnly portal="parent"><ParentHomeRoute /></PortalOnly>} />
              <Route path="/parent/attendance" element={<PortalOnly portal="parent"><ParentAttendanceRoute /></PortalOnly>} />
              <Route path="/parent/leave" element={<PortalOnly portal="parent"><ParentLeaveRoute /></PortalOnly>} />
              <Route path="/parent/diary" element={<PortalOnly portal="parent"><ParentDiaryRoute /></PortalOnly>} />
              <Route path="/parent/timetable" element={<PortalOnly portal="parent"><ParentTimetableRoute /></PortalOnly>} />
              <Route path="/parent/messages" element={<PortalOnly portal="parent"><ParentChatRoute /></PortalOnly>} />

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
              <Route path="/student/fees" element={<PortalOnly portal="student"><StudentModulesPage focus="fees" /></PortalOnly>} />
              <Route path="/student/diary" element={<PortalOnly portal="student"><StudentDiaryRoute /></PortalOnly>} />
              <Route path="/student/messages" element={<PortalOnly portal="student"><StudentChatRoute /></PortalOnly>} />

              <Route path="/teacher" element={<PortalOnly portal="teacher"><TeacherHomeRoute /></PortalOnly>} />
              <Route path="/teacher/attendance" element={<PortalOnly portal="teacher"><TeacherAttendanceRoute /></PortalOnly>} />
              <Route path="/teacher/timetable" element={<PortalOnly portal="teacher"><TeacherTimetableRoute /></PortalOnly>} />
              <Route path="/teacher/messages" element={<PortalOnly portal="teacher"><TeacherChatRoute /></PortalOnly>} />
              <Route path="/principal" element={<PortalOnly portal="principal"><PrincipalHomeRoute /></PortalOnly>} />
              <Route path="/principal/attendance" element={<PortalOnly portal="principal"><PrincipalAttendanceRoute /></PortalOnly>} />
              <Route path="/principal/timetable" element={<PortalOnly portal="principal"><PrincipalTimetableRoute /></PortalOnly>} />
              <Route path="/principal/messages" element={<PortalOnly portal="principal"><PrincipalChatRoute /></PortalOnly>} />

              <Route path="*" element={<RoleLanding />} />
            </Routes>
          </Suspense>
        </div>
      </AppErrorBoundary>
    </AppProviders>
  );
}
