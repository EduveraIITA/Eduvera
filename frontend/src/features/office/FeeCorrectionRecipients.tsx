import { useState } from "react";
import { invoiceDescription, invoicePersonLabel, type Invoice } from "./api";
import type { PersonFeeInvoice } from "./personFeesApi";

export function FeeCorrectionRecipients({ invoices, selected, onChange }: { invoices: Array<Invoice | PersonFeeInvoice>; selected: string[]; onChange: (ids: string[]) => void }) {
  const [search, setSearch] = useState(""), [requestedPage, setPage] = useState(1);
  const matching = invoices.filter(invoice => `${invoicePersonLabel(invoice)} ${invoice.reference} ${invoiceDescription(invoice)}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const eligible = invoices.filter(invoice => invoice.can_correct === true), pages = Math.max(1, Math.ceil(matching.length / 10)), page = Math.min(requestedPage, pages);
  return <section className="fee-correction-recipients" aria-label="Charges to correct">
    <div className="person-fee-label"><strong>{selected.length} selected</strong><button type="button" className="is-secondary" onClick={() => onChange(selected.length ? [] : eligible.map(invoice => invoice.id))}>{selected.length ? "Clear selection" : `Select all ${eligible.length}`}</button></div>
    {invoices.length > 8 || search ? <label>Find a charge<input type="search" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} /></label> : null}
    <div className="fee-correction-choices">{matching.slice((page - 1) * 10, page * 10).map(invoice => <label className={`fee-correction-choice${selected.includes(invoice.id) ? " is-selected" : ""}`} key={invoice.id}>
      <input type="checkbox" checked={selected.includes(invoice.id)} disabled={invoice.can_correct !== true} onChange={() => onChange(selected.includes(invoice.id) ? selected.filter(id => id !== invoice.id) : [...selected, invoice.id])} />
      <span><strong>{invoicePersonLabel(invoice)}</strong><small>{invoice.reference}{invoice.can_correct !== true ? " · Correction unavailable" : ""}</small></span>
    </label>)}</div>
    {!matching.length ? <p className="person-fee-caption">No matching charges.</p> : null}
    {pages > 1 ? <nav className="fee-beneficiary-pages" aria-label="Charges to correct pages"><button type="button" className="is-secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} of {pages}</span><button type="button" className="is-secondary" disabled={page === pages} onClick={() => setPage(page + 1)}>Next</button></nav> : null}
  </section>;
}
