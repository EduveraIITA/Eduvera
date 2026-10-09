import { render, screen, waitFor, act, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { apiFetch } from "../../lib/api";
import { RazorpayPayment } from "./RazorpayPayment";
vi.mock("../../lib/api", () => ({ apiFetch: vi.fn() }));
vi.mock("./razorpay", () => ({ loadRazorpay: vi.fn().mockResolvedValue(undefined) }));
afterEach(() => { cleanup(); delete window.Razorpay; });
let options: ConstructorParameters<NonNullable<Window["Razorpay"]>>[0];
const opened = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  window.Razorpay = class { constructor(value: typeof options) { options = value; } open() { opened(); } on() {} };
});
it("opens checkout with the server order and waits for verified capture before showing a receipt", async () => {
  const saved = vi.fn().mockResolvedValue(undefined);
  vi.mocked(apiFetch).mockResolvedValueOnce({ key_id: "rzp_test_fixture", order_id: "order_one", amount: 2500, currency: "INR" }).mockResolvedValueOnce({ state: "captured", payment_id: "receipt" });
  render(<RazorpayPayment schoolId="school" invoiceId="invoice" amount={2500} onSaved={saved} />);
  await userEvent.click(screen.getByRole("button", { name: /Pay with Razorpay/ }));
  expect(opened).toHaveBeenCalledOnce(); expect(saved).not.toHaveBeenCalled();
  expect(options.order_id).toBe("order_one"); expect(options.amount).toBe(2500);
  act(() => options.handler({ razorpay_order_id: "order_one", razorpay_payment_id: "pay_one", razorpay_signature: "signature" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Sandbox payment verified"));
  expect(saved).toHaveBeenCalledOnce();
});
it("keeps authorized payments pending and provides a recovery status check", async () => {
  vi.mocked(apiFetch).mockResolvedValueOnce([{ state: "created", payment_id: null }]);
  render(<RazorpayPayment schoolId="school" invoiceId="invoice" amount={2500} onSaved={vi.fn()} />);
  await userEvent.click(screen.getByRole("button", { name: "Check payment status" }));
  expect(screen.getByRole("status")).toHaveTextContent("not yet confirmed");
});
it("never calls checkout after an order failure", async () => {
  vi.mocked(apiFetch).mockRejectedValueOnce(new Error("Amount exceeds outstanding balance"));
  render(<RazorpayPayment schoolId="school" invoiceId="invoice" amount={2500} onSaved={vi.fn()} />);
  await userEvent.click(screen.getByRole("button", { name: /Pay with Razorpay/ }));
  expect(opened).not.toHaveBeenCalled(); expect(screen.getByRole("alert")).toHaveTextContent("outstanding balance");
});
