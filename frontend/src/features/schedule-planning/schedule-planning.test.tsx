import { cleanup,render,screen,fireEvent,waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach,describe,it,expect,vi } from 'vitest';
import { TimetableDraft } from './TimetableDraft';
import { YearForm } from './YearForm';
import { buildDayTimings } from './timings';
import { scheduleCommand,cleanPeriod,type ScheduleScreen,type ScheduleVersion } from './api';
vi.mock('./api',async original=>({...await original<typeof import('./api')>(),scheduleCommand:vi.fn().mockResolvedValue({id:'v1'})}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
const data:ScheduleScreen={school_id:'s1',school_date:'2026-10-08',selected_term_id:'t1',terms:[{id:'t1',academic_year:'2026-27',name:'Term 1',starts_on:'2026-08-01',ends_on:'2027-03-31',is_active:true}],classes:[{id:'c1',name:'Class 7A',grade:'7',section:'A',room_number:'204'}],subjects:[{id:'sub1',name:'English',short_name:'Eng',code:'ENG',color:'#444'}],teachers:[{id:'teacher1',name:'Kavita Mehta'}],slots:[],conflicts:[],coverage:[],calendar_exceptions:[],versions:[]};
const version:ScheduleVersion={id:'v1',class_section_id:'c1',term_id:'t1',starts_on:'2026-11-01',ends_on:'2027-03-31',state:'draft',baseline:false,revision:2,periods:[{id:'p1',weekday:1,period_number:1,starts_at:'09:00',ends_at:'09:45',title:'English',slot_type:'class',subject_id:'sub1',teacher_user_id:'teacher1',room:'204'}]};
function draft(v?:ScheduleVersion){return render(<TimetableDraft data={{...data,versions:v?[v]:[]}} selectedClass={data.classes[0]!} refresh={vi.fn().mockResolvedValue(undefined)}/>);}
describe('schedule planning UI',()=>{
  it('prepares a draft with future dates, never silently publishes',async()=>{draft();await userEvent.click(screen.getByRole('button',{name:'Prepare draft'}));await waitFor(()=>expect(scheduleCommand).toHaveBeenCalledWith('drafts','s1',expect.objectContaining({starts_on:'2026-10-09',ends_on:'2027-03-31',class_section_id:'c1'})));expect(screen.queryByRole('button',{name:'Confirm and publish'})).not.toBeInTheDocument();});
  it('offers bounded dates with automatic return to the previous pattern',async()=>{draft();await userEvent.selectOptions(screen.getByLabelText('Applies'),'range');expect(screen.getByLabelText('Ends')).toBeVisible();expect(screen.getByText(/previous repeating timetable resumes/)).toBeVisible();});
  it('requires confirmation before publication',async()=>{draft(version);await userEvent.click(screen.getByRole('button',{name:'Review & publish'}));expect(scheduleCommand).not.toHaveBeenCalled();expect(screen.getByText(/Affected staff and families/)).toBeVisible();await userEvent.click(screen.getByRole('button',{name:'Confirm and publish'}));await waitFor(()=>expect(scheduleCommand).toHaveBeenCalledWith('v1/publish','s1',{expected_revision:2}));});
  it('blocks publication with unassigned teaching periods',async()=>{draft({...version,periods:version.periods.map(p=>({...p,teacher_user_id:null}))});await userEvent.click(screen.getByRole('button',{name:'Review & publish'}));expect(screen.getByRole('button',{name:'Confirm and publish'})).toBeDisabled();expect(screen.getByRole('alert')).toHaveTextContent('Assign teachers');});
  it('keeps publication errors visible',async()=>{vi.mocked(scheduleCommand).mockRejectedValueOnce(new Error('Resolve the room clash.'));draft(version);await userEvent.click(screen.getByRole('button',{name:'Review & publish'}));await userEvent.click(screen.getByRole('button',{name:'Confirm and publish'}));expect(await screen.findByRole('alert')).toHaveTextContent('room clash');});
  it('shows published arrangements without edit controls',()=>{draft({...version,state:'published'});expect(screen.getByText('Published arrangements')).toBeVisible();expect(screen.queryByRole('button',{name:'Review & publish'})).not.toBeInTheDocument();});
  it('prepares a year without assuming enrollment or publication',async()=>{const save=vi.fn().mockResolvedValue(undefined);render(<YearForm data={data} onSave={save}/>);fireEvent.change(screen.getByLabelText('Academic year'),{target:{value:'2027-28'}});fireEvent.change(screen.getByLabelText('Starts'),{target:{value:'2027-04-01'}});fireEvent.change(screen.getByLabelText('Ends'),{target:{value:'2028-03-31'}});await userEvent.selectOptions(screen.getByLabelText('Reuse class structure'),'2026-27');await userEvent.click(screen.getByRole('button',{name:'Prepare year'}));expect(save).toHaveBeenCalledWith({academic_year:'2027-28',source_year:'2026-27',terms:[{name:'Term 1',starts_on:'2027-04-01',ends_on:'2028-03-31'}]});});
});
describe('automatic timings',()=>{
  const input={start:'08:00',count:6,minutes:45,breakAfter:3,breakMinutes:30,days:[1,2,3,4,5],room:'204'};
  it('creates the selected days and a correctly positioned break',()=>{const rows=buildDayTimings(input,()=>crypto.randomUUID());expect(rows).toHaveLength(35);expect(rows[3]).toMatchObject({title:'Break',starts_at:'10:15',ends_at:'10:45',slot_type:'break'});expect(rows[6]?.ends_at).toBe('13:00');expect(new Set(rows.map(p=>p.weekday))).toEqual(new Set([1,2,3,4,5]));});
  it('rejects a school day crossing midnight',()=>{expect(()=>buildDayTimings({...input,start:'23:00'},()=>crypto.randomUUID())).toThrow('midnight');});
  it('removes relational metadata before saving',()=>{expect(cleanPeriod({...version.periods[0]!,version_id:'v1'} as never)).not.toHaveProperty('version_id');});
});
