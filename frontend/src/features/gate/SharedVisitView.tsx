import { useEffect, useRef } from "react";
import { InfoSummary } from "../../components/InfoSummary";
import { ProductIcon } from "../../components/ProductIcon";
import type { SharedVisitDetail } from "./visitSharingApi";
import { visitDate, visitWindow } from "./VisitPrimitives";
import { VisitQuestions } from "./VisitQuestions";

/** Only accepts the minimized sharing DTO. No manager detail or movement history. */
export function SharedVisitView({ schoolId, detail, timezone, disabled, refresh }: {
  schoolId: string; detail: SharedVisitDetail; timezone: string; disabled: boolean; refresh: () => Promise<unknown>;
}) {
  const { visit, share, changes } = detail, title = useRef<HTMLHeadingElement>(null);
  useEffect(() => { title.current?.focus({ preventScroll: true }); }, [visit.id]);
  return <>
    <section className="visits-summary" aria-label="Shared visit">
      <header className="visits-heading"><div className="visits-identity"><ProductIcon name="gate" size={32} /><div><h2 ref={title} tabIndex={-1}>{visit.title}</h2><p className="visits-caption">{visit.guest_label}{visit.party_size > 1 ? ` · ${visit.party_size} people` : ""}</p></div></div><span className={`visits-status is-${visit.state}`}>{visit.state === "cancelled" ? "Cancelled" : "Confirmed"}</span></header>
      {visit.state === "cancelled" ? <p role="status">This visit has been cancelled. Contact the campus before travelling.</p> : null}
      <dl className="visits-facts"><div><dt>{visit.state === "cancelled" ? "Previous plan" : "When"} · {timezone}</dt><dd>{visitWindow(visit, timezone)}</dd></div><div><dt>{visit.state === "cancelled" ? "Previous meeting place" : "Meeting place"}</dt><dd>{visit.place.label}{visit.place.campus_label ? <small className="visits-caption"> · {visit.place.campus_label}</small> : null}</dd></div><div><dt>Campus contact</dt><dd>{visit.contact.label}</dd></div>{share.directions ? <div className="visits-directions"><dt>{visit.state === "cancelled" ? "Previous directions" : "Directions"}</dt><dd>{share.directions}</dd></div> : null}</dl>
    </section>
    {changes.length ? <details className="visits-history"><InfoSummary>Visit changes · {changes.length}</InfoSummary><p className="visits-caption">The details above are current.</p><ol>{changes.map(change => <li key={change.revision}><strong>{change.state === "cancelled" ? "Visit cancelled" : "Plan updated"}</strong><small>{visitDate(change.recorded_at, timezone)}</small><p>{change.title} · {visitWindow(change, timezone)}</p><p>{change.place_label} · {change.contact_label}{change.party_size > 1 ? ` · ${change.party_size} people` : ""}</p></li>)}</ol>{detail.changes_has_more ? <p className="visits-caption">Showing the latest 25 changes.</p> : null}</details> : null}
    <VisitQuestions schoolId={schoolId} detail={detail} timezone={timezone} disabled={disabled} refresh={refresh} />
    <p className="visits-caption">Shared until {visitDate(share.ends_at, timezone)} · This plan does not grant entry or room access.</p>
  </>;
}
