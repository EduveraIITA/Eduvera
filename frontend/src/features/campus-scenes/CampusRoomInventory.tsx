import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useOptionalAuth } from "../auth/AuthContext";
import { useOptionalExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentIdentity, LIVE_EXECUTION_ENVIRONMENT } from "../simulation/executionEnvironment";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { getCampusSceneResources } from "./api";
import "./campus-room-inventory.css";

interface Props { schoolId: string; campusId: string; spaceId: string; canRead: boolean }

/** Quantities remain owning inventory records; they never imply positioned units. */
export function CampusRoomInventory(props: Props) {
  const auth = useOptionalAuth(), environment = useOptionalExecutionEnvironment() ?? LIVE_EXECUTION_ENVIRONMENT;
  const actorId = auth?.user?.id;
  if (!props.canRead || !actorId || !props.schoolId || !props.campusId || !props.spaceId
    || auth?.user?.active_school_id !== props.schoolId
    || !auth?.memberships.some(member => member.school_id === props.schoolId && member.role === "admin")) return null;
  if (environment.mode === "simulation" && environment.unavailable)
    return <section className="campus-room-inventory" aria-label="Room inventory"><h3>Room inventory</h3><p role="alert">Room resources are unavailable until this Simulation is recovered.</p></section>;
  return <ActiveCampusRoomInventory key={`${actorId}:${props.schoolId}:${props.campusId}:${props.spaceId}:${executionEnvironmentIdentity(environment)}`} {...props} actorId={actorId} />;
}

function ActiveCampusRoomInventory({ schoolId, campusId, spaceId, actorId }: Props & { actorId: string }) {
  const environment = useOptionalExecutionEnvironment() ?? LIVE_EXECUTION_ENVIRONMENT;
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: executionEnvironmentQueryKey(environment, ["campus-scenes", schoolId, campusId, "room-inventory", actorId, spaceId, page]),
    queryFn: async ({ signal }) => {
      const result = await getCampusSceneResources(schoolId, campusId, { search: "", page, space_id: spaceId, tracking_mode: "pooled" }, signal);
      if (result.page !== page || result.page_size !== 20 || !Number.isInteger(result.total) || result.total < 0 || result.items.length > 20
        || result.items.some(item => item.space_id !== spaceId || item.tracking_mode !== "pooled"
          || !Number.isInteger(item.quantity) || (item.quantity ?? 0) <= 0 || !item.unit_label?.trim()))
        throw new Error("The selected room resources could not be confirmed.");
      return result;
    },
    staleTime: 15_000, refetchOnMount: "always", retry: false,
    refetchInterval: environment.mode === "live" ? 30_000 : false,
  });
  const loading = query.isPending || query.isFetching;
  const data = !loading && !query.isError ? query.data : undefined;
  return <section className="campus-room-inventory" aria-label="Room inventory">
    <h3>Room inventory</h3>
    {loading ? <p role="status">Loading room resources…</p> : query.isError ? <div role="alert"><p>Room resources could not be loaded.</p><button type="button" className="campus-scene-text-link" onClick={() => void query.refetch()}>Try again</button></div>
      : data?.items.length ? <><dl>{data.items.map(item => <div key={item.id}><dt>{item.name}{item.state === "unavailable" ? <small>Recorded unavailable</small> : null}</dt><dd>{item.quantity?.toLocaleString()} <span>{item.unit_label}</span></dd></div>)}</dl><p className="campus-room-inventory__note">Recorded quantities; individual positions are not mapped.</p></>
      : <p>No pooled resources are recorded for this room.</p>}
    {data && data.total > data.page_size ? <nav className="campus-scene-pagination" aria-label="Room inventory pages"><button type="button" className="campus-scene-button" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Previous</button><span>{page} / {Math.ceil(data.total / data.page_size)}</span><button type="button" className="campus-scene-button" disabled={page * data.page_size >= data.total} onClick={() => setPage(value => value + 1)}>Next</button></nav> : null}
  </section>;
}
