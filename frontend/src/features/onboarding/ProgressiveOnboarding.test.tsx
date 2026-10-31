import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SelfServiceOnboardingPage from './SelfServiceOnboardingPage';
import ProgressiveSetupPage from './ProgressiveSetupPage';
import OrganizationVerificationPage from './OrganizationVerificationPage';
import { workspaceQueryRoot } from '../workspace/useWorkspaceManifest';
import { ExecutionEnvironmentProvider } from '../simulation/ExecutionEnvironmentContext';
import type { ExecutionEnvironment } from '../simulation/executionEnvironment';

const apiFetch = vi.hoisted(() => vi.fn<(path:string,options?:RequestInit)=>Promise<unknown>>());
const auth = vi.hoisted(() => ({
  companyOperator: false,
  user: {id:'owner', first_name:'', last_name:'', email:'owner@example.test'},
  refresh: vi.fn(()=>Promise.resolve()),
  logout: vi.fn(()=>Promise.resolve()),
}));

vi.mock('../../lib/api', async original => ({...await original(), apiFetch}));
vi.mock('../auth/AuthContext', async original => ({...await original(), useAuth:()=>auth}));

const catalogue = [
  {key:'attendance',label:'Attendance',description:'Take a register',destination:'/areas/attendance/registers',selection_kind:'goal',selected:false},
  {key:'gate',label:'Gate entry & exit',description:'Record movement',destination:'/areas/in-out/operate',selection_kind:'goal',selected:false},
] as const;
const workspace = {
  status:'ready',
  workspace:{id:'school-1',display_name:'My workspace',profile_named:false,timezone:'Asia/Kolkata',verification_status:'not_required',onboarding_model:'progressive'},
  goals:{selected:['attendance'],primary:'attendance'},
  resume:{step:'first_use',goal:'attendance',path:'/more/setup/capabilities?task=attendance'},
  catalogue,
  applications:[],
};
const setup = {
  school_id:'school-1',
  working_now:[],
  useful_next:[
    {capability:'attendance',label:'Attendance',status:'needs_setup',destination:'/areas/attendance/registers',setup_path:'/more/setup/capabilities?task=attendance',counts:{},missing:[]},
    {capability:'gate',label:'Gate entry & exit',status:'needs_setup',destination:'/areas/in-out/operate',setup_path:'/more/setup/capabilities?task=gate',counts:{},missing:[]},
  ],
  available_anytime:[],
  options:{classes:[],students:[],staff:[],gates:[]},
};

function LocationProbe(){const location=useLocation();return <output data-testid="location">{location.pathname}{location.search}</output>;}
function mount(element:React.ReactNode,path:string,environment:ExecutionEnvironment={mode:'live'}){
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  return render(<QueryClientProvider client={client}><ExecutionEnvironmentProvider environment={environment}><MemoryRouter initialEntries={[path]}><Routes><Route path="*" element={<>{element}<LocationProbe/></>}/></Routes></MemoryRouter></ExecutionEnvironmentProvider></QueryClientProvider>);
}

describe('progressive onboarding',()=>{
  afterEach(cleanup);
  beforeEach(()=>{vi.clearAllMocks();});

  it('starts whole-campus guidance without selecting every capability or asking for the campus catalogue',async()=>{
    apiFetch.mockImplementation((path,options)=>{
      if(path==='/api/v1/onboarding/workspace/'&&!options)return Promise.resolve({...workspace,status:'purpose_required',goals:{selected:[],primary:null}});
      if(path==='/api/v1/onboarding/workspace/'&&options?.method==='POST')return Promise.resolve({...workspace,guidance:'whole_campus',goals:{selected:[],primary:null}});
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
    mount(<SelfServiceOnboardingPage/>,'/onboarding/start');
    await userEvent.click(await screen.findByRole('button',{name:'I want to set up the whole campus'}));
    await waitFor(()=>expect(screen.getByTestId('location')).toHaveTextContent('/more/setup/whole-campus'));
    const writes=apiFetch.mock.calls.filter(([,options])=>options?.method==='POST');
    expect(writes).toHaveLength(1);
    const body=JSON.parse(writes[0]![1]!.body as string) as {guidance:string;timezone:string;goals?:string[]};
    expect(body.guidance).toBe('whole_campus');expect(typeof body.timezone).toBe('string');expect(body.goals).toBeUndefined();
    expect(screen.queryByRole('textbox',{name:/Campus name/})).not.toBeInTheDocument();
    expect(auth.refresh).toHaveBeenCalled();
  });

  it('preserves chosen purposes and the normal retry when starting campus guidance fails',async()=>{
    let failed=true;
    apiFetch.mockImplementation((path,options)=>{
      if(path==='/api/v1/onboarding/workspace/'&&!options)return Promise.resolve(workspace);
      if(path==='/api/v1/onboarding/workspace/'&&options?.method==='POST')return failed?Promise.reject(new Error('Your campus guide could not be saved.')):Promise.resolve({...workspace,guidance:'whole_campus'});
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
    mount(<SelfServiceOnboardingPage/>,'/onboarding/start');
    await userEvent.click(await screen.findByRole('button',{name:'I want to set up the whole campus'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your campus guide could not be saved.');
    expect(screen.getByRole('checkbox',{name:'Attendance'})).toBeChecked();
    expect(screen.getByRole('checkbox',{name:'Gate entry & exit'})).not.toBeChecked();
    failed=false;
    await userEvent.click(screen.getByRole('button',{name:'I want to set up the whole campus'}));
    await waitFor(()=>expect(screen.getByTestId('location')).toHaveTextContent('/more/setup/whole-campus'));
    expect(apiFetch.mock.calls.some(([path])=>path==='/api/v1/onboarding/goals/')).toBe(false);
  });

  it('lets Assignments be the first outcome without creating a teaching role or advertising Fees',async()=>{
    const assignments={key:'assignments',label:'Assignments',description:'Publish work, receive submissions and give feedback.',destination:'/more/setup/capabilities?task=assignments',selection_kind:'goal',selected:false};
    apiFetch.mockImplementation((path,options)=>{
      if(path==='/api/v1/onboarding/workspace/'&&!options)return Promise.resolve({...workspace,status:'workspace_required',workspace:null,goals:{selected:[],primary:null},catalogue:[...catalogue,assignments]});
      if(path==='/api/v1/onboarding/workspace/'&&options?.method==='POST')return Promise.resolve({...workspace,goals:{selected:['assignments'],primary:'assignments'},resume:{step:'first_use',goal:'assignments',path:assignments.destination}});
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
    const user=userEvent.setup();mount(<SelfServiceOnboardingPage/>,'/onboarding/start');
    await user.click(await screen.findByRole('checkbox',{name:'Assignments'}));
    expect(screen.queryByRole('checkbox',{name:/Fees/})).not.toBeInTheDocument();
    await user.click(screen.getByRole('button',{name:'Continue · 1 selected'}));
    await user.click(screen.getByRole('button',{name:'Start with assignments'}));
    expect(await screen.findByTestId('location')).toHaveTextContent(assignments.destination);
    const request=apiFetch.mock.calls.find(([,options])=>options?.method==='POST');
    expect(JSON.parse(request?.[1]?.body as string)).toMatchObject({goals:['assignments']});
    expect(apiFetch.mock.calls.filter(([,options])=>options?.method==='POST')).toHaveLength(1);
  });

  it('chooses multiple purposes before saving the private connected workspace',async()=>{
    apiFetch.mockImplementation((path:string,options?:RequestInit)=>{
      if(path==='/api/v1/onboarding/workspace/'&&!options)return Promise.resolve({...workspace,status:'purpose_required',goals:{selected:[],primary:null}});
      if(path==='/api/v1/onboarding/workspace/'&&options?.method==='POST')return Promise.resolve(workspace);
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
    const user=userEvent.setup();mount(<SelfServiceOnboardingPage/>,'/onboarding/start');
    expect(await screen.findByRole('heading',{name:'What would you like to run?'})).toBeVisible();
    expect(screen.queryByLabelText(/campus name|institution type|organisation type/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox',{name:/Attendance/}));
    await user.click(screen.getByRole('checkbox',{name:/Gate entry & exit/}));
    await user.click(screen.getByRole('button',{name:/Continue · 2 selected/}));
    expect(screen.getByRole('heading',{name:'Your campus starts here'})).toBeVisible();
    expect(screen.getByRole('figure', { name: 'Campus connections' })).toBeVisible();
    expect(screen.queryByText('One connected campus')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button',{name:/Start with attendance/i}));
    await waitFor(()=>expect(apiFetch).toHaveBeenCalledWith('/api/v1/onboarding/workspace/',expect.objectContaining({method:'POST'})));
    const call=apiFetch.mock.calls.find(([path,options])=>path==='/api/v1/onboarding/workspace/'&&options?.method==='POST');
    const requestBody=call?.[1]?.body;
    expect(typeof requestBody).toBe('string');
    const body=JSON.parse(requestBody as string) as {goals:string[];timezone:string};
    expect(body.goals).toEqual(['attendance','gate']);
    expect(body.timezone).not.toBe('');
    expect(await screen.findByTestId('location')).toHaveTextContent('/more/setup/capabilities?task=attendance');
  });

  it('requires explicit gate authority and posts only to the scoped gate setup endpoint',async()=>{
    let prepared=false;
    function ResponsibilityProbe(){const query=useQuery({queryKey:[...workspaceQueryRoot,'live:school-1'],queryFn:()=>Promise.resolve(prepared?'Gate responsibility available':'No gate responsibility'),staleTime:Infinity});return <output>{query.data}</output>;}
    apiFetch.mockImplementation((path:string,options?:RequestInit)=>{
      if(path==='/api/v1/onboarding/workspace/')return Promise.resolve({...workspace,goals:{selected:['gate'],primary:'gate'}});
      if(path==='/api/v1/schools/school-1/get-started/')return Promise.resolve(setup);
      if(path==='/api/v1/schools/school-1/get-started/gate/'&&options?.method==='POST'){prepared=true;return Promise.resolve({capability:'gate',status:'working',readiness:setup.useful_next[1],destination:'/areas/in-out/operate',notes:[],created:{},reused:{}});}
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
    const user=userEvent.setup();mount(<><ProgressiveSetupPage/><ResponsibilityProbe/></>,'/more/setup/capabilities?task=gate');
    expect(await screen.findByText('No gate responsibility')).toBeVisible();
    const create=await screen.findByRole('button',{name:/Create entry point/i});
    await user.click(create);
    expect(apiFetch.mock.calls.some(([path])=>path==='/api/v1/schools/school-1/get-started/gate/')).toBe(false);
    await user.click(screen.getByRole('checkbox',{name:/I will operate this entry point/i}));
    await user.click(create);
    await waitFor(()=>expect(apiFetch).toHaveBeenCalledWith('/api/v1/schools/school-1/get-started/gate/',{method:'POST',body:JSON.stringify({gate_name:'Main entrance',operator:{kind:'current_user',confirm:true}})}));
    expect(await screen.findByRole('link',{name:/Open gate register/i})).toHaveAttribute('href','/areas/in-out/operate');
    expect(auth.refresh).toHaveBeenCalled();
    expect(await screen.findByText('Gate responsibility available')).toBeVisible();
  });

  it('starts attendance in the shared purpose-first activity flow without creating academic or account records', async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path === '/api/v1/onboarding/workspace/') return Promise.resolve(workspace);
      if (path === '/api/v1/schools/school-1/get-started/') return Promise.resolve(setup);
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
    mount(<ProgressiveSetupPage />, '/more/setup/capabilities?task=attendance');
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/areas/timetable/planning?create=attendance'));
    expect(screen.queryByText(/I teach this group/)).not.toBeInTheDocument();
    expect(apiFetch.mock.calls.some(([path, options]) => path.endsWith('/get-started/attendance/') && options?.method === 'POST')).toBe(false);
  });

  it('keeps accessible tile names, selected descriptions and the local multi-choice draft when going Back',async()=>{
    apiFetch.mockResolvedValue({...workspace,status:'purpose_required',goals:{selected:[],primary:null}});
    const user=userEvent.setup();mount(<SelfServiceOnboardingPage/>,'/onboarding/start');
    const attendance=await screen.findByRole('checkbox',{name:'Attendance'});
    expect(screen.queryByText('Take a register')).not.toBeInTheDocument();
    await user.click(attendance);
    await user.click(screen.getByRole('checkbox',{name:'Gate entry & exit'}));
    await user.click(screen.getByText('2 selected · What’s included'));
    expect(screen.getByText('Take a register')).toBeVisible();
    await user.click(screen.getByRole('button',{name:'Continue · 2 selected'}));
    expect(screen.getByText('Step 2 of 2')).toBeVisible();
    await user.click(screen.getByRole('button',{name:'Back'}));
    expect(screen.getByText('Step 1 of 2')).toBeVisible();
    expect(screen.getByRole('checkbox',{name:'Attendance'})).toBeChecked();
    expect(screen.getByRole('checkbox',{name:'Gate entry & exit'})).toBeChecked();
    expect(apiFetch.mock.calls.some(([,options])=>options?.method==='POST'||options?.method==='PUT')).toBe(false);
  });

  it('keeps the chosen primary outcome stable while its request is pending and retains it on failure',async()=>{
    let reject:((reason:Error)=>void)|undefined;
    apiFetch.mockImplementation((_path,options)=>options?.method==='PUT'?new Promise((_resolve,rejectRequest)=>{reject=rejectRequest;}):Promise.resolve(workspace));
    const user=userEvent.setup();mount(<SelfServiceOnboardingPage/>,'/onboarding/start?step=connect&goals=attendance,gate');
    const primary=await screen.findByRole('radio',{name:'Gate entry & exit'});
    await user.click(primary);
    await user.click(screen.getByRole('button',{name:'Start with gate entry & exit'}));
    expect(primary).toBeDisabled();
    expect(screen.getByRole('button',{name:'Preparing your workspace…'})).toBeDisabled();
    expect(screen.getByRole('button',{name:'Back'})).toBeDisabled();
    expect(screen.getByRole('link',{name:'Done'})).toHaveAttribute('aria-disabled','true');
    reject?.(new Error('Please retry without changing your choices.'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Please retry');
    expect(primary).toBeEnabled();expect(primary).toBeChecked();
    expect(screen.getByRole('button',{name:'Start with gate entry & exit'})).toBeEnabled();
  });

  it.each([['starting-point setup',<SelfServiceOnboardingPage/>],['organisation verification',<OrganizationVerificationPage/>]])('does not read or mutate Live control-plane %s inside Simulation',async(_name,element)=>{
    mount(element,'/onboarding/start',{mode:'simulation',namespaceId:'qa-scenario',runId:'qa-run',virtualClock:{now:'2026-10-21T01:00:00Z',timeZone:'Asia/Kolkata'}});
    expect(screen.getByRole('link',{name:'Open Simulation controls'})).toHaveAttribute('href','/more/simulation');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    await waitFor(()=>expect(apiFetch).not.toHaveBeenCalled());
  });

  it.each(['attendance','gate'])('opens existing %s setup without forcing another creation journey',async capability=>{
    const ready={...setup.useful_next.find(item=>item.capability===capability)!,status:'working'};
    apiFetch.mockImplementation(path=>Promise.resolve(path==='/api/v1/onboarding/workspace/'?workspace:{...setup,working_now:[ready],useful_next:setup.useful_next.filter(item=>item.capability!==capability)}));
    mount(<ProgressiveSetupPage/>,`/more/setup/capabilities?task=${capability}`);
    expect(await screen.findByRole('link',{name:capability==='attendance'?'Open attendance':'Open gate entry & exit'})).toHaveAttribute('href',ready.destination);
    expect(screen.queryByRole('button',{name:'Create entry point'})).not.toBeInTheDocument();
    expect(screen.getByRole('link',{name:'Set up later'})).toHaveAttribute('href','/today');
    if(capability==='gate')expect(screen.getByRole('button',{name:'Set up another entry point'})).toBeVisible();
    else expect(screen.getByRole('link',{name:'Schedule an activity'})).toHaveAttribute('href','/areas/timetable/planning?create=attendance');
  });

  it('explicitly reuses an existing entry point and retains its authority confirmation',async()=>{
    const ready={...setup.useful_next[1]!,status:'working'};
    apiFetch.mockImplementation((path,options)=>{
      if(path==='/api/v1/onboarding/workspace/')return Promise.resolve(workspace);
      if(path==='/api/v1/schools/school-1/get-started/')return Promise.resolve({...setup,working_now:[ready],useful_next:[setup.useful_next[0]],options:{...setup.options,gates:[{id:'gate-existing',label:'Reception'}]}});
      if(path==='/api/v1/schools/school-1/get-started/gate/'&&options?.method==='POST')return Promise.reject(new Error('Please review and retry.'));
      return Promise.resolve({});
    });
    const user=userEvent.setup();mount(<ProgressiveSetupPage/>,'/more/setup/capabilities?task=gate');
    await user.click(await screen.findByRole('button',{name:'Set up another entry point'}));
    await user.selectOptions(screen.getByRole('combobox',{name:'Entry point'}),'gate-existing');
    expect(screen.queryByRole('textbox',{name:'Entry point name'})).not.toBeInTheDocument();
    const submit=screen.getByRole('button',{name:'Set up entry point'});
    await user.click(submit);
    expect(apiFetch.mock.calls.some(([path,options])=>path.endsWith('/get-started/gate/')&&options?.method==='POST')).toBe(false);
    await user.click(screen.getByRole('checkbox',{name:/I will operate/}));
    await user.click(submit);
    expect(await screen.findByRole('alert')).toHaveTextContent('Please review');
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/schools/school-1/get-started/gate/',{method:'POST',body:JSON.stringify({existing_gate_id:'gate-existing',operator:{kind:'current_user',confirm:true}})});
    expect(screen.getByRole('combobox',{name:'Entry point'})).toHaveValue('gate-existing');
  });

  it('holds Gate Back, Done and defer navigation until the pending preparation reaches its accepted handoff',async()=>{
    let accept:((value:unknown)=>void)|undefined;
    apiFetch.mockImplementation((path,options)=>{
      if(path==='/api/v1/onboarding/workspace/')return Promise.resolve(workspace);
      if(path==='/api/v1/schools/school-1/get-started/')return Promise.resolve(setup);
      if(path==='/api/v1/schools/school-1/get-started/gate/'&&options?.method==='POST')return new Promise(resolve=>{accept=resolve;});
      return Promise.resolve({});
    });
    const user=userEvent.setup();mount(<ProgressiveSetupPage/>,'/more/setup/capabilities?task=gate');
    await user.click(await screen.findByRole('checkbox',{name:/I will operate/}));
    await user.click(screen.getByRole('button',{name:'Create entry point'}));
    expect(screen.getByRole('textbox',{name:/^Entry point name/})).toBeDisabled();
    expect(screen.getByRole('button',{name:'Back'})).toBeDisabled();
    expect(screen.getByRole('button',{name:'Preparing your entry point…'})).toBeDisabled();
    expect(screen.getByRole('link',{name:'Done'})).toHaveAttribute('aria-disabled','true');
    expect(screen.getByRole('link',{name:'Set up later'})).toHaveAttribute('aria-disabled','true');
    await user.click(screen.getByRole('link',{name:'Done'}));
    await user.click(screen.getByRole('link',{name:'Set up later'}));
    expect(screen.getByTestId('location')).toHaveTextContent('/more/setup/capabilities?task=gate');
    accept?.({capability:'gate',status:'working',readiness:setup.useful_next[1],destination:'/areas/in-out/operate',notes:[],created:{},reused:{}});
    expect(await screen.findByRole('link',{name:'Open gate register'})).toHaveAttribute('href','/areas/in-out/operate');
    expect(screen.getByRole('button',{name:'Back'})).toBeEnabled();
    expect(screen.getByRole('link',{name:'Done'})).not.toHaveAttribute('aria-disabled');
  });

  it('explains an obsolete task instead of silently showing an unrelated overview',async()=>{
    apiFetch.mockImplementation(path=>Promise.resolve(path==='/api/v1/onboarding/workspace/'?workspace:setup));
    const user=userEvent.setup();mount(<ProgressiveSetupPage/>,'/more/setup/capabilities?task=not-a-capability');
    expect(await screen.findByRole('heading',{name:'This setup step isn’t available'})).toBeVisible();
    await user.click(screen.getByRole('button',{name:'Choose a setup step'}));
    expect(screen.getByTestId('location')).toHaveTextContent('/more/setup/capabilities');
    expect(screen.getByRole('heading',{name:'Choose your next step'})).toBeVisible();
  });

  it('keeps optional verification separate until explicitly opened, with cancel and declaration intact',async()=>{
    apiFetch.mockResolvedValue(workspace);
    const user=userEvent.setup();mount(<OrganizationVerificationPage/>,'/more/verification');
    expect(await screen.findByRole('heading',{name:'Organisation verification'})).toBeVisible();
    expect(screen.queryByRole('textbox',{name:'Registered organisation name'})).not.toBeInTheDocument();
    expect(await screen.findByRole('link',{name:'Set up later'})).toHaveAttribute('href','/more/setup/capabilities');
    await user.click(screen.getByRole('button',{name:'Start verification'}));
    expect(screen.getByRole('textbox',{name:'Registered organisation name'})).toBeVisible();
    expect(screen.getByRole('checkbox',{name:/I’m authorised/})).not.toBeChecked();
    const form=screen.getByRole('button',{name:'Submit for review'}).closest('form');
    expect(within(form!).getByText(/Never enter Aadhaar/)).toBeVisible();
    await user.click(screen.getByRole('button',{name:'Cancel'}));
    expect(screen.queryByRole('textbox',{name:'Registered organisation name'})).not.toBeInTheDocument();
    expect(apiFetch.mock.calls.some(([,options])=>options?.method==='POST')).toBe(false);
  });
});
