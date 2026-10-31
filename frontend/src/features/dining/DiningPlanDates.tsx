import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { TemporalInput } from "../../components/forms/TemporalInput";
import { ProductIcon } from "../../components/ProductIcon";
import { campusDate } from "../activities/activityExperience";
import { shiftDate } from "../calendar/monthGrid";
import { applicationNow } from "../simulation/applicationTime";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { getDiningPlanDates, type DiningPlan } from "./diningPlanApi";
import { DiningError, DiningPages, diningDate, diningStateLabel } from "./DiningPrimitives";

export function diningPreviewStart(plan: DiningPlan) {
  const today = campusDate(applicationNow(), plan.timezone);
  return plan.ends_on && plan.ends_on < today ? plan.starts_on : today > plan.starts_on ? today : plan.starts_on;
}
export function DiningPlanDates({ schoolId, actorId, plan, dateHref, review = false }: {
  schoolId: string; actorId: string; plan: DiningPlan; dateHref: (seriesId: string, date: string) => string; review?: boolean;
}) {
  const environment = useExecutionEnvironment(), [from, setFrom] = useState(() => diningPreviewStart(plan)), [page, setPage] = useState(1);
  const until = plan.ends_on && plan.ends_on < shiftDate(from, 34) ? plan.ends_on < from ? from : plan.ends_on : shiftDate(from, 34);
  const result = useQuery({ queryKey: executionEnvironmentQueryKey(environment, ["dining", schoolId, actorId, "plan-dates", plan.id, plan.revision, from, until, page]), queryFn: () => getDiningPlanDates(schoolId, plan, from, until, page) });
  const cancelledDates = new Set(result.data?.items.filter(item => item.origin === "plan_date" && (item.cancelled_for_date || item.state === "cancelled")).map(item => item.origin === "plan_date" ? item.local_date : ""));
  const hasClockWarning = [...(result.data?.warnings ?? []), ...(result.data?.issues ?? [])].some(item => !cancelledDates.has(item.local_date));
  return <section className="dining-section" aria-label={review ? "Dated publication preview" : "Weekly menu dates"}><header><h3>{review ? "Dates to review" : "Dates"}</h3><label className="dining-preview-from"><span className="dining-sr">Preview from</span><TemporalInput type="date" value={from} onChange={event => { if (event.target.value) { setFrom(event.target.value); setPage(1); } }} /></label></header><p className="dining-caption">{from} – {until} · {plan.timezone}{!plan.ends_on ? " · Preview only, not the last date." : ""}</p>
    {result.isPending ? <p role="status">Loading dated menus…</p> : result.error ? <DiningError error={result.error} retry={() => void result.refetch()} /> : <>
      {hasClockWarning ? <p className="dining-warning" role="alert">Some dates need clock-time resolution. Review the repeated-hour policy or adjust the weekly hours before publishing.</p> : null}
      <ul className="dining-list" aria-label="Preview dates">{result.data?.items.map(item => { const date = item.origin === "session" ? item.session : item, localDate = item.origin === "plan_date" ? item.local_date : campusDate(new Date(item.session.starts_at), plan.timezone);
        const content = <><ProductIcon name="dining" size={26} /><span><strong>{localDate} · {date.label}</strong><small>{diningDate(date.starts_at, plan.timezone)} – {diningDate(date.ends_at, plan.timezone)}</small><small>{date.place?.label ?? "Place not set"} · {item.origin === "session" ? diningStateLabel(item.session.state) : item.cancelled_for_date || item.state === "cancelled" ? "Cancelled for this date" : item.needs_time_resolution ? "Clock time needs review" : "Planned · not opened"}</small>{plan.menu_mode === "native" ? <small className="dining-menu">{date.menu_text || "Menu not entered"}</small> : null}</span></>;
        return <li key={date.id}>{plan.state === "draft" || review ? <div className="dining-entry">{content}</div> : <Link className="dining-entry" to={dateHref(plan.series_id, localDate)}>{content}<ChevronRight size={16} aria-hidden="true" /></Link>}</li>; })}</ul>
      {!result.data?.items.length ? <p className="dining-caption" role="status">No planned dates in this window.</p> : null}<DiningPages page={page} hasMore={page < (result.data?.total_pages ?? 1)} onChange={setPage} label="Weekly menu date pages" />
    </>}
  </section>;
}
