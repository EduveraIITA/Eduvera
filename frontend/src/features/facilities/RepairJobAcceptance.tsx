import type { RepairDetail } from "./facilitiesApi";
import { useRepairJobAcceptance } from "./useRepairJobAcceptance";

export function RepairJobAcceptance({ schoolId, repair, refresh }: { schoolId: string; repair: RepairDetail; refresh: () => Promise<unknown> }) {
  const action = useRepairJobAcceptance(schoolId, repair, refresh);
  return <div className="facilities-feedback">
    <div className="facilities-inline-actions"><button type="button" disabled={action.locked} onClick={() => void action.accept()}>{action.busy ? "Connecting job…" : "Accept job"}</button>
      {action.recovery ? <button type="button" className="is-secondary" disabled={action.busy} onClick={() => void action.recover()}>{action.retrySafe ? "Retry same action" : "Check result"}</button> : null}
      {action.reviewRequired ? <button type="button" className="is-secondary" disabled={action.busy} onClick={() => void action.review()}>Review repair</button> : null}</div>
    {action.error ? <p role="alert" className="facilities-error">{action.error}</p> : null}
  </div>;
}
