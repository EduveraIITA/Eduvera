import { PrincipalTimetableExperienceRoute } from "../../features/experiments/TimetableExperienceRoutes";
import { useCampusLabProjection } from "./CampusLabProjectionContext";
import { campusLabTimetableIndicator } from "./timetableProjection";

export { campusLabTimetableIndicator } from "./timetableProjection";

export default function PrincipalTimetableDevelopmentRoute() {
  const projection = useCampusLabProjection();
  return <PrincipalTimetableExperienceRoute rehearsal={campusLabTimetableIndicator(projection.status)} />;
}
