import { beforeEach, describe, expect, it, vi } from "vitest";
import { feeLedgerReadOptions, getFeeLedger, getGatewayPaymentReview } from "./api";

const apiFetchMock = vi.hoisted(() => vi.fn());
vi.mock("../../lib/api", () => ({ apiFetch: apiFetchMock }));

beforeEach(() => apiFetchMock.mockReset());

describe("exact gateway payment review API", () => {
  it("replaces list cursors with exact invoice, batch and receipt scope when opening a retained detail", async () => {
    apiFetchMock.mockResolvedValue({});
    const options = feeLedgerReadOptions(new URLSearchParams("ledger_cursor=old&ledger_search=other&ledger_payment_cursor=old-receipt&ledger_review_cursor=old-review&batch_id=batch&receipt=receipt&review=review"), "invoice");
    expect(options.cursor).toBeUndefined(); expect(options.search).toBeUndefined();
    expect(options.payment_cursor).toBeUndefined(); expect(options.review_cursor).toBeUndefined();
    await getFeeLedger("school", "student", options);
    expect(apiFetchMock).toHaveBeenCalledWith("/api/v1/schools/school/fees/workspace/?invoice_id=invoice&receipt_id=receipt&batch_id=batch&review_id=review&student_id=student");
  });
  it("encodes the school and order identifiers in the exact endpoint", async () => {
    apiFetchMock.mockResolvedValue({});

    await getGatewayPaymentReview("school/one", "order/two");

    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/v1/schools/school%2Fone/fees/gateway-orders/order%2Ftwo/",
    );
  });
});
