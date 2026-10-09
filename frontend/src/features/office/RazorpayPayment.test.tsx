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
  vi.mocked(apiFetch).mockResolvedValue([]);
  window.Razorpay = class { constructor(value: typeof options) { options = value; } open() { opened(); } close() {} on() {} };
});
it("opens checkout with the server order and waits for verified capture before showing a receipt", async () => {
  const saved = vi.fn().mockResolvedValue(undefined);
  vi.mocked(apiFetch).mockResolvedValueOnce([]).mockResolvedValueOnce({ key_id: "rzp_test_fixture", order_id: "order_one", amount: 2500, currency: "INR" }).mockResolvedValueOnce({ state: "captured", payment_id: "receipt" });
  render(<RazorpayPayment schoolId="school" invoiceId="invoice" amount={2500} onSaved={saved} />);
  await userEvent.click(screen.getByRole("button", { name: /Pay with Razorpay/ }));
  expect(opened).toHaveBeenCalledOnce(); expect(saved).not.toHaveBeenCalled();
  expect(options.order_id).toBe("order_one"); expect(options.amount).toBe(2500);
  act(() => options.handler({ razorpay_order_id: "order_one", razorpay_payment_id: "pay_one", razorpay_signature: "signature" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Sandbox payment verified"));
  expect(saved).toHaveBeenCalledOnce();
});
it("keeps authorized payments pending and provides a recovery status check", async () => {
  vi.mocked(apiFetch).mockResolvedValue([{ state: "created", payment_id: null }]);
  render(<RazorpayPayment schoolId="school" invoiceId="invoice" amount={2500} onSaved={vi.fn()} />);
  await userEvent.click(screen.getByRole("button", { name: "Check payment status" }));
  expect(screen.getByRole("status")).toHaveTextContent("not yet confirmed");
});
it("never calls checkout after an order failure", async () => {
  vi.mocked(apiFetch).mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("Amount exceeds outstanding balance"));
  render(<RazorpayPayment schoolId="school" invoiceId="invoice" amount={2500} onSaved={vi.fn()} />);
  await userEvent.click(screen.getByRole("button", { name: /Pay with Razorpay/ }));
  expect(opened).not.toHaveBeenCalled(); expect(screen.getByRole("alert")).toHaveTextContent("outstanding balance");
});
it('restores payment and email status after reopening the invoice and exposes a private PDF link',async()=>{
 vi.mocked(apiFetch).mockResolvedValue([{id:'order',state:'captured',payment_id:'receipt',provider_payment_id:'pay_one',amount_paise:2500,email_status:'accepted'}]);
 render(<RazorpayPayment schoolId="school" invoiceId="invoice" amount={0} onSaved={vi.fn()}/>);
 expect(await screen.findByText('Payment confirmed')).toBeVisible();
 expect(screen.getByText(/Email accepted by provider/)).toBeVisible();
 expect(screen.getByRole('link',{name:'Download PDF receipt'})).toHaveAttribute('href','/api/v1/schools/school/fees/invoices/invoice/razorpay/receipts/receipt/pdf/');
});
it('shows failed attempts without presenting a receipt',async()=>{
 vi.mocked(apiFetch).mockResolvedValue([{state:'failed',payment_id:null,email_status:'unknown'}]);
 render(<RazorpayPayment schoolId="school" invoiceId="invoice" amount={2500} onSaved={vi.fn()}/>);
 expect(await screen.findByText('Attempt failed')).toBeVisible();
 expect(screen.queryByRole('link',{name:'Download PDF receipt'})).not.toBeInTheDocument();
});
it('does not let a late status response erase a verified payment',async()=>{
 let resolveInitial!:(value:unknown[])=>void;
 vi.mocked(apiFetch).mockReturnValueOnce(new Promise(resolve=>{resolveInitial=resolve;})).mockResolvedValueOnce({key_id:'rzp_test_fixture',order_id:'order_one',amount:2500,currency:'INR'}).mockResolvedValueOnce({state:'captured',payment_id:'receipt'});
 render(<RazorpayPayment schoolId="school" invoiceId="invoice" amount={2500} onSaved={vi.fn()}/>);
 await userEvent.click(screen.getByRole('button',{name:/Pay with Razorpay/}));
 await act(async()=>options.handler({razorpay_order_id:'order_one',razorpay_payment_id:'pay_one',razorpay_signature:'signature'}));
 await act(async()=>resolveInitial([]));
 expect(screen.getByText('Payment confirmed')).toBeVisible();
});
