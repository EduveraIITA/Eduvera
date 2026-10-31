import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Link, MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FeeLedgerPage from "./FeeLedgerPage";
import { getFeeLedger, getFeeStudents, getGatewayPaymentReview, postInvoice, recordPayment, type FeeReview, type Invoice } from "./api";
import { ExecutionEnvironmentProvider } from "../simulation/ExecutionEnvironmentContext";
import { getFinanceArrangements } from "./financeArrangementsApi";
vi.mock("../auth/AuthContext",()=>({useAuth:()=>({memberships:[{role:"staff",school_id:"school-1",permissions:["fees.manage"]}]})}));
vi.mock("../../pages/operations/OperationsShell",()=>({OperationsShell:({title,backTo,children}:{title:string;backTo:string;children:ReactNode})=><><h1>{title}</h1><Link to={backTo}>Go back</Link>{children}</>}));
vi.mock("./api",async original=>({...await original<typeof import("./api")>(),getFeeLedger:vi.fn(),getFeeStudents:vi.fn(),getGatewayPaymentReview:vi.fn(),recordPayment:vi.fn(),postInvoice:vi.fn()}));
vi.mock("./financeArrangementsApi",async original=>({...await original<typeof import("./financeArrangementsApi")>(),getFinanceArrangements:vi.fn()}));
const invoice:Invoice={id:"invoice-1",student_id:"student-1",first_name:"Mira",last_name:"Sen",admission_number:"S001",reference:"TERM-1",description:"Term tuition",due_on:"2026-10-20",amount_paise:10000,adjusted_amount_paise:10000,paid_paise:0,balance_paise:10000,refund_due_paise:0,collection_state:"collectible"};
const review:FeeReview={id:"review-1",invoice_id:invoice.id,kind:"payment",amount_paise:4000,method:"bank_transfer",reference:"UTR123",note:"Paid today",created_at:"2026-10-02T10:00:00Z",status:"pending",response:null,payment_id:null,reviewed_at:null};
const gatewayPayment={id:"order-1",invoice_id:invoice.id,amount_paise:4000,state:"review_required",provider_payment_id:"pay-1",payment_id:null};
beforeEach(()=>{vi.mocked(getFeeLedger).mockResolvedValue({currency:"INR",invoices:[invoice],payments:[],online_payments_enabled:false,reviews:[]});vi.mocked(getFeeStudents).mockResolvedValue({results:[invoice]});vi.mocked(getGatewayPaymentReview).mockResolvedValue(gatewayPayment);});
afterEach(()=>{cleanup();vi.clearAllMocks();});
function NavigationProbe(){const location=useLocation();const navigate=useNavigate();return <><span data-testid="location">{location.pathname}{location.search}</span><button type="button" onClick={()=>navigate(-1)}>Browser back</button></>;}
function show(path="/areas/fees/ledger"){return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter initialEntries={[path]}><NavigationProbe/><FeeLedgerPage/></MemoryRouter></QueryClientProvider>);}
describe("fee workspace navigation",()=>{
 it("uses one visible Payment plans page title while retaining the account section hierarchy",async()=>{
   vi.mocked(getFinanceArrangements).mockResolvedValue({school_id:"school-1",today:"2026-10-23",timezone:"UTC",supported_mode:"approval_required",
     can_manage:false,review_route:{state:"ready",reviewer:{user_id:"reviewer",label:"Imran"}},invoices:[]});
   render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter initialEntries={["/areas/fees/ledger?view=arrangements"]}>
     <ExecutionEnvironmentProvider environment={{mode:"live"}}><FeeLedgerPage/></ExecutionEnvironmentProvider></MemoryRouter></QueryClientProvider>);
   const panel=await screen.findByRole("region",{name:"Payment plans"});
   expect(screen.getByRole("heading",{name:"Payment plans",level:1})).toBeVisible();
   expect(screen.queryByRole("heading",{name:"Payment plans",level:2})).not.toBeInTheDocument();
   expect(within(panel).getByRole("heading",{name:"Fee accounts",level:2})).toHaveClass("sr-only");
   expect(panel.querySelector(".finance-arrangements-heading")).toBeNull();
 });
 it("shows a future agreed date or a neutral review state without the original overdue label",async()=>{
   vi.mocked(getFeeLedger).mockResolvedValue({currency:"INR",invoices:[{...invoice,due_on:"2020-01-01",original_due_on:"2020-01-01",payment_plan_state:"active",
     collection_today:"2026-10-23",collection_due_on:"2026-11-23",collection_due_amount_paise:5000,collection_overdue_paise:0}],payments:[],online_payments_enabled:false,reviews:[]});
   const view=show();await screen.findByText("TERM-1");
   expect(screen.getByText("Agreed date")).toBeVisible();expect(screen.getByText("23 Nov 2026")).toBeVisible();expect(screen.queryByText("Overdue")).not.toBeInTheDocument();
   view.unmount();
   vi.mocked(getFeeLedger).mockResolvedValue({currency:"INR",invoices:[{...invoice,payment_plan_state:"needs_review",collection_due_on:null,collection_due_amount_paise:null,collection_overdue_paise:null}],payments:[],online_payments_enabled:false,reviews:[]});
   show();expect(await screen.findByText("Plan needs review")).toBeVisible();expect(screen.queryByText("Overdue")).not.toBeInTheDocument();
 });
 it("pages and categorises invoices without changing balances, retaining the payment form return",async()=>{
   const invoices=Array.from({length:12},(_,index)=>({...invoice,id:`invoice-${index+1}`,reference:`TERM-${index+1}`,collection_state:index<11?"collectible" as const:"paid" as const,balance_paise:index<11?10000:0,paid_paise:index<11?0:10000}));
   vi.mocked(getFeeLedger).mockResolvedValue({currency:"INR",invoices,payments:[],online_payments_enabled:false,reviews:[]});
   show();
   const pages=within(await screen.findByRole("navigation",{name:"invoices pages"}));
   expect(document.querySelectorAll(".office-invoices > li")).toHaveLength(10);
   await userEvent.click(pages.getByRole("button",{name:"Next",exact:true}));
   expect(document.querySelectorAll(".office-invoices > li")).toHaveLength(2);
   await userEvent.click(screen.getByRole("button",{name:"Record payment"}));
   expect(await screen.findByLabelText("Amount received (₹)")).toBeVisible();
   await userEvent.click(screen.getByRole("link",{name:"Go back"}));
   expect(await screen.findByText("Page 2 of 2 · 12 invoices")).toBeVisible();
   await userEvent.selectOptions(screen.getByRole("combobox",{name:"Invoice status"}),"paid");
   expect(document.querySelectorAll(".office-invoices > li")).toHaveLength(1);
   expect(screen.getByText(/Outstanding ₹1,100.00 · 11 open/)).toBeInTheDocument();
   expect(screen.getByTestId("location")).not.toHaveTextContent("invoices_page");
   expect(recordPayment).not.toHaveBeenCalled();expect(postInvoice).not.toHaveBeenCalled();
 });
 it("pages receipts and searches references only within the existing receipt register",async()=>{
   const payments=Array.from({length:11},(_,index)=>({id:`payment-${index+1}`,invoice_id:invoice.id,amount_paise:100,method:index<10?"bank_transfer":"cash",reference:`RECEIPT-${index+1}`,created_at:"2026-10-20T09:00:00Z"}));
   vi.mocked(getFeeLedger).mockResolvedValue({currency:"INR",invoices:[invoice],payments,online_payments_enabled:false,reviews:[]});
   show("/areas/fees/ledger?view=receipts");
   const pages=within(await screen.findByRole("navigation",{name:"receipts pages"}));
   expect(document.querySelectorAll(".office-receipts > li")).toHaveLength(10);
   await userEvent.click(pages.getByRole("button",{name:"Next",exact:true}));
   expect(screen.getByText("RECEIPT-11")).toBeVisible();
   await userEvent.selectOptions(screen.getByRole("combobox",{name:"Payment method"}),"cash");
   expect(document.querySelectorAll(".office-receipts > li")).toHaveLength(1);
   expect(screen.getByRole("searchbox",{name:"Find a receipt"})).toBeVisible();
   expect(recordPayment).not.toHaveBeenCalled();
 });
 it("prints every issued invoice while restoring the same bounded screen page afterwards",async()=>{
   const invoices=Array.from({length:11},(_,index)=>({...invoice,id:`invoice-${index+1}`,reference:`TERM-${index+1}`}));
   vi.mocked(getFeeLedger).mockResolvedValue({currency:"INR",invoices,payments:[],online_payments_enabled:false,reviews:[]});
   const print=vi.spyOn(window,"print").mockImplementation(()=>{expect(document.querySelectorAll(".office-invoices > li")).toHaveLength(11);});
   show("/areas/fees/ledger?invoices_page=2");
   await screen.findByText("Page 2 of 2 · 11 invoices");
   expect(document.querySelectorAll(".office-invoices > li")).toHaveLength(1);
   await userEvent.click(screen.getByRole("button",{name:"Print statement"}));
   expect(print).toHaveBeenCalledOnce();
   expect(document.querySelectorAll(".office-invoices > li")).toHaveLength(1);
   fireEvent(window,new Event("beforeprint"));
   expect(document.querySelectorAll(".office-invoices > li")).toHaveLength(11);
   fireEvent(window,new Event("afterprint"));
   expect(document.querySelectorAll(".office-invoices > li")).toHaveLength(1);
   print.mockRestore();
 });
 it("pages the bounded provider review list and explicitly labels its search scope",async()=>{
   const gateway_payments=Array.from({length:11},(_,index)=>({...gatewayPayment,id:`order-${index+1}`,provider_payment_id:`provider-${index+1}`}));
   vi.mocked(getFeeLedger).mockResolvedValue({currency:"INR",invoices:[invoice],payments:[],online_payments_enabled:true,reviews:[],gateway_payments});
   show("/areas/fees/ledger?view=review");
   expect(await screen.findByText(/100 most recent provider orders/)).toBeVisible();
   expect(screen.getAllByText("Captured payment needs reconciliation")).toHaveLength(10);
   await userEvent.click(within(screen.getByRole("navigation",{name:"provider payments pages"})).getByRole("button",{name:"Next",exact:true}));
   expect(screen.getAllByText("Captured payment needs reconciliation")).toHaveLength(1);
   expect(screen.getByText(/provider-11/)).toBeVisible();
   expect(getGatewayPaymentReview).not.toHaveBeenCalled();
 });
 it("opens the payment form without the ledger and preserves its verification gate",async()=>{
   const user=userEvent.setup();show();await user.click(await screen.findByRole("button",{name:"Record payment"}));
   expect(await screen.findByLabelText("Amount received (₹)")).toBeVisible();
   expect(screen.queryByRole("navigation",{name:"Ledger records"})).not.toBeInTheDocument();
   expect(screen.getByRole("checkbox",{name:/Funds have been received and verified/})).toBeRequired();
   expect(recordPayment).not.toHaveBeenCalled();
   await user.click(screen.getByRole("link",{name:"Go back"}));
   expect(await screen.findByRole("navigation",{name:"Ledger records"})).toBeVisible();
 });
 it("does not reopen a cancelled payment form with browser Back",async()=>{
   const user=userEvent.setup();show("/areas/fees/ledger?student_id=student-1");
   await user.click(await screen.findByRole("button",{name:"Record payment"}));
   await user.click(screen.getByRole("button",{name:"Cancel"}));
   expect(await screen.findByRole("navigation",{name:"Ledger records"})).toBeVisible();
   expect(screen.getByTestId("location")).toHaveTextContent("student_id=student-1");
   await user.click(screen.getByRole("button",{name:"Browser back"}));
   expect(await screen.findByRole("navigation",{name:"Ledger records"})).toBeVisible();
   expect(screen.queryByLabelText("Amount received (₹)")).not.toBeInTheDocument();
 });
 it("does not reopen a completed payment form with browser Back",async()=>{
   const user=userEvent.setup();show("/areas/fees/ledger?student_id=student-1");
   await user.click(await screen.findByRole("button",{name:"Record payment"}));
   await user.type(screen.getByLabelText("Receipt, bank or cheque reference"),"CASH-100");
   await user.click(screen.getByRole("checkbox",{name:/Funds have been received and verified/}));
   await user.click(screen.getByRole("button",{name:"Confirm receipt"}));
   expect(await screen.findByRole("navigation",{name:"Ledger records"})).toBeVisible();
   await user.click(screen.getByRole("button",{name:"Browser back"}));
   expect(await screen.findByRole("navigation",{name:"Ledger records"})).toBeVisible();
   expect(screen.queryByLabelText("Amount received (₹)")).not.toBeInTheDocument();
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
   show("/areas/fees/ledger?mode=payment&invoice=invoice-1&student_id=student-1");
   expect(await screen.findByLabelText("Amount received (₹)")).toHaveValue(100);
   expect(getFeeLedger).toHaveBeenCalledWith("school-1","student-1",expect.objectContaining({invoice_id:"invoice-1"}));
   expect(recordPayment).not.toHaveBeenCalled();expect(postInvoice).not.toHaveBeenCalled();
 });
 it("opens and focuses the exact fee review from an attention link",async()=>{
   vi.mocked(getFeeLedger).mockResolvedValue({currency:"INR",invoices:[invoice],payments:[],online_payments_enabled:false,reviews:[review]});
   show("/areas/fees/ledger?review=review-1");
   expect(await screen.findByRole("heading",{name:"Fee reviews"})).toBeVisible();
   expect(await screen.findByLabelText("Response to the family")).toBeVisible();
   const target=document.getElementById("attention-review-1");
   expect(target).toHaveClass("attention-focus");
   await waitFor(()=>expect(target).toHaveFocus());
 });
 it("focuses a completed review in history and reports a missing review truthfully",async()=>{
   vi.mocked(getFeeLedger).mockResolvedValue({currency:"INR",invoices:[invoice],payments:[],online_payments_enabled:false,reviews:[{...review,status:"verified",response:"Matched to the bank statement",reviewed_at:"2026-10-03T10:00:00Z"}]});
   const first=show("/areas/fees/ledger?review=review-1");
   await screen.findByText("Matched to the bank statement");
   const target=document.getElementById("fee-review-review-1");
   expect(target).toHaveClass("attention-focus");
   await waitFor(()=>expect(target).toHaveFocus());
   first.unmount();
   show("/areas/fees/ledger?review=missing-review");
   expect(await screen.findByRole("alert")).toHaveTextContent("Fee review unavailable");
 });
 it("opens and focuses an exact captured payment outside the bounded workspace",async()=>{
   vi.mocked(getFeeLedger).mockResolvedValue({currency:"INR",invoices:[invoice],payments:[],online_payments_enabled:true,reviews:[],gateway_payments:[]});
   show("/areas/fees/ledger?view=review&invoice=invoice-1&order=order-1");
   expect(await screen.findByText("Captured payment needs reconciliation")).toBeVisible();
   expect(getGatewayPaymentReview).toHaveBeenCalledWith("school-1","order-1");
   const target=document.getElementById("attention-payment-order-order-1");
   expect(target).toHaveClass("is-attention-target");
   await waitFor(()=>expect(target).toHaveFocus());
 });
 it("does not focus an order when the linked invoice is wrong or missing",async()=>{
   vi.mocked(getFeeLedger).mockResolvedValue({currency:"INR",invoices:[invoice],payments:[],online_payments_enabled:true,reviews:[],gateway_payments:[gatewayPayment]});
   show("/areas/fees/ledger?view=review&invoice=wrong-invoice&order=order-1");
   expect(await screen.findByRole("alert")).toHaveTextContent("does not match the linked invoice");
   expect(document.getElementById("attention-payment-order-order-1")).not.toBeInTheDocument();
 });
 it("fails closed and retries when the exact payment review cannot be verified",async()=>{
   const user=userEvent.setup();
   vi.mocked(getFeeLedger).mockResolvedValue({currency:"INR",invoices:[invoice],payments:[],online_payments_enabled:true,reviews:[],gateway_payments:[gatewayPayment]});
   vi.mocked(getGatewayPaymentReview).mockRejectedValueOnce(new Error("Unavailable")).mockResolvedValueOnce(gatewayPayment);
   show("/areas/fees/ledger?view=review&invoice=invoice-1&order=order-1");
   const alert=await screen.findByRole("alert");
   expect(alert).toHaveTextContent("Payment review unavailable");
   expect(document.getElementById("attention-payment-order-order-1")).not.toBeInTheDocument();
   await user.click(screen.getByRole("button",{name:"Try again"}));
   expect(await screen.findByText("Captured payment needs reconciliation")).toBeVisible();
   expect(getGatewayPaymentReview).toHaveBeenCalledTimes(2);
 });
});
