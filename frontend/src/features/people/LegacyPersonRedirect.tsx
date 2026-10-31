import { useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { resolvePersonSource } from "./participationApi";

export function LegacyPersonRedirect({ schoolId, sourceId, kind }: { schoolId: string; sourceId: string; kind: "student" | "staff" | "guardian" }) {
  const environment = useExecutionEnvironment();
  if (environment.mode === "simulation" && environment.unavailable) return <OperationsShell active="areas" title="People"><p role="alert">This simulation is unavailable. The person cannot be resolved from Live instead.</p></OperationsShell>;
  return <ResolvePerson schoolId={schoolId} sourceId={sourceId} kind={kind} />;
}
function ResolvePerson({ schoolId, sourceId, kind }: { schoolId: string; sourceId: string; kind: "student" | "staff" | "guardian" }) {
  const environment = useExecutionEnvironment();
  const query = useQuery({ queryKey: executionEnvironmentQueryKey(environment, ["people.source-person", schoolId, kind, sourceId]), queryFn: () => resolvePersonSource(schoolId, kind, sourceId), enabled: Boolean(schoolId && sourceId) });
  if (query.data) return <Navigate replace to={`/areas/people/participants/${encodeURIComponent(query.data.person_id)}`} />;
  return <OperationsShell active="areas" title="People"><div className="operations-stack">{query.isError ? <p role="alert">{query.error.message} <button onClick={() => void query.refetch()}>Try again</button></p> : <p role="status">Opening the campus person…</p>}</div></OperationsShell>;
}
