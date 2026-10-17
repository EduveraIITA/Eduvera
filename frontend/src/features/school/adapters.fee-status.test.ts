import { describe, expect, it } from "vitest";
import { adaptParentFeeStatus } from "./adapters";
import type { ApiParentFeeStatus } from "./api";

const base: ApiParentFeeStatus = {
  state: "overdue",
  source: "fee_ledger",
  scope: "current_term_and_carried_balance",
  as_of: "2026-10-16",
  term_id: "term-1",
  invoice_count: 3,
  currency: "INR",
  outstanding_paise: 850000,
  overdue_paise: 600000,
  refund_due_paise: 0,
  next_due_on: "2026-11-06",
};

describe("parent Home fee adapter", () => {
  it("shows ledger-backed outstanding and overdue amounts", () => {
    expect(adaptParentFeeStatus(base)).toEqual({
      feeStatus: "₹8,500.00 due",
      feeDetail: "₹6,000.00 overdue · Fee ledger as of 16 Oct",
      feeState: "overdue",
    });
  });

  it("keeps missing and unconfigured fee data distinct from a cleared ledger", () => {
    expect(adaptParentFeeStatus(undefined)).toMatchObject({
      feeStatus: "Unavailable",
      feeState: "unavailable",
    });
    expect(adaptParentFeeStatus({
      ...base,
      state: "not_configured",
      invoice_count: 0,
      outstanding_paise: null,
      overdue_paise: null,
      refund_due_paise: null,
      next_due_on: null,
    })).toMatchObject({
      feeStatus: "Not configured",
      feeState: "not_configured",
    });
    expect(adaptParentFeeStatus({
      ...base,
      state: "clear",
      invoice_count: 2,
      outstanding_paise: 0,
      overdue_paise: 0,
      refund_due_paise: 0,
      next_due_on: null,
    })).toEqual({
      feeStatus: "No balance due",
      feeDetail: "2 posted invoices · Fee ledger as of 16 Oct",
      feeState: "clear",
    });
  });

  it("fails closed when a clearance label contradicts the ledger totals", () => {
    expect(adaptParentFeeStatus({ ...base, state: "clear" })).toEqual({
      feeStatus: "Unavailable",
      feeDetail: "Fee ledger totals could not be confirmed",
      feeState: "unavailable",
    });
  });
});
