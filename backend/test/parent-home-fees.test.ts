import { describe, expect, it } from "vitest";
import { parentFeeStatusFromLedger } from "../src/school/school.service.js";

const context = { asOf: "2026-10-16", termId: "term-1" };

describe("parent Home fee status", () => {
  it("keeps a missing applicable ledger distinct from a cleared balance", () => {
    expect(parentFeeStatusFromLedger({
      invoice_count: 0,
      outstanding_paise: "0",
      overdue_paise: "0",
      refund_due_paise: "0",
      next_due_on: null,
    }, context)).toEqual({
      state: "not_configured",
      source: "fee_ledger",
      scope: "current_term_and_carried_balance",
      as_of: context.asOf,
      term_id: context.termId,
      invoice_count: 0,
      currency: "INR",
      outstanding_paise: null,
      overdue_paise: null,
      refund_due_paise: null,
      next_due_on: null,
    });
  });

  it("reports accepted invoice, payment, credit and refund aggregates without inventing clearance", () => {
    expect(parentFeeStatusFromLedger({
      invoice_count: 3,
      outstanding_paise: "850000",
      overdue_paise: "600000",
      refund_due_paise: "25000",
      next_due_on: "2026-11-06",
    }, context)).toMatchObject({
      state: "mixed",
      invoice_count: 3,
      outstanding_paise: 850000,
      overdue_paise: 600000,
      refund_due_paise: 25000,
      next_due_on: "2026-11-06",
    });
  });

  it("calls a zero balance clear only when at least one applicable invoice exists", () => {
    expect(parentFeeStatusFromLedger({
      invoice_count: 2,
      outstanding_paise: 0,
      overdue_paise: 0,
      refund_due_paise: 0,
      next_due_on: null,
    }, context)).toMatchObject({ state: "clear", invoice_count: 2, outstanding_paise: 0 });
  });
});
