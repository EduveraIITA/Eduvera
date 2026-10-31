import { useState, type FormEvent } from "react";
import { InfoSummary } from "../../components/InfoSummary";
import { TemporalInput } from "../../components/forms/TemporalInput";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { applicationNow } from "../simulation/applicationTime";
import { resourceInputInstant, resourceInputTime, resourceInputZone } from "../resources/resourceTime";
import { cancelVisit, getVisit, recordVisitMovement, type VisitDetail } from "./visitApi";
import { useVisitCommand, VisitWriteFeedback } from "./useVisitCommand";

export type VisitAction = "cancel" | "in" | "out";
export function VisitActionDialog({ schoolId, detail, action, onClose, onSaved }: { schoolId: string; detail: VisitDetail; action: VisitAction; onClose: () => void; onSaved: (result: VisitDetail) => Promise<unknown> }) {
  const [base, setBase] = useState(detail), [count, setCount] = useState(detail.visit.party_size), [earlier, setEarlier] = useState(false);
  const [occurred, setOccurred] = useState(() => resourceInputTime(applicationNow())), [error, setError] = useState(""), [reviewing, setReviewing] = useState(false);
  const title = action === "cancel" ? "Cancel visit" : action === "in" ? "Record arrival" : "Record departure";
  const write = useVisitCommand({ schoolId, sourceId: detail.visit.id, onAccepted: onSaved });
  const submit = (event: FormEvent) => {
    event.preventDefault(); setError("");
    try {
      const observedAt = earlier ? resourceInputInstant(occurred) : undefined;
      void write.execute(command_id => action === "cancel" ? cancelVisit(schoolId, base.visit.id, { command_id, expected_revision: base.visit.revision }) : recordVisitMovement(schoolId, base.visit.id, { command_id, expected_revision: base.visit.revision, direction: action, observed_count: count, ...(observedAt ? { occurred_at: observedAt } : {}) }), base.visit.revision);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Choose valid movement details."); }
  };
  const review = async () => {
    setReviewing(true); setError("");
    try {
      const current = await getVisit(schoolId, detail.visit.id);
      const allowed = action === "cancel" ? current.can_cancel : action === "in" ? current.can_record_arrival : current.can_record_exit;
      if (!allowed) throw new Error("This action is no longer available. Close this sheet to see the current visit.");
      setBase(current); write.reviewed();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The current visit could not load."); }
    finally { setReviewing(false); }
  };
  return <PlannerDialog title={title} busy={write.busy || Boolean(write.recovery) || reviewing} onClose={onClose}><form className="visits-form" onSubmit={submit}>
    <section className="visits-summary"><h3>{base.visit.guest_label}</h3><p className="visits-caption">{base.visit.title} · {base.visit.place.label}</p></section>
    {action === "cancel" ? <p className="visits-caption">Cancel the planned visit? Any recorded arrival or departure stays unchanged.</p> : <fieldset disabled={write.locked || reviewing}>
      <label>People observed<input required type="number" min={1} max={5000} step={1} value={count} onChange={event => setCount(Number(event.target.value))} /></label>
      <p className="visits-caption">Count only the people whose {action === "in" ? "arrival" : "departure"} you observed. This does not complete their campus work.</p>
      <details><summary>Record an earlier time</summary><label className="visits-check"><input type="checkbox" checked={earlier} onChange={event => setEarlier(event.target.checked)} />Use another time</label>{earlier ? <label>Observed at<TemporalInput required type="datetime-local" value={occurred} onChange={event => setOccurred(event.target.value)} /></label> : null}<p className="visits-caption">Times entered in {resourceInputZone()}.</p></details>
    </fieldset>}
    {base.visit.revision !== detail.visit.revision ? <p role="status" className="visits-caption">Latest visit loaded. Review this action before sending again.</p> : null}
    {error ? <p className="visits-error" role="alert">{error}</p> : null}<VisitWriteFeedback write={write} onReview={review} />
    <footer><button type="button" className="is-secondary" disabled={write.busy || Boolean(write.recovery) || reviewing} onClick={onClose}>Back</button><button type="submit" disabled={write.locked || reviewing || action !== "cancel" && (!Number.isInteger(count) || count < 1 || count > 5000)}>{write.busy ? "Saving…" : title}</button></footer>
    {action === "cancel" ? <details><InfoSummary>Recorded movements</InfoSummary><p className="visits-caption">Cancelling a plan never records a physical exit.</p></details> : null}
  </form></PlannerDialog>;
}
