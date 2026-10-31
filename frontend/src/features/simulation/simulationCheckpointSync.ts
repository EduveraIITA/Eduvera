import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { FULL_SYNC_INVALIDATIONS } from "../school/schoolEventProtocol";
import {
  executionEnvironmentIdentity,
  isSimulationExecutionEnvironment,
  type ExecutionEnvironment,
  type SimulationExecutionEnvironment,
} from "./executionEnvironment";

function matchesCampusQuery(queryKey: QueryKey, environment: SimulationExecutionEnvironment) {
  let domainKey = queryKey;
  if (queryKey[0] === "execution-environment") {
    // Do not invalidate retained Live or sibling-run cache entries, nor the
    // selected run's control-plane queries (which are absent from the catalogue).
    if (queryKey[1] !== "simulation" || queryKey[2] !== environment.namespaceId || queryKey[3] !== environment.runId) return false;
    domainKey = queryKey.slice(4);
  }
  if (domainKey[0] === "responsibility-workspace" && domainKey[1] !== executionEnvironmentIdentity(environment)) return false;
  return FULL_SYNC_INVALIDATIONS.some(({ queryKey: prefix, exact }) =>
    (!exact || domainKey.length === prefix.length)
      && prefix.every((part, index) => part === domainKey[index]),
  );
}

/** Refresh the ordinary campus screens only after a committed same-world change. */
export async function refreshCommittedSimulationCheckpoint(
  queryClient: QueryClient,
  previous: ExecutionEnvironment,
  confirmed: ExecutionEnvironment,
) {
  if (!isSimulationExecutionEnvironment(previous) || !isSimulationExecutionEnvironment(confirmed)
    || executionEnvironmentIdentity(previous) !== executionEnvironmentIdentity(confirmed)) return;
  const checkpointChanged = Date.parse(previous.virtualClock.now) !== Date.parse(confirmed.virtualClock.now)
    || previous.worldRevision !== confirmed.worldRevision;
  if (!checkpointChanged) return;
  // One batched catalogue predicate preserves cached content and mounted forms.
  // Active in-flight reads are restarted rather than skipped at the final commit;
  // inactive data is marked stale and refetches when its ordinary screen opens.
  await queryClient.invalidateQueries({
    predicate: (query) => matchesCampusQuery(query.queryKey, confirmed),
    refetchType: "active",
  });
}
