import { Navigate, useLocation } from "react-router-dom";
import PrincipalDayPlanPage from "../day-plans/PrincipalDayPlanPage";
import { PrincipalCalendarRoute } from "../calendar/CalendarRoutes";
import { useOptionalAuth } from "../auth/AuthContext";
import { PrincipalPlannerRoute } from "../planner/PrincipalPlannerRoute";
import type { TimetableRehearsalIndicator } from "../planner/rehearsal";
import { useTimetableExperience } from "./timetableExperience";

function useExperience() {
  const auth = useOptionalAuth();
  return useTimetableExperience(auth?.user?.id ?? "anonymous");
}

export function PrincipalTimetableExperienceRoute({ rehearsal }: { rehearsal?: TimetableRehearsalIndicator | null } = {}) {
  return useExperience() === "timeline" ? <PrincipalPlannerRoute rehearsal={rehearsal} /> : <PrincipalDayPlanPage rehearsal={rehearsal} />;
}

export function PrincipalCalendarExperienceRoute() {
  const location = useLocation();
  if (useExperience() === "current") return <PrincipalCalendarRoute />;
  const parameters = new URLSearchParams(location.search);
  parameters.set("view", "month");
  return <Navigate replace to={{ pathname: "/principal/timetable", search: parameters.toString() }} />;
}
