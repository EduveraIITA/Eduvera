import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../lib/api';
import { ExecutionEnvironmentProvider } from '../simulation/ExecutionEnvironmentContext';
import type { ExecutionEnvironment } from '../simulation/executionEnvironment';
import ProgressiveSetupPage from './ProgressiveSetupPage';
import type { AssignmentsOperationReadiness, AttendanceOperationReadiness, CapabilityReadiness, FeesOperationReadiness, ProgressiveSetup, ProgressiveWorkspace, SetupResult, TimetableOperationReadiness } from './progressive-api';

const auth=vi.hoisted(()=>({user:{id:'owner',email:'owner@example.test'},refresh:vi.fn(()=>Promise.resolve()),logout:vi.fn(()=>Promise.resolve())}));
vi.mock('../auth/AuthContext',async original=>({...await original<typeof import('../auth/AuthContext')>(),useAuth:()=>auth}));
vi.mock('../../lib/api',async original=>({...await original<typeof import('../../lib/api')>(),apiFetch:vi.fn()}));
const attendance:CapabilityReadiness={capability:'attendance',label:'Attendance',status:'working',destination:'/areas/attendance/registers',setup_path:'/more/setup/capabilities?task=attendance',counts:{},missing:[]};
const timetable:CapabilityReadiness={capability:'timetable',label:'Timetable & classes',status:'needs_setup',destination:'/areas/timetable/planning',setup_path:'/more/setup/capabilities?task=timetable',counts:{},missing:[
  {key:'groups',label:'People and groups',reason:'Choose the people and groups taking part.',destination:'/areas/people/participants'},
  {key:'schedule',label:'Schedule',reason:'Plan and publish the first activity.',destination:'/areas/timetable/planning'},
]};
const gate:CapabilityReadiness={capability:'gate',label:'Gate entry & exit',status:'needs_setup',destination:'/areas/in-out/operate',setup_path:'/more/setup/capabilities?task=gate',counts:{},missing:[]};
const workspace:ProgressiveWorkspace={status:'ready',workspace:{id:'school-1',display_name:'Your campus',profile_named:false,timezone:'Asia/Kolkata',verification_status:'not_required',onboarding_model:'progressive'},
  goals:{selected:['attendance','timetable'],primary:'attendance'},resume:{step:'first_use',goal:'attendance',path:'/more/setup/capabilities?task=attendance'},
  catalogue:[attendance,timetable,gate].map(item=>({key:item.capability,label:item.label,description:'',destination:item.destination,selection_kind:'goal',selected:true})),applications:[]};
let setup:ProgressiveSetup;
function Location(){const location=useLocation();return <output data-testid="setup-location">{location.pathname}{location.search}</output>;}
function show(path='/more/setup/capabilities',environment:ExecutionEnvironment={mode:'live'}){
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  render(<QueryClientProvider client={client}><ExecutionEnvironmentProvider environment={environment}><MemoryRouter initialEntries={[path]}><ProgressiveSetupPage/><Location/></MemoryRouter></ExecutionEnvironmentProvider></QueryClientProvider>);
  return client;
}
const operation=(state:AttendanceOperationReadiness['state'],action:AttendanceOperationReadiness['action']='view'):AttendanceOperationReadiness=>({actor_user_id:'owner',state,action,
  scope:{kind:'occurrence',id:'exact-occurrence',date:'2026-10-24'},source_revision:2,register_revision:1,evaluated_at:'2026-10-21T09:00:00Z',starts_at:'2026-10-24T09:00:00Z',requires_recheck:true});
const attendanceDestination='/areas/attendance/registers?date=2026-10-24&occurrence_id=exact-occurrence';
beforeEach(()=>{
  vi.clearAllMocks();
  setup={school_id:'school-1',working_now:[attendance],useful_next:[timetable],available_anytime:[gate],options:{classes:[],students:[],staff:[{id:'owner',label:'Account owner'},{id:'colleague',label:'Sam Patel'}],gates:[]}};
  vi.mocked(apiFetch).mockImplementation((path,options)=>{
    if(path==='/api/v1/onboarding/workspace/'&&!options)return Promise.resolve(workspace);
    if(path==='/api/v1/schools/school-1/get-started/'&&!options)return Promise.resolve(setup);
    if(path==='/api/v1/onboarding/resume/'&&options?.method==='PATCH')return Promise.resolve({});
    return Promise.reject(new Error(`Unexpected request: ${path}`));
  });
});
afterEach(cleanup);
describe('focused progressive setup presentation',()=>{
  it.each([
    ['ready_to_record','record_charge','Choose people or a group. No class or term needed.'],
    ['charge_recorded','view','Charge recorded · follow payments and receipts.'],
    ['unavailable','unavailable','Review your current Finance access.'],
  ] as const)('opens Fees %s without overwriting an exact charge or implying money received',async(state,action,description)=>{
    const destination=state==='charge_recorded'?'/areas/fees/ledger?person_id=person-1&invoice_id=invoice-1':'/areas/fees/ledger';
    const operation:FeesOperationReadiness={actor_user_id:'owner',environment_namespace_id:'live:school-1',state,action,
      scope:null,source_revision:null,evaluated_at:'2026-10-23T09:00:00Z',requires_recheck:true,destination};
    setup.useful_next=[{capability:'fees',label:'Fees & receipts',status:'needs_setup',destination,setup_path:'/more/setup/capabilities?task=fees',counts:{},missing:[],fees_operation:operation}];
    show();
    const tile=within(await screen.findByRole('region',{name:'Useful next'})).getByRole('link',{name:/Fees & receipts/});
    expect(tile).toHaveTextContent(description);expect(tile).toHaveAttribute('href',destination);
    cleanup();show('/more/setup/capabilities?task=fees');
    await waitFor(()=>expect(screen.getByTestId('setup-location')).toHaveTextContent(destination));
    expect(vi.mocked(apiFetch).mock.calls.some(([path,options])=>path==='/api/v1/onboarding/resume/'&&options?.method==='PATCH')).toBe(false);
    expect(vi.mocked(apiFetch).mock.calls.some(([,options])=>options?.method==='POST')).toBe(false);
  });
  it('opens the exact recorded fee collection without choosing its first person or posting on mount',async()=>{
    const destination='/areas/fees/ledger?batch_id=batch-1';
    const operation:FeesOperationReadiness={actor_user_id:'owner',environment_namespace_id:'live:school-1',state:'charge_recorded',action:'view',
      scope:{kind:'batch',id:'batch-1',person_count:25},source_revision:1,evaluated_at:'2026-10-23T09:00:00Z',requires_recheck:true,destination};
    setup.working_now=[{capability:'fees',label:'Fees & receipts',status:'working',destination,setup_path:'/more/setup/capabilities?task=fees',counts:{},missing:[],fees_operation:operation}];
    show();
    expect(await screen.findByText('Charges recorded · follow payments and receipts.')).toBeVisible();
    const tile=screen.getByRole('link',{name:/Fees & receipts/});
    expect(tile).toHaveAttribute('href',destination);
    cleanup();show('/more/setup/capabilities?task=fees');
    await waitFor(()=>expect(screen.getByTestId('setup-location')).toHaveTextContent(destination));
    expect(vi.mocked(apiFetch).mock.calls.some(([,options])=>options?.method==='POST'||options?.method==='PATCH')).toBe(false);
  });
  it('hands Assignments to its source-owned hub without replacing an exact continuation on mount',async()=>{
    setup.useful_next=[{capability:'assignments',label:'Assignments',status:'needs_setup',destination:'/areas/messages/assignments',setup_path:'/more/setup/capabilities?task=assignments',counts:{},missing:[]}];
    show('/more/setup/capabilities?task=assignments');
    await waitFor(()=>expect(screen.getByTestId('setup-location')).toHaveTextContent('/areas/messages/assignments'));
    expect(vi.mocked(apiFetch).mock.calls.some(([path,options])=>path==='/api/v1/onboarding/resume/'&&options?.method==='PATCH')).toBe(false);
    expect(vi.mocked(apiFetch).mock.calls.some(([,options])=>options?.method==='POST')).toBe(false);
    cleanup();show();
    const tile=within(await screen.findByRole('region',{name:'Useful next'})).getByRole('link',{name:/Assignments/});
    expect(tile).toHaveAttribute('href','/areas/messages/assignments');
  });
  it.each([
    ['requires_setup','unavailable','Start with one learning group and its people.'],
    ['ready_to_create','create','Choose a group to prepare your first assignment.'],
    ['draft','continue','Draft saved · not yet shared with learners.'],
    ['published','view','Published · follow submissions and feedback.'],
    ['unavailable','unavailable','Review your current assignment responsibility.'],
  ] as const)('shows actor-owned Assignment %s as source state, not a campus-wide count',async(state,action,description)=>{
    const assignmentsOperation:AssignmentsOperationReadiness={actor_user_id:'owner',environment_namespace_id:'live:school-1',state,action,
      scope:null,source_revision:null,evaluated_at:'2026-10-23T09:00:00Z',requires_recheck:true,destination:'/areas/messages/assignments'};
    setup.useful_next=[{capability:'assignments',label:'Assignments',status:'needs_setup',destination:'/areas/messages/assignments',setup_path:'/more/setup/capabilities?task=assignments',counts:{},missing:[],assignments_operation:assignmentsOperation}];
    show();
    const tile=within(await screen.findByRole('region',{name:'Useful next'})).getByRole('link',{name:/Assignments/});
    expect(tile).toHaveTextContent(description);expect(tile).toHaveAttribute('href','/areas/messages/assignments');
  });
  it.each([
    ['ready_to_create','create','Schedule one activity. Attendance is optional.','Schedule an activity'],
    ['draft','continue','Draft saved · not yet on the timetable.','Continue your draft'],
    ['published','view','Published · view the dated schedule.','View scheduled activity'],
    ['historical','view','Past activity · retained with its history.','View activity history'],
    ['cancelled','view','Cancelled · earlier records are retained.','View cancelled activity'],
    ['superseded','view','Replaced · review the saved timetable version.','View timetable version'],
    ['unavailable','unavailable','Your saved activity is unavailable. Review your current access.','Review timetable access'],
  ] as const)('presents Timetable %s with its exact source and no duplicate setup command',async(state,action,description,label)=>{
    const source='11000000-0000-4000-8000-000000000001';
    const destination=state==='ready_to_create'?'/areas/timetable/planning?create=activity':`/areas/timetable/planning?plan=${source}&plan_revision=2&date=2026-11-03`;
    const timetableOperation:TimetableOperationReadiness={actor_user_id:'owner',environment_namespace_id:'live:school-1',state,action,
      scope:state==='ready_to_create'?null:{kind:'plan',id:source,date:'2026-11-03'},source_revision:state==='ready_to_create'?null:2,
      evaluated_at:'2026-10-23T09:00:00Z',requires_recheck:true};
    setup.useful_next=[{...timetable,destination,missing:[],timetable_operation:timetableOperation}];
    show('/more/setup/capabilities?task=timetable');
    expect(await screen.findByRole('link',{name:label})).toHaveAttribute('href',destination);
    expect(screen.getByText(description)).toBeVisible();
    expect(vi.mocked(apiFetch).mock.calls.some(([path,options])=>path==='/api/v1/onboarding/resume/'&&options?.method==='PATCH')).toBe(false);
    expect(vi.mocked(apiFetch).mock.calls.some(([,options])=>options?.method==='POST')).toBe(false);
    cleanup();
    show();
    const tile=within(await screen.findByRole('region',{name:'Useful next'})).getByRole('link',{name:/Timetable & classes/});
    expect(tile).toHaveTextContent(description);
    expect(tile).toHaveAttribute('href',action==='unavailable'?'/more/setup/capabilities?task=timetable':destination);
  });
  it.each([
    ['opens_later','record','Scheduled · opens when the activity starts.','View upcoming register'],
    ['waiting_for_recorder','view','Waiting for attendance to be submitted.','View register'],
    ['waiting_for_review','view','Submitted · awaiting review.','View submitted register'],
    ['automatic_pending','view','Submitted · automatic finalization scheduled.','View register'],
    ['complete','view','Final · open the saved register.','View final register'],
  ] as const)('keeps %s clear on the existing tile and action without changing its exact source',async(state,action,description,label)=>{
    setup.working_now=[{...attendance,destination:attendanceDestination,operation:operation(state,action)}];
    show();
    const tile=within(await screen.findByRole('region',{name:'Working now'})).getByRole('link',{name:/Attendance/});
    expect(tile).toHaveTextContent(description);
    expect(tile).toHaveAttribute('href',attendanceDestination);
    cleanup();
    show('/more/setup/capabilities?task=attendance');
    expect(await screen.findByRole('link',{name:label})).toHaveAttribute('href',attendanceDestination);
    expect(screen.getByText(description)).toBeVisible();
    expect(screen.queryByRole('button',{name:/Record|Submit|Finalize/})).not.toBeInTheDocument();
  });

  it('opens the exact review register with keyboard navigation rather than another setup or submit action',async()=>{
    setup.working_now=[{...attendance,destination:attendanceDestination,operation:operation('ready','review')}];
    show('/more/setup/capabilities?task=attendance');
    const link=await screen.findByRole('link',{name:'Review register'});
    expect(link).toHaveAttribute('href',attendanceDestination);
    expect(screen.getByText('Submitted · ready for your review.')).toBeVisible();
    await userEvent.tab();
    expect(link).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByTestId('setup-location')).toHaveTextContent(attendanceDestination);
    expect(vi.mocked(apiFetch).mock.calls.some(([,options])=>options?.method==='POST')).toBe(false);
  });

  it('partitions operation discovery by actor and selected world without writing the Live owner resume in Simulation',async()=>{
    setup.working_now=[{...attendance,destination:attendanceDestination,operation:operation('ready','review')}];
    const client=show('/more/setup/capabilities?task=attendance',{mode:'simulation',namespaceId:'selected-world',runId:'selected-run',worldRevision:7,
      virtualClock:{now:'2026-10-21T09:00:00Z',timeZone:'UTC'}});
    expect(await screen.findByRole('link',{name:'Review register'})).toHaveAttribute('href',attendanceDestination);
    expect(client.getQueryCache().findAll({queryKey:['onboarding','setup']}).filter(query=>query.state.data!==undefined).map(query=>query.queryKey))
      .toEqual([['onboarding','setup','school-1','owner','simulation','selected-world','selected-run',7]]);
    expect(vi.mocked(apiFetch).mock.calls.some(([path,options])=>path==='/api/v1/onboarding/resume/'&&options?.method==='PATCH')).toBe(false);
  });

  it('keeps shared feature SVGs outside utility-only hiding and colour rules',()=>{
    const css=readFileSync(join(process.cwd(),'src/features/onboarding/progressive-setup-presentation.css'),'utf8');
    // ProductIcon is an SVG too. A bare child-svg selector silently includes
    // the identity artwork, rather than only its neighbouring utility chevron.
    expect(css).not.toMatch(/\.progressive-setup__tile-icon\s*>\s*svg\s*\{[^}]*\b(?:display|color)\s*:/);
  });
  it('leads with real working tools and next steps while keeping optional campus details together',async()=>{
    show();
    expect(await screen.findByRole('heading',{level:1,name:'Your campus setup'})).toBeVisible();
    const working=screen.getByRole('region',{name:'Working now'});
    expect(within(working).getByRole('link',{name:/Attendance/})).toHaveAttribute('href','/areas/attendance/registers');
    const next=screen.getByRole('region',{name:'Useful next'});
    expect(within(next).getByRole('link',{name:/Timetable & classes/})).toHaveAttribute('href','/more/setup/capabilities?task=timetable');
    const options=screen.getByText('More campus options',{selector:'summary'}).closest('details');
    expect(options).not.toHaveAttribute('open');
    expect(screen.getByRole('link',{name:'Set up later'})).toHaveAttribute('href','/today');
    await userEvent.click(screen.getByText('More campus options',{selector:'summary'}));
    expect(screen.getByRole('region',{name:'Available anytime'})).toBeVisible();
    expect(screen.getByRole('link',{name:'Change my starting points'})).toHaveAttribute('href','/onboarding/start');
    expect(screen.getByRole('link',{name:/Organisation verification/})).toHaveAttribute('href','/more/verification');
    expect(screen.queryByRole('textbox',{name:'Campus name'})).not.toBeInTheDocument();
  });

  it('offers one authoritative first prerequisite rather than duplicating its row and action',async()=>{
    show('/more/setup/capabilities?task=timetable');
    expect(await screen.findByRole('heading',{level:1,name:'Timetable & classes'})).toBeVisible();
    const first=screen.getByRole('link',{name:'Continue to People and groups'});
    expect(first).toHaveAttribute('href','/areas/people/participants');
    expect(first).toHaveTextContent(/^Continue$/);
    expect(screen.getByRole('heading',{level:2,name:'People and groups'})).toBeVisible();
    expect(screen.queryByRole('heading',{name:'Next step'})).not.toBeInTheDocument();
    expect(screen.queryByText('Set up only what this task needs. Existing people and records are reused.')).not.toBeInTheDocument();
    expect(screen.getAllByRole('link').filter(link=>link.getAttribute('href')==='/areas/people/participants')).toHaveLength(1);
    expect(screen.getByText('Choose the people and groups taking part.')).toBeVisible();
    expect(within(screen.getByRole('region',{name:'Other setup requirements'})).getByRole('link',{name:/Schedule/})).toHaveAttribute('href','/areas/timetable/planning');
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/onboarding/resume/',{method:'PATCH',body:JSON.stringify({step:'first_use',goal:'timetable',path:'/more/setup/capabilities?task=timetable'})});
    expect(vi.mocked(apiFetch).mock.calls.some(([,options])=>options?.method==='POST')).toBe(false);
  });

  it('focuses the new task after opening a lower optional tile without stealing focus while editing',async()=>{
    show();
    await screen.findByRole('heading',{name:'Your campus setup'});
    await userEvent.click(screen.getByText('More campus options',{selector:'summary'}));
    await userEvent.click(within(screen.getByRole('region',{name:'Available anytime'})).getByRole('link',{name:/Gate entry & exit/}));
    const heading=await screen.findByRole('heading',{level:1,name:'Set up entry & exit'});
    expect(heading).toHaveFocus();
    const name=screen.getByRole('textbox',{name:/^Entry point name/});
    await userEvent.clear(name);await userEvent.type(name,'Reception');
    expect(name).toHaveFocus();
    expect(name).toHaveValue('Reception');
    expect(screen.getByRole('group',{name:'Operator responsibility'})).toBeVisible();
    expect(vi.mocked(apiFetch).mock.calls.some(([,options])=>options?.method==='POST')).toBe(false);
  });

  it('requires renewed self confirmation after changing operators and preserves the exact owning request',async()=>{
    vi.mocked(apiFetch).mockImplementation((path,options)=>{
      if(path==='/api/v1/onboarding/workspace/')return Promise.resolve(workspace);
      if(path==='/api/v1/schools/school-1/get-started/')return Promise.resolve(setup);
      if(path.endsWith('/get-started/gate/')&&options?.method==='POST')return Promise.reject(new Error('Review the entry-point details and retry.'));
      return Promise.resolve({});
    });
    show('/more/setup/capabilities?task=gate');
    await userEvent.click(await screen.findByRole('checkbox',{name:/I will operate this entry point/}));
    await userEvent.selectOptions(screen.getByRole('combobox',{name:'Who will operate it?'}),'colleague');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByText('Sam Patel',{selector:'strong'}).closest('p')).toHaveTextContent('Sam Patel will receive gatekeeper responsibility.');
    await userEvent.selectOptions(screen.getByRole('combobox',{name:'Who will operate it?'}),'self');
    const confirmation=screen.getByRole('checkbox',{name:/I will operate this entry point/});
    expect(confirmation).not.toBeChecked();
    await userEvent.click(screen.getByRole('button',{name:'Create entry point'}));
    expect(vi.mocked(apiFetch).mock.calls.some(([path])=>path.endsWith('/get-started/gate/'))).toBe(false);
    await userEvent.click(confirmation);
    await userEvent.click(screen.getByRole('button',{name:'Create entry point'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Review the entry-point details');
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/schools/school-1/get-started/gate/',{method:'POST',body:JSON.stringify({gate_name:'Main entrance',operator:{kind:'current_user',confirm:true}})});
    expect(confirmation).toBeChecked();
  });

  it('keeps the minimum Gate choices visible and discloses only optional visitor guidance',async()=>{
    show('/more/setup/capabilities?task=gate');
    await screen.findByRole('heading',{level:1,name:'Set up entry & exit'});
    expect(screen.getByRole('textbox',{name:'Entry point name'})).toHaveValue('Main entrance');
    expect(screen.getByRole('combobox',{name:'Who will operate it?'})).toHaveValue('self');
    const consent=screen.getByRole('checkbox',{name:'I will operate this entry point and record arrivals and departures using my administrator access.'});
    expect(consent).toBeVisible();expect(consent).toBeRequired();expect(consent).not.toBeChecked();
    const help=screen.getByText('Visitor records').closest('summary');
    expect(help).not.toBeNull();
    const details=help!.closest('details');
    expect(details).not.toHaveAttribute('open');
    expect(within(help!).getByText('Visitor records')).toBeVisible();
    await userEvent.click(help!);
    expect(details).toHaveAttribute('open');
    expect(screen.getByText('Visitors don’t need an app account. No class or student record is required.')).toBeVisible();
    expect(vi.mocked(apiFetch).mock.calls.some(([,options])=>options?.method==='POST')).toBe(false);
  });

  it('keeps a new entry-point name required and retains it after a refused staff assignment',async()=>{
    vi.mocked(apiFetch).mockImplementation((path,options)=>{
      if(path==='/api/v1/onboarding/workspace/')return Promise.resolve(workspace);
      if(path==='/api/v1/schools/school-1/get-started/')return Promise.resolve(setup);
      if(path.endsWith('/get-started/gate/')&&options?.method==='POST')return Promise.reject(new Error('That responsibility could not be assigned.'));
      return Promise.resolve({});
    });
    show('/more/setup/capabilities?task=gate');
    const name=await screen.findByRole('textbox',{name:'Entry point name'});
    await userEvent.selectOptions(screen.getByRole('combobox',{name:'Who will operate it?'}),'colleague');
    await userEvent.clear(name);
    await userEvent.click(screen.getByRole('button',{name:'Create entry point'}));
    expect(name).toBeInvalid();
    expect(vi.mocked(apiFetch).mock.calls.some(([path])=>path.endsWith('/get-started/gate/'))).toBe(false);
    await userEvent.type(name,'Reception');
    await userEvent.click(screen.getByRole('button',{name:'Create entry point'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('That responsibility could not be assigned.');
    expect(name).toHaveValue('Reception');
    expect(screen.getByRole('combobox',{name:'Who will operate it?'})).toHaveValue('colleague');
    expect(screen.getByText('Sam Patel',{selector:'strong'})).toBeVisible();
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/schools/school-1/get-started/gate/',{method:'POST',body:JSON.stringify({gate_name:'Reception',operator:{kind:'staff',user_id:'colleague'}})});
  });

  it('keeps all Gate navigation locked until an explicit existing-entry/staff request is accepted',async()=>{
    let accept:((value:SetupResult)=>void)|undefined;
    setup={...setup,options:{...setup.options,gates:[{id:'existing-gate',label:'Reception'}]}};
    vi.mocked(apiFetch).mockImplementation((path,options)=>{
      if(path==='/api/v1/onboarding/workspace/')return Promise.resolve(workspace);
      if(path==='/api/v1/schools/school-1/get-started/')return Promise.resolve(setup);
      if(path.endsWith('/get-started/gate/')&&options?.method==='POST')return new Promise<SetupResult>(resolve=>{accept=resolve;});
      return Promise.resolve({});
    });
    show('/more/setup/capabilities?task=gate');
    await userEvent.selectOptions(await screen.findByRole('combobox',{name:'Entry point'}),'existing-gate');
    await userEvent.selectOptions(screen.getByRole('combobox',{name:'Who will operate it?'}),'colleague');
    expect(screen.queryByRole('textbox',{name:/Entry point name/})).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button',{name:'Set up entry point'}));
    expect(screen.getByRole('button',{name:'Back'})).toBeDisabled();
    expect(screen.getByRole('combobox',{name:'Entry point'})).toBeDisabled();
    expect(screen.getByRole('combobox',{name:'Who will operate it?'})).toBeDisabled();
    expect(screen.getByRole('link',{name:'Set up later'})).toHaveAttribute('aria-disabled','true');
    await userEvent.click(screen.getByRole('link',{name:'Done'}));
    await userEvent.click(screen.getByRole('link',{name:'Set up later'}));
    expect(screen.getByTestId('setup-location')).toHaveTextContent('/more/setup/capabilities?task=gate');
    expect(screen.queryByRole('heading',{name:'Your entry point is ready.'})).not.toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/schools/school-1/get-started/gate/',{method:'POST',body:JSON.stringify({existing_gate_id:'existing-gate',operator:{kind:'staff',user_id:'colleague'}})});
    accept?.({capability:'gate',status:'working',readiness:{...gate,status:'working'},destination:'/areas/in-out/operate?entry=existing-gate',notes:['The operator has an explicit, reviewable one-year entry-point responsibility.'],created:{},reused:{gate:true}});
    const ready=await screen.findByRole('heading',{level:1,name:'Your entry point is ready.'});
    await waitFor(()=>expect(ready).toHaveFocus());
    expect(screen.getByText('The operator has an explicit, reviewable one-year entry-point responsibility.')).toBeVisible();
    expect(screen.getByRole('link',{name:'Open gate register'})).toHaveAttribute('href','/areas/in-out/operate?entry=existing-gate');
    expect(auth.refresh).toHaveBeenCalled();
  });

  it('retains optional naming input and a clear retry without claiming a failed save is complete',async()=>{
    vi.mocked(apiFetch).mockImplementation((path,options)=>{
      if(path==='/api/v1/onboarding/workspace/')return Promise.resolve(workspace);
      if(path==='/api/v1/schools/school-1/get-started/')return Promise.resolve(setup);
      if(path==='/api/v1/onboarding/workspace-profile/'&&options?.method==='PATCH')return Promise.reject(new Error('The name could not be saved.'));
      return Promise.resolve({});
    });
    show();await screen.findByRole('heading',{name:'Your campus setup'});
    await userEvent.click(screen.getByText('More campus options',{selector:'summary'}));
    await userEvent.click(screen.getByRole('button',{name:'Add your campus name'}));
    await userEvent.type(screen.getByRole('textbox',{name:'Campus name'}),'Lotus learning campus');
    await userEvent.click(screen.getByRole('button',{name:'Save name'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('The name could not be saved.');
    expect(screen.getByRole('textbox',{name:'Campus name'})).toHaveValue('Lotus learning campus');
    expect(screen.getByRole('button',{name:'Save name'})).toBeEnabled();
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/onboarding/workspace-profile/',{method:'PATCH',body:JSON.stringify({display_name:'Lotus learning campus'})});
  });

  it('locks hub and frame navigation while a campus-name save is pending and retains work after failure',async()=>{
    let refuse:((reason:Error)=>void)|undefined;
    vi.mocked(apiFetch).mockImplementation((path,options)=>{
      if(path==='/api/v1/onboarding/workspace/')return Promise.resolve(workspace);
      if(path==='/api/v1/schools/school-1/get-started/')return Promise.resolve(setup);
      if(path==='/api/v1/onboarding/workspace-profile/'&&options?.method==='PATCH')return new Promise((_resolve,reject)=>{refuse=reject;});
      return Promise.resolve({});
    });
    show();await screen.findByRole('heading',{name:'Your campus setup'});
    await userEvent.click(screen.getByText('More campus options',{selector:'summary'}));
    await userEvent.click(screen.getByRole('button',{name:'Add your campus name'}));
    const name=screen.getByRole('textbox',{name:'Campus name'});
    await userEvent.type(name,'Lotus campus');
    await userEvent.click(screen.getByRole('button',{name:'Save name'}));
    expect(name).toBeDisabled();
    const targets=[
      within(screen.getByRole('region',{name:'Working now'})).getByRole('link',{name:/Attendance/}),
      within(screen.getByRole('region',{name:'Useful next'})).getByRole('link',{name:/Timetable/}),
      within(screen.getByRole('region',{name:'Available anytime'})).getByRole('link',{name:/Gate/}),
      screen.getByRole('link',{name:'Change my starting points'}),screen.getByRole('link',{name:/Organisation verification/}),
      screen.getByRole('link',{name:'Set up later'}),screen.getByRole('link',{name:'Done'}),
    ];
    for(const link of targets){expect(link).toHaveAttribute('aria-disabled','true');await userEvent.click(link);}
    expect(screen.getByTestId('setup-location')).toHaveTextContent(/^\/more\/setup\/capabilities$/);
    refuse?.(new Error('Name save is unavailable.'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Name save is unavailable.');
    expect(name).toBeEnabled();expect(name).toHaveValue('Lotus campus');
    for(const link of targets)expect(link).not.toHaveAttribute('aria-disabled');
  });
});
