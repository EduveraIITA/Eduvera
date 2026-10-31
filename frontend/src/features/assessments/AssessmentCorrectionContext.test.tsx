import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { Link, MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExecutionEnvironmentProvider } from "../simulation/ExecutionEnvironmentContext";
import type { ExecutionEnvironment } from "../simulation/executionEnvironment";
import { AssessmentWorkspacePage } from "./AssessmentWorkspacePage";
import { getAssessmentDetail, saveAssessmentResults, type AssessmentDetail, type AssessmentWorkspace } from "./api";
import { ApiError } from "../../lib/api";

const actor=vi.hoisted(()=>({id:"examiner-1"}));
vi.mock("../auth/AuthContext",()=>({useOptionalAuth:()=>({user:{id:actor.id}})}));
vi.mock("../../pages/operations/OperationsShell",()=>({OperationsShell:({children,backTo}:{children:ReactNode;backTo:string})=><><Link to={backTo??"/areas"}>Back</Link>{children}</>}));
vi.mock("./api",async original=>({...await original<typeof import("./api")>(),getAssessmentDetail:vi.fn(),saveAssessmentResults:vi.fn()}));
const source:AssessmentDetail={assessment:{id:"assessment-1",cycle_id:"cycle-1",term_id:"term-1",class_section_id:"class-1",subject_id:"subject-1",title:"Programming result",assessment_kind:"assignment",maximum_marks:"20",weight_percent:null,scheduled_at:null,duration_minutes:null,venue:"",instructions:"",evidence_requirement:"none",status:"published",revision:7,moderation_note:"",cycle_name:"Semester one",subject_name:"Programming",color:"",icon:"book",class_name:"BCA A",examiner_user_id:"examiner-1",examiner_name:"Meera",moderator_user_id:"moderator-1",moderator_name:"Anita",roster_count:1,unrecorded_count:0,publication_sequence:1},viewer_role:"examiner",results:[{id:"result-1",student_id:"student-1",outcome:"scored",marks:"16.00",grade:"",feedback:"",revision:3,first_name:"Sana",last_name:"Audit",admission_number:"QA-1",roll_number:1,evidence_count:0,evidence:null}],publications:[{id:"release-1",sequence:1,source_revision:6,reason:"First release",published_at:"2026-10-23T09:00:00Z"}]};
const workspace:AssessmentWorkspace={mode:"staff",can_plan_class_test:false,planner_user_id:"examiner-1",cycles:[],assessments:[source.assessment]};
const live:ExecutionEnvironment={mode:"live"};
const simulation:ExecutionEnvironment={mode:"simulation",namespaceId:"scenario:test:run:test",runId:"test",virtualClock:{now:"2026-10-23T09:00:00.000Z",timeZone:"UTC"},runStatus:"running"};
function view(client:QueryClient,environment:ExecutionEnvironment=live){return <QueryClientProvider client={client}><ExecutionEnvironmentProvider environment={environment}><MemoryRouter initialEntries={["/areas/assessments/assigned?assessment=assessment-1"]}><AssessmentWorkspacePage presentation="workspace" schoolId="school-1" data={workspace} refresh={vi.fn()}/></MemoryRouter></ExecutionEnvironmentProvider></QueryClientProvider>;}
afterEach(()=>{cleanup();vi.clearAllMocks();vi.restoreAllMocks();actor.id="examiner-1";});
describe("correction source and session boundaries",()=>{
  it("preserves a correction through a temporary refresh failure but hides revoked data",async()=>{
    vi.mocked(getAssessmentDetail).mockResolvedValue(source);
    const client=new QueryClient({defaultOptions:{queries:{retry:false}}});render(view(client));
    fireEvent.click(await screen.findByRole("button",{name:"Correct results"}));
    fireEvent.change(screen.getByRole("spinbutton",{name:"Marks for Sana"}),{target:{value:"17"}});
    const queryKey=client.getQueryCache().getAll().find(query=>query.queryKey.includes("assessment-detail"))!.queryKey;
    vi.mocked(getAssessmentDetail).mockRejectedValueOnce(new Error("Readback unavailable"));
    await act(async()=>{await client.refetchQueries({queryKey});});
    expect(await screen.findByText("Couldn’t refresh this assessment")).toBeVisible();
    expect(screen.getByText("This register is now read-only. Your unsaved changes have not been applied.")).toBeVisible();
    fireEvent.click(screen.getByRole("button",{name:"Try again"}));
    expect(await screen.findByRole("spinbutton",{name:"Marks for Sana"})).toHaveValue(17);
    vi.mocked(getAssessmentDetail).mockRejectedValueOnce(new ApiError("Assessment access ended",403));
    await act(async()=>{await client.refetchQueries({queryKey});});
    expect(await screen.findByRole("alert")).toHaveTextContent("Assessment access ended");
    expect(screen.queryByText("Sana Audit")).not.toBeInTheDocument();
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  });
  it("partitions cached detail by current actor and world and discards another actor's local correction",async()=>{
    vi.mocked(getAssessmentDetail).mockImplementation(()=>Promise.resolve({...source,viewer_role:actor.id==="examiner-1"?"examiner":"moderator"}));
    const client=new QueryClient({defaultOptions:{queries:{retry:false}}}),rendered=render(view(client));
    fireEvent.click(await screen.findByRole("button",{name:"Correct results"}));fireEvent.change(screen.getByRole("spinbutton",{name:"Marks for Sana"}),{target:{value:"17"}});
    actor.id="moderator-1";rendered.rerender(view(client));
    await waitFor(()=>expect(getAssessmentDetail).toHaveBeenCalledTimes(2));expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();expect(screen.queryByRole("button",{name:"Correct results"})).not.toBeInTheDocument();
    actor.id="examiner-1";rendered.rerender(view(client,simulation));
    expect(await screen.findByRole("button",{name:"Correct results"})).toBeVisible();expect(getAssessmentDetail).toHaveBeenCalledTimes(3);
    const keys=client.getQueryCache().getAll().map(query=>query.queryKey);
    expect(keys).toContainEqual(expect.arrayContaining(["live","examiner-1"]));expect(keys).toContainEqual(expect.arrayContaining(["live","moderator-1"]));
    expect(keys).toContainEqual(expect.arrayContaining(["simulation",simulation.namespaceId,simulation.runId,"examiner-1"]));
    expect(saveAssessmentResults).not.toHaveBeenCalled();
  });
  it("protects a dirty correction when leaving and allows leaving after explicit discard",async()=>{
    vi.mocked(getAssessmentDetail).mockResolvedValue(source);const confirm=vi.spyOn(window,"confirm").mockReturnValue(false);
    const client=new QueryClient({defaultOptions:{queries:{retry:false}}});render(view(client));
    fireEvent.click(await screen.findByRole("button",{name:"Correct results"}));fireEvent.change(screen.getByRole("spinbutton",{name:"Marks for Sana"}),{target:{value:"17"}});
    fireEvent.click(screen.getByRole("link",{name:"Back"}));expect(confirm).toHaveBeenCalled();expect(screen.getByRole("spinbutton")).toHaveValue(17);
    fireEvent.click(screen.getByRole("button",{name:"Discard changes"}));fireEvent.click(screen.getByRole("link",{name:"Back"}));
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();expect(saveAssessmentResults).not.toHaveBeenCalled();
  });
  it("does not reopen editing in a stopped or unavailable simulation",async()=>{
    vi.mocked(getAssessmentDetail).mockResolvedValue(source);const client=new QueryClient({defaultOptions:{queries:{retry:false}}}),rendered=render(view(client,{...simulation,runStatus:"stopped"}));
    expect(await screen.findByRole("heading",{name:"Programming result"})).toBeVisible();expect(screen.queryByRole("button",{name:"Correct results"})).not.toBeInTheDocument();
    const calls=vi.mocked(getAssessmentDetail).mock.calls.length;
    rendered.rerender(view(client,{mode:"simulation",unavailable:true,unavailableReason:"authorization_lost",namespaceId:"scenario:lost:run:lost",runId:"lost"}));
    expect(screen.getByRole("alert")).toHaveTextContent("unavailable");expect(getAssessmentDetail).toHaveBeenCalledTimes(calls);
  });
});
