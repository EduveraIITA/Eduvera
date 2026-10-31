import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FamilyFeeActions } from "./FamilyFeeActions";
import { FeeReviewQueue } from "./FeeReviewQueue";
import { FeeReviewHistory } from "./FeeReviewHistory";
import { decideFeeReview, parseRupees, submitFeeReview, type FeeReview, type Invoice } from "./api";
vi.mock("./api", async importOriginal => ({ ...await importOriginal<typeof import("./api")>(), submitFeeReview: vi.fn(), decideFeeReview: vi.fn() }));
afterEach(cleanup);
beforeEach(() => { vi.mocked(submitFeeReview).mockReset().mockResolvedValue({}); vi.mocked(decideFeeReview).mockReset().mockResolvedValue({}); });
const invoice: Invoice = { id: "invoice-1", student_id: "student-1", first_name: "Mira", last_name: "Sen", admission_number: "S001", reference: "TERM-1", description: "Term tuition", due_on: "2026-10-20", amount_paise: 10000, adjusted_amount_paise: 10000, paid_paise: 0, balance_paise: 10000, refund_due_paise: 0, collection_state: "collectible" };
const review: FeeReview = { id: "review-1", invoice_id: invoice.id, kind: "payment", amount_paise: 4000, method: "bank_transfer", reference: "UTR123", note: "Paid today", created_at: "2026-10-02T10:00:00Z", status: "pending", response: null, payment_id: null, reviewed_at: null };
const family = (reviews: FeeReview[] = []) => render(<FamilyFeeActions schoolId="school-1" invoice={invoice} settings={{ payee_name: "Test School", upi_id: "school@bank", instructions: "Use invoice reference", revision: 1 }} reviews={reviews} onSaved={vi.fn().mockResolvedValue(undefined)} />);
describe("fee pay and review", () => {
  it("keeps review response drafts across finite pages without carrying a funds-verification checkbox", async () => {
    const reviews = Array.from({ length: 11 }, (_, index) => ({ ...review, id: `review-${index + 1}`, note: `Report number ${index + 1}` }));
    render(<MemoryRouter><FeeReviewQueue schoolId="school-1" reviews={reviews} invoices={[invoice]} onSaved={vi.fn().mockResolvedValue(undefined)} /></MemoryRouter>);
    expect(screen.getAllByRole("button", { name: "Review request" })).toHaveLength(10);
    await userEvent.click(screen.getAllByRole("button", { name: "Review request" })[0]!);
    await userEvent.type(screen.getByLabelText("Response to the family"), "Checking the bank statement against this claim");
    await userEvent.click(screen.getByRole("checkbox", { name: /I independently verified/ }));
    await userEvent.click(within(screen.getByRole("navigation", { name: "reviews pages" })).getByRole("button", { name: "Next", exact: true }));
    expect(screen.getByText("Report number 11")).toBeVisible();
    expect(screen.queryByLabelText("Response to the family")).not.toBeInTheDocument();
    await userEvent.click(within(screen.getByRole("navigation", { name: "reviews pages" })).getByRole("button", { name: "Previous", exact: true }));
    expect(screen.getByLabelText("Response to the family")).toHaveValue("Checking the bank statement against this claim");
    expect(screen.getByRole("checkbox", { name: /I independently verified/ })).not.toBeChecked();
    expect(decideFeeReview).not.toHaveBeenCalled();
  });
  it("uses existing review kinds and opens an exact pending target beyond the first page", async () => {
    const reviews = Array.from({ length: 11 }, (_, index) => ({ ...review, id: `review-${index + 1}`, note: `Report number ${index + 1}` }));
    render(<MemoryRouter initialEntries={["/reviews?fee_reviews_search=missing"]}><FeeReviewQueue schoolId="school-1" reviews={reviews} invoices={[invoice]} onSaved={vi.fn()} focusReviewId="review-11" /></MemoryRouter>);
    expect(await screen.findByLabelText("Response to the family")).toBeVisible();
    expect(screen.getByText("Page 2 of 2 · 11 reviews")).toBeVisible();
    await waitFor(() => expect(document.getElementById("attention-review-11")).toHaveFocus());
    expect(screen.getByRole("option", { name: "Payment claims · 11" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Find a review" })).toHaveValue("");
    expect(decideFeeReview).not.toHaveBeenCalled();
  });
  it("keeps the page fixed while a review decision is in flight", async () => {
    let complete: (() => void) | undefined;
    vi.mocked(decideFeeReview).mockImplementation(() => new Promise((resolve) => { complete = () => resolve({}); }));
    const reviews = Array.from({ length: 11 }, (_, index) => ({ ...review, id: `review-${index + 1}` }));
    render(<MemoryRouter><FeeReviewQueue schoolId="school-1" reviews={reviews} invoices={[invoice]} onSaved={vi.fn().mockResolvedValue(undefined)} /></MemoryRouter>);
    await userEvent.click(screen.getAllByRole("button", { name: "Review request" })[0]!);
    await userEvent.type(screen.getByLabelText("Response to the family"), "Matched the bank statement");
    await userEvent.click(screen.getByRole("checkbox", { name: /I independently verified/ }));
    await userEvent.click(screen.getByRole("button", { name: "Verify payment & issue receipt" }));
    const pages = within(screen.getByRole("navigation", { name: "reviews pages" }));
    expect(pages.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
    expect(screen.getByRole("searchbox", { name: "Find a review" })).toBeDisabled();
    await act(async () => { complete?.(); await Promise.resolve(); });
    await waitFor(() => expect(pages.getByRole("button", { name: "Next", exact: true })).toBeEnabled());
    expect(decideFeeReview).toHaveBeenCalledOnce();
  });
  it("opens and focuses a completed review beyond the first history page", async () => {
    const reviews = Array.from({ length: 11 }, (_, index) => ({ ...review, id: `review-${index + 1}`, status: "rejected" as const, response: `Bank check ${index + 1}` }));
    render(<MemoryRouter><FeeReviewHistory reviews={reviews} invoices={[invoice]} focusReviewId="review-11" /></MemoryRouter>);
    expect(await screen.findByText("Bank check 11")).toBeVisible();
    expect(screen.getByText("Page 2 of 2 · 11 past reviews")).toBeVisible();
    await waitFor(() => expect(document.getElementById("fee-review-review-11")).toHaveFocus());
    expect(screen.getByRole("option", { name: "Payment not verified · 11" })).toBeInTheDocument();
    expect(decideFeeReview).not.toHaveBeenCalled();
  });
  it("converts money exactly and rejects invalid precision", () => {
    expect(parseRupees("10.01")).toBe(1001); expect(parseRupees("0.29")).toBe(29);
    for (const value of ["0", "-1", "1.001", "1e4", "NaN", "1000001"]) expect(() => parseRupees(value)).toThrow();
  });
  it("shows payee and amount before UPI and submits a payment claim, never a receipt", async () => {
    const user = userEvent.setup(); family();
    await user.click(screen.getByRole("button", { name: "Review fee & pay" }));
    await user.click(screen.getByRole("button", { name: "Pay / report payment" }));
    expect(screen.getByRole("link", { name: /Open UPI app/ })).toHaveAttribute("href", "upi://pay?pa=school%40bank&pn=Test+School&am=100.00&cu=INR&tn=TERM-1");
    await user.clear(screen.getByLabelText("Amount (₹)")); await user.type(screen.getByLabelText("Amount (₹)"), "40.01");
    await user.type(screen.getByLabelText(/UTR/), "UTR123");
    await user.click(screen.getByRole("checkbox")); await user.click(screen.getByRole("button", { name: "Submit payment for review" }));
    expect(submitFeeReview).toHaveBeenCalledWith("school-1", invoice.id, expect.objectContaining({ kind: "payment", amount_paise: 4001, method: "bank_transfer", reference: "UTR123" }));
    expect(screen.getByRole("status")).toHaveTextContent("this is not a receipt");
  });
  it("blocks another pay action while verification is pending", async () => {
    const user = userEvent.setup(); family([review]); await user.click(screen.getByRole("button", { name: "Review fee & pay" }));
    expect(screen.queryByRole("button", { name: "Pay / report payment" })).not.toBeInTheDocument();
    expect(screen.getByText(/awaiting school verification/)).toBeVisible();
  });
  it("retries the identical payment submission with the same idempotency key", async () => {
    vi.mocked(submitFeeReview).mockRejectedValueOnce(new Error("Connection lost")); const user = userEvent.setup(); family();
    await user.click(screen.getByRole("button", { name: "Review fee & pay" })); await user.click(screen.getByRole("button", { name: "Pay / report payment" }));
    await user.type(screen.getByLabelText(/UTR/), "UTR456"); await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Submit payment for review" })); expect(screen.getByRole("alert")).toHaveTextContent("Connection lost");
    await user.click(screen.getByRole("button", { name: "Submit payment for review" }));
    expect(vi.mocked(submitFeeReview).mock.calls[0]?.[2]).toEqual(vi.mocked(submitFeeReview).mock.calls[1]?.[2]);
  });
  it("allows a fee question independently of a pending payment", async () => {
    const user = userEvent.setup(); family([review]); await user.click(screen.getByRole("button", { name: "Review fee & pay" }));
    await user.click(screen.getByRole("button", { name: "Question this fee" })); await user.type(screen.getByLabelText("Your question"), "Is transport included here?");
    await user.click(screen.getByRole("button", { name: "Request fee review" }));
    expect(submitFeeReview).toHaveBeenCalledWith("school-1", invoice.id, expect.objectContaining({ kind: "charge", note: "Is transport included here?" }));
  });
  it("requires independent verification and records the family-facing response", async () => {
    const user = userEvent.setup(); render(<MemoryRouter><FeeReviewQueue schoolId="school-1" reviews={[review]} invoices={[invoice]} onSaved={vi.fn().mockResolvedValue(undefined)} /></MemoryRouter>);
    await user.click(screen.getByRole("button", { name: "Review request" })); await user.type(screen.getByLabelText("Response to the family"), "Matched bank statement.");
    await user.click(screen.getByRole("checkbox")); await user.click(screen.getByRole("button", { name: "Verify payment & issue receipt" }));
    expect(decideFeeReview).toHaveBeenCalledWith("school-1", review.id, { outcome: "verified", response: "Matched bank statement.", verified_funds: true });
  });
  it("clearly distinguishes rejected payment history from receipts", () => {
    render(<MemoryRouter><FeeReviewHistory reviews={[{ ...review, status: "rejected", response: "No matching transfer found." }]} invoices={[invoice]} /></MemoryRouter>);
    expect(screen.getByText("Payment not verified")).toBeVisible(); expect(screen.getByText("No matching transfer found.")).toBeVisible();
  });
});
