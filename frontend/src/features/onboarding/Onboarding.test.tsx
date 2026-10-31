import { cleanup,render,screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation, useNavigationType } from 'react-router-dom';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import CompanyPage from './CompanyPage';
import InvitationsPage from './InvitationsPage';
import JoinPage from './JoinPage';
import { InvitationReceipt } from './InvitationReceipt';
import { createInstitution,getCompany,getInvitations,inviteMember,resendMemberInvitation,revokeMember } from './api';
import { apiFetch } from '../../lib/api';
import { authDestination } from '../auth/AuthContext';
import { ExecutionEnvironmentProvider } from '../simulation/ExecutionEnvironmentContext';
import type { ExecutionEnvironment } from '../simulation/executionEnvironment';
const auth=vi.hoisted(()=>({status:'authenticated',companyOperator:true,memberships:[{school_id:'school',role:'admin',school_name:'School',permissions:['members.invite']}],user:{display_name:'ThatCampus Company'},logout:vi.fn(),refresh:vi.fn()}));
vi.mock('../auth/AuthContext',async original=>({...await original(),useAuth:()=>auth}));
vi.mock('../../pages/operations/OperationsShell',()=>({OperationsShell:({children}:{children:React.ReactNode})=><main>{children}</main>}));
vi.mock('./api',async original=>({...await original(),getCompany:vi.fn(),createInstitution:vi.fn(),getInvitations:vi.fn(),inviteMember:vi.fn(),resendMemberInvitation:vi.fn(),revokeMember:vi.fn()}));
vi.mock('../../lib/api',async original=>({...await original(),apiFetch:vi.fn()}));
function mount(element:React.ReactNode,path='/',environment:ExecutionEnvironment={mode:'live'}){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});render(<QueryClientProvider client={client}><ExecutionEnvironmentProvider environment={environment}><MemoryRouter initialEntries={[path]}>{element}</MemoryRouter></ExecutionEnvironmentProvider></QueryClientProvider>);return client;}
function NavigationProbe(){const location=useLocation();const navigationType=useNavigationType();return <><output data-testid="navigation-location">{location.pathname+location.search}</output><output data-testid="navigation-type">{navigationType}</output></>;}
afterEach(cleanup);
beforeEach(()=>{
  vi.clearAllMocks();auth.companyOperator=true;
  vi.mocked(apiFetch).mockResolvedValue({enquiries:[]});
  vi.mocked(getCompany).mockResolvedValue({schools:[],invitations:[],applications:[]});
  vi.mocked(createInstitution).mockResolvedValue({school:{id:'new',name:'Lotus',code:'lotus',institution_kind:'college',admin_count:0,pending_admins:1},invitation:{token:'012345',email:'admin@example.test',expires_at:'2099-10-04'}});
  vi.mocked(getInvitations).mockResolvedValue({can_invite_admin:false,invitations:[],students:[{id:'student',name:'Learner',admission_number:'A001',email:null}],guardians:[],staff:[{id:'staff-person',name:'Campus worker',email:'worker@example.test',staff_code:'W01'}],roles:[]});
  vi.mocked(inviteMember).mockResolvedValue({token:'012345',email:'learner@example.test',expires_at:'2099-10-04',delivery:'email_accepted'});
});
describe('company and school onboarding',()=>{
  it('loads invitations under the Live-qualified cache key',async()=>{
    const client=mount(<InvitationsPage/>,'/more/setup/people/invitations');
    expect(await screen.findByText('No invitations yet.')).toBeVisible();
    expect(getInvitations).toHaveBeenCalledWith('school');
    expect(client.getQueryData(['execution-environment','live','invitations','school'])).toEqual(expect.objectContaining({invitations:[]}));
    expect(client.getQueryData(['invitations','school'])).toBeUndefined();
    expect(screen.getByRole('button',{name:'Invite member'})).toBeVisible();
  });
  it.each([
    {mode:'simulation',namespaceId:'campus-world',runId:'running-world',runStatus:'running',virtualClock:{now:'2026-10-20T12:00:00Z',timeZone:'Asia/Kolkata'}},
    {mode:'simulation',namespaceId:'campus-world',runId:'stopped-world',runStatus:'stopped',virtualClock:{now:'2026-10-20T12:00:00Z',timeZone:'Asia/Kolkata'}},
    {mode:'simulation',namespaceId:'campus-world',runId:'unavailable-world',unavailable:true,unavailableReason:'authorization_lost'},
  ] satisfies ExecutionEnvironment[])('keeps account invitations out of $runId',environment=>{
    mount(<InvitationsPage/>,'/more/setup/people/invitations?create=invitation',environment);
    expect(screen.getByRole('heading',{name:'App access is managed in Live'})).toBeVisible();
    expect(screen.getByText(/Invitations and real account changes are unavailable/)).toBeVisible();
    expect(screen.queryByLabelText('Recipient email')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Account type')).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:/invite|send|resend|revoke/i})).not.toBeInTheDocument();
    expect(getInvitations).not.toHaveBeenCalled();
    expect(inviteMember).not.toHaveBeenCalled();
    expect(resendMemberInvitation).not.toHaveBeenCalled();
    expect(revokeMember).not.toHaveBeenCalled();
  });
  it('confirms app-only membership without telling the recipient to become a campus administrator',async()=>{
    vi.mocked(apiFetch).mockImplementation(path=>Promise.resolve(path.endsWith('recipient-proof/')?{campus:{id:'campus',name:'Campus'},verification_required:false,delivery:'not_required'}:{school_id:'campus',role:'member',accepted_user_id:'recipient'}));
    const user=userEvent.setup();mount(<><JoinPage/><NavigationProbe/></>,'/join');
    await user.type(screen.getByLabelText('Invitation code'),'012345');
    await user.type(screen.getByLabelText('Email'),'aarav@example.test');
    await user.click(screen.getByRole('button',{name:'Continue'}));
    await user.type(await screen.findByLabelText('Name'),'Aarav Sharma');
    await user.type(screen.getByLabelText('Password'),'Testing!RiverPebbles2026');
    await user.click(screen.getByRole('button',{name:'Accept invitation'}));
    expect(await screen.findByText('Your account is linked to your campus person. Campus work is available only when assigned.')).toBeVisible();
    expect(screen.queryByText(/start setting up your workspace/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button',{name:'Sign in with invited account'}));
    expect(screen.getByTestId('navigation-location')).toHaveTextContent('/login?next=%2Fjoin%3Fcampus%3Dcampus');
  });
  it('does not confuse a previous send with the newly queued resend, and polls for acceptance',async()=>{
    const old={id:'invite',email:'learner@example.test',role:'staff',expires_at:'2099-10-04',accepted_at:null,revoked_at:null,delivery:'email_accepted' as const,delivery_job_id:'previous-job'};
    const workspace={can_invite_admin:true,invitations:[old],students:[],guardians:[],staff:[],roles:[]};
    vi.mocked(getInvitations).mockResolvedValue(workspace);
    vi.mocked(resendMemberInvitation).mockResolvedValue({id:'invite',delivery_job_id:'new-job',token:'012345',email:old.email,expires_at:old.expires_at,delivery:'queued'});
    const user=userEvent.setup();mount(<InvitationsPage/>,'/more/setup/people/invitations');
    await user.click(await screen.findByRole('button',{name:'Resend invitation email'}));
    expect(await screen.findByRole('dialog',{name:'Sending invitation…'})).toBeVisible();
    expect(screen.queryByRole('heading',{name:'Invitation sent'})).not.toBeInTheDocument();
    vi.mocked(getInvitations).mockResolvedValue({...workspace,invitations:[{...old,delivery_job_id:'new-job'}]});
    expect(await screen.findByRole('dialog',{name:'Invitation sent'},{timeout:3500})).toBeVisible();
  });
  it('starts with invitation history and opens a separate, cancellable form',async()=>{
    const user=userEvent.setup();mount(<><InvitationsPage/><NavigationProbe/></>,'/more/setup/people/invitations');
    expect(await screen.findByText('No invitations yet.')).toBeVisible();
    expect(screen.queryByLabelText('Recipient email')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button',{name:'Invite member'}));
    expect(screen.getByTestId('navigation-location')).toHaveTextContent('/more/setup/people/invitations?create=invitation');
    expect(screen.getByTestId('navigation-type')).toHaveTextContent('PUSH');
    expect(screen.getByLabelText('Recipient email')).toBeVisible();
    expect(screen.queryByLabelText('Invitation status')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button',{name:'Cancel'}));
    expect(screen.getByTestId('navigation-location')).toHaveTextContent('/more/setup/people/invitations');
    expect(screen.getByTestId('navigation-type')).not.toHaveTextContent('PUSH');
    expect(screen.getByLabelText('Invitation status')).toBeVisible();
    expect(inviteMember).not.toHaveBeenCalled();
  });
  it.each(['staff','guardian'])('preselects the contextual %s invitation without creating one',async role=>{
    const from=role==='staff'?'staff':'students';
    mount(<><InvitationsPage/><NavigationProbe/></>,`/more/setup/people/invitations?role=${role}&from=${from}`);
    expect(await screen.findByLabelText('Account type')).toHaveValue(role);
    expect(inviteMember).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole('button',{name:'Cancel'}));
    expect(screen.getByTestId('navigation-location')).toHaveTextContent(`/more/setup/people/invitations?role=${role}&from=${from}&view=history`);
    expect(screen.getByTestId('navigation-type')).not.toHaveTextContent('PUSH');
  });
  it('resends a pending invitation and shows the mail-server result',async()=>{
    vi.mocked(getInvitations).mockResolvedValue({can_invite_admin:true,invitations:[{id:'invite',email:'learner@example.test',role:'staff',expires_at:'2099-10-04',accepted_at:null,revoked_at:null}],students:[],guardians:[],staff:[],roles:[]});
    vi.mocked(resendMemberInvitation).mockResolvedValue({token:'replacement-code',email:'learner@example.test',expires_at:'2099-10-04',delivery:'email_accepted'});
    const user=userEvent.setup();mount(<InvitationsPage/>,'/more/setup/people/invitations');
    await user.click(await screen.findByRole('button',{name:'Resend invitation email'}));
    expect(resendMemberInvitation).toHaveBeenCalledWith('school','invite');
    expect(await screen.findByRole('status')).toHaveTextContent('Invitation sent');
    expect(screen.queryByText('replacement-code')).not.toBeInTheDocument();
  });
  it('shows resend errors without a false success receipt',async()=>{
    vi.mocked(getInvitations).mockResolvedValue({can_invite_admin:true,invitations:[{id:'invite',email:'learner@example.test',role:'staff',expires_at:'2099-10-04',accepted_at:null,revoked_at:null}],students:[],guardians:[],staff:[],roles:[]});
    vi.mocked(resendMemberInvitation).mockRejectedValue(new Error('Please wait one minute.'));
    const user=userEvent.setup();mount(<InvitationsPage/>,'/more/setup/people/invitations');
    await user.click(await screen.findByRole('button',{name:'Resend invitation email'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Please wait one minute.');
    expect(screen.queryByRole('heading',{name:'Invitation ready'})).not.toBeInTheDocument();
  });
  it('reports mail-server acceptance without claiming inbox delivery',()=>{
    mount(<InvitationReceipt invite={{token:'private-code',email:'recipient@example.test',expires_at:'2099-10-04',delivery:'email_accepted'}} onClose={()=>{}}/>);
    expect(screen.getByRole('status')).toHaveTextContent('Invitation sent');
    expect(screen.getByRole('status')).toHaveTextContent('recipient@example.test');
    expect(screen.queryByText('private-code')).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'Copy invitation'})).not.toBeInTheDocument();
    expect(screen.queryByText(/No email has been sent/)).not.toBeInTheDocument();
  });
  it('shows a failure without a success animation or private code',()=>{
    mount(<InvitationReceipt invite={{token:'private-code',email:'recipient@example.test',expires_at:'2099-10-04',delivery:'failed'}} onClose={()=>{}}/>);
    expect(screen.getByRole('alert')).toHaveTextContent('Invitation not sent');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(document.querySelector('.invitation-confirmation--sent')).toBeNull();
    expect(screen.queryByText('private-code')).not.toBeInTheDocument();
  });

  it('creates a college with first admin and reports unavailable email sending',async()=>{
    const user=userEvent.setup();mount(<CompanyPage/>);await user.click(screen.getByRole('button',{name:'Create institution'}));await user.click(screen.getByRole('button',{name:/Add institution manually/}));
    await user.type(screen.getByLabelText('Institution name'),'Lotus College');await user.selectOptions(screen.getByLabelText('Institution type'),'college');await user.type(screen.getByLabelText('First administrator email'),'admin@example.test');await user.type(screen.getByLabelText('State'),'Delhi');await user.type(screen.getByLabelText('City'),'Delhi');await user.type(screen.getByLabelText('Address'),'Campus Road');await user.click(screen.getByRole('button',{name:'Create & invite admin'}));
    expect(createInstitution).toHaveBeenCalledWith(expect.objectContaining({name:'Lotus College',code:'lotus-college',institution_kind:'college',timezone:'Asia/Kolkata',admin_email:'admin@example.test'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invitation not sent');expect(screen.getByText(/Email sending is unavailable/)).toBeInTheDocument();
  });
  it('normalizes a manually edited institution code instead of silently blocking submission',async()=>{
    const user=userEvent.setup();mount(<CompanyPage/>);await user.click(screen.getByRole('button',{name:'Create institution'}));await user.click(screen.getByRole('button',{name:/Add institution manually/}));
    await user.type(screen.getByLabelText('Institution name'),'Delhi Public School');const code=screen.getByLabelText('Unique code');expect(code).toHaveValue('delhi-public-school');
    await user.clear(code);await user.type(code,'DPS South Campus');await user.tab();expect(code).toHaveValue('dps-south-campus');
    await user.type(screen.getByLabelText('First administrator email'),'principal@example.test');await user.type(screen.getByLabelText('State'),'Delhi');await user.type(screen.getByLabelText('City'),'Delhi');await user.type(screen.getByLabelText('Address'),'Campus Road');await user.click(screen.getByRole('button',{name:'Create & invite admin'}));
    expect(createInstitution).toHaveBeenCalledWith(expect.objectContaining({name:'Delhi Public School',code:'dps-south-campus',institution_kind:'school',timezone:'Asia/Kolkata',admin_email:'principal@example.test'}));
  });
  it('keeps entered institution details on a server error',async()=>{
    vi.mocked(createInstitution).mockRejectedValue(new Error('Institution code is already in use.'));const user=userEvent.setup();mount(<CompanyPage/>);await user.click(screen.getByRole('button',{name:'Create institution'}));await user.click(screen.getByRole('button',{name:/Add institution manually/}));
    await user.type(screen.getByLabelText('Institution name'),'Lotus');await user.type(screen.getByLabelText('Unique code'),'lotus');await user.type(screen.getByLabelText('First administrator email'),'admin@example.test');await user.type(screen.getByLabelText('State'),'Delhi');await user.type(screen.getByLabelText('City'),'Delhi');await user.type(screen.getByLabelText('Address'),'Campus Road');await user.click(screen.getByRole('button',{name:'Create & invite admin'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('already in use');expect(screen.getByLabelText('Institution name')).toHaveValue('Lotus');
  });
  it('hides administrator and role assignment from a delegated inviter and links a student',async()=>{
    const user=userEvent.setup();mount(<InvitationsPage/>);await user.click(await screen.findByRole('button',{name:'Invite member'}));await screen.findByRole('heading',{name:'Create invitation'});
    expect(screen.queryByRole('option',{name:'Administrator'})).not.toBeInTheDocument();expect(screen.queryByLabelText('Role on joining')).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Account type'),'student');await user.selectOptions(screen.getByLabelText('Student record'),'student');await user.type(screen.getByLabelText('Recipient email'),'learner@example.test');await user.click(screen.getByRole('button',{name:'Send invitation email'}));
    expect(inviteMember).toHaveBeenCalledWith('school',{email:'learner@example.test',role:'student',student_id:'student'});expect(await screen.findByRole('status')).toHaveTextContent('Invitation sent');
    expect(screen.getByLabelText('Invitation status')).toBeVisible();
    expect(screen.queryByLabelText('Recipient email')).not.toBeInTheDocument();
    expect(screen.queryByText('012345')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button',{name:'Dismiss invitation notification'}));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Invitation status')).toBeVisible();
  });
  it('requires the explicitly chosen staff person even when names match',async()=>{
    vi.mocked(getInvitations).mockResolvedValue({can_invite_admin:false,invitations:[],students:[],guardians:[],roles:[],staff:[
      {id:'first-person',name:'Same name',email:'first@example.test',staff_code:'W01'},
      {id:'second-person',name:'Same name',email:'second@example.test',staff_code:'W02'},
    ]});
    const user=userEvent.setup();mount(<InvitationsPage/>,'/more/setup/people/invitations?role=staff&from=staff');
    const target=await screen.findByLabelText('Staff person');
    expect(target).toHaveValue('');expect(target).toBeRequired();
    expect(screen.getByRole('button',{name:'Send invitation email'})).toBeDisabled();
    expect(inviteMember).not.toHaveBeenCalled();
    await user.selectOptions(target,'second-person');
    expect(screen.getByLabelText('Recipient email')).toHaveValue('second@example.test');
    await user.click(screen.getByRole('button',{name:'Send invitation email'}));
    expect(inviteMember).toHaveBeenCalledExactlyOnceWith('school',{email:'second@example.test',role:'staff',person_id:'second-person'});
    expect(await screen.findByRole('status')).toHaveTextContent('Invitation sent');
  });
  it('offers staff onboarding rather than issuing a code without an eligible person',async()=>{
    vi.mocked(getInvitations).mockResolvedValue({can_invite_admin:false,invitations:[],students:[],guardians:[],staff:[],roles:[]});
    const user=userEvent.setup();mount(<InvitationsPage/>,'/more/setup/people/invitations?role=staff&from=staff');
    await screen.findByLabelText('Staff person');
    expect(screen.getByText(/No staff are ready for an invitation/)).toBeVisible();
    expect(screen.getByRole('link',{name:'Open staff onboarding'})).toHaveAttribute('href','/more/setup/responsibilities?section=directory&school=school');
    await user.type(screen.getByLabelText('Recipient email'),'someone@example.test');
    expect(screen.getByRole('button',{name:'Send invitation email'})).toBeDisabled();
    expect(inviteMember).not.toHaveBeenCalled();
  });
  it('retains the exact staff choice and email after stale eligibility is rejected',async()=>{
    vi.mocked(inviteMember).mockRejectedValue(new Error('This staff person is no longer available for an invitation. Refresh and review their profile.'));
    const user=userEvent.setup();mount(<InvitationsPage/>,'/more/setup/people/invitations?role=staff');
    await user.selectOptions(await screen.findByLabelText('Staff person'),'staff-person');
    await user.click(screen.getByRole('button',{name:'Send invitation email'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('no longer available');
    expect(screen.getByLabelText('Staff person')).toHaveValue('staff-person');
    expect(screen.getByLabelText('Recipient email')).toHaveValue('worker@example.test');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Account type'),'student');
    expect(screen.getByLabelText('Student record')).toHaveValue('');
    expect(screen.getByLabelText('Recipient email')).toHaveValue('');
  });
  it('accepts a code with CSRF and shows account activation success',async()=>{
    vi.mocked(apiFetch).mockImplementation(path=>Promise.resolve(path.endsWith('recipient-proof/')?{campus:{id:'new',name:'Campus'},verification_required:false,delivery:'not_required'}:{school_id:'new',role:'admin',accepted_user_id:'recipient'}));const user=userEvent.setup();mount(<JoinPage/>);
    await user.type(screen.getByLabelText('Invitation code'),'012345');await user.type(screen.getByLabelText('Email'),'admin@example.test');await user.click(screen.getByRole('button',{name:'Continue'}));await user.type(await screen.findByLabelText('Name'),'First Admin');await user.type(screen.getByLabelText('Password'),'Testing!RiverPebbles2026');await user.click(screen.getByRole('button',{name:'Accept invitation'}));
    expect(await screen.findByRole('status')).toHaveTextContent('membership is active');expect(apiFetch).toHaveBeenCalledWith('/api/v1/auth/csrf/');expect(apiFetch).toHaveBeenCalledWith('/api/v1/invitations/accept/',expect.objectContaining({method:'POST'}));
  });
  it('prefills the email link, removes its fragment and waits for explicit acceptance',async()=>{
    function LocationProbe(){const location=useLocation();return <span data-testid="join-location">{location.pathname+location.hash}</span>;}
    vi.mocked(apiFetch).mockImplementation(path=>Promise.resolve(path.endsWith('recipient-proof/')?{campus:{id:'new',name:'Campus'},verification_required:false,delivery:'not_required'}:{school_id:'new',role:'admin',accepted_user_id:'recipient'}));
    const user=userEvent.setup();
    mount(<><JoinPage/><LocationProbe/></>,'/join#email=admin%2Bschool%40example.test&token=012345');
    expect(screen.getByLabelText('Invitation code')).toHaveValue('012345');
    expect(screen.getByLabelText('Email')).toHaveValue('admin+school@example.test');
    expect(screen.getByTestId('join-location')).toHaveTextContent(/^\/join$/);
    expect(apiFetch).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button',{name:'Continue'}));
    await user.type(await screen.findByLabelText('Name'),'First Admin');
    await user.type(screen.getByLabelText('Password'),'Testing!RiverPebbles2026');
    await user.click(screen.getByRole('button',{name:'Accept invitation'}));
    expect(await screen.findByRole('status')).toHaveTextContent('membership is active');
    const request=vi.mocked(apiFetch).mock.calls.find(call=>call[0]==='/api/v1/invitations/accept/');
    expect(JSON.parse(request![1]!.body as string)).toMatchObject({email:'admin+school@example.test',token:'012345'});
  });
  it.each(['#email=a%40example.test&token=123','#email=bad&token=012345','#token=012345'])('leaves malformed link %s available for manual entry',fragment=>{
    mount(<JoinPage/>,'/join'+fragment);
    expect(screen.getByLabelText('Invitation code')).toHaveValue('');
    expect(screen.getByLabelText('Email')).toHaveValue('');
    expect(apiFetch).not.toHaveBeenCalled();
  });
  it('retains prefilled details after an expired invitation error',async()=>{
    vi.mocked(apiFetch).mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('Invitation expired. Request a new invitation.'));
    const user=userEvent.setup();mount(<JoinPage/>,'/join#email=admin%40example.test&token=012345');
    await user.click(screen.getByRole('button',{name:'Continue'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invitation expired');
    expect(screen.getByLabelText('Invitation code')).toHaveValue('012345');
    expect(screen.getByLabelText('Email')).toHaveValue('admin@example.test');
  });
  it('routes company operators, new accounts and members to one clear workspace',()=>{
    expect(authDestination({status:'authenticated',companyOperator:true,memberships:[]})).toBe('/company');
    expect(authDestination({status:'authenticated',memberships:[]})).toBe('/onboarding/start');
    expect(authDestination({status:'authenticated',memberships:[{id:'membership',school_id:'school',school_name:'School',role:'admin'}]})).toBe('/today');
  });
});
