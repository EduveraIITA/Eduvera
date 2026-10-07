import { describe, expect, it } from "vitest";
import {
  canRecordInvoicePayment,
  feeLedgerSummary,
  type Invoice,
  invoiceStateLabel,
} from "./administration";

const invoice = (values: Partial<Invoice> = {}): Invoice => ({
  id: "invoice-1",
  student_id: "student-1",
  reference: "EVT-001",
  description: "Campus event",
  due_on: "2026-09-20",
  amount_paise: 10_000,
  paid_paise: 0,
  credited_paise: 0,
  refunded_paise: 0,
  adjusted_amount_paise: 10_000,
  net_paid_paise: 0,
  balance_paise: 10_000,
  refund_due_paise: 0,
  collection_state: "collectible",
  first_name: "Aarav",
  last_name: "Sharma",
  admission_number: "CIS-071",
  ...values,
});

describe("fee ledger presentation", () => {
  it("never presents a credited event invoice as paid, overdue, or collectible", () => {
    const credited = invoice({
      credited_paise: 10_000,
      adjusted_amount_paise: 0,
      balance_paise: 0,
      collection_state: "credited",
    });

    expect(invoiceStateLabel(credited, "2026-09-30")).toBe("Credited");
    expect(canRecordInvoicePayment(credited)).toBe(false);
  });

  it("keeps gross receipts while summarizing reconciled balances and refund work", () => {
    const refundDue = invoice({
      paid_paise: 6_000,
      credited_paise: 10_000,
      adjusted_amount_paise: 0,
      net_paid_paise: 6_000,
      balance_paise: 0,
      refund_due_paise: 6_000,
      collection_state: "refund_due",
    });
    const open = invoice({ id: "invoice-2", reference: "TUITION-1", amount_paise: 8_000, adjusted_amount_paise: 8_000, balance_paise: 8_000 });

    expect(invoiceStateLabel(refundDue, "2026-09-30")).toBe("Refund due");
    expect(canRecordInvoicePayment(refundDue)).toBe(false);
    expect(canRecordInvoicePayment(open)).toBe(true);
    expect(feeLedgerSummary([refundDue, open])).toEqual({
      adjusted_paise: 8_000,
      received_paise: 6_000,
      outstanding_paise: 8_000,
      refund_due_paise: 6_000,
    });
  });
});
