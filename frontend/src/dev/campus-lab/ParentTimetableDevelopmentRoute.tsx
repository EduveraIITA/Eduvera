import { ParentTimetableRoute } from "../../features/school/ParentLiveRoutes";
import { useCampusLabProjection } from "./CampusLabProjectionContext";
import { campusLabTimetableIndicator } from "./timetableProjection";

export default function ParentTimetableDevelopmentRoute() {
  const projection = useCampusLabProjection();
  return <ParentTimetableRoute rehearsal={campusLabTimetableIndicator(projection.status)} />;
}
