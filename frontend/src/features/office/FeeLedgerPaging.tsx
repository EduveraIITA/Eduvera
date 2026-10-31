import { useSearchParams } from "react-router-dom";
import type { FeeLedgerPagination } from "./api";
import { InfoSummary } from "../../components/InfoSummary";
import "./fee-ledger-paging.css";

export function FeeLedgerSearch({ pagination }: { pagination?: FeeLedgerPagination }) {
  const [, setParams] = useSearchParams();
  if (!pagination || pagination.exact) return null;
  return <form className="fee-ledger-search" role="search" aria-label="Ledger search" onSubmit={event => {
    event.preventDefault(); const form = new FormData(event.currentTarget); setParams(current => {
      const updated = new URLSearchParams(current), value = form.get("ledger_search"), search = typeof value === "string" ? value.trim() : "";
      if (search) updated.set("ledger_search", search); else updated.delete("ledger_search");
      updated.delete("ledger_cursor"); updated.delete("ledger_payment_cursor"); updated.delete("ledger_review_cursor");
      updated.delete("fee_charges_search"); updated.delete("fee_charges_page"); return updated;
    });
  }}><label className="office-field"><span className="sr-only">Search all records</span><input key={pagination.search} type="search" name="ledger_search" defaultValue={pagination.search} maxLength={80} placeholder="Find a person, charge or reference" /></label><button type="submit" className="office-secondary">Search ledger</button></form>;
}

export function FeeLedgerPaging({ pagination, receipts = false, reviews = false, showSearch = true }: { pagination?: FeeLedgerPagination; receipts?: boolean; reviews?: boolean; showSearch?: boolean }) {
  const [params, setParams] = useSearchParams();
  if (!pagination || pagination.exact && !receipts && !reviews) return null;
  const key = reviews ? "ledger_review_cursor" : receipts ? "ledger_payment_cursor" : "ledger_cursor";
  const next = reviews ? pagination.next_review_cursor : receipts ? pagination.next_payment_cursor : pagination.next_cursor;
  const move = (cursor?: string) => setParams(current => { const updated = new URLSearchParams(current);
    if (cursor) updated.set(key, cursor); else updated.delete(key);
    if (!receipts && !reviews) updated.delete("ledger_review_cursor"); return updated; });
  return <section className="fee-ledger-paging" aria-label="Ledger pages">
    {showSearch && !reviews ? <FeeLedgerSearch pagination={pagination} /> : null}
    <details><InfoSummary>About this list</InfoSummary><p className="office-hint">Up to {reviews ? pagination.review_limit ?? pagination.limit : receipts ? pagination.payment_limit ?? pagination.limit : pagination.limit} {reviews ? "reviews for charges on this page" : receipts ? "receipts" : pagination.grouped ? "collections or charges" : "charges"} per page. Balance totals cover all matching charges. Filters and printing apply to this page.</p></details>
    <div className="office-actions">{params.has(key) ? <button type="button" className="office-secondary" onClick={() => move()}>First page</button> : null}
      {next ? <button type="button" className="office-secondary" onClick={() => move(next)}>Next {reviews ? "reviews" : receipts ? "receipts" : "charges"}</button> : null}</div>
  </section>;
}
