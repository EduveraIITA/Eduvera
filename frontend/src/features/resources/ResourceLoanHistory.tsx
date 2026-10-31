import { InfoSummary } from "../../components/InfoSummary";
import { resourceDate } from "./ResourcePrimitives";
import type { ResourceLoanDetail, ResourceReceipt } from "./resourceApi";

const labels:Record<string,string>={issued:"Item issued",return_recorded:"Return recorded",return_corrected:"Return corrected",
  due_changed:"Due date changed",question_asked:"Record questioned",replied:"Reply recorded",resolved:"Question resolved",custody_changed:"Responsibility changed"};
export const resourceActionLabel=(receipt:ResourceReceipt)=>labels[receipt.action] ?? receipt.action.replaceAll("_"," ");

export function ResourceLoanHistory({ loan, timezone }: { loan: ResourceLoanDetail; timezone: string }) {
  return <details className="resource-section"><summary>Loan history · {loan.history.length}</summary>
    {loan.history.length ? <ol className="resource-history">{loan.history.map(receipt=><li key={receipt.id}>
      <strong>{resourceActionLabel(receipt)}</strong>
      <small>{receipt.actor_label} · Recorded {resourceDate(receipt.recorded_at,timezone,true)}</small>
      {receipt.observed_at ? <p className="resource-caption">Observed {resourceDate(receipt.observed_at,timezone,true)}</p> : null}
      {receipt.due_at ? <p className="resource-caption">Due {resourceDate(receipt.due_at,timezone,true)}</p> : null}
      {receipt.previous_due_at ? <p className="resource-caption">Previously due {resourceDate(receipt.previous_due_at,timezone,true)}</p> : null}
      {receipt.custodian?<p className="resource-caption">{receipt.previous_custodian?.label} → {receipt.custodian.label}{receipt.custody_basis==="orphan_recovery"?" · access recovery":""}</p>:null}
      {receipt.parts.length ? <ul className="resource-component-list">{receipt.parts.map((part,index)=><li key={`${part.part_id}:${index}`}><span>{loan.parts.find(item=>item.id===part.part_id)?.label ?? "Recorded part"} · {part.quantity}</span><small>{part.condition === "usable" ? "Usable" : part.condition === "damaged" ? "Damaged" : "Held for review"}</small></li>)}</ul> : null}
      {receipt.reason ? <p>{receipt.reason}</p> : null}{receipt.note ? <p>{receipt.note}</p> : null}
      {receipt.supersedes_receipt_id ? <p className="resource-caption">Corrects an earlier receipt. The original stays in this history.</p> : null}
      <details><InfoSummary>Record details</InfoSummary><p className="resource-caption">{receipt.id}</p></details>
    </li>)}</ol> : <p className="resource-caption">No history is available.</p>}
    {loan.history_has_more ? <p className="resource-caption">Showing the latest {loan.history.length} records. Earlier history is not included in this view.</p> : null}
  </details>;
}
