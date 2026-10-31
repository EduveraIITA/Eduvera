import { useState } from "react";
import { weekdayLabels } from "../activities/activityExperience";
import { shiftDate } from "../calendar/monthGrid";
import type { DiningPlan } from "./diningPlanApi";
import { DiningPlanActionDialog } from "./DiningPlanActionDialog";
import { DiningPlanDates } from "./DiningPlanDates";
import { DiningPlanDialog } from "./DiningPlanDialog";
import { DiningHistoryView, DiningPages, DiningSourceView } from "./DiningPrimitives";
import { DiningResponsibilityDialog } from "./DiningResponsibilityDialog";

export function DiningPlanView({ schoolId, actorId, plan, readOnly, refresh, onSaved, onTransferred, dateHref, historyPage, onHistoryPage }: {
  schoolId: string; actorId: string; plan: DiningPlan; readOnly: boolean; refresh: () => Promise<unknown>; onSaved: (id: string) => void;
  dateHref: (seriesId: string, date: string) => string; historyPage: number; onHistoryPage: (page: number) => void;
  onTransferred: () => Promise<unknown>;
}) {
  const [edit, setEdit] = useState(false), [action, setAction] = useState<"publish" | "revise" | "stop" | null>(null), [handoff, setHandoff] = useState(false), actions = readOnly ? [] : plan.allowed_actions, day = plan.days[0];
  return <><section className="dining-summary" aria-label="Weekly menu summary"><header><h2>{plan.label}</h2><span className="dining-status">{plan.state === "draft" ? "Weekly draft" : plan.state === "stopped" ? "Ended pattern" : "Weekly menu published"}</span></header><p>{plan.service.label}</p><dl className="dining-facts"><div><dt>Dates</dt><dd>{plan.starts_on} – {plan.ends_on ?? "until ended"}{plan.stop_from ? ` · stops from ${plan.stop_from}` : ""}</dd></div><div><dt>Coordinator</dt><dd>{plan.coordinator.label}</dd></div></dl><p className="dining-caption">{plan.timezone} · Serving availability, not a venue reservation.</p><div className="dining-inline">{actions.includes("publish") ? <button type="button" onClick={() => setAction("publish")}>Review & publish</button> : null}{actions.includes("save") ? <button type="button" className="is-secondary" onClick={() => setEdit(true)}>Edit draft</button> : null}{actions.includes("revise") ? <button type="button" className="is-secondary" onClick={() => setAction("revise")}>Change future dates</button> : null}{actions.includes("stop") ? <button type="button" className="is-text" onClick={() => setAction("stop")}>End weekly menu</button> : null}</div></section>
    <section className="dining-section"><h3>Weekly pattern</h3><ul className="dining-plan-preview">{plan.days.map(value => <li key={value.weekday}><strong>{weekdayLabels[value.weekday - 1]} · {value.starts_at}–{value.ends_at}{value.end_day_offset ? " next day" : ""}</strong><small>{value.place?.label ?? "Place not set"} · {value.operator.label}</small>{plan.menu_mode === "native" ? <p className="dining-menu">{value.menu_text || "Menu not entered"}</p> : null}</li>)}</ul></section>
    {plan.source ? <DiningSourceView source={plan.source} timezone={plan.timezone} /> : null}
    {actions.includes("recover") ? <button type="button" className="is-text dining-back" onClick={() => setHandoff(true)}>Change coordinator</button> : null}
    <DiningPlanDates key={`${plan.id}:${plan.revision}`} schoolId={schoolId} actorId={actorId} plan={plan} dateHref={dateHref} />
    {plan.history?.length || historyPage > 1 ? <><DiningHistoryView entries={plan.history ?? []} timezone={plan.timezone} /><DiningPages page={historyPage} hasMore={plan.history_pagination?.has_more ?? false} onChange={onHistoryPage} label="Weekly menu history pages" /></> : null}
    {edit && day ? <DiningPlanDialog schoolId={schoolId} actorId={actorId} initial={plan} timezone={plan.timezone} draft={{ label: plan.label, start: `${plan.starts_on}T${day.starts_at}`, end: `${day.end_day_offset ? shiftDate(plan.starts_on, 1) : plan.starts_on}T${day.ends_at}`, menu: day.menu_text, operator: day.operator, place: day.place }} refresh={refresh} onClose={() => setEdit(false)} onSaved={id => { setEdit(false); onSaved(id); }} /> : null}
    {action ? <DiningPlanActionDialog schoolId={schoolId} actorId={actorId} initial={plan} action={action} refresh={refresh} onClose={() => setAction(null)} onSaved={id => { setAction(null); onSaved(id); }} /> : null}
    {handoff ? <DiningResponsibilityDialog schoolId={schoolId} actorId={actorId} id={plan.id} revision={plan.revision} kind="plan" refresh={onTransferred} onClose={() => setHandoff(false)} /> : null}
  </>;
}
