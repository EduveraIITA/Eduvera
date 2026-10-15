import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GateAdminPage from './GateAdminPage';

const state=vi.hoisted(()=>({auth:{memberships:[{school_id:'school',school_name:'Test school',role:'admin'}]},command:vi.fn(),workspace:vi.fn(),find:vi.fn()}));
vi.mock('../auth/AuthContext',()=>({useAuth:()=>state.auth,authDestination:()=>'/teacher'}));
vi.mock('./api',()=>({gateCommand:state.command,getGateWorkspace:state.workspace,findGateStudents:state.find}));
vi.mock('qrcode',()=>({default:{toDataURL:vi.fn().mockResolvedValue('data:image/png;base64,cXI=')}}));
function mount(){render(<MemoryRouter><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><GateAdminPage/></QueryClientProvider></MemoryRouter>);}

describe('gate administration uses central roles and permissions',()=>{
 afterEach(cleanup);
 beforeEach(()=>{vi.clearAllMocks();state.auth.memberships[0].role='admin';state.workspace.mockResolvedValue({visitors:[],hosts:[],pending:0});state.find.mockResolvedValue([]);});

 it('links to roles and existing staff instead of creating another account',async()=>{
  mount();
  expect(screen.getByRole('link',{name:'Roles & permissions'})).toHaveAttribute('href','/principal/staff?section=roles');
  expect(screen.getByRole('link',{name:'staff member’s profile'})).toHaveAttribute('href','/principal/staff?section=directory');
  expect(screen.queryByRole('button',{name:'Add gatekeeper'})).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Username')).not.toBeInTheDocument();
  expect(screen.queryByText(/Temporary password/)).not.toBeInTheDocument();
  await waitFor(()=>expect(state.workspace).toHaveBeenCalledWith('school'));
  expect(state.command).not.toHaveBeenCalled();
 });

 it('keeps the role and people links keyboard accessible',async()=>{
  mount();const user=userEvent.setup();
  await user.tab();expect(screen.getByRole('link',{name:'Back'})).toHaveFocus();
  await user.tab();expect(screen.getByRole('link',{name:'Open gatekeeper screen'})).toHaveFocus();
  await user.tab();expect(screen.getByRole('link',{name:'Roles & permissions'})).toHaveFocus();
  await user.tab();expect(screen.getByRole('link',{name:'staff member’s profile'})).toHaveFocus();
 });

 it('preserves student search and QR generation',async()=>{
  state.find.mockResolvedValue([{id:'student',name:'Aarav',class_label:'7 A',admission_number:'100',plan_state:'ready'}]);
  state.command.mockResolvedValue({qr:'private-pass',kind:'student',name:'Aarav',expires_at:'2030-10-15T12:00:00Z'});
  mount();fireEvent.change(screen.getByLabelText('Find student'),{target:{value:'Aarav'}});fireEvent.click(screen.getByRole('button',{name:'Search'}));
  fireEvent.click(await screen.findByRole('button',{name:'Student QR'}));
  expect(await screen.findByRole('img',{name:'student QR pass'})).toBeInTheDocument();
  expect(state.find).toHaveBeenCalledWith('school','Aarav');
  expect(state.command).toHaveBeenCalledWith('school','passes',{student_id:'student',kind:'student'});
 });

 it('preserves visitor approvals',async()=>{
  state.workspace.mockResolvedValue({visitors:[{id:'visitor',name:'Visitor',purpose:'Meeting',state:'pending'}],hosts:[],pending:1});
  state.command.mockResolvedValue({});mount();fireEvent.click(await screen.findByRole('button',{name:'Approve'}));
  await waitFor(()=>expect(state.command).toHaveBeenCalledWith('school','visitors/visitor/approve'));
 });

 it('does not expose administration to ordinary staff',()=>{
  state.auth.memberships[0].role='staff';mount();
  expect(screen.queryByRole('link',{name:'Roles & permissions'})).not.toBeInTheDocument();
  expect(state.workspace).not.toHaveBeenCalled();
 });
});
