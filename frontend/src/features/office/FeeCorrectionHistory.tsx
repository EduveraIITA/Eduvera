import { CollectionView } from "../../components/CollectionView";
import { rupees, type Invoice } from "./api";
import { feeDate } from "./FamilyFeeRecords";
import "./person-fees.css";

export function FeeCorrectionHistory({ invoice }: { invoice: Pick<Invoice, "corrections"> }) {
  if (!invoice.corrections?.length) return null;
  return <details className="fee-correction-history"><summary>Charge corrections · {invoice.corrections.length}</summary>
    <CollectionView items={[...invoice.corrections].sort((a, b) => b.revision - a.revision)} namespace="charge_corrections" label="corrections" searchLabel="Find a correction" searchText={item => `${item.reason} ${item.description}`}>
      {visible => <div className="fee-correction-item-list">{visible.map(item => <article key={item.id}><h3>{item.charge_state === "cancelled" ? "Charge cancelled" : "Charge corrected"} · {rupees(item.amount_paise)}</h3><p>{item.description} · Due {item.due_on}</p><p>{item.reason}</p><small>{item.actor_name || item.created_by_label || "Operator name unavailable"} · {feeDate(item.created_at)}</small></article>)}</div>}
    </CollectionView>
  </details>;
}
