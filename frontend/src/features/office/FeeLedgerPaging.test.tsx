import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { FeeLedgerPaging } from "./FeeLedgerPaging";
import { FamilyFeeOverview } from "./FamilyFeeOverview";
import type { FeeLedger } from "./api";

function Location() { return <output data-testid="location">{useLocation().search}</output>; }
const pagination = { limit: 50, payment_limit: 50, next_cursor: "next-charge", next_payment_cursor: "next-receipt", search: "", exact: false, grouped: true };
afterEach(cleanup);
describe("bounded ledger navigation", () => {
  it("retains account scope while paging and resets both cursors on a full-ledger search", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={["/areas/fees/account?student_id=learner&scope=dependent&ledger_payment_cursor=old&ledger_review_cursor=old-review"]}>
      <FeeLedgerPaging pagination={pagination} /><Location /></MemoryRouter>);
    await user.click(screen.getByRole("button", { name: "Next charges" }));
    expect(screen.getByTestId("location")).toHaveTextContent("student_id=learner");
    expect(screen.getByTestId("location")).toHaveTextContent("ledger_cursor=next-charge");
    await user.type(screen.getByRole("searchbox", { name: "Search all records" }), "Materials");
    await user.click(screen.getByRole("button", { name: "Search ledger" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("ledger_search=Materials"));
    expect(screen.getByTestId("location")).not.toHaveTextContent("ledger_cursor");
    expect(screen.getByTestId("location")).not.toHaveTextContent("ledger_payment_cursor");
    expect(screen.getByTestId("location")).not.toHaveTextContent("ledger_review_cursor");
  });
  it("pages reviews independently while preserving the exact account scope", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={["/areas/fees/account?student_id=learner&invoice=invoice-a"]}>
      <FeeLedgerPaging pagination={{ ...pagination, exact: true, next_review_cursor: "review-b" }} reviews /><Location /></MemoryRouter>);
    await user.click(screen.getByRole("button", { name: "Next reviews" }));
    expect(screen.getByTestId("location")).toHaveTextContent("student_id=learner");
    expect(screen.getByTestId("location")).toHaveTextContent("invoice=invoice-a");
    expect(screen.getByTestId("location")).toHaveTextContent("ledger_review_cursor=review-b");
  });
  it("uses complete server balances rather than summing the loaded page", () => {
    const client = new QueryClient();
    const ledger: FeeLedger = { currency: "INR", invoices: [], payments: [], online_payments_enabled: false, pagination,
      totals: { outstanding: 99900, billed: 100000, received: 100, refunds: 0, open: 120, invoices: 120 } };
    render(<QueryClientProvider client={client}><MemoryRouter><FamilyFeeOverview ledger={ledger} canPay={false} payHref="/fees" /></MemoryRouter></QueryClientProvider>);
    expect(screen.getByText("₹999.00")).toBeVisible();
    expect(screen.getByText(/120 invoices pending/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Print this page" })).toBeVisible();
    client.clear();
  });
});
