import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { Link, MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssessmentWorkspacePage } from "./AssessmentWorkspacePage";
import { getAssessmentDetail, saveAssessmentResults, type AssessmentResult, type AssessmentSummary, type AssessmentWorkspace } from "./api";

vi.mock("../../pages/operations/OperationsShell",()=>({OperationsShell:({children,title,backTo}:{children:ReactNode;title:string;backTo:string})=><><h1>{title}</h1><Link to={backTo}>Back</Link>{children}</>}));
vi.mock("./api",async original=>({...await original<typeof import('./api')>(),getAssessmentDetail:vi.fn(),saveAssessmentResults:vi.fn()}));

const assessment:AssessmentSummary={id:"test-1",cycle_id:"cycle-1",class_section_id:"class-1",subject_id:"subject-1",title:"English class test",assessment_kind:"class_test",maximum_marks:"20",weight_percent:null,scheduled_at:"2026-10-08T04:00:00Z",duration_minutes:30,venue:"Room 1",instructions:"",evidence_requirement:"optional",status:"submitted",revision:1,moderation_note:"",cycle_name:"Term 1",subject_name:"English",color:"#0037b0",icon:"book",class_name:"Class 7A",examiner_user_id:"teacher-1",examiner_name:"Teacher",moderator_user_id:"teacher-2",moderator_name:"Moderator",roster_count:0,unrecorded_count:0,publication_sequence:0};
const data:AssessmentWorkspace={mode:"staff",cycles:[],assessments:[assessment,{...assessment,id:"test-2",title:"Published test",status:"published"}]};
const result:AssessmentResult={id:'result-1',student_id:'student-1',outcome:'scored',marks:'16.00',grade:'',feedback:'Good concepts; revise written presentation.',revision:2,first_name:'Ananya',last_name:'Iyer',admission_number:'CIS-2023-061',roll_number:1,evidence_count:0,evidence:null};
afterEach(cleanup);
function Location(){return <output>{useLocation().search}</output>;}
function mount(portal:"principal"|"teacher"="teacher",search="",workspace:AssessmentWorkspace=data){return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter initialEntries={[`/${portal}/assessments${search}`]}><Location/><AssessmentWorkspacePage portal={portal} schoolId="school-1" data={workspace} refresh={vi.fn()}/></MemoryRouter></QueryClientProvider>);}

describe("assessment directory",()=>{
  it.each(['principal','teacher'] as const)('keeps the %s result register flat and published marks read-only',async portal=>{
    vi.mocked(getAssessmentDetail).mockResolvedValue({assessment:{...assessment,status:'published',term_id:'term-1',evidence_requirement:'none'},results:[result,{...result,id:'result-2',first_name:'Rohan',outcome:'unrecorded',marks:null,feedback:''}],publications:[],viewer_role:'examiner'});
    mount(portal,'?assessment=test-1');
    const register=await screen.findByRole('region',{name:'Results'});
    expect(within(register).getByText('1 of 2 recorded')).toBeVisible();
    expect(within(register).getByText('Evidence not collected')).toBeVisible();
    expect(within(register).getByText('16.00 / 20')).toBeVisible();
    expect(within(register).getByText(result.feedback)).toBeVisible();
    expect(within(register).getAllByText('Unrecorded')).toHaveLength(2);
    expect(within(register).queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(within(register).queryByText('RESULT REGISTER')).not.toBeInTheDocument();
  });

  it('retains marking controls and revision checks in the flat register',async()=>{
    vi.mocked(getAssessmentDetail).mockResolvedValue({assessment:{...assessment,status:'marking',term_id:'term-1'},results:[result],publications:[],viewer_role:'examiner'});
    vi.mocked(saveAssessmentResults).mockResolvedValue(assessment);
    mount('teacher','?assessment=test-1');
    const register=await screen.findByRole('region',{name:'Results'});
    expect(within(register).getByRole('spinbutton',{name:'Marks for Ananya'})).toHaveValue(16);
    fireEvent.change(within(register).getByRole('combobox',{name:'Outcome for Ananya'}),{target:{value:'absent'}});
    expect(within(register).getByRole('spinbutton',{name:'Marks for Ananya'})).toBeDisabled();
    fireEvent.click(within(register).getByRole('button',{name:'Save'}));
    await waitFor(()=>expect(saveAssessmentResults).toHaveBeenCalledWith('school-1','test-1',1,[expect.objectContaining({result_id:'result-1',outcome:'absent',marks:null,expected_revision:2})]));
  });
  it("replaces the status banner with a URL-backed filter and keeps it after returning from details",async()=>{
    vi.mocked(getAssessmentDetail).mockResolvedValue({assessment:{...assessment,term_id:"term-1"},results:[],publications:[],viewer_role:"moderator"});
    const {container}=mount();
    expect(container.querySelector('.assessment-summary')).toBeNull();
    fireEvent.change(screen.getByRole('combobox',{name:'Filter assessments'}),{target:{value:'submitted'}});
    expect(screen.queryByRole('button',{name:/Published test/})).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('status=submitted');
    fireEvent.click(screen.getByRole('button',{name:/English class test/}));
    expect(await screen.findByRole('heading',{name:'English class test'})).toBeVisible();
    expect(screen.queryByRole('combobox',{name:'Filter assessments'})).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('link',{name:'Back'}));
    expect(screen.getByRole('combobox',{name:'Filter assessments'})).toHaveValue('submitted');
  });

  it("restores an empty filter from the URL and does not expose creation to teachers",()=>{
    mount('teacher','?status=marking');
    expect(screen.getByText('No assessments with this status')).toBeVisible();
    expect(screen.queryByLabelText('Create assessment or cycle')).not.toBeInTheDocument();
  });

  it("keeps cycle creation available when there is no cycle for a new assessment",()=>{
    mount('principal','',{...data,mode:'admin',references:{terms:[],classes:[],subjects:[],staff:[]}});
    fireEvent.click(screen.getByLabelText('Create assessment or cycle'));
    expect(screen.getByRole('button',{name:'New assessment'})).toBeDisabled();
    fireEvent.click(screen.getByRole('button',{name:'New cycle'}));
    expect(screen.getByRole('dialog')).toBeVisible();
    fireEvent.click(screen.getByRole('button',{name:'Cancel'}));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
