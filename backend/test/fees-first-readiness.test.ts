import { describe, expect, it } from "vitest";
import { feesBatchDestination, feesInvoiceDestination, parseFeesContinuation } from "../src/operations/fees-first-readiness.js";

const person = "51f9b93b-a735-4bc9-85f2-a5d239d0d10e", invoice = "8b2ed9df-b972-4177-8923-5509384e7f65";
describe("exact person invoice continuation", () => {
  it("retains the invoice and beneficiary without a student adapter", () => {
    const path = feesInvoiceDestination({ id: invoice, person_id: person });
    expect(path.length).toBeLessThanOrEqual(180);
    expect(parseFeesContinuation(path)).toEqual({ person_id: person, invoice_id: invoice });
  });
  it("retains one exact collection without choosing a beneficiary", () => {
    expect(parseFeesContinuation(feesBatchDestination({ id: invoice }))).toEqual({ batch_id: invoice });
  });
  it.each([
    `//example.test/areas/fees/ledger?person_id=${person}&invoice_id=${invoice}`,
    `https://example.test/areas/fees/ledger?person_id=${person}&invoice_id=${invoice}`,
    `/areas/fees/ledger?person_id=${person}&invoice_id=${invoice}&person_id=${person}`,
    `/areas/fees/ledger?person_id=${person}&invoice_id=${invoice}&world=live`,
    `/areas/fees/ledger?person_id=${person}&invoice_id=${invoice}#pay`,
    `/areas/fees/ledger?student_id=${person}&invoice_id=${invoice}`,
    `/areas/fees/ledger?person_id=${person}&invoice_id=unknown`,
    `/areas/fees/account?person_id=${person}&invoice_id=${invoice}`,
    `/areas/fees/ledger?batch_id=${invoice}&person_id=${person}`,
    `/areas/fees/ledger?batch_id=${invoice}&batch_id=${invoice}`,
    `/areas/fees/ledger?batch_id=${invoice}#pay`,
    `/areas/fees/ledger?batch_id=unknown`,
    `/areas/fees/ledger?batch_id=${invoice}&world=live`,
  ])("rejects a broadened or invalid continuation %s", path => expect(parseFeesContinuation(path)).toBeNull());
});
