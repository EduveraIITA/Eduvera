import { StudentTimetableRoute } from "../../features/school/StudentLiveRoutes";
import { useCampusLabProjection } from "./CampusLabProjectionContext";
import { campusLabTimetableIndicator } from "./timetableProjection";

export default function StudentTimetableDevelopmentRoute() {
  const projection = useCampusLabProjection();
  return <StudentTimetableRoute rehearsal={campusLabTimetableIndicator(projection.status)} />;
}
