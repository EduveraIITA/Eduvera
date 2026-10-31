import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { getAccommodationOptions } from "./accommodationApi";

/** A repair reference never grants housing authority or exposes another stay. */
export function RepairAccommodationLink({ schoolId, actorId, repairId }: { schoolId: string; actorId: string; repairId: string }) {
  const environment = useExecutionEnvironment();
  const options = useQuery({ queryKey: executionEnvironmentQueryKey(environment, ["accommodation", schoolId, actorId, "repair-entry", repairId]), queryFn: () => getAccommodationOptions(schoolId, { repair_id: repairId }), retry: false });
  if (options.error || !options.data?.can_offer) return null;
  return <Link to={`/areas/accommodation?${new URLSearchParams({ repair_id: repairId, offer: "1" })}`}>Arrange temporary stay</Link>;
}
