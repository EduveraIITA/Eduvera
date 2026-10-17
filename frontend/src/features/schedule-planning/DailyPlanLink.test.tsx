import { cleanup,render,screen } from '@testing-library/react';
import { afterEach,expect,it,vi } from 'vitest';
import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { ScheduleSettingsRoute } from './ScheduleSettingsRoute';
import PrincipalDayPlanPage from '../day-plans/PrincipalDayPlanPage';
import { startDayPlan } from '../day-plans/api';
vi.mock('../../pages/operations/OperationsShell',()=>({OperationsShell:({children,title}:{children:React.ReactNode;title:string})=><main><h1>{title}</h1>{children}</main>}));
vi.mock('../auth/AuthContext',()=>({useAuth:()=>({memberships:[{role:'admin',school_id:'s1'}]}),useOptionalAuth:()=>null}));
vi.mock('../timetable/TimetableNavigator',async original=>({...await original<typeof import('../timetable/TimetableNavigator')>(),TimetableNavigator:()=>null}));
vi.mock('./api',()=>({getScheduleSettings:()=>Promise.resolve({school_id:'s1',school_date:'2026-10-08',selected_term_id:'t1',terms:[{id:'t1',name:'Term 1',academic_year:'2026-27',starts_on:'2026-04-01',ends_on:'2027-03-31'}],classes:[{id:'c1',name:'Class 7A'}],versions:[],slots:[],calendar_exceptions:[],subjects:[],coverage:[]})}));
vi.mock('../day-plans/api',()=>({getPlanOptions:()=>Promise.resolve({classes:[{id:'c1',name:'Class 7A',plan_id:null}],context:{today:'2026-10-08',is_instructional:true},schedule:[],teachers:[],subjects:[]}),getAdminSummary:()=>Promise.resolve({days:[]}),getDayPlan:vi.fn(),sharedDayPeriods:()=>[],startDayPlan:vi.fn().mockRejectedValue(new Error('Test retry'))}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
function mount(ui:React.ReactNode,url:string){return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter initialEntries={[url]}>{ui}</MemoryRouter></QueryClientProvider>);}
it('links to the day schedule without a separate editing mode',async()=>{
  mount(<ScheduleSettingsRoute/>,'/principal/timetable/weekly?class=c1&date=2026-10-12&view=year');
  const link=await screen.findByRole('link',{name:/View day schedule/});
  const url=new URL(link.getAttribute('href')!,'http://localhost');
  expect(url.searchParams.has('mode')).toBe(false);expect(url.searchParams.get('view')).toBe('day');
  expect(url.searchParams.get('class')).toBe('c1');expect(url.searchParams.get('date')).toBe('2026-10-12');
});
it('redirects the old class editor to the unified calendar and preserves its scope',async()=>{
  function CalendarLocation(){const location=useLocation();return <output>{location.pathname}{location.search}</output>;}
  mount(<Routes><Route path="/principal/timetable/weekly" element={<ScheduleSettingsRoute/>}/><Route path="/principal/timetable" element={<CalendarLocation/>}/></Routes>,'/principal/timetable/weekly?settings=pattern&class=c1&date=2026-10-12&view=year');
  const target=await screen.findByText('/principal/timetable?class=c1&date=2026-10-12&view=week');
  expect(target).toHaveTextContent('/principal/timetable?class=c1&date=2026-10-12&view=week');
  expect(screen.queryByRole('heading',{name:'Class timetable'})).not.toBeInTheDocument();
});
it('keeps academic settings free of a second class timetable editor',async()=>{
  mount(<ScheduleSettingsRoute/>,'/principal/timetable/weekly');
  await screen.findByRole('button',{name:/Prepare next year/});
  expect(screen.queryByRole('heading',{name:'Class timetables'})).not.toBeInTheDocument();
  expect(screen.getByRole('button',{name:/Working days & holidays/})).toBeVisible();
});
it('opens editing from the ordinary schedule menu without writing on navigation',async()=>{
  mount(<PrincipalDayPlanPage/>,'/principal/timetable?date=2026-10-12&class=c1');
  expect(screen.getByRole('heading',{name:'Timetable'})).toBeVisible();
  await screen.findByLabelText('Schedule actions');
  expect(screen.queryByText('Change this day')).not.toBeInTheDocument();
  await userEvent.click(screen.getByLabelText('Schedule actions'));
  const prepare=await screen.findByRole('button',{name:'Edit day schedule'});
  expect(prepare.querySelector('svg')).toHaveAttribute('aria-hidden','true');
  expect(prepare).toBeVisible();expect(startDayPlan).not.toHaveBeenCalled();
  await userEvent.click(prepare);
  expect(startDayPlan).toHaveBeenCalledWith(expect.objectContaining({school_id:'s1',class_section_id:'c1',date:'2026-10-12'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Test retry');
});
it('keeps historical dates read-only',async()=>{
  mount(<PrincipalDayPlanPage/>,'/principal/timetable?mode=edit&date=2026-10-01&class=c1');
  await screen.findByRole('heading',{name:'Day schedule'});
  expect(screen.queryByRole('button',{name:'Edit day schedule',hidden:true})).not.toBeInTheDocument();
});
