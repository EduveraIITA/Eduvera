import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { nativeFeeDecision, nativeFeeReport } from "../src/operations/native-fee-reviews.contracts.js";
import { nativeFeeReviewHref, obsoleteNativeFeeReview } from "../src/operations/native-fee-reviews.model.js";
import { hasNativeWorkflowProjection, nativeFeeReviewWork } from "../src/workspace/workflow-work.projection.js";

const ids = { command_id: randomUUID(), review_id: randomUUID(), expected_revision: 0, basis_hash: "a".repeat(64), basis_revision: 0,
  reviewer: { user_id: randomUUID(), person_id: randomUUID(), eligibility_hash: "b".repeat(64) } };
describe("native fee review public contract", () => {
  it("requires an explicit made-payment assertion, bounded money and independent recipient identity", () => {
    const payment = { ...ids, kind: "payment", amount_paise: 10000, method: "bank_transfer", reference: "ABC-123", note: "Synthetic payment" };
    expect(nativeFeeReport.safeParse(payment).success).toBe(false);
    expect(nativeFeeReport.safeParse({ ...payment, payment_made: true }).success).toBe(true);
    expect(nativeFeeReport.safeParse({ ...payment, payment_made: true, amount_paise: 1.5 }).success).toBe(false);
    expect(nativeFeeReport.safeParse({ ...payment, payment_made: true, amount_paise: 0 }).success).toBe(false);
    expect(nativeFeeReport.safeParse({ ...payment, payment_made: true, reviewer: { user_id: ids.reviewer.user_id } }).success).toBe(false);
    expect(nativeFeeReport.safeParse({ ...ids, kind: "charge", note: "Explain this charge" }).success).toBe(true);
    expect(nativeFeeReport.safeParse({ ...ids, kind: "charge", note: "Explain this charge", amount_paise: 100 }).success).toBe(false);
    expect(nativeFeeDecision.safeParse({ command_id: ids.command_id, expected_revision: 1, outcome: "verified", response: "Matched statement" }).success).toBe(true);
  });
  it("keeps person and student account routes distinct and rejects blind recovery through a bound proof", () => {
    const invoice = { id: randomUUID(), person_id: randomUUID(), student_id: null };
    expect(nativeFeeReviewHref(invoice, ids.review_id, false)).toContain(`scope=person&person_id=${invoice.person_id}`);
    expect(nativeFeeReviewHref({ ...invoice, student_id: "student-one" }, ids.review_id, false, "guardian")).toContain("scope=dependent&student_id=student-one");
    const proof = obsoleteNativeFeeReview(invoice.id, ids.review_id, ids, 2, "stream_advanced").getResponse();
    expect(proof).toMatchObject({ fields: { native_fee_review_obsolete: { handler: "finance.payment_review", invoice_id: invoice.id,
      review_id: ids.review_id, command_id: ids.command_id, expected_revision: 0, current_revision: 2, receipt_state: "absent" } } });
  });
  it("projects neutral named Work and suppresses only its exact native protocol mirror", () => {
    const item = { id: ids.review_id, invoice_id: randomUUID(), revision: 1, kind: "payment" as const, created_at: "2026-10-23T08:00:00Z",
      message_id: randomUUID(), href: "/areas/fees/ledger?native_review=one", title: "Payment reported", reviewer: { user_id: ids.reviewer.user_id, label: "Imran" }, state: "review_needed" as const };
    expect(nativeFeeReviewWork(item, "needs_me")).toMatchObject({ state: "action_required", due_at: null, urgency: "normal", source: { domain: "finance", kind: "fee_payment_review", action: "decide" } });
    expect(nativeFeeReviewWork({ ...item, state: "waiting_for_review" }, "waiting")).toMatchObject({ status_label: "Waiting for Imran", due_at: null, owner: { label: "Imran" } });
    expect(nativeFeeReviewWork({ ...item, state: "needs_reassignment" }, "waiting").tone).toBe("attention");
    expect(JSON.stringify(nativeFeeReviewWork(item, "needs_me"))).not.toMatch(/reference|note|bank|amount|schedule/u);
    expect(hasNativeWorkflowProjection({ source_domain: "finance", reaction_kind: "finance_payment_review" })).toBe(true);
    expect(hasNativeWorkflowProjection({ source_domain: "unrelated", reaction_kind: "finance_payment_review" })).toBe(false);
  });
});
