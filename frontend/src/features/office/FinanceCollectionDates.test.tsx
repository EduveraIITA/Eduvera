import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { invoiceCollectionDue, invoiceStatusLabel, type FeeLedger, type Invoice } from "./api";
import { FamilyFeeOverview } from "./FamilyFeeOverview";
import { FamilyInvoiceList } from "./FamilyFeeRecords";
import { FamilyInvoiceStatement } from "./FamilyInvoiceStatement";
import { FamilyFeePrint } from "./FamilyFeePrint";

const original: Invoice = { id: "invoice", student_id: "learner", first_name: "Sana", last_name: "Sen", admission_number: "R001",
  reference: "F001", description: "Course fees", amount_paise: 3_000_000, adjusted_amount_paise: 3_000_000, paid_paise: 0,
  balance_paise: 3_000_000, refund_due_paise: 0, collection_state: "collectible", due_on: "2026-10-01", original_due_on: "2026-10-01",
  collection_today: "2026-10-23", collection_due_on: "2026-10-01", collection_due_amount_paise: 3_000_000, collection_overdue_paise: 3_000_000,
  payment_plan_state: "none" };
const ledger = (invoice: Invoice): FeeLedger => ({ currency: "INR", invoices: [invoice], payments: [], online_payments_enabled: false });
afterEach(cleanup);

describe("source-owned collection-date presentation", () => {
  it("keeps ordinary original due dates when no agreement exists", () => {
    expect(invoiceCollectionDue(original)).toBe("2026-10-01"); expect(invoiceStatusLabel(original)).toBe("Overdue");
  });
  it("uses the campus date and approved future date instead of showing an old overdue invoice", () => {
    const invoice = { ...original, payment_plan_state: "active" as const, collection_due_on: "2026-11-23", collection_due_amount_paise: 1_000_000, collection_overdue_paise: 0 };
    render(<MemoryRouter><FamilyFeeOverview ledger={ledger(invoice)} canPay={false} payHref="/fees" /><FamilyInvoiceList invoices={[invoice]} href={id => `/fees/${id}`} /></MemoryRouter>);
    expect(invoiceStatusLabel(invoice)).toBe("Open"); expect(invoiceCollectionDue(invoice)).toBe("2026-11-23");
    expect(screen.getByRole("link", { name: /Course fees/ })).toHaveTextContent("Agreed date 23 Nov 2026");
    expect(screen.getByText("Overdue").parentElement).toHaveTextContent("₹0.00");
    expect(screen.queryByText(/Due 1 Oct 2026/)).not.toBeInTheDocument();
  });
  it("shows only overdue instalments rather than the whole future outstanding balance", () => {
    const invoice = { ...original, payment_plan_state: "active" as const, collection_due_on: "2026-10-22", collection_due_amount_paise: 1_000_000, collection_overdue_paise: 1_000_000 };
    render(<MemoryRouter><FamilyFeeOverview ledger={ledger(invoice)} canPay={false} payHref="/fees" /></MemoryRouter>);
    expect(screen.getByText("Overdue").parentElement).toHaveTextContent("₹10,000.00");
    expect(screen.getByText("Total outstanding").parentElement).toHaveTextContent("₹30,000.00");
  });
  it("does not substitute the old overdue date for a plan needing review", () => {
    const invoice = { ...original, payment_plan_state: "needs_review" as const, collection_due_on: null, collection_due_amount_paise: null, collection_overdue_paise: null };
    render(<MemoryRouter><FamilyFeeOverview ledger={ledger(invoice)} canPay={false} payHref="/fees" /><FamilyInvoiceList invoices={[invoice]} href={id => `/fees/${id}`} /></MemoryRouter>);
    expect(invoiceCollectionDue(invoice)).toBeNull(); expect(invoiceStatusLabel(invoice)).toBe("Plan needs review");
    expect(screen.getByRole("link", { name: /Course fees/ })).toHaveTextContent("Plan needs review");
    expect(screen.getByText("Known overdue")).toBeVisible(); expect(screen.getByText(/overdue amount is not confirmed/)).toBeVisible();
    expect(screen.queryByText(/Due 1 Oct/)).not.toBeInTheDocument();
  });
  it("labels original and current dates separately in statements and print without including private correspondence", () => {
    const invoice = { ...original, payment_plan_state: "active" as const, collection_due_on: "2026-11-23", collection_due_amount_paise: 1_000_000, collection_overdue_paise: 0 };
    render(<MemoryRouter><FamilyInvoiceStatement invoice={invoice} payments={[]} receiptHref={id => `/receipt/${id}`} onSync={() => Promise.resolve()} syncing={false} />
      <FamilyFeePrint schoolName="Riverview" ledger={ledger(invoice)} view="invoices" /></MemoryRouter>);
    const statement = within(document.querySelector(".fee-statement") as HTMLElement);
    expect(statement.getByText("Original due 1 Oct 2026")).toBeVisible(); expect(statement.getByText("Next agreed date 23 Nov 2026")).toBeVisible();
    const print = within(document.querySelector(".family-fee-print-document") as HTMLElement);
    expect(print.getByText("Agreed: 23 Nov 2026")).toBeInTheDocument(); expect(print.getByText("Open")).toBeInTheDocument();
    expect(print.queryByText("Overdue")).not.toBeInTheDocument();
  });
});
