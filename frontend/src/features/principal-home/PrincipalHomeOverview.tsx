import type { PrincipalHomeResponse } from "../operations/api";
import { PrincipalHomeAttention } from "./PrincipalHomeAttention";
import { PrincipalHomeEvents } from "./PrincipalHomeEvents";
import { PrincipalSchoolPulse } from "./PrincipalSchoolPulse";
import { usePrincipalHomeQueries } from "./usePrincipalHomeQueries";
import { OperatingDayNowNext } from "../operating-day/OperatingDayNowNext";

export function PrincipalHomeOverview({ data, date }: { data: PrincipalHomeResponse; date: string }) {
  const queries = usePrincipalHomeQueries(date);
  return <div className="principal-home__sections">
    <OperatingDayNowNext day={data.operating_day} showCampus />
    <PrincipalHomeAttention data={data} date={date} queries={queries} />
    <PrincipalSchoolPulse queries={queries} />
    <PrincipalHomeEvents actions={data.home_actions} />
  </div>;
}
