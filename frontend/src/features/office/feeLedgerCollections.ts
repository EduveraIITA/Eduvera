import { invoiceDescription, invoicePersonLabel } from "./api";
import type { PersonFeeInvoice } from "./personFeesApi";

export type FeeLedgerRecord = { id: string; kind: "charge"; invoice: PersonFeeInvoice; collectionUnavailable?: boolean } | {
  id: string; kind: "collection"; batchId: string; reference: string; description: string; personCount: number;
  invoices: PersonFeeInvoice[]; complete: boolean; cancelled: number; outstanding: number | null;
};
/** Only the owning API's exact saved collection ID establishes grouping. */
export function feeLedgerRecords(invoices: PersonFeeInvoice[], groupCollections: boolean): FeeLedgerRecord[] {
  const records: FeeLedgerRecord[] = [], collections = new Map<string, Extract<FeeLedgerRecord, { kind: "collection" }>>();
  const counts = new Map<string, number>(), standalone = new Set<string>();
  for (const invoice of invoices) counts.set(invoice.id, (counts.get(invoice.id) ?? 0) + 1);
  for (const invoice of invoices) {
    const batch = groupCollections ? invoice.charge_batch : null;
    if (!batch || typeof batch.id !== "string" || !batch.id.trim() || typeof batch.reference !== "string" || !batch.reference.trim() || typeof batch.description !== "string" || !batch.description.trim() || !Number.isSafeInteger(batch.person_count) || batch.person_count < 1 || batch.person_count > 500) {
      if (!standalone.has(invoice.id)) records.push({ id: `charge:${invoice.id}`, kind: "charge", invoice, ...(batch || counts.get(invoice.id)! > 1 ? { collectionUnavailable: true } : {}) });
      standalone.add(invoice.id); continue;
    }
    let collection = collections.get(batch.id);
    if (!collection) {
      collection = { id: `collection:${batch.id}`, kind: "collection", batchId: batch.id, reference: batch.reference, description: batch.description, personCount: batch.person_count, invoices: [], complete: Number.isSafeInteger(batch.person_count) && batch.person_count > 0 && batch.person_count <= 500, cancelled: 0, outstanding: null };
      collections.set(batch.id, collection); records.push(collection);
    }
    if (collection.reference !== batch.reference || collection.description !== batch.description || collection.personCount !== batch.person_count || counts.get(invoice.id)! > 1) collection.complete = false;
    if (!collection.invoices.some(item => item.id === invoice.id)) collection.invoices.push(invoice);
  }
  for (const collection of collections.values()) {
    const summary = collection.invoices[0]?.charge_batch?.summary;
    if (summary && typeof summary.complete === "boolean" && Number.isSafeInteger(summary.outstanding) && summary.outstanding >= 0
      && Number.isSafeInteger(summary.cancelled) && summary.cancelled >= 0 && summary.cancelled <= collection.personCount) {
      collection.complete = collection.complete && summary.complete;
      collection.cancelled = summary.cancelled;
      collection.outstanding = collection.complete ? summary.outstanding : null;
      continue;
    }
    collection.complete = collection.complete && collection.invoices.length === collection.personCount && new Set(collection.invoices.map(invoice => invoice.beneficiary.person_id)).size === collection.personCount;
    collection.cancelled = collection.invoices.filter(invoice => invoice.charge_state === "cancelled").length;
    collection.outstanding = collection.complete ? collection.invoices.reduce((sum, invoice) => sum + invoice.balance_paise, 0) : null;
  }
  return records;
}
export const feeLedgerRecordSearch = (record: FeeLedgerRecord) => record.kind === "charge" ? `${invoicePersonLabel(record.invoice)} ${record.invoice.reference} ${invoiceDescription(record.invoice)}`
  : `${record.description} ${record.reference} ${record.invoices.map(invoice => `${invoicePersonLabel(invoice)} ${invoice.reference} ${invoiceDescription(invoice)}`).join(" ")}`;

const presentationKeys = ["fee_charges_search", "fee_charges_page", "fee_charges_filter", "ledger_cursor", "ledger_payment_cursor", "ledger_review_cursor", "ledger_search", "collection_view", "collection_people_search", "collection_people_page", "collection_receipts_search", "collection_receipts_page"] as const;
/** Retain known view state, never a supplied return URL or another authority scope. */
export function feeLedgerHref(params: URLSearchParams, source: Record<string, string> = {}, collection = true) {
  const next = new URLSearchParams(source);
  const sameAccount = ["person_id", "invoice_id", "batch_id"].every(key => (source[key] ?? null) === params.get(key));
  for (const key of presentationKeys) {
    if (!collection && key.startsWith("collection_")) continue;
    if ((key === "ledger_payment_cursor" || key === "ledger_review_cursor") && (!sameAccount || source.receipt)) continue;
    const value = params.get(key); if (value) next.set(key, value);
  }
  return `/areas/fees/ledger${next.size ? `?${next}` : ""}`;
}
