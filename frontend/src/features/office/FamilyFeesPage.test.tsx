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
vi.mock('../../pages/operations/OperationsShell',()=>({OperationsShell:({title,backTo,children}:{title:string;backTo:string;children:ReactNode})=><><h1>{title}</h1><Link to={backTo}>Go back</Link>{children}</>}));
vi.mock('../school/api',()=>({getAccessibleStudents:vi.fn()}));
vi.mock('./api',async original=>({...await original<typeof import('./api')>(),getFeeLedger:vi.fn(),submitFeeReview:vi.fn()}));
const student:ApiStudent={id:'student-1',user:{id:'user-1',display_name:'Mira Sen'},admission_number:'S001',avatar_url:'',current_enrollment:{class_name:'Class 7A',grade:'7',section:'A',board:'CBSE',room_number:'201',roll_number:1,term:{name:'Term 1',academic_year:'2026-27',starts_on:'2026-04-01',ends_on:'2027-03-31'}}};
const invoice:Invoice={id:'invoice-1',student_id:'student-1',first_name:'Mira',last_name:'Sen',admission_number:'S001',reference:'TERM-1',description:'Term tuition',due_on:'2026-10-20',amount_paise:10000,adjusted_amount_paise:10000,paid_paise:0,balance_paise:10000,refund_due_paise:0,collection_state:'collectible'};
beforeEach(()=>{
  vi.mocked(getAccessibleStudents).mockResolvedValue({results:[student,{...student,id:'student-2',user:{id:'user-2',display_name:'Dev Sen'}}]});
  vi.mocked(getFeeLedger).mockImplementation((_school,id)=>Promise.resolve({currency:'INR',invoices:id==='student-2'?[]:[invoice],payments:[],can_submit:true,online_payments_enabled:false,reviews:[]}));
});
afterEach(()=>{cleanup();vi.clearAllMocks();});
function show(relationship:'dependent'|'self'='dependent',search='',exactStudentId?:string) {render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter initialEntries={[`/areas/fees/account?scope=${relationship}${search ? `&${search.replace(/^\?/, '')}` : ''}`]}><FamilyFeesPage relationship={relationship} {...(exactStudentId?{studentId:exactStudentId}:{})}/></MemoryRouter></QueryClientProvider>);}

describe('family fee navigation',()=>{
  it('shows the exact single dependent identity in the account and invoice without needing a selector',async()=>{
    vi.mocked(getAccessibleStudents).mockResolvedValue({results:[student]});
    const user=userEvent.setup();show('dependent','student_id=student-1','student-1');
    const identity=await screen.findByRole('group',{name:'Fee account identity'});
    expect(within(identity).getByText('Mira Sen')).toBeVisible();expect(within(identity).getByText('S001')).toBeVisible();
    expect(screen.queryByRole('combobox',{name:'Student'})).not.toBeInTheDocument();
    await user.click(screen.getByRole('link',{name:/Term tuition/}));await screen.findByRole('region',{name:'Invoice details'});
    expect(within(screen.getByRole('group',{name:'Fee account identity'})).getByText('Mira Sen')).toBeVisible();
    expect(getFeeLedger).toHaveBeenLastCalledWith('school-1','student-1',expect.objectContaining({invoice_id:'invoice-1'}));expect(submitFeeReview).not.toHaveBeenCalled();
  });
  it('shows the real self-account identity without enabling dependent-only payment claims',async()=>{
    vi.mocked(getAccessibleStudents).mockResolvedValue({results:[student]});show('self','student_id=student-1&invoice=invoice-1','student-1');
    const identity=await screen.findByRole('group',{name:'Fee account identity'});
    expect(within(identity).getByText('Mira Sen')).toBeVisible();expect(within(identity).getByText('S001')).toBeVisible();
    expect(screen.queryByRole('combobox',{name:'Student'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:/Pay|Question this fee/})).not.toBeInTheDocument();expect(submitFeeReview).not.toHaveBeenCalled();
  });
  it('filters overdue by current agreed dates rather than the original invoice date',async()=>{
    const planned={...invoice,due_on:'2020-01-01',original_due_on:'2020-01-01',payment_plan_state:'active' as const,
      collection_today:'2026-10-23',collection_due_on:'2026-11-23',collection_due_amount_paise:5000,collection_overdue_paise:0};
    vi.mocked(getFeeLedger).mockResolvedValue({currency:'INR',invoices:[planned],payments:[],online_payments_enabled:false,reviews:[]});
    show('dependent','student_id=student-1&filter=overdue');
    await screen.findByRole('region',{name:'Fee overview'});
    expect(screen.queryByRole('link',{name:/Term tuition/})).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole('combobox',{name:'Filter invoices'}),'unpaid');
    expect(await screen.findByRole('link',{name:/Term tuition/})).toHaveTextContent('Agreed date 23 Nov 2026');
    expect(screen.getByRole('link',{name:/Term tuition/})).toHaveTextContent('Open');
  });
  it('pages a larger invoice account and restores the same filtered page after opening a statement',async()=>{
    const invoices=Array.from({length:12},(_,index)=>({...invoice,id:`invoice-${index+1}`,description:`Tuition item ${index+1}`,reference:`TERM-${index+1}`}));
    vi.mocked(getFeeLedger).mockResolvedValue({currency:'INR',invoices,payments:[],can_submit:true,online_payments_enabled:false,reviews:[]});
    show('dependent','student_id=student-1&filter=unpaid');
    const pages=within(await screen.findByRole('navigation',{name:'invoices pages'}));
    expect(screen.getAllByRole('link',{name:/Tuition item/})).toHaveLength(10);
    await userEvent.click(pages.getByRole('button',{name:'Next',exact:true}));
    const detail=screen.getByRole('link',{name:/Tuition item 12/});
    expect(detail).toHaveAttribute('href',expect.stringContaining('invoices_page=2'));
    await userEvent.click(detail);
    expect(await screen.findByRole('region',{name:'Invoice details'})).toBeVisible();
    await userEvent.click(screen.getByRole('link',{name:'Go back'}));
    expect(await screen.findByText('Page 2 of 2 · 12 invoices')).toBeVisible();
    expect(screen.getByRole('combobox',{name:'Filter invoices'})).toHaveValue('unpaid');
    expect(screen.getAllByRole('link',{name:/Tuition item/})).toHaveLength(2);
    expect(submitFeeReview).not.toHaveBeenCalled();
  });
  it('opens one invoice without the list and preserves payment confirmation',async()=>{
    const user=userEvent.setup();show();await user.click(await screen.findByRole('link',{name:/Term tuition/}));
    expect(await screen.findByRole('region',{name:'Invoice details'})).toBeVisible();
    expect(screen.queryByRole('navigation',{name:'Fee records'})).not.toBeInTheDocument();
    await user.click(screen.getByRole('button',{name:'Pay / report payment'}));
    expect(screen.getByRole('checkbox',{name:/I have already made this payment/})).toBeRequired();
    expect(submitFeeReview).not.toHaveBeenCalled();
    await user.click(screen.getByRole('link',{name:'Go back'}));
    expect(await screen.findByRole('navigation',{name:'Fee records'})).toBeVisible();
  });
  it('keeps student invoice details read-only even when response says can_submit',async()=>{
    show('self','?student_id=student-1&invoice=invoice-1');
    expect(await screen.findByRole('region',{name:'Invoice details'})).toBeVisible();
    expect(screen.getByText('Original charge')).toBeVisible();
    expect(screen.queryByRole('button',{name:/Pay|Question this fee/})).not.toBeInTheDocument();
    expect(submitFeeReview).not.toHaveBeenCalled();
  });
  it('separates receipts and reviews from invoices',async()=>{
    const user=userEvent.setup();show();await user.click(await screen.findByRole('link',{name:'Receipts'}));
    expect(screen.getByText('No receipts recorded.')).toBeVisible();
    expect(screen.queryByRole('link',{name:/Term tuition/})).not.toBeInTheDocument();
    await user.click(screen.getByRole('link',{name:'Reviews'}));
    expect(screen.getByText('No fee reviews submitted.')).toBeVisible();
  });
  it('never substitutes another invoice for an invalid direct link',async()=>{
    show('dependent','?student_id=student-1&invoice=wrong-id');
    expect(await screen.findByRole('alert')).toHaveTextContent('unavailable');
    expect(screen.queryByRole('button',{name:'Pay / report payment'})).not.toBeInTheDocument();
  });
  it('clears invoice selection when the parent switches children',async()=>{
    const user=userEvent.setup();show('dependent','?student_id=student-1&invoice=invoice-1');
    await screen.findByRole('region',{name:'Invoice details'});
    expect(within(screen.getByRole('group',{name:'Fee account identity'})).getByText('Mira Sen')).toBeVisible();
    await user.selectOptions(screen.getByRole('combobox',{name:'Student'}),'student-2');
    expect(await screen.findByText(/No invoices have been issued/)).toBeVisible();
    const identity=screen.getByRole('group',{name:'Fee account identity'});
    expect(within(identity).getByText('Dev Sen')).toBeVisible();expect(within(identity).queryByText('Mira Sen')).not.toBeInTheDocument();
    expect(screen.queryByRole('region',{name:'Invoice details'})).not.toBeInTheDocument();
    expect(getFeeLedger).toHaveBeenLastCalledWith('school-1','student-2',expect.any(Object));
  });
  it('never substitutes another learner when an exact workspace relationship disappears',async()=>{
    vi.mocked(getAccessibleStudents).mockResolvedValue({results:[student]});
    render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter initialEntries={['/areas/fees/account?scope=dependent&student_id=student-2']}><FamilyFeesPage relationship="dependent" studentId="student-2"/></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByRole('alert')).toHaveTextContent('no longer available');
    expect(screen.getByRole('link',{name:'Return to fees'})).toHaveAttribute('href','/areas/fees');
    expect(screen.queryByRole('group',{name:'Fee account identity'})).not.toBeInTheDocument();
    expect(getFeeLedger).not.toHaveBeenCalled();
  });
});


describe('fee printing and receipts', () => {
  it('opens a verified receipt and prints only its record, with sandbox labeling', async () => {
    const user = userEvent.setup(); const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    vi.mocked(getFeeLedger).mockResolvedValue({currency:'INR',invoices:[invoice],can_submit:true,online_payments_enabled:true,payments:[
      {id:'payment-1',invoice_id:invoice.id,amount_paise:5000,method:'razorpay_test',reference:'pay_test_1',created_at:'2026-10-09T10:00:00Z'},
      {id:'payment-2',invoice_id:invoice.id,amount_paise:2000,method:'cash',reference:'cash_2',created_at:'2026-10-08T10:00:00Z'},
    ]});
    show('dependent','?student_id=student-1&view=receipts');
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
    show('dependent','?student_id=student-1&invoice=invoice-1');
    await user.click(await screen.findByRole('button',{name:'Print invoice'}));
    expect(print).toHaveBeenCalledOnce();
    const document = window.document.querySelector('.family-fee-print-document')!;
    expect(document).toHaveTextContent('Term tuition'); expect(document).toHaveTextContent('Total outstanding: ₹100.00');
    expect(document.querySelector('button')).toBeNull(); print.mockRestore();
  });
  it('does not print or expose an unavailable receipt', async () => {
    show('dependent','?student_id=student-1&view=receipts&receipt=another-child-payment');
    expect(await screen.findByRole('alert')).toHaveTextContent('receipt is unavailable');
    expect(screen.queryByRole('button',{name:'Print receipt'})).not.toBeInTheDocument();
    expect(document.querySelector('.family-fee-print-document')).toBeNull();
  });
});


describe('reference finance overview',()=>{
  it('keeps a long invoice identity discoverable without changing its payment state', async () => {
    const description = 'Term tuition, laboratory resources and optional afternoon learning programme';
    const reference = 'CAMPUS-2026-TERM-01-LEARNER-ACCOUNT-004287';
    vi.mocked(getFeeLedger).mockResolvedValue({currency:'INR',invoices:[{...invoice,description,reference}],payments:[],can_submit:true,online_payments_enabled:false,reviews:[]});
    const user = userEvent.setup(); show();
    const row = await screen.findByRole('link',{name:new RegExp(description)});
    expect(within(row).getByText(reference)).toBeInTheDocument();
    expect(within(row).getByText('₹100.00')).toBeVisible();
    await user.click(row);
    expect(await screen.findByRole('region',{name:'Invoice details'})).toHaveTextContent(reference);
    expect(submitFeeReview).not.toHaveBeenCalled();
  });
  it('filters unpaid invoices from Pay balance even after a different filter',async()=>{
    const user=userEvent.setup();show('dependent','?filter=settled');
    await user.click(await screen.findByRole('link',{name:/Pay balance/}));
    expect(await screen.findByRole('link',{name:/Term tuition/})).toBeVisible();
    expect(screen.getByRole('combobox',{name:'Filter invoices'})).toHaveValue('unpaid');
    await user.selectOptions(screen.getByRole('combobox',{name:'Filter invoices'}),'settled');
    expect(screen.getByText('No invoices match this filter.')).toBeVisible();
  });
  it('opens the fee enquiry form for a selected invoice',async()=>{
    const user=userEvent.setup();show();
    await user.click(await screen.findByRole('link',{name:'Enquire'}));
    await user.click(screen.getByRole('link',{name:/Term tuition/}));
    expect(await screen.findByRole('textbox',{name:'Your question'})).toBeVisible();
    expect(submitFeeReview).not.toHaveBeenCalled();
  });
  it('refreshes the statement without submitting a payment',async()=>{
    const user=userEvent.setup();show('dependent','?invoice=invoice-1');
    await user.click(await screen.findByRole('button',{name:'Sync'}));
    expect(await screen.findByRole('status')).toHaveTextContent('Statement is up to date');
    expect(getFeeLedger).toHaveBeenCalledTimes(2); expect(submitFeeReview).not.toHaveBeenCalled();
  });
});
