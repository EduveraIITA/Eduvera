import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {afterEach,describe,it,expect,vi} from "vitest";
import {ImportUpload} from "./ImportUpload";
import {ImportReview} from "./ImportReview";
import {ImportRowEditor} from "./ImportRowEditor";
import {stageImport,commitImport,cancelImport,updateImportRow,type ImportDetail,type ImportRow} from "./import-api";
import {searchGuardians} from "./api";
vi.mock('./import-api',async original=>({...await original<typeof import('./import-api')>(),stageImport:vi.fn(),commitImport:vi.fn(),cancelImport:vi.fn(),updateImportRow:vi.fn()}));
vi.mock('./api',()=>({searchGuardians:vi.fn()}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
const options=[{class_section_id:'class-a',term_id:'term-1',class_name:'Class 7A',term_name:'Term 1',starts_on:'2026-07-01',ends_on:'2026-12-31',today:'2026-09-15',next_roll:26}];
const row:ImportRow={row_number:2,values:{admission_number:'BULK-1',first_name:'Ishaan',last_name:'Deshmukh',date_of_birth:'2014-04-12',class:'7A',roll_number:'26',enrolled_on:'2026-09-15',guardian_key:'family-1',guardian_first_name:'Nandita',guardian_last_name:'Deshmukh',guardian_phone:'9000011001',guardian_email:'',relationship:'mother'},decision:'include',guardian_choice:{mode:'new'},errors:[],warnings:[],guardian_name:'Nandita Deshmukh',class_name:'7A'};
const fixture=():ImportDetail=>({id:'import-1',filename:'class-7a.csv',state:'draft',revision:1,row_count:1,created_at:'2026-09-15T12:00:00Z',expires_at:'2026-09-16T12:00:00Z',receipt:null,review:{rows:[structuredClone(row)],classes:[{id:'class-a',label:'7A',room:'204'}],term:{id:'term-1',name:'Term 1',today:'2026-09-15',starts_on:'2026-07-01',ends_on:'2026-12-31'},summary:{total:1,included:1,skipped:0,errors:0,warnings:0,new_guardians:1,existing_guardians:0,registers_reopened:0},validation_token:'token-1'}});
describe('Complete student import UI',()=>{
  it('offers the CSV template and uploads only when the user requests review',async()=>{
    const onUploaded=vi.fn();render(<ImportUpload schoolId="school-1" options={options} onUploaded={onUploaded}/>);const user=userEvent.setup();
    expect(screen.getByRole('link',{name:'CSV template'})).toHaveAttribute('href','/api/v1/people/imports/template?school_id=school-1');
    await user.click(screen.getByText('Or paste CSV data'));fireEvent.change(screen.getByLabelText('CSV data'),{target:{value:'header\nrow'}});expect(stageImport).not.toHaveBeenCalled();
    vi.mocked(stageImport).mockResolvedValue({id:'import-1'});await user.click(screen.getByRole('button',{name:'Upload & review'}));expect(stageImport).toHaveBeenCalledWith(expect.objectContaining({csv:'header\nrow',school_id:'school-1',term_id:'term-1'}));expect(onUploaded).toHaveBeenCalledWith('import-1');expect(commitImport).not.toHaveBeenCalled();
  });
  it('preserves the upload key after an interrupted response',async()=>{
    render(<ImportUpload schoolId="school-1" options={options} onUploaded={vi.fn()}/>);const user=userEvent.setup();await user.click(screen.getByText('Or paste CSV data'));fireEvent.change(screen.getByLabelText('CSV data'),{target:{value:'header\nrow'}});
    vi.mocked(stageImport).mockRejectedValueOnce(new Error('Connection interrupted')).mockResolvedValueOnce({id:'import-1'});await user.click(screen.getByRole('button',{name:'Upload & review'}));expect(await screen.findByRole('alert')).toHaveTextContent('Connection interrupted');await user.click(screen.getByRole('button',{name:'Upload & review'}));expect(vi.mocked(stageImport).mock.calls[0]).toEqual(vi.mocked(stageImport).mock.calls[1]);
  });
  it('blocks final enrollment when any included row has errors',()=>{
    const job=fixture();job.review!.rows[0]!.errors=['Invalid date'];job.review!.summary.errors=1;
    render(<ImportReview schoolId="school-1" job={job} reload={vi.fn()} onCommitted={vi.fn()}/>);expect(screen.getByRole('button',{name:'Review enrollment'})).toBeDisabled();expect(screen.getByText('Invalid date')).toBeVisible();
  });
  it('requires complete batch review and explicit verification before enrollment',async()=>{
    const done=vi.fn().mockResolvedValue(undefined);render(<ImportReview schoolId="school-1" job={fixture()} reload={vi.fn()} onCommitted={done}/>);const user=userEvent.setup();
    await user.click(screen.getByRole('button',{name:'Review enrollment'}));expect(screen.getByRole('heading',{name:'Confirm school enrollment'})).toHaveFocus();expect(commitImport).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'Enroll 1 student'})).toBeDisabled();
    vi.mocked(commitImport).mockResolvedValue({import_id:'import-1',students:1,guardians_created:1,guardians_reused:0,skipped:0,registers_reopened:0,enrolled:[]});await user.click(screen.getByRole('checkbox'));await user.click(screen.getByRole('button',{name:'Enroll 1 student'}));expect(commitImport).toHaveBeenCalledWith('import-1',{school_id:'school-1',expected_revision:1,validation_token:'token-1',verified:true});expect(done).toHaveBeenCalled();
  });
  it('retries a final submission with its original review token',async()=>{
    render(<ImportReview schoolId="school-1" job={fixture()} reload={vi.fn()} onCommitted={vi.fn()}/>);const user=userEvent.setup();await user.click(screen.getByRole('button',{name:'Review enrollment'}));await user.click(screen.getByRole('checkbox'));vi.mocked(commitImport).mockRejectedValue(new Error('Response interrupted'));
    await user.click(screen.getByRole('button',{name:'Enroll 1 student'}));await user.click(await screen.findByRole('button',{name:'Retry same import'}));expect(vi.mocked(commitImport).mock.calls[0]).toEqual(vi.mocked(commitImport).mock.calls[1]);
  });
  it('invalidates the confirmation when a newer draft arrives',async()=>{
    const job=fixture();const props={schoolId:'school-1',reload:vi.fn(),onCommitted:vi.fn()};const view=render(<ImportReview {...props} job={job}/>);const user=userEvent.setup();await user.click(screen.getByRole('button',{name:'Review enrollment'}));await user.click(screen.getByRole('checkbox'));
    view.rerender(<ImportReview {...props} job={{...job,revision:2}}/>);expect(screen.getByRole('alert')).toHaveTextContent('review changed');expect(screen.getByRole('button',{name:'Enroll 1 student'})).toBeDisabled();
  });
  it('saves corrected row details with a revision and never commits the school batch',async()=>{
    const done=vi.fn().mockResolvedValue(undefined);render(<ImportRowEditor schoolId="school-1" job={fixture()} row={row} onClose={vi.fn()} onSaved={done}/>);const user=userEvent.setup();fireEvent.change(screen.getByLabelText('Roll number'),{target:{value:'27'}});vi.mocked(updateImportRow).mockResolvedValue({revision:2});await user.click(screen.getByRole('button',{name:'Save & recheck'}));expect(vi.mocked(updateImportRow).mock.calls[0]![2].expected_revision).toBe(1);expect(vi.mocked(updateImportRow).mock.calls[0]![2].values.roll_number).toBe('27');expect(commitImport).not.toHaveBeenCalled();
  });
  it('requires explicit guardian selection rather than treating a search match as consent',async()=>{
    render(<ImportRowEditor schoolId="school-1" job={fixture()} row={row} onClose={vi.fn()} onSaved={vi.fn()}/>);const user=userEvent.setup();await user.selectOptions(screen.getByLabelText('Guardian choice'),'existing');expect(screen.getByRole('button',{name:'Save & recheck'})).toBeDisabled();
    vi.mocked(searchGuardians).mockResolvedValue({results:[{id:'guardian-1',name:'Pooja Sharma',phone:'9000011111',linked_admissions:'CIS-2023-071'}]});await user.type(screen.getByLabelText('Find existing guardian'),'Pooja');await user.click(screen.getByRole('button',{name:'Search guardians'}));expect(await screen.findByLabelText('Select the verified guardian')).toHaveValue('');await user.selectOptions(screen.getByLabelText('Select the verified guardian'),'guardian-1');expect(screen.getByRole('button',{name:'Save & recheck'})).toBeEnabled();
  });
  it('supports skipping an invalid row and cancelling an edit without persisting',async()=>{
    const close=vi.fn();render(<ImportRowEditor schoolId="school-1" job={fixture()} row={row} onClose={close} onSaved={vi.fn()}/>);const user=userEvent.setup();await user.selectOptions(screen.getByLabelText('Include this student'),'skip');expect(screen.getByText(/This row will be excluded/)).toBeVisible();await user.click(screen.getByRole('button',{name:'Cancel edit'}));expect(close).toHaveBeenCalled();expect(updateImportRow).not.toHaveBeenCalled();
  });
  it('requires a separate confirmation before discarding uploaded details',async()=>{
    const reload=vi.fn().mockResolvedValue(undefined);render(<ImportReview schoolId="school-1" job={fixture()} reload={reload} onCommitted={vi.fn()}/>);const user=userEvent.setup();await user.click(screen.getByRole('button',{name:'Discard draft'}));expect(cancelImport).not.toHaveBeenCalled();vi.mocked(cancelImport).mockResolvedValue({state:'cancelled'});await user.click(screen.getByRole('button',{name:'Discard uploaded draft'}));await waitFor(()=>expect(reload).toHaveBeenCalled());expect(cancelImport).toHaveBeenCalledWith('import-1',{school_id:'school-1',expected_revision:1});
  });
  it('paginates row results instead of rendering an entire large spreadsheet',async()=>{
    const job=fixture();job.review!.rows=Array.from({length:45},(_,i)=>({...structuredClone(row),row_number:i+2}));job.row_count=45;job.review!.summary.total=45;render(<ImportReview schoolId="school-1" job={job} reload={vi.fn()} onCommitted={vi.fn()}/>);expect(screen.getAllByRole('button',{name:/Edit row/})).toHaveLength(20);await userEvent.setup().click(screen.getByRole('button',{name:'Next',exact:true}));expect(screen.getByText('Page 2 of 3')).toBeVisible();
  });
});
