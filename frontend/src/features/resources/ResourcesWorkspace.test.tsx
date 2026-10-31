import type { ReactNode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api";
import { ExecutionEnvironmentProvider } from "../simulation/ExecutionEnvironmentContext";
import type { ExecutionEnvironment } from "../simulation/executionEnvironment";
import { useWorkspaceManifest } from "../workspace/useWorkspaceManifest";
import { getResourceLoan, getResources } from "./resourceApi";
import { ResourcesWorkspace, ResourcesWorkspaceRoute } from "./ResourcesWorkspaceRoute";
import { resourceFixtureItem, resourceFixtureLoan, resourceFixturePage } from "./resources.test-fixtures";

vi.mock("./resourceApi",async original=>({...await original<typeof import("./resourceApi")>(),getResources:vi.fn(),getResourceLoan:vi.fn()}));
vi.mock("../workspace/useWorkspaceManifest",()=>({useWorkspaceManifest:vi.fn()}));
vi.mock("../auth/AuthContext",()=>({useOptionalAuth:()=>({user:{id:"actor"}})}));
vi.mock("../../pages/operations/OperationsShell",()=>({OperationsShell:({children,title}:{children:ReactNode;title:string})=><><h1>{title}</h1>{children}</>}));
afterEach(()=>{cleanup();vi.resetAllMocks();});
beforeEach(()=>{
  vi.mocked(getResources).mockResolvedValue(resourceFixturePage());vi.mocked(getResourceLoan).mockResolvedValue(resourceFixtureLoan());
  vi.mocked(useWorkspaceManifest).mockReturnValue({isPending:false,error:null,data:{context:{institution_id:"school",actor_user_id:"actor",time_zone:"Asia/Kolkata",environment:{kind:"live"}},areas:[{key:"resources"}]},refetch:vi.fn()} as unknown as ReturnType<typeof useWorkspaceManifest>);
});
function Location(){const location=useLocation();return <output aria-label="Location">{location.search}</output>;}
function mount({path="/areas/resources",environment={mode:"live"},route=false}:{path?:string;environment?:ExecutionEnvironment;route?:boolean}={}){
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  render(<QueryClientProvider client={client}><ExecutionEnvironmentProvider environment={environment}><MemoryRouter initialEntries={[path]}>{route ? <ResourcesWorkspaceRoute /> : <ResourcesWorkspace schoolId="school" actorId="actor" timezone="Asia/Kolkata" />}<Location /></MemoryRouter></ExecutionEnvironmentProvider></QueryClientProvider>);
  return client;
}
describe("compact source-owned Resources workspace",()=>{
  it.each<{name:string;environment:ExecutionEnvironment}>([{name:"Live",environment:{mode:"live"}},{name:"Simulation",environment:{mode:"simulation",namespaceId:"simulation:resources",runId:"run-resources",virtualClock:{now:"2026-10-24T09:00:00Z",timeZone:"Asia/Kolkata"},runStatus:"running"}}])("uses the same source UI with isolated $name query identity",async({environment})=>{
    const client=mount({environment});expect(await screen.findByRole("link",{name:/Project camera/})).toHaveAttribute("href","/areas/resources?loan_id=loan-1");
    expect(getResources).toHaveBeenCalledWith("school",{view:"loans",state:"outstanding",search:"",page:1});
    expect(client.getQueryCache().findAll()[0]!.queryKey).toContain(environment.mode==="simulation" ? "simulation:resources" : "live");
  });
  it("shows honest loading, then a one-item start without forcing setup",async()=>{
    let finish!:(value:ReturnType<typeof resourceFixturePage>)=>void;vi.mocked(getResources).mockReturnValue(new Promise(resolve=>{finish=resolve;}));mount();
    expect(screen.getByLabelText("Loading your workspace")).toBeInTheDocument();
    act(()=>finish(resourceFixturePage({loans:[],totals:{outstanding:0,overdue:0,questions:0}})));
    expect(await screen.findByRole("heading",{name:"Nothing out right now"})).toBeVisible();expect(screen.getByRole("button",{name:"Issue an item"})).toBeEnabled();
  });
  it("preserves list context while opening the exact native loan",async()=>{
    mount({path:"/areas/resources?view=loans&state=overdue&search=camera&page=2"});const user=userEvent.setup();
    await user.click(await screen.findByRole("link",{name:/Project camera/}));await screen.findByRole("region",{name:"Borrowing summary"});
    expect(getResourceLoan).toHaveBeenCalledWith("school","loan-1");expect(screen.getByLabelText("Location")).toHaveTextContent("state=overdue&search=camera&page=2&loan_id=loan-1");
    await user.click(screen.getByRole("button",{name:"Back to resources"}));await screen.findByRole("link",{name:/Project camera/});
    expect(screen.getByLabelText("Location")).toHaveTextContent("?view=loans&state=overdue&search=camera&page=2");
  });
  it("opens a native deep link without requiring a manager list first",async()=>{
    mount({path:"/areas/resources?loan_id=loan-1"});await screen.findByRole("region",{name:"Borrowing summary"});expect(getResources).not.toHaveBeenCalled();
  });
  it("uses finite server pages and resets the page for a new search",async()=>{
    vi.mocked(getResources).mockResolvedValue(resourceFixturePage({pagination:{page:1,page_size:10,total:21}}));mount();const user=userEvent.setup();
    await user.click(await screen.findByRole("button",{name:"Next"}));await waitFor(()=>expect(getResources).toHaveBeenLastCalledWith("school",expect.objectContaining({page:2})));
    await user.type(screen.getByRole("searchbox"),"charger");await user.click(screen.getByRole("button",{name:"Search resources"}));await waitFor(()=>expect(getResources).toHaveBeenLastCalledWith("school",expect.objectContaining({page:1,search:"charger"})));
  });
  it("uses the actor-scoped borrowing view without inventing management authority",async()=>{
    vi.mocked(getResources).mockResolvedValue(resourceFixturePage({view:"mine",can_manage:false,can_issue:false}));mount({path:"/areas/resources?view=mine"});
    expect(await screen.findByRole("heading",{name:"My borrowing"})).toBeVisible();expect(screen.queryByRole("navigation",{name:"Resources views"})).not.toBeInTheDocument();expect(screen.queryByRole("button",{name:"Issue item"})).not.toBeInTheDocument();
  });
  it("clears a retained private record after access is revoked",async()=>{
    const client=mount({path:"/areas/resources?loan_id=loan-1"});await screen.findByText("Sana Patel");vi.mocked(getResourceLoan).mockRejectedValue(new ApiError("No longer allowed",403));
    await act(async()=>{await client.invalidateQueries();});await screen.findByRole("alert");expect(screen.queryByText("Sana Patel")).not.toBeInTheDocument();expect(screen.queryByRole("button",{name:"Record return"})).not.toBeInTheDocument();
  });
  it("labels pooled inventory as unsupported rather than issuing it as an individual copy",async()=>{
    vi.mocked(getResources).mockResolvedValue(resourceFixturePage({view:"items",loans:[],items:[resourceFixtureItem({tracking_mode:"pooled",available:false,unavailable_reason:"Pooled inventory",active_loan_id:null})]}));mount({path:"/areas/resources?view=items"});
    expect(await screen.findByText("Pooled stock · individual loans not supported")).toBeVisible();expect(screen.queryByRole("button",{name:"Issue"})).not.toBeInTheDocument();
  });
  it("stops before resource reads when the selected world or current area is unavailable",()=>{
    vi.mocked(useWorkspaceManifest).mockReturnValue({isPending:false,error:null,data:{context:{institution_id:"school",environment:{kind:"live"}},areas:[]},refetch:vi.fn()} as unknown as ReturnType<typeof useWorkspaceManifest>);
    mount({route:true});expect(screen.getByRole("alert")).toHaveTextContent("Your workspace access changed");expect(getResources).not.toHaveBeenCalled();expect(getResourceLoan).not.toHaveBeenCalled();
  });
});
