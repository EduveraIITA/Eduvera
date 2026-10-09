import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Link, MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FamilyFeesPage } from './FamilyFeesPage';
import { getFeeLedger, submitFeeReview, type Invoice } from './api';
import { getAccessibleStudents, type ApiStudent } from '../school/api';

vi.mock('../auth/AuthContext',()=>({useAuth:()=>({memberships:[{role:'guardian',school_id:'school-1'},{role:'student',school_id:'school-1'}]})}));
vi.mock('../../pages/parent/ParentShell',()=>({ParentShell:({pageLabel,backTo,children,onSelectChild}:{pageLabel:string;backTo:string;children:ReactNode;onSelectChild:(id:string)=>void})=><><h1>{pageLabel}</h1><Link to={backTo}>Go back</Link><button onClick={()=>onSelectChild('student-2')}>Switch child</button>{children}</>}));
vi.mock('../../pages/student/StudentShell',()=>({StudentShell:({pageTitle,backTo,children}:{pageTitle:string;backTo:string;children:ReactNode})=><><h1>{pageTitle}</h1><Link to={backTo}>Go back</Link>{children}</>}));
vi.mock('../school/api',()=>({getAccessibleStudents:vi.fn()}));
vi.mock('./api',async original=>({...await original<typeof import('./api')>(),getFeeLedger:vi.fn(),submitFeeReview:vi.fn()}));
const student:ApiStudent={id:'student-1',user:{id:'user-1',display_name:'Mira Sen'},admission_number:'S001',avatar_url:'',current_enrollment:{class_name:'Class 7A',grade:'7',section:'A',board:'CBSE',room_number:'201',roll_number:1,term:{name:'Term 1',academic_year:'2026-27',starts_on:'2026-04-01',ends_on:'2027-03-31'}}};
const invoice:Invoice={id:'invoice-1',student_id:'student-1',first_name:'Mira',last_name:'Sen',admission_number:'S001',reference:'TERM-1',description:'Term tuition',due_on:'2026-10-20',amount_paise:10000,adjusted_amount_paise:10000,paid_paise:0,balance_paise:10000,refund_due_paise:0,collection_state:'collectible'};
beforeEach(()=>{
  vi.mocked(getAccessibleStudents).mockResolvedValue({results:[student,{...student,id:'student-2',user:{id:'user-2',display_name:'Dev Sen'}}]});
  vi.mocked(getFeeLedger).mockImplementation((_school,id)=>Promise.resolve({currency:'INR',invoices:id==='student-2'?[]:[invoice],payments:[],can_submit:true,online_payments_enabled:false,reviews:[]}));
});
afterEach(()=>{cleanup();vi.clearAllMocks();});
function show(portal:'parent'|'student'='parent',search='') {render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter initialEntries={[`/${portal}/fees${search}`]}><FamilyFeesPage portal={portal}/></MemoryRouter></QueryClientProvider>);}

describe('family fee navigation',()=>{
  it('opens one invoice without the list and preserves payment confirmation',async()=>{
    const user=userEvent.setup();show();await user.click(await screen.findByRole('link',{name:/TERM-1/}));
    expect(await screen.findByRole('region',{name:'Invoice details'})).toBeVisible();
    expect(screen.queryByRole('navigation',{name:'Fee records'})).not.toBeInTheDocument();
    await user.click(screen.getByRole('button',{name:'Pay / report payment'}));
    expect(screen.getByRole('checkbox',{name:/I have already made this payment/})).toBeRequired();
    expect(submitFeeReview).not.toHaveBeenCalled();
    await user.click(screen.getByRole('link',{name:'Go back'}));
    expect(await screen.findByRole('navigation',{name:'Fee records'})).toBeVisible();
  });
  it('keeps student invoice details read-only even when response says can_submit',async()=>{
    show('student','?student_id=student-1&invoice=invoice-1');
    expect(await screen.findByRole('region',{name:'Invoice details'})).toBeVisible();
    expect(screen.getByText('Original charge')).toBeVisible();
    expect(screen.queryByRole('button',{name:/Pay|Question this fee/})).not.toBeInTheDocument();
    expect(submitFeeReview).not.toHaveBeenCalled();
  });
  it('separates receipts and reviews from invoices',async()=>{
    const user=userEvent.setup();show();await user.click(await screen.findByRole('link',{name:'Receipts'}));
    expect(screen.getByText('No receipts recorded.')).toBeVisible();
    expect(screen.queryByRole('link',{name:/TERM-1/})).not.toBeInTheDocument();
    await user.click(screen.getByRole('link',{name:'Reviews'}));
    expect(screen.getByText('No fee reviews submitted.')).toBeVisible();
  });
  it('never substitutes another invoice for an invalid direct link',async()=>{
    show('parent','?student_id=student-1&invoice=wrong-id');
    expect(await screen.findByRole('alert')).toHaveTextContent('unavailable');
    expect(screen.queryByRole('button',{name:'Pay / report payment'})).not.toBeInTheDocument();
  });
  it('clears invoice selection when the parent switches children',async()=>{
    const user=userEvent.setup();show('parent','?student_id=student-1&invoice=invoice-1');
    await screen.findByRole('region',{name:'Invoice details'});await user.click(screen.getByRole('button',{name:'Switch child'}));
    expect(await screen.findByText(/No invoices have been issued/)).toBeVisible();
    expect(screen.queryByRole('region',{name:'Invoice details'})).not.toBeInTheDocument();
    expect(getFeeLedger).toHaveBeenLastCalledWith('school-1','student-2');
  });
});


describe('fee printing and receipts', () => {
  it('opens a verified receipt and prints only its record, with sandbox labeling', async () => {
    const user = userEvent.setup(); const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    vi.mocked(getFeeLedger).mockResolvedValue({currency:'INR',invoices:[invoice],can_submit:true,online_payments_enabled:true,payments:[
      {id:'payment-1',invoice_id:invoice.id,amount_paise:5000,method:'razorpay_test',reference:'pay_test_1',created_at:'2026-10-09T10:00:00Z'},
      {id:'payment-2',invoice_id:invoice.id,amount_paise:2000,method:'cash',reference:'cash_2',created_at:'2026-10-08T10:00:00Z'},
    ]});
    show('parent','?student_id=student-1&view=receipts');
    await user.click(await screen.findByRole('link',{name:/pay_test_1/}));
    const detail = await screen.findByRole('region',{name:'Receipt details'});
    expect(within(detail).getByText('Test payment receipt')).toBeVisible();
    await user.click(within(detail).getByRole('button',{name:'Print receipt'}));
    expect(print).toHaveBeenCalledOnce();
    const document = window.document.querySelector('.family-fee-print-document')!;
    expect(document).toHaveTextContent('Mira Sen'); expect(document).toHaveTextContent('pay_test_1');
    expect(document).toHaveTextContent('TEST RECEIPT'); expect(document).not.toHaveTextContent('cash_2');
    await user.click(screen.getByRole('link',{name:'Go back'}));
    expect(await screen.findByRole('navigation',{name:'Fee records'})).toBeVisible();
    print.mockRestore();
  });
  it('prints invoice balances without payment controls', async () => {
    const user = userEvent.setup(); const print = vi.spyOn(window,'print').mockImplementation(()=>{});
    show('parent','?student_id=student-1&invoice=invoice-1');
    await user.click(await screen.findByRole('button',{name:'Print invoice'}));
    expect(print).toHaveBeenCalledOnce();
    const document = window.document.querySelector('.family-fee-print-document')!;
    expect(document).toHaveTextContent('Term tuition'); expect(document).toHaveTextContent('Total outstanding: ₹100.00');
    expect(document.querySelector('button')).toBeNull(); print.mockRestore();
  });
  it('does not print or expose an unavailable receipt', async () => {
    show('parent','?student_id=student-1&view=receipts&receipt=another-child-payment');
    expect(await screen.findByRole('alert')).toHaveTextContent('receipt is unavailable');
    expect(screen.queryByRole('button',{name:'Print receipt'})).not.toBeInTheDocument();
    expect(document.querySelector('.family-fee-print-document')).toBeNull();
  });
});
