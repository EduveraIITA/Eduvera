import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {CalendarConnections} from './CalendarConnections';
import {ExecutionEnvironmentProvider} from '../simulation/ExecutionEnvironmentContext';
import {createSimulationExecutionEnvironment} from '../simulation/executionEnvironment';

const {apiFetchMock,writeTextMock}=vi.hoisted(()=>({apiFetchMock:vi.fn(),writeTextMock:vi.fn()}));
vi.mock('../../lib/api',()=>({apiFetch:apiFetchMock}));

beforeEach(()=>{apiFetchMock.mockReset();writeTextMock.mockReset().mockResolvedValue(undefined);Object.assign(navigator,{clipboard:{writeText:writeTextMock}});});
afterEach(cleanup);

function view(simulation=false){
  const content=<CalendarConnections audience="student"/>;
  const environment=createSimulationExecutionEnvironment({namespaceId:'scenario:scenario-1:run:run-1',scenarioId:'scenario-1',runId:'run-1',institutionId:'school-1',sourceSnapshotAt:'2026-10-19T00:00:00.000Z',virtualClock:{now:'2026-10-20T00:00:00.000Z',timeZone:'UTC'}});
  return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>{simulation?<ExecutionEnvironmentProvider environment={environment}>{content}</ExecutionEnvironmentProvider>:content}</QueryClientProvider>);
}

it('creates a private subscription and only then reveals its one-time link actions',async()=>{
  apiFetchMock.mockImplementation((path:string,init?:RequestInit)=>{
    if(path.startsWith('/api/v1/calendar-connections?'))return Promise.resolve({scope:{portal:'student',student_id:'student-1',calendar_name:'Cambridge · Aarav'},subscription:null});
    if(path==='/api/v1/calendar-connections/subscriptions'&&init?.method==='POST')return Promise.resolve({id:'subscription-1',token_hint:'abc123',created_at:'2026-10-14T00:00:00Z',last_fetched_at:null,revision:1,calendar_name:'Cambridge · Aarav',feed_url:'https://example.test/feed.ics'});
    return Promise.resolve({});
  });
  view();expect(await screen.findByText('Connect your calendar')).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:/copy link/i})).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button',{name:'Subscribe'}));
  expect(await screen.findByText('Private link created')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button',{name:'Copy link'}));
  expect(writeTextMock).toHaveBeenCalledWith('https://example.test/feed.ics');
});

it('requires confirmation before revoking an active subscription',async()=>{
  apiFetchMock.mockImplementation((path:string,init?:RequestInit)=>{
    if(path.startsWith('/api/v1/calendar-connections?'))return Promise.resolve({scope:{portal:'student',student_id:'student-1',calendar_name:'Cambridge · Aarav'},subscription:{id:'subscription-1',token_hint:'abc123',created_at:'2026-10-14T00:00:00Z',last_fetched_at:null,revision:1}});
    if(path==='/api/v1/calendar-connections/subscriptions/subscription-1'&&init?.method==='DELETE')return Promise.resolve({id:'subscription-1',active:false});
    return Promise.resolve({});
  });
  view();expect(await screen.findByText('Subscribed calendar ready')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button',{name:'Disconnect'}));
  expect(apiFetchMock).not.toHaveBeenCalledWith('/api/v1/calendar-connections/subscriptions/subscription-1',{method:'DELETE'});
  await userEvent.click(screen.getByRole('button',{name:'Disconnect'}));
  await waitFor(()=>expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/calendar-connections/subscriptions/subscription-1',{method:'DELETE'}));
});

it('presents Simulation calendars as authenticated run-local previews without a public subscription token',async()=>{
  apiFetchMock.mockImplementation((path:string,init?:RequestInit)=>{
    if(path.startsWith('/api/v1/calendar-connections?'))return Promise.resolve({scope:{portal:'student',student_id:'student-1',calendar_name:'Your campus · Aarav'},subscription:null,evidence_mode:'simulation',external_subscription:false});
    if(path==='/api/v1/calendar-connections/subscriptions'&&init?.method==='POST')return Promise.resolve({id:'preview-1',token_hint:'simulation',created_at:'2026-10-19T00:00:00Z',last_fetched_at:null,revision:1,calendar_name:'Simulation · Your campus · Aarav',feed_url:'/api/v1/calendar-connections/subscriptions/preview-1/preview.ics',evidence_mode:'simulation',external_subscription:false});
    return Promise.resolve({});
  });
  view(true);
  expect(await screen.findByText('Run-local calendar preview')).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Subscribe'})).not.toBeInTheDocument();
  await userEvent.click(await screen.findByRole('button',{name:'Create preview'}));
  expect(await screen.findByText('Run-local preview created')).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Open/download preview'})).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:/copy link/i})).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:/open calendar app/i})).not.toBeInTheDocument();
  expect(writeTextMock).not.toHaveBeenCalled();
});
