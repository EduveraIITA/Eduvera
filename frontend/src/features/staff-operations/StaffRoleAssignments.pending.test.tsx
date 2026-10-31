import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api";
import { ExecutionEnvironmentProvider } from "../simulation/ExecutionEnvironmentContext";
import type { ExecutionEnvironment } from "../simulation/executionEnvironment";
import { StaffRoleAssignments } from "./StaffRoleAssignments";
import { assignAccessRole, changeAssignmentRole, endClassRoleAssignment, type AccessRole, type RoleAssignment } from "./access-api";
import type { AdminStaffWorkspace, StaffProfile } from "./api";

const auth=vi.hoisted(()=>({user:{id:"operator-1"}}));
vi.mock("../auth/AuthContext",()=>({useOptionalAuth:()=>auth}));
vi.mock("./access-api",async original=>({...await original<typeof import("./access-api")>(),assignAccessRole:vi.fn(),changeAssignmentRole:vi.fn(),endClassRoleAssignment:vi.fn()}));
const profile:StaffProfile={id:"profile",user_id:"staff",staff_code:"T1",first_name:"Kavita",last_name:"Mehta",email:"kavita@example.test",phone:"",staff_kind:"teaching",designation:"Teacher",department:"Learning",employment_type:"full_time",joined_on:"2026-04-01",status:"active",revision:1,onboarding_total:0,onboarding_complete:0,pending_requests:0};
const role:AccessRole={id:"role",name:"Class support",description:"",context_kind:"class",permissions:["messages.view"],source_kind:"institute",is_active:true,revision:1,assignment_count:1};
const assignment:RoleAssignment={source_id:"assignment",source_kind:"class_assignment",staff_profile_id:profile.id,user_id:"staff",role_id:role.id,role_name:role.name,context_kind:"class",scope_id:"class",scope_label:"Class A",subject_name:null,permissions:role.permissions,starts_on:"2026-01-01",ends_on:null,status:"active",display_status:"active",revision:3};
const data:AdminStaffWorkspace={mode:"admin",academic_year:"2026-27",profiles:[profile],onboarding_items:[],policies:[],balances:[],requests:[],work_types:[],responsibility_types:[],assignments:[],coverage_tasks:[],references:{classes:[{id:"class",name:"Class A"}],subjects:[],events:[]},access_roles:[role,{...role,id:"other-role",name:"Class coordinator"}],role_assignments:[assignment]};
function deferred(){let resolve!:(value:unknown)=>void;const promise=new Promise<unknown>(done=>{resolve=done;});return{promise,resolve};}
function mount(refresh=vi.fn().mockResolvedValue(undefined)){
  const tree=(environment:ExecutionEnvironment)=> <MemoryRouter><ExecutionEnvironmentProvider environment={environment}><StaffRoleAssignments schoolId="campus" profile={profile} data={data} refresh={refresh}/></ExecutionEnvironmentProvider></MemoryRouter>;
  const view=render(tree({mode:"live"}));
  return{refresh,rerender:(environment:ExecutionEnvironment={mode:"live"})=>view.rerender(tree(environment))};
}
async function openAssign(){await userEvent.click(screen.getByRole("button",{name:"Assign role",exact:true}));const dialog=screen.getByRole("dialog");await userEvent.selectOptions(within(dialog).getByRole("combobox",{name:"Class",exact:true}),"class");return dialog;}
async function openManage(){await userEvent.click(screen.getByLabelText("Class support, 1 assignment"));await userEvent.click(screen.getByRole("button",{name:"Manage assignment: Class A",exact:true}));return screen.getByRole("dialog");}
beforeEach(()=>{vi.clearAllMocks();auth.user.id="operator-1";});
afterEach(cleanup);

describe("assignment writes and recovery",()=>{
  it("locks close, Escape, cancel, fields and duplicate submits until assignment is confirmed",async()=>{
    const pending=deferred();vi.mocked(assignAccessRole).mockReturnValue(pending.promise);const {refresh}=mount();const dialog=await openAssign();
    fireEvent.submit(dialog.querySelector("form")!);fireEvent.submit(dialog.querySelector("form")!);
    expect(assignAccessRole).toHaveBeenCalledTimes(1);expect(within(dialog).getByRole("button",{name:"Close"})).toBeDisabled();expect(within(dialog).getByRole("button",{name:"Cancel"})).toBeDisabled();expect(within(dialog).getByRole("combobox",{name:"Role"})).toBeDisabled();
    fireEvent(dialog,new Event("cancel",{bubbles:true,cancelable:true}));expect(screen.getByRole("dialog")).toBeVisible();
    await act(async()=>{pending.resolve({id:"saved"});await pending.promise;});await waitFor(()=>expect(screen.queryByRole("dialog")).not.toBeInTheDocument());expect(refresh).toHaveBeenCalledTimes(1);
  });
  it("distinguishes accepted write from failed refresh and retries only the read",async()=>{
    vi.mocked(assignAccessRole).mockResolvedValue({id:"saved"});const refresh=vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);mount(refresh);const dialog=await openAssign();
    await userEvent.click(within(dialog).getByRole("button",{name:"Assign role",exact:true}));
    expect(await screen.findByRole("alert")).toHaveTextContent("The change was saved");expect(within(dialog).getByRole("combobox",{name:"Role"})).toBeDisabled();expect(within(dialog).queryByRole("button",{name:"Assign role",exact:true})).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button",{name:"Refresh assignments"}));await waitFor(()=>expect(screen.queryByRole("dialog")).not.toBeInTheDocument());expect(assignAccessRole).toHaveBeenCalledTimes(1);expect(refresh).toHaveBeenCalledTimes(2);
  });
  it("does not blindly resubmit an unconfirmed transport outcome",async()=>{
    vi.mocked(assignAccessRole).mockRejectedValue(new TypeError("connection lost"));const {refresh}=mount();const dialog=await openAssign();await userEvent.click(within(dialog).getByRole("button",{name:"Assign role",exact:true}));
    expect(await screen.findByRole("alert")).toHaveTextContent("not confirmed");expect(screen.getByRole("alert")).not.toHaveTextContent("was saved");expect(within(dialog).getByRole("combobox",{name:"Role"})).toBeDisabled();
    await userEvent.click(within(dialog).getByRole("button",{name:"Refresh assignments"}));expect(assignAccessRole).toHaveBeenCalledTimes(1);expect(refresh).toHaveBeenCalledTimes(1);
  });
  it("keeps a known validation refusal editable without claiming acceptance",async()=>{
    vi.mocked(assignAccessRole).mockRejectedValue(new ApiError("Choose a valid class.",400));mount();const dialog=await openAssign();await userEvent.click(within(dialog).getByRole("button",{name:"Assign role",exact:true}));
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose a valid class");expect(within(dialog).getByRole("combobox",{name:"Role"})).toBeEnabled();expect(within(dialog).getByRole("button",{name:"Assign role",exact:true})).toBeEnabled();
  });
  it.each(["role","end"] as const)("keeps a pending %s change visible and locked",async kind=>{
    const pending=deferred();vi.mocked(changeAssignmentRole).mockReturnValue(pending.promise);vi.mocked(endClassRoleAssignment).mockReturnValue(pending.promise);mount();const dialog=await openManage();
    if(kind==="role"){await userEvent.selectOptions(within(dialog).getByRole("combobox",{name:"Role"}),"other-role");await userEvent.click(within(dialog).getByRole("button",{name:"Save assignment"}));}
    else{await userEvent.click(within(dialog).getByText("End this assignment",{exact:true}));await userEvent.type(within(dialog).getByRole("textbox",{name:"Reason"}),"Duty ended");await userEvent.click(within(dialog).getByRole("button",{name:"End assignment",exact:true}));}
    expect(within(dialog).getByRole("button",{name:"Close"})).toBeDisabled();expect(within(dialog).getByRole("button",{name:"Cancel"})).toBeDisabled();fireEvent(dialog,new Event("cancel",{bubbles:true,cancelable:true}));expect(screen.getByRole("dialog")).toBeVisible();await act(async()=>{pending.resolve({saved:true});await pending.promise;});
  });
  it.each(["actor","world"] as const)("ignores late accepted write after a %s switch",async boundary=>{
    const pending=deferred();vi.mocked(assignAccessRole).mockReturnValue(pending.promise);const {refresh,rerender}=mount();const dialog=await openAssign();await userEvent.click(within(dialog).getByRole("button",{name:"Assign role",exact:true}));
    if(boundary==="actor"){auth.user.id="operator-2";rerender();}else rerender({mode:"simulation",namespaceId:"world",runId:"run",virtualClock:{now:"2026-10-23T10:00:00Z",timeZone:"UTC"}});
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();await act(async()=>{pending.resolve({id:"saved"});await pending.promise;});expect(refresh).not.toHaveBeenCalled();
  });
});
