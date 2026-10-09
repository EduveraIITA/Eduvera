import type { PrincipalHomeResponse } from "../operations/api";
import { PrincipalHomeAttention } from "./PrincipalHomeAttention";
import { PrincipalHomeEvents } from "./PrincipalHomeEvents";
import { PrincipalSchoolPulse } from "./PrincipalSchoolPulse";
import { usePrincipalHomeQueries } from "./usePrincipalHomeQueries";

export function PrincipalHomeOverview({ data, date }: { data: PrincipalHomeResponse; date: string }) {
  const queries = usePrincipalHomeQueries(date);
  return <div className="principal-home__sections">
    <PrincipalHomeAttention data={data} date={date} queries={queries} />
    <PrincipalSchoolPulse queries={queries} />
    <PrincipalHomeEvents actions={data.home_actions} />
  </div>;
}
