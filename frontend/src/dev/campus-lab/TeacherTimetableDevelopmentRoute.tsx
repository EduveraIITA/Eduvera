import TeacherDayPage from "../../features/day-plans/TeacherDayPage";
import { useCampusLabProjection } from "./CampusLabProjectionContext";
import { campusLabTimetableIndicator } from "./timetableProjection";

export default function TeacherTimetableDevelopmentRoute() {
  const projection = useCampusLabProjection();
  return <TeacherDayPage rehearsal={campusLabTimetableIndicator(projection.status)} />;
}
