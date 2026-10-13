import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Link, MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FeeLedgerPage from "./FeeLedgerPage";
import { getFeeLedger, getFeeStudents, getGatewayPaymentReview, postInvoice, recordPayment, type FeeReview, type Invoice } from "./api";
vi.mock("../auth/AuthContext",()=>({useAuth:()=>({memberships:[{role:"admin",school_id:"school-1"}],hasPortal:(role:string)=>role==="principal"})}));
vi.mock("../../pages/operations/OperationsShell",()=>({OperationsShell:({title,backTo,children}:{title:string;backTo:string;children:ReactNode})=><><h1>{title}</h1><Link to={backTo}>Go back</Link>{children}</>}));
vi.mock("./api",async original=>({...await original<typeof import("./api")>(),getFeeLedger:vi.fn(),getFeeStudents:vi.fn(),getGatewayPaymentReview:vi.fn(),recordPayment:vi.fn(),postInvoice:vi.fn()}));
const invoice:Invoice={id:"invoice-1",student_id:"student-1",first_name:"Mira",last_name:"Sen",admission_number:"S001",reference:"TERM-1",description:"Term tuition",due_on:"2026-10-20",amount_paise:10000,adjusted_amount_paise:10000,paid_paise:0,balance_paise:10000,refund_due_paise:0,collection_state:"collectible"};
const review:FeeReview={id:"review-1",invoice_id:invoice.id,kind:"payment",amount_paise:4000,method:"bank_transfer",reference:"UTR123",note:"Paid today",created_at:"2026-10-02T10:00:00Z",status:"pending",response:null,payment_id:null,reviewed_at:null};
const gatewayPayment={id:"order-1",invoice_id:invoice.id,amount_paise:4000,state:"review_required",provider_payment_id:"pay-1",payment_id:null};
beforeEach(()=>{vi.mocked(getFeeLedger).mockResolvedValue({currency:"INR",invoices:[invoice],payments:[],online_payments_enabled:false,reviews:[]});vi.mocked(getFeeStudents).mockResolvedValue({results:[invoice]});vi.mocked(getGatewayPaymentReview).mockResolvedValue(gatewayPayment);});
afterEach(()=>{cleanup();vi.clearAllMocks();});
function show(path="/principal/fees"){return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter initialEntries={[path]}><FeeLedgerPage/></MemoryRouter></QueryClientProvider>);}
describe("fee workspace navigation",()=>{
 it("opens the payment form without the ledger and preserves its verification gate",async()=>{
   const user=userEvent.setup();show();await user.click(await screen.findByRole("button",{name:"Record payment"}));
   expect(await screen.findByLabelText("Amount received (₹)")).toBeVisible();
   expect(screen.queryByRole("navigation",{name:"Ledger records"})).not.toBeInTheDocument();
   expect(screen.getByRole("checkbox",{name:/Funds have been received and verified/})).toBeRequired();
   expect(recordPayment).not.toHaveBeenCalled();
   await user.click(screen.getByRole("link",{name:"Go back"}));
   expect(await screen.findByRole("navigation",{name:"Ledger records"})).toBeVisible();
 });
 it("keeps reviews and settings separate from invoices",async()=>{
   const user=userEvent.setup();show();await user.click(await screen.findByRole("button",{name:"Reviews"}));
   expect(screen.getByRole("heading",{name:"Fee reviews"})).toBeVisible();
   expect(screen.queryByRole("navigation",{name:"Ledger records"})).not.toBeInTheDocument();
   await user.click(screen.getByRole("link",{name:"Go back"}));await user.click(screen.getByRole("button",{name:"Settings"}));
   expect(screen.getByLabelText("School payee name")).toBeVisible();
   expect(screen.queryByRole("navigation",{name:"Ledger records"})).not.toBeInTheDocument();
 });
 it("restores a direct payment link without recording a payment",async()=>{
   show("/principal/fees?mode=payment&invoice=invoice-1&student_id=student-1");
   expect(await screen.findByLabelText("Amount received (₹)")).toHaveValue(100);
   expect(getFeeLedger).toHaveBeenCalledWith("school-1","student-1");
   expect(recordPayment).not.toHaveBeenCalled();expect(postInvoice).not.toHaveBeenCalled();
 });
 it("opens and focuses the exact fee review from an attention link",async()=>{
   vi.mocked(getFeeLedger).mockResolvedValue({currency:"INR",invoices:[invoice],payments:[],online_payments_enabled:false,reviews:[review]});
   show("/principal/fees?review=review-1");
   expect(await screen.findByRole("heading",{name:"Fee reviews"})).toBeVisible();
   expect(await screen.findByLabelText("Response to the family")).toBeVisible();
   const target=document.getElementById("attention-review-1");
   expect(target).toHaveClass("attention-focus");
   await waitFor(()=>expect(target).toHaveFocus());
 });
 it("focuses a completed review in history and reports a missing review truthfully",async()=>{
   vi.mocked(getFeeLedger).mockResolvedValue({currency:"INR",invoices:[invoice],payments:[],online_payments_enabled:false,reviews:[{...review,status:"verified",response:"Matched to the bank statement",reviewed_at:"2026-10-03T10:00:00Z"}]});
   const first=show("/principal/fees?review=review-1");
   await screen.findByText("Matched to the bank statement");
   const target=document.getElementById("fee-review-review-1");
   expect(target).toHaveClass("attention-focus");
   await waitFor(()=>expect(target).toHaveFocus());
   first.unmount();
   show("/principal/fees?review=missing-review");
   expect(await screen.findByRole("alert")).toHaveTextContent("Fee review unavailable");
 });
 it("opens and focuses an exact captured payment outside the bounded workspace",async()=>{
   vi.mocked(getFeeLedger).mockResolvedValue({currency:"INR",invoices:[invoice],payments:[],online_payments_enabled:true,reviews:[],gateway_payments:[]});
   show("/principal/fees?view=review&invoice=invoice-1&order=order-1");
   expect(await screen.findByText("Captured payment needs reconciliation")).toBeVisible();
   expect(getGatewayPaymentReview).toHaveBeenCalledWith("school-1","order-1");
   const target=document.getElementById("attention-payment-order-order-1");
   expect(target).toHaveClass("is-attention-target");
   await waitFor(()=>expect(target).toHaveFocus());
 });
 it("does not focus an order when the linked invoice is wrong or missing",async()=>{
   vi.mocked(getFeeLedger).mockResolvedValue({currency:"INR",invoices:[invoice],payments:[],online_payments_enabled:true,reviews:[],gateway_payments:[gatewayPayment]});
   show("/principal/fees?view=review&invoice=wrong-invoice&order=order-1");
   expect(await screen.findByRole("alert")).toHaveTextContent("does not match the linked invoice");
   expect(document.getElementById("attention-payment-order-order-1")).not.toBeInTheDocument();
 });
 it("fails closed and retries when the exact payment review cannot be verified",async()=>{
   const user=userEvent.setup();
   vi.mocked(getFeeLedger).mockResolvedValue({currency:"INR",invoices:[invoice],payments:[],online_payments_enabled:true,reviews:[],gateway_payments:[gatewayPayment]});
   vi.mocked(getGatewayPaymentReview).mockRejectedValueOnce(new Error("Unavailable")).mockResolvedValueOnce(gatewayPayment);
   show("/principal/fees?view=review&invoice=invoice-1&order=order-1");
   const alert=await screen.findByRole("alert");
   expect(alert).toHaveTextContent("Payment review unavailable");
   expect(document.getElementById("attention-payment-order-order-1")).not.toBeInTheDocument();
   await user.click(screen.getByRole("button",{name:"Try again"}));
   expect(await screen.findByText("Captured payment needs reconciliation")).toBeVisible();
   expect(getGatewayPaymentReview).toHaveBeenCalledTimes(2);
 });
});
