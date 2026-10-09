import { cleanup,render,screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import CompanyPage from './CompanyPage';
import SelfServiceOnboardingPage from './SelfServiceOnboardingPage';
import InvitationsPage from './InvitationsPage';
import JoinPage from './JoinPage';
import { InvitationReceipt } from './InvitationReceipt';
import { createCoachingWorkspace,createInstitution,getCompany,getInvitations,getOnboardingWorkspace,inviteMember,resendMemberInvitation,submitInstitutionApplication } from './api';
import { apiFetch } from '../../lib/api';
import { authDestination } from '../auth/AuthContext';
const auth=vi.hoisted(()=>({status:'authenticated',companyOperator:true,memberships:[{school_id:'school',role:'admin',school_name:'School',permissions:['members.invite']}],user:{display_name:'Eduera Company'},hasPortal:vi.fn(()=>true),logout:vi.fn(),refresh:vi.fn()}));
vi.mock('../auth/AuthContext',async original=>({...await original(),useAuth:()=>auth}));
vi.mock('../../pages/operations/OperationsShell',()=>({OperationsShell:({children}:{children:React.ReactNode})=><main>{children}</main>}));
vi.mock('./api',async original=>({...await original(),getCompany:vi.fn(),createInstitution:vi.fn(),getInvitations:vi.fn(),inviteMember:vi.fn(),resendMemberInvitation:vi.fn(),getOnboardingWorkspace:vi.fn(),submitInstitutionApplication:vi.fn(),createCoachingWorkspace:vi.fn()}));
vi.mock('../../lib/api',async original=>({...await original(),apiFetch:vi.fn()}));
function mount(element:React.ReactNode,path='/'){render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter initialEntries={[path]}>{element}</MemoryRouter></QueryClientProvider>);}
afterEach(cleanup);
beforeEach(()=>{
  vi.clearAllMocks();auth.companyOperator=true;auth.hasPortal.mockReturnValue(true);
  vi.mocked(getCompany).mockResolvedValue({schools:[],invitations:[],applications:[]});
  vi.mocked(createInstitution).mockResolvedValue({school:{id:'new',name:'Lotus',code:'lotus',institution_kind:'college',admin_count:0,pending_admins:1},invitation:{token:'012345',email:'admin@example.test',expires_at:'2099-10-04'}});
  vi.mocked(getInvitations).mockResolvedValue({can_invite_admin:false,invitations:[],students:[{id:'student',name:'Learner',admission_number:'A001',email:null}],guardians:[],roles:[]});
  vi.mocked(inviteMember).mockResolvedValue({token:'012345',email:'learner@example.test',expires_at:'2099-10-04',delivery:'email_accepted'});
  vi.mocked(getOnboardingWorkspace).mockResolvedValue({applications:[],coaching_workspaces:[]});
  vi.mocked(submitInstitutionApplication).mockResolvedValue({id:'application',institution_name:'Lotus School',requested_code:'lotus-school',institution_kind:'school',timezone:'Asia/Kolkata',state_code:'KA',district:'Bengaluru Urban',website:'',applicant_role_title:'Founder',regulator_type:'udise',regulator_reference:'12345',status:'submitted',review_note:'',revision:1,submitted_at:'2026-10-04',updated_at:'2026-10-04',provisioned_school_id:null});
  vi.mocked(createCoachingWorkspace).mockResolvedValue({id:'coaching',name:'Lotus Tutorials',code:'lotus-tutorials'});
});
describe('company and school onboarding',()=>{
  it('starts with invitation history and opens a separate, cancellable form',async()=>{
    const user=userEvent.setup();mount(<InvitationsPage/>,'/principal/invitations');
    expect(await screen.findByText('No invitations yet.')).toBeVisible();
    expect(screen.queryByLabelText('Recipient email')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button',{name:'Invite member'}));
    expect(screen.getByLabelText('Recipient email')).toBeVisible();
    expect(screen.queryByLabelText('Invitation status')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button',{name:'Cancel'}));
    expect(screen.getByLabelText('Invitation status')).toBeVisible();
    expect(inviteMember).not.toHaveBeenCalled();
  });
  it.each(['staff','guardian'])('preselects the contextual %s invitation without creating one',async role=>{
    mount(<InvitationsPage/>,`/principal/invitations?role=${role}&from=${role==='staff'?'staff':'students'}`);
    expect(await screen.findByLabelText('Account type')).toHaveValue(role);
    expect(inviteMember).not.toHaveBeenCalled();
  });
  it('resends a pending invitation and shows the mail-server result',async()=>{
    vi.mocked(getInvitations).mockResolvedValue({can_invite_admin:true,invitations:[{id:'invite',email:'learner@example.test',role:'staff',expires_at:'2099-10-04',accepted_at:null,revoked_at:null}],students:[],guardians:[],roles:[]});
    vi.mocked(resendMemberInvitation).mockResolvedValue({token:'replacement-code',email:'learner@example.test',expires_at:'2099-10-04',delivery:'email_accepted'});
    const user=userEvent.setup();mount(<InvitationsPage/>,'/principal/invitations');
    await user.click(await screen.findByRole('button',{name:'Resend invitation email'}));
    expect(resendMemberInvitation).toHaveBeenCalledWith('school','invite');
    expect(await screen.findByRole('status')).toHaveTextContent('Invitation sent');
    expect(screen.queryByText('replacement-code')).not.toBeInTheDocument();
  });
  it('shows resend errors without a false success receipt',async()=>{
    vi.mocked(getInvitations).mockResolvedValue({can_invite_admin:true,invitations:[{id:'invite',email:'learner@example.test',role:'staff',expires_at:'2099-10-04',accepted_at:null,revoked_at:null}],students:[],guardians:[],roles:[]});
    vi.mocked(resendMemberInvitation).mockRejectedValue(new Error('Please wait one minute.'));
    const user=userEvent.setup();mount(<InvitationsPage/>,'/principal/invitations');
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
    auth.hasPortal.mockReturnValue(false);const user=userEvent.setup();mount(<InvitationsPage/>);await user.click(await screen.findByRole('button',{name:'Invite member'}));await screen.findByRole('heading',{name:'Create invitation'});
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
  it('accepts a code with CSRF and shows account activation success',async()=>{
    vi.mocked(apiFetch).mockResolvedValue({school_id:'new',role:'admin'});const user=userEvent.setup();mount(<JoinPage/>);
    await user.type(screen.getByLabelText('Invitation code'),'012345');await user.type(screen.getByLabelText('Email'),'admin@example.test');await user.type(screen.getByLabelText('First name'),'First');await user.type(screen.getByLabelText('Last name'),'Admin');await user.type(screen.getByLabelText('Password'),'Testing!RiverPebbles2026');await user.click(screen.getByRole('button',{name:'Accept invitation'}));
    expect(await screen.findByRole('status')).toHaveTextContent('membership is active');expect(apiFetch).toHaveBeenCalledWith('/api/v1/auth/csrf/');expect(apiFetch).toHaveBeenCalledWith('/api/v1/invitations/accept/',expect.objectContaining({method:'POST'}));
  });
  it('prefills the email link, removes its fragment and waits for explicit acceptance',async()=>{
    function LocationProbe(){const location=useLocation();return <span data-testid="join-location">{location.pathname+location.hash}</span>;}
    vi.mocked(apiFetch).mockResolvedValue({school_id:'new',role:'admin'});
    const user=userEvent.setup();
    mount(<><JoinPage/><LocationProbe/></>,'/join#email=admin%2Bschool%40example.test&token=012345');
    expect(screen.getByLabelText('Invitation code')).toHaveValue('012345');
    expect(screen.getByLabelText('Email')).toHaveValue('admin+school@example.test');
    expect(screen.getByTestId('join-location')).toHaveTextContent(/^\/join$/);
    expect(apiFetch).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('First name'),'First');
    await user.type(screen.getByLabelText('Last name'),'Admin');
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
    await user.type(screen.getByLabelText('First name'),'First');await user.type(screen.getByLabelText('Last name'),'Admin');await user.type(screen.getByLabelText('Password'),'Testing!RiverPebbles2026');
    await user.click(screen.getByRole('button',{name:'Accept invitation'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invitation expired');
    expect(screen.getByLabelText('Invitation code')).toHaveValue('012345');
    expect(screen.getByLabelText('Email')).toHaveValue('admin@example.test');
  });
  it('routes company operators and new school admins to the correct workspace',()=>{
    expect(authDestination({status:'authenticated',companyOperator:true,portals:[],memberships:[]})).toBe('/company');
    expect(authDestination({status:'authenticated',setupRequired:true,portals:['principal'],memberships:[]})).toBe('/principal/activation');
    expect(authDestination({status:'authenticated',portals:['principal'],memberships:[]})).toBe('/principal');
  });
  it('presents verified institution and immediate coaching as distinct onboarding models',async()=>{
    auth.companyOperator=false;
    mount(<SelfServiceOnboardingPage/>);
    expect(await screen.findByRole('heading',{name:'Create a workspace'})).toBeVisible();
    expect(await screen.findByRole('button',{name:/Start institution application/i})).toBeVisible();
    expect(screen.getByRole('button',{name:/Create coaching workspace/i})).toBeVisible();
    expect(screen.getByText('No Eduvera verification')).toBeVisible();
    expect(screen.getByText('Workspace opens after approval')).toBeVisible();
    expect(screen.queryByText(/focused learner community/i)).not.toBeInTheDocument();
  });
  it('submits formal verification details without provisioning from the applicant UI',async()=>{
    auth.companyOperator=false;
    const user=userEvent.setup();mount(<SelfServiceOnboardingPage/>);await user.click(await screen.findByRole('button',{name:/Start institution application/i}));
    await user.type(screen.getByLabelText('Institution name'),'Lotus School');
    await user.type(screen.getByLabelText('State or UT code'),'KA');
    await user.type(screen.getByLabelText('District'),'Bengaluru Urban');
    await user.type(screen.getByLabelText('Your role at the institution'),'Founder Principal');
    await user.type(screen.getByLabelText(/Registration or affiliation reference/),'UDISE-12345');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button',{name:/Submit for company review/i}));
    expect(submitInstitutionApplication).toHaveBeenCalledWith(expect.objectContaining({institution_name:'Lotus School',requested_code:'lotus-school',state_code:'KA',declaration_accepted:true}));
    expect(createCoachingWorkspace).not.toHaveBeenCalled();
  });
});
