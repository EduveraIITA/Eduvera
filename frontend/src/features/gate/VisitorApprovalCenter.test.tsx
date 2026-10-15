import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VisitorApprovalCenter } from './VisitorApprovalCenter';
const state=vi.hoisted(()=>({auth:{status:'authenticated',publicDemo:false,user:{id:'host',email_verified:true,active_school_id:'school'},memberships:[{role:'staff',school_id:'school',permissions:[] as string[]}]},get:vi.fn(),command:vi.fn()}));
vi.mock('../auth/AuthContext',()=>({useOptionalAuth:()=>state.auth}));
vi.mock('./api',()=>({getVisitorApprovals:state.get,gateCommand:state.command}));
const visitor={id:'request',school_id:'school',school_name:'Cambridge School',name:'Visitor Test',phone:'9876543210',purpose:'Document delivery',state:'pending',revision:1};
function mount(){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});return render(<MemoryRouter><QueryClientProvider client={client}><VisitorApprovalCenter/></QueryClientProvider></MemoryRouter>);}
beforeEach(()=>{vi.clearAllMocks();state.auth.status='authenticated';state.auth.publicDemo=false;state.auth.user.email_verified=true;state.get.mockResolvedValue([visitor]);state.command.mockResolvedValue({saved:true});});
afterEach(cleanup);
describe('visitor approval popup on login',()=>{
 it('opens a persisted pending request for a signed-in host even without gate permission',async()=>{
  mount();expect(await screen.findByRole('dialog')).toHaveTextContent('Visitor Test');expect(screen.getByRole('button',{name:'Approve'})).toBeEnabled();expect(state.get).toHaveBeenCalledWith(expect.any(AbortSignal));
 });
 it.each([['Approve','approve'],['Decline','deny']])('records %s with the displayed revision and removes the popup',async(label,action)=>{
  state.get.mockResolvedValueOnce([visitor]).mockResolvedValue([]);mount();fireEvent.click(await screen.findByRole('button',{name:label}));
  await waitFor(()=>expect(state.command).toHaveBeenCalledWith('school',`visitors/request/${action}`,{expected_revision:1}));
  await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
 });
 it('review later dismisses only the popup, without declining the request',async()=>{
  mount();fireEvent.click((await screen.findAllByRole('button',{name:'Review later'})).at(-1)!);expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(state.command).not.toHaveBeenCalled();
 });
 it('keeps an uncertain decision retryable inside the popup',async()=>{
  state.command.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({saved:true});mount();fireEvent.click(await screen.findByRole('button',{name:'Approve'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not confirm your decision');fireEvent.click(screen.getByRole('button',{name:'Retry request'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Approve'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'Approve'}));
  await waitFor(()=>expect(state.command).toHaveBeenCalledTimes(2));expect(state.command.mock.calls[1]).toEqual(state.command.mock.calls[0]);
 });
 it('does not query on public-demo or unverified sessions',()=>{
  state.auth.publicDemo=true;mount();expect(state.get).not.toHaveBeenCalled();cleanup();state.auth.publicDemo=false;state.auth.user.email_verified=false;mount();expect(state.get).not.toHaveBeenCalled();
 });
});
