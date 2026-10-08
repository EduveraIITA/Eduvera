import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Link, MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FeeLedgerPage from "./FeeLedgerPage";
import { getFeeLedger, getFeeStudents, postInvoice, recordPayment, type Invoice } from "./api";
vi.mock("../auth/AuthContext",()=>({useAuth:()=>({memberships:[{role:"admin",school_id:"school-1"}],hasPortal:(role:string)=>role==="principal"})}));
vi.mock("../../pages/operations/OperationsShell",()=>({OperationsShell:({title,backTo,children}:{title:string;backTo:string;children:ReactNode})=><><h1>{title}</h1><Link to={backTo}>Go back</Link>{children}</>}));
vi.mock("./api",async original=>({...await original<typeof import("./api")>(),getFeeLedger:vi.fn(),getFeeStudents:vi.fn(),recordPayment:vi.fn(),postInvoice:vi.fn()}));
const invoice:Invoice={id:"invoice-1",student_id:"student-1",first_name:"Mira",last_name:"Sen",admission_number:"S001",reference:"TERM-1",description:"Term tuition",due_on:"2026-10-20",amount_paise:10000,adjusted_amount_paise:10000,paid_paise:0,balance_paise:10000,refund_due_paise:0,collection_state:"collectible"};
beforeEach(()=>{vi.mocked(getFeeLedger).mockResolvedValue({currency:"INR",invoices:[invoice],payments:[],online_payments_enabled:false,reviews:[]});vi.mocked(getFeeStudents).mockResolvedValue({results:[invoice]});});
afterEach(()=>{cleanup();vi.clearAllMocks();});
function show(path="/principal/fees"){render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter initialEntries={[path]}><FeeLedgerPage/></MemoryRouter></QueryClientProvider>);}
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
});
