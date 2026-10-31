import { QueryClient,QueryClientProvider } from "@tanstack/react-query";
import { act,cleanup,fireEvent,render,screen,waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter,useLocation } from "react-router-dom";
import { afterEach,beforeAll,beforeEach,describe,expect,it,vi } from "vitest";
import { WorkspaceDiaryRoute } from "./DiaryWorkspaceRoute";
import { getClassPractice,getClassPracticeDetail,publishClassPractice,replyToPractice,type ClassPracticeList,type ClassPracticeDetail } from "./classPracticeApi";
import { getDiaryItem,getStudentDiary,setHomeworkCompleted,type ApiDiaryItem } from "../school/api";
import type { WorkspaceManifest } from "../workspace/types";
import type { ExecutionEnvironment } from "../simulation/executionEnvironment";

const state=vi.hoisted(():{actor:string;environment:ExecutionEnvironment;manifest:WorkspaceManifest|null}=>({actor:"teacher",environment:{mode:"live"},manifest:null}));
vi.mock("../auth/AuthContext",async original=>({...await original<typeof import("../auth/AuthContext")>(),useOptionalAuth:()=>({user:{id:state.actor}})}));
vi.mock("../simulation/ExecutionEnvironmentContext",()=>({useExecutionEnvironment:()=>state.environment}));
vi.mock("../workspace/useWorkspaceManifest",()=>({useWorkspaceManifest:()=>({data:state.manifest,isPending:false,error:null,refetch:vi.fn()})}));
vi.mock("../../pages/operations/OperationsShell",()=>({OperationsShell:({children}:{children:ReactNode})=><main>{children}</main>}));
vi.mock("./classPracticeApi",async original=>({...await original<typeof import("./classPracticeApi")>(),getClassPractice:vi.fn(),getClassPracticeDetail:vi.fn(),publishClassPractice:vi.fn(),replyToPractice:vi.fn()}));
vi.mock("../school/api",async original=>({...await original<typeof import("../school/api")>(),getDiaryItem:vi.fn(),getStudentDiary:vi.fn(),setHomeworkCompleted:vi.fn()}));
const id="12000000-0000-4000-8000-000000000001",classId="12000000-0000-4000-8000-000000000002";
const list:ClassPracticeList={school_id:"school",timezone:"UTC",today:"2026-10-23",class_section:{id:classId,label:"Class 7A"},terms:[{id:"term",name:"Term 1"}],subjects:[],can_publish:true,can_publish_general:true,items:[],page:1,has_more:false};
const detail:ClassPracticeDetail={item:{id,date:"2026-10-23",title:"Practice",body:"Write a sorting program.",due_at:null,published_at:"2026-10-23T08:00:00Z",term_id:"term",subject_id:null,revision:1},progress:{items:[{id:"learner",name:"Sana",completed_at:null}],total:1,completed:0,page:1},can_reply:true,thread:[{id:"question",body:"Which example?",author_name:"Sana",created_at:"2026-10-23T08:10:00Z"}]};
function manifest(scope="class"):WorkspaceManifest{return {version:1,revision:"practice",capabilities:[],context:{institution_id:"school",actor_user_id:state.actor,environment:state.environment.mode==="live"?{kind:"live"}:{kind:"simulation",namespace_id:state.environment.namespaceId,virtual_now:"2026-10-23T08:00:00Z"}},today:{now:[],attention:{total:0,overdue:0,due_soon:0},next:[]},work:{total:0,items:[]},areas:[{key:"messages",label:"Messages",href:"/areas/messages",capabilities:["learning.work.publish"],scopes:[],surfaces:[{key:scope==="class"?`diary:class:${classId}`:"diary:self:learner",label:scope==="class"?"Class 7A practice":"My diary",href:"/areas/messages/diary",capabilities:["learning.work.publish"],scopes:[]}]}],more:{setup:[],other:[]},freshness:{state:"current",as_of:"2026-10-23",source_revision:"1"}};}
function Location(){const location=useLocation();return <output aria-label="URL">{location.pathname}{location.search}</output>;}
function show(url=`/areas/messages/diary?scope=class&class_section_id=${classId}`){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});const tree=()=> <QueryClientProvider client={client}><MemoryRouter initialEntries={[url]}><WorkspaceDiaryRoute/><Location/></MemoryRouter></QueryClientProvider>;const view=render(tree());return{client,rerender:()=>view.rerender(tree())};}
beforeAll(()=>{HTMLDialogElement.prototype.showModal=function(){this.setAttribute("open","");};HTMLDialogElement.prototype.close=function(){this.removeAttribute("open");};});
beforeEach(()=>{state.actor="teacher";state.environment={mode:"live"};state.manifest=manifest();vi.mocked(getClassPractice).mockResolvedValue(list);vi.mocked(getClassPracticeDetail).mockResolvedValue(detail);vi.mocked(publishClassPractice).mockResolvedValue({id,revision:1,replayed:false});vi.mocked(replyToPractice).mockResolvedValue({});});
afterEach(()=>{cleanup();vi.resetAllMocks();vi.restoreAllMocks();});
async function compose(){await userEvent.click(await screen.findByRole("button",{name:"Add practice"}));await userEvent.type(screen.getByLabelText("Title"),"Programming practice");await userEvent.type(screen.getByLabelText("Instructions"),"Explain the second example.");await userEvent.click(screen.getByRole("button",{name:"Review",exact:true}));}
describe("class practice in the existing Diary workspace",()=>{
  it("operates from a learning-only class surface and retains the exact accepted source after publication retry",async()=>{
    vi.mocked(publishClassPractice).mockRejectedValueOnce(new Error("Publication not confirmed"));show();await compose();
    await userEvent.click(screen.getByRole("button",{name:"Publish practice"}));expect(await screen.findByRole("alert")).toHaveTextContent("not confirmed");
    await userEvent.click(screen.getByRole("button",{name:"Publish practice"}));expect(await screen.findByRole("heading",{name:"0 of 1 done"})).toBeVisible();
    expect(publishClassPractice).toHaveBeenCalledTimes(2);expect(vi.mocked(publishClassPractice).mock.calls[0]).toEqual(vi.mocked(publishClassPractice).mock.calls[1]);
    expect(screen.getByLabelText("URL")).toHaveTextContent(`practice=${id}`);expect(screen.queryByText(/attendance/i)).not.toBeInTheDocument();
  });
  it("guards an unsent private reply on close and retries the same note identity after failure",async()=>{
    const confirm=vi.spyOn(window,"confirm").mockReturnValue(false);vi.mocked(replyToPractice).mockRejectedValueOnce(new Error("Reply not confirmed"));
    show(`/areas/messages/diary?scope=class&class_section_id=${classId}&practice=${id}&learner=learner`);
    await userEvent.type(await screen.findByLabelText("Reply"),"Try the second example.");
    await userEvent.click(screen.getByRole("button",{name:"Close",exact:true}));expect(confirm).toHaveBeenCalledOnce();expect(screen.getByLabelText("Reply")).toHaveValue("Try the second example.");
    await userEvent.click(screen.getByRole("button",{name:"Send reply"}));expect(await screen.findByRole("alert")).toHaveTextContent("not confirmed");
    await userEvent.click(screen.getByRole("button",{name:"Send reply"}));await waitFor(()=>expect(screen.getByLabelText("Reply")).toHaveValue(""));
    expect(vi.mocked(replyToPractice).mock.calls[0]).toEqual(vi.mocked(replyToPractice).mock.calls[1]);
  });
  it("blocks a rapid duplicate publication and ignores an accepted callback after actor changes",async()=>{
    let accept!:(value:{id:string;revision:1;replayed:boolean})=>void;vi.mocked(publishClassPractice).mockReturnValue(new Promise(resolve=>{accept=resolve;}));
    const view=show();await compose();const publish=screen.getByRole("button",{name:"Publish practice"});fireEvent.click(publish);fireEvent.click(publish);expect(publishClassPractice).toHaveBeenCalledOnce();
    state.actor="other";state.manifest=manifest();view.rerender();expect(await screen.findByRole("button",{name:"Add practice"})).toBeVisible();
    await act(async()=>{accept({id,revision:1,replayed:false});await Promise.resolve();});expect(screen.getByLabelText("URL")).not.toHaveTextContent("practice=");expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(view.client.getQueryCache().getAll().some(query=>query.queryKey.includes("other"))).toBe(true);
  });
  it("opens an older exact learner task without a recent-date list and keeps failed completion retry identity",async()=>{
    state.actor="learner";state.manifest=manifest("self");
    const item:ApiDiaryItem={id,date:"2026-09-01",item_type:"homework",item_type_label:"Homework",subject:null,title:"Old practice",body:"Retained instructions",author_name:"Meera",due_at:null,requires_acknowledgement:false,acknowledged:false,completed:false,completed_at:null,published_at:"2026-09-01T08:00:00Z",notes:[]};
    vi.mocked(getDiaryItem).mockResolvedValue(item);vi.mocked(setHomeworkCompleted).mockRejectedValueOnce(new Error("Not confirmed")).mockResolvedValueOnce({});
    show(`/areas/messages/diary?scope=self&student_id=learner&date=2026-09-01&diary_item=${id}`);
    await userEvent.click(await screen.findByRole("button",{name:"Mark homework done"}));expect(await screen.findByRole("alert")).toHaveTextContent("Not confirmed");
    await userEvent.click(screen.getByRole("button",{name:"Mark homework done"}));await waitFor(()=>expect(setHomeworkCompleted).toHaveBeenCalledTimes(2));
    expect(vi.mocked(setHomeworkCompleted).mock.calls[0]).toEqual(vi.mocked(setHomeworkCompleted).mock.calls[1]);expect(getStudentDiary).not.toHaveBeenCalled();expect(getDiaryItem).toHaveBeenCalledWith(id,"learner");
  });
  it("shows exact-source denial without opening a new composer",async()=>{vi.mocked(getClassPracticeDetail).mockRejectedValue(new Error("Assignment revoked"));show(`/areas/messages/diary?scope=class&class_section_id=${classId}&practice=${id}`);expect(await screen.findByRole("alert")).toHaveTextContent("revoked");expect(screen.queryByLabelText("Title")).not.toBeInTheDocument();expect(publishClassPractice).not.toHaveBeenCalled();});
  it("defaults to the authorized subject without offering general publication for a subject-only assignment",async()=>{
    vi.mocked(getClassPractice).mockResolvedValue({...list,subjects:[{id:"math",name:"Math"}],can_publish_general:false});show();await compose();
    expect(screen.queryByRole("option",{name:"Class practice"})).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button",{name:"Publish practice"}));await waitFor(()=>expect(publishClassPractice).toHaveBeenCalledOnce());
    expect(vi.mocked(publishClassPractice).mock.calls[0]?.[0].subject_id).toBe("math");
  });
  it("keeps a completed world read-only while retaining its practice and private history",async()=>{
    state.environment={mode:"simulation",namespaceId:"practice-world",runId:"practice-run",runStatus:"completed",virtualClock:{now:"2026-10-23T08:00:00Z",timeZone:"UTC"}};state.manifest=manifest();
    show(`/areas/messages/diary?scope=class&class_section_id=${classId}&practice=${id}&learner=learner`);
    expect(await screen.findByText("Which example?")).toBeVisible();expect(screen.getByText("This simulation is read-only.")).toBeVisible();
    expect(screen.queryByRole("button",{name:"Add practice"})).not.toBeInTheDocument();expect(screen.queryByLabelText("Reply")).not.toBeInTheDocument();expect(replyToPractice).not.toHaveBeenCalled();
  });
  it("offers first-page recovery for an unavailable roster page without claiming an empty class",async()=>{
    vi.mocked(getClassPracticeDetail).mockRejectedValueOnce(new Error("Return to the first page to refresh this class list."));
    show(`/areas/messages/diary?scope=class&class_section_id=${classId}&practice=${id}&page=2`);
    await userEvent.click(await screen.findByRole("button",{name:"Return to first page"}));
    expect(await screen.findByRole("heading",{name:"0 of 1 done"})).toBeVisible();expect(screen.getByLabelText("URL")).toHaveTextContent(`practice=${id}`);expect(screen.getByLabelText("URL")).not.toHaveTextContent("page=");
  });
});
