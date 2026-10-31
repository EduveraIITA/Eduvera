import { describe, expect, it } from "vitest";
import { requestInstalments, enableSelfPayer } from "../src/operations/finance-arrangements.contracts.js";
import { agreedSchedule, financeHash } from "../src/operations/finance-arrangements.store.js";
import { assertFinanceArrangementLimit } from "../src/operations/finance-arrangements.service.js";
const id = "11111111-1111-4111-8111-111111111111";
describe("Finance arrangement contracts and ledger-derived schedules", () => {
  it("accepts one deferred payment or arbitrary dated instalments, not a monthly institution model", () => {
    const input = { command_id: id, request_id: id, expected_revision: 0, basis_hash: "a".repeat(64), basis_revision: 0, schedule: [{ amount_paise: 3051, due_on: "2030-11-07" }] };
    expect(requestInstalments.parse(input).schedule).toHaveLength(1);
    expect(requestInstalments.parse({ ...input, schedule: [...input.schedule, { amount_paise: 77, due_on: "2031-03-12" }] }).schedule).toHaveLength(2);
    expect(() => requestInstalments.parse({ ...input, schedule: [...input.schedule, ...input.schedule] })).toThrow();
    expect(() => requestInstalments.parse({ ...input, schedule: [{ amount_paise: 1.5, due_on: "2030-11-07" }] })).toThrow();
    expect(() => enableSelfPayer.parse({ command_id: id, entitlement_id: id, expected_revision: 0, valid_from: "2030-01-01", valid_until: "2030-02-01", attested_adult_self_payer: false })).toThrow();
  });
  it("allocates only newly posted money, leaving claims and the charge out of the schedule", () => {
    const basis = { invoice_id: id, student_id: id, amount_paise: 3_000_000, credited_paise: 0, paid_paise: 0, refunded_paise: 0, balance_paise: 3_000_000, credits: [], payments: [], refunds: [] };
    const request = { ledger_basis: basis, schedule: [{ amount_paise: 1_000_000, due_on: "2030-11-01" }, { amount_paise: 2_000_000, due_on: "2030-12-01" }] };
    expect(agreedSchedule(request, basis)).toMatchObject({ state: "active", next_due_on: "2030-11-01", rows: [{ allocated_paise: 0 }, { allocated_paise: 0 }] });
    expect(agreedSchedule(request, { ...basis, paid_paise: 1_000_000, balance_paise: 2_000_000, payments: [{ id, amount_paise: 1_000_000 }] })).toMatchObject({ state: "active", next_due_on: "2030-12-01", rows: [{ remaining_paise: 0 }, { remaining_paise: 2_000_000 }] });
    expect(agreedSchedule(request, { ...basis, credited_paise: 1, credits: [{ id, amount_paise: 1 }] })).toMatchObject({ state: "needs_review", next_due_on: null });
    expect(agreedSchedule(request, { ...basis, refunded_paise: 1, refunds: [{ id, amount_paise: 1 }] })).toMatchObject({ state: "needs_review" });
  });
  it("uses stable commitments across JSONB key ordering and enforces supported mandate amount limits", () => {
    expect(financeHash({ b: 2, a: [{ y: 1, x: 3 }] })).toBe(financeHash({ a: [{ x: 3, y: 1 }], b: 2 }));
    expect(() => assertFinanceArrangementLimit({ fee_instalment_basis: { max_amount_paise: 100 } } as never, 101)).toThrow("exceeds");
    expect(() => assertFinanceArrangementLimit({ fee_instalment_basis: { max_amount_paise: null } } as never, 101)).not.toThrow();
  });
});
