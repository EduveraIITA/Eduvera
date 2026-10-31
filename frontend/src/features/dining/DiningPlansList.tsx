import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { ProductIcon } from "../../components/ProductIcon";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { getDiningPlans } from "./diningPlanApi";
import { DiningError, DiningPages } from "./DiningPrimitives";

export function DiningPlansList({ schoolId, actorId, serviceId, href }: { schoolId: string; actorId: string; serviceId: string; href: (id: string) => string }) {
  const environment = useExecutionEnvironment(), [page, setPage] = useState(1), result = useQuery({ queryKey: executionEnvironmentQueryKey(environment, ["dining", schoolId, actorId, "plans", serviceId, page]), queryFn: () => getDiningPlans(schoolId, serviceId, page) });
  return <section className="dining-section" aria-label="Weekly menus"><h3>Weekly menus</h3>{result.isPending ? <p role="status">Loading weekly menus…</p> : result.error ? <DiningError error={result.error} retry={() => void result.refetch()} /> : <><ul className="dining-list">{result.data?.items.map(plan => <li key={plan.series_id}><Link className="dining-entry" to={href(plan.id)}><ProductIcon name="dining" size={26} /><span>{plan.recovery_only ? <><strong>Weekly menu needs a coordinator</strong><small>Private details stay hidden during recovery.</small></> : <><strong>{plan.label}</strong><small>{plan.starts_on} – {plan.ends_on ?? "until ended"} · {plan.state === "draft" ? "Draft" : plan.state === "stopped" ? "Ended" : "Published"}</small>{plan.draft_id && plan.current_published_id ? <small>Published menu remains active while changes are drafted.</small> : null}</>}</span><ChevronRight size={16} aria-hidden="true" /></Link></li>)}</ul>{!result.data?.items.length ? <p className="dining-caption">No weekly menus on this page.</p> : null}<DiningPages page={page} hasMore={page < (result.data?.total_pages ?? 1)} onChange={setPage} label="Weekly menu pages" /></>}</section>;
}
