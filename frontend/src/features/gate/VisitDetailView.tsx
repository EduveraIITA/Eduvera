import { useEffect, useRef, useState } from "react";
import { LogIn, LogOut, Pencil } from "lucide-react";
import { InfoSummary } from "../../components/InfoSummary";
import { ProductIcon } from "../../components/ProductIcon";
import type { VisitDetail } from "./visitApi";
import { VisitEditor } from "./VisitEditor";
import { VisitActionDialog, type VisitAction } from "./VisitActionDialog";
import { visitDate, visitWindow } from "./VisitPrimitives";
import { VisitHistory } from "./VisitHistory";
import { VisitSharing } from "./VisitSharing";

export function VisitDetailView({ schoolId, actorId, detail, timezone, disabled, onSaved }: { schoolId: string; actorId: string; detail: VisitDetail; timezone: string; disabled: boolean; onSaved: (result: VisitDetail) => Promise<unknown> }) {
  const [editing, setEditing] = useState(false), [action, setAction] = useState<VisitAction | null>(null);
  const { visit } = detail;
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => { title.current?.focus({ preventScroll: true }); }, [visit.id]);
  const saved = async (result: VisitDetail) => { await onSaved(result); setEditing(false); setAction(null); };
  return <>
    <section className="visits-summary" aria-label="Visit arrangement">
      <header className="visits-heading"><div className="visits-identity"><ProductIcon name="gate" size={32} /><div><h2 ref={title} tabIndex={-1}>{visit.guest_label}</h2><p className="visits-caption">{visit.title}{visit.party_size > 1 ? ` · ${visit.party_size} people planned` : ""}</p></div></div><span className={`visits-status is-${visit.state}`}>{visit.state === "cancelled" ? "Cancelled" : "Confirmed plan"}</span></header>
      <dl className="visits-facts"><div><dt>When</dt><dd>{visitWindow(visit, timezone)}</dd></div><div><dt>Meeting place</dt><dd>{visit.place.label}{visit.place.campus_label ? <small className="visits-caption"> · {visit.place.campus_label}</small> : null}</dd></div><div><dt>Campus contact</dt><dd>{visit.contact.label}</dd></div></dl>
      {detail.can_edit ? <div className="visits-actions"><button type="button" className="is-secondary" disabled={disabled} onClick={() => setEditing(true)}><Pencil size={16} aria-hidden="true" />Edit visit</button></div> : null}
    </section>
    <VisitSharing schoolId={schoolId} actorId={actorId} visit={visit} timezone={timezone} disabled={disabled} />
    <section className="visits-section" aria-labelledby="visit-movements-title"><header><h2 id="visit-movements-title">Arrival & departure</h2><span className="visits-caption">Optional record</span></header>
      {visit.last_movement ? <div className="visits-record">{visit.last_movement.direction === "in" ? <LogIn size={20} aria-hidden="true" /> : <LogOut size={20} aria-hidden="true" />}<div><strong>{visit.last_movement.direction === "in" ? "Arrival recorded" : "Departure recorded"} · {visit.last_movement.observed_count} {visit.last_movement.observed_count === 1 ? "person" : "people"}</strong><p className="visits-caption">{visitDate(visit.last_movement.occurred_at, timezone)}</p></div></div> : <p className="visits-caption">No movement recorded. A confirmed plan does not mean someone has arrived.</p>}
      <div className="visits-actions">{detail.can_record_arrival ? <button type="button" disabled={disabled} onClick={() => setAction("in")}><LogIn size={18} aria-hidden="true" />Record arrival</button> : null}{detail.can_record_exit ? <button type="button" className="is-secondary" disabled={disabled} onClick={() => setAction("out")}><LogOut size={18} aria-hidden="true" />Record departure</button> : null}</div>
    </section>
    <details><InfoSummary>About this plan</InfoSummary><p className="visits-caption">The meeting place is a destination, not an exclusive room booking. A contact does not gain new permissions. Times shown in {timezone}.</p></details>
    {detail.history ? <VisitHistory entries={detail.history} hasMore={Boolean(detail.history_has_more)} timezone={timezone} /> : null}
    {detail.can_cancel ? <button type="button" className="is-text visits-back" disabled={disabled} onClick={() => setAction("cancel")}>Cancel visit</button> : null}
    {editing && !disabled ? <VisitEditor schoolId={schoolId} actorId={actorId} initial={visit} onClose={() => setEditing(false)} onSaved={saved} /> : null}
    {action && !disabled ? <VisitActionDialog schoolId={schoolId} detail={detail} action={action} onClose={() => setAction(null)} onSaved={saved} /> : null}
  </>;
}
