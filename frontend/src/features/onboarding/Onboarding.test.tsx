import { cleanup,render,screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import CompanyPage from './CompanyPage';
import InvitationsPage from './InvitationsPage';
import JoinPage from './JoinPage';
import { createInstitution,getCompany,getInvitations,inviteMember } from './api';
import { apiFetch } from '../../lib/api';
import { authDestination } from '../auth/AuthContext';
const auth=vi.hoisted(()=>({status:'authenticated',companyOperator:true,memberships:[{school_id:'school',role:'admin',school_name:'School',permissions:['members.invite']}],user:{display_name:'Eduera Company'},hasPortal:vi.fn(()=>true),logout:vi.fn()}));
vi.mock('../auth/AuthContext',async original=>({...await original(),useAuth:()=>auth}));
vi.mock('../../pages/operations/OperationsShell',()=>({OperationsShell:({children}:{children:React.ReactNode})=><main>{children}</main>}));
vi.mock('./api',async original=>({...await original(),getCompany:vi.fn(),createInstitution:vi.fn(),getInvitations:vi.fn(),inviteMember:vi.fn()}));
vi.mock('../../lib/api',async original=>({...await original(),apiFetch:vi.fn()}));
function mount(element:React.ReactNode){render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter>{element}</MemoryRouter></QueryClientProvider>);}
afterEach(cleanup);
beforeEach(()=>{
  vi.clearAllMocks();auth.hasPortal.mockReturnValue(true);
  vi.mocked(getCompany).mockResolvedValue({schools:[],invitations:[]});
  vi.mocked(createInstitution).mockResolvedValue({school:{id:'new',name:'Lotus',code:'lotus',institution_kind:'college',admin_count:0,pending_admins:1},invitation:{token:'x'.repeat(43),email:'admin@example.test',expires_at:'2099-10-04'}});
  vi.mocked(getInvitations).mockResolvedValue({can_invite_admin:false,invitations:[],students:[{id:'student',name:'Learner',admission_number:'A001',email:null}],guardians:[],roles:[]});
  vi.mocked(inviteMember).mockResolvedValue({token:'x'.repeat(43),email:'learner@example.test',expires_at:'2099-10-04'});
});
describe('company and school onboarding',()=>{
  it('creates a college with first admin and explains manual invitation delivery',async()=>{
    const user=userEvent.setup();mount(<CompanyPage/>);await user.click(screen.getByRole('button',{name:'Create institution'}));
    await user.type(screen.getByLabelText('Institution name'),'Lotus College');await user.selectOptions(screen.getByLabelText('Institution type'),'college');await user.type(screen.getByLabelText('First administrator email'),'admin@example.test');await user.click(screen.getByRole('button',{name:'Create & invite admin'}));
    expect(createInstitution).toHaveBeenCalledWith({name:'Lotus College',code:'lotus-college',institution_kind:'college',timezone:'Asia/Kolkata',admin_email:'admin@example.test'});
    expect(await screen.findByRole('heading',{name:'Invitation ready'})).toBeInTheDocument();expect(screen.getByText(/No email has been sent/)).toBeInTheDocument();
  });
  it('normalizes a manually edited institution code instead of silently blocking submission',async()=>{
    const user=userEvent.setup();mount(<CompanyPage/>);await user.click(screen.getByRole('button',{name:'Create institution'}));
    await user.type(screen.getByLabelText('Institution name'),'Delhi Public School');const code=screen.getByLabelText('Unique code');expect(code).toHaveValue('delhi-public-school');
    await user.clear(code);await user.type(code,'DPS South Campus');await user.tab();expect(code).toHaveValue('dps-south-campus');
    await user.type(screen.getByLabelText('First administrator email'),'principal@example.test');await user.click(screen.getByRole('button',{name:'Create & invite admin'}));
    expect(createInstitution).toHaveBeenCalledWith({name:'Delhi Public School',code:'dps-south-campus',institution_kind:'school',timezone:'Asia/Kolkata',admin_email:'principal@example.test'});
  });
  it('keeps entered institution details on a server error',async()=>{
    vi.mocked(createInstitution).mockRejectedValue(new Error('Institution code is already in use.'));const user=userEvent.setup();mount(<CompanyPage/>);await user.click(screen.getByRole('button',{name:'Create institution'}));
    await user.type(screen.getByLabelText('Institution name'),'Lotus');await user.type(screen.getByLabelText('Unique code'),'lotus');await user.type(screen.getByLabelText('First administrator email'),'admin@example.test');await user.click(screen.getByRole('button',{name:'Create & invite admin'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('already in use');expect(screen.getByLabelText('Institution name')).toHaveValue('Lotus');
  });
  it('hides administrator and role assignment from a delegated inviter and links a student',async()=>{
    auth.hasPortal.mockReturnValue(false);const user=userEvent.setup();mount(<InvitationsPage/>);await screen.findByRole('heading',{name:'Create invitation'});
    expect(screen.queryByRole('option',{name:'Administrator'})).not.toBeInTheDocument();expect(screen.queryByLabelText('Role on joining')).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Account role'),'student');await user.selectOptions(screen.getByLabelText('Student record'),'student');await user.type(screen.getByLabelText('Recipient email'),'learner@example.test');await user.click(screen.getByRole('button',{name:'Create invitation'}));
    expect(inviteMember).toHaveBeenCalledWith('school',{email:'learner@example.test',role:'student',student_id:'student'});expect(await screen.findByRole('heading',{name:'Invitation ready'})).toBeInTheDocument();
  });
  it('accepts a code with CSRF and shows account activation success',async()=>{
    vi.mocked(apiFetch).mockResolvedValue({school_id:'new',role:'admin'});const user=userEvent.setup();mount(<JoinPage/>);
    await user.type(screen.getByLabelText('Invitation code'),'x'.repeat(43));await user.type(screen.getByLabelText('Email'),'admin@example.test');await user.type(screen.getByLabelText('First name'),'First');await user.type(screen.getByLabelText('Last name'),'Admin');await user.type(screen.getByLabelText('Password'),'Testing!RiverPebbles2026');await user.click(screen.getByRole('button',{name:'Accept invitation'}));
    expect(await screen.findByRole('status')).toHaveTextContent('membership is active');expect(apiFetch).toHaveBeenCalledWith('/api/v1/auth/csrf/');expect(apiFetch).toHaveBeenCalledWith('/api/v1/invitations/accept/',expect.objectContaining({method:'POST'}));
  });
  it('routes company operators and new school admins to the correct workspace',()=>{
    expect(authDestination({status:'authenticated',companyOperator:true,portals:[],memberships:[]})).toBe('/company');
    expect(authDestination({status:'authenticated',setupRequired:true,portals:['principal'],memberships:[]})).toBe('/principal/administration');
    expect(authDestination({status:'authenticated',portals:['principal'],memberships:[]})).toBe('/principal');
  });
});
