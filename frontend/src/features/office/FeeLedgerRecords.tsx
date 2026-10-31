import { Link } from "react-router-dom";
import { ProductIcon } from "../../components/ProductIcon";
import { CollectionView } from "../../components/CollectionView";
import { invoiceDescription, invoicePersonLabel, rupees } from "./api";
import type { PersonFeeInvoice } from "./personFeesApi";
import { feeLedgerRecordSearch, type FeeLedgerRecord } from "./feeLedgerCollections";
import { feeDate } from "./FamilyFeeRecords";

export function FeeLedgerRecords({ records, chargeHref, collectionHref, serverPaged = false }: {
  records: FeeLedgerRecord[]; chargeHref: (invoice: PersonFeeInvoice) => string; collectionHref: (id: string) => string;
  serverPaged?: boolean;
}) {
  const empty = <p className="person-fee-caption">No matching charges. Add people or record a charge when you’re ready.</p>;
  const renderRecords = (visible: readonly FeeLedgerRecord[]) => <div className="person-fee-records">{visible.map(record => record.kind === "collection" ? <Link key={record.id} className="fee-collection-tile" to={collectionHref(record.batchId)}>
      <span className="fee-collection-icon" aria-hidden="true"><ProductIcon name="fees" size={32} /></span>
      <div><strong>{record.description}</strong><span>{record.personCount} {record.personCount === 1 ? "person" : "people"}{record.complete && record.cancelled ? ` · ${record.cancelled} cancelled` : ""}</span><small>{record.reference}</small></div>
      <div className="fee-collection-tile-value"><strong>{record.outstanding === null ? "Unavailable" : rupees(record.outstanding)}</strong><small>{record.outstanding === null ? "Records incomplete" : record.outstanding > 0 ? "Outstanding" : "No outstanding balance"}</small></div>
      </Link> : <Link key={record.id} className="person-fee-charge-row" to={chargeHref(record.invoice)}><div><strong>{invoiceDescription(record.invoice)}</strong><span>{invoicePersonLabel(record.invoice)}</span><small>{record.invoice.reference} · <span className={record.collectionUnavailable ? undefined : "person-fee-date"}>{record.collectionUnavailable ? "Collection information unavailable" : record.invoice.charge_state === "cancelled" ? "Cancelled" : `Due ${feeDate(record.invoice.collection_due_on ?? record.invoice.effective_due_on ?? record.invoice.due_on)}`}</span></small></div><div><strong>{rupees(record.invoice.balance_paise)}</strong><small>{record.invoice.charge_state === "cancelled" ? "Cancelled" : record.invoice.balance_paise > 0 ? "Outstanding" : "No outstanding balance"}</small></div></Link>)}</div>;
  if (serverPaged) return records.length ? renderRecords(records) : empty;
  return <CollectionView items={records} namespace="fee_charges" label="records" searchLabel="Find a collection or charge" searchPlaceholder="Collection, person or reference" searchText={feeLedgerRecordSearch} empty={empty}>{renderRecords}</CollectionView>;
}
