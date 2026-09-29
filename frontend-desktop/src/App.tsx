import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { Shell } from "./components/Shell";
import { ToastProvider } from "./components/ui";
import { AuthProvider, useAuth } from "./lib/auth";
import { AttendanceIndex, RegisterPage } from "./pages/AttendancePage";
import { SchoolEventBridge } from "./features/school/SchoolEventBridge";
import { ParentAttendancePage, StudentAttendancePage } from "./pages/FamilyAttendance";
import { ParentHome, StudentHome } from "./pages/FamilyHome";
import { FamilyDiaryPage, FamilyTimetablePage, ParentLeavePage, StudentLeavePage } from "./pages/FamilyPages";
import { LeavePage } from "./pages/LeavePage";
import { LoginPage } from "./pages/LoginPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { PrincipalHome } from "./pages/PrincipalHome";
import { TeacherHome } from "./pages/TeacherHome";
import { TimetablePage } from "./pages/TimetablePage";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 15_000 } },
});

function RequireStaff() {
  const { status, persona } = useAuth();
  if (status === "loading") return <div style={{ padding: 40, color: "var(--faint)" }}>Loading…</div>;
  if (status !== "signed-in" || !persona) return <Navigate to="/login" replace />;
  return <Outlet />;
}

function Only({ personas }: { personas: string[] }) {
  const { persona } = useAuth();
  return persona && personas.includes(persona) ? <Outlet /> : <Navigate to="/" replace />;
}

/* One route, four screens: each persona opens on its own question. */
function Home() {
  const { persona } = useAuth();
  if (persona === "principal") return <PrincipalHome />;
  if (persona === "teacher") return <TeacherHome />;
  if (persona === "parent") return <ParentHome />;
  return <StudentHome />;
}
function Attendance() {
  const { persona } = useAuth();
  if (persona === "parent") return <ParentAttendancePage />;
  if (persona === "student") return <StudentAttendancePage />;
  return <AttendanceIndex />;
}
function Leave() {
  const { persona } = useAuth();
  if (persona === "parent") return <ParentLeavePage />;
  if (persona === "student") return <StudentLeavePage />;
  return <LeavePage />;
}
function Timetable() {
  const { persona } = useAuth();
  return persona === "principal" ? <TimetablePage /> : <FamilyTimetablePage />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <SchoolEventBridge />
        <ToastProvider>
          <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route element={<RequireStaff />}>
                <Route element={<Shell />}>
                  <Route index element={<Home />} />
                  <Route path="attendance" element={<Attendance />} />
                  <Route element={<Only personas={["principal", "teacher"]} />}>
                    <Route path="attendance/:classId" element={<RegisterPage />} />
                  </Route>
                  <Route path="leave" element={<Leave />} />
                  <Route path="notifications" element={<NotificationsPage />} />
                  <Route element={<Only personas={["principal", "parent", "student"]} />}>
                    <Route path="timetable" element={<Timetable />} />
                  </Route>
                  <Route element={<Only personas={["parent", "student"]} />}>
                    <Route path="diary" element={<FamilyDiaryPage />} />
                  </Route>
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Route>
              </Route>
            </Routes>
          </BrowserRouter>
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
