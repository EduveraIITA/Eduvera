import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import PrincipalDeparturePage from "./PrincipalDeparturePage";
import { decideDutySwap, getDepartureWorkspace, type AdminDeparture, type TransportTrip } from "./api";
import { clearPendingTransportCommandsForTests } from "./pendingTransportCommand";

vi.mock("../../pages/operations/OperationsShell",()=>({OperationsShell:({children}:{children:ReactNode})=><main>{children}</main>}));
vi.mock("../attention/AttentionOpenAcknowledgement",()=>({AttentionOpenAcknowledgement:()=> <output data-testid="attention-opened"/>}));
vi.mock("../auth/AuthContext",()=>({useAuth:()=>({user:{id:"admin-1",active_school_id:"school-1"},memberships:[{role:"admin",school_id:"school-1"}],refresh:vi.fn()})}));
vi.mock("./api",async original=>({...await original<typeof import("./api")>(),getDepartureWorkspace:vi.fn(),decideDutySwap:vi.fn()}));

const trip:TransportTrip={
  id:"trip-1",school_id:"school-1",route_id:"route-1",service_date:"2026-12-20",direction:"from_institution",
  service_pattern_id:null,service_pattern_label:null,scheduled_departure_time:"15:30:00",assigned_collector_user_id:"collector-1",
  backup_collector_user_id:null,collector_assignment_status:"declined",assignment_note:"Unable to attend",state:"planned",revision:2,
  route_name:"South route",route_code:"SOUTH",vehicle_label:"Bus 14",collector_name:"Kavita Mehta",backup_collector_name:null,
  roster_count:24,boarded_count:0,dropped_count:0,
};

const workspace:AdminDeparture={
  school:{id:"school-1",name:"Cambridge International School",timezone:"Asia/Kolkata",institution_kind:"school"},
  policy:{school_id:"school-1",enabled:true,enabled_modes:["guardian_pickup"],change_cutoff:"13:00",location_retention_hours:24,location_stale_seconds:90,revision:1},
  routes:[],trips:[trip],patterns:[],swaps:[],requests:[],
  students:[{id:"student-1",admission_number:"S001",name:"Aarav Sharma"}],collectors:[],authorities:[],guardian_links:[],
  plans:[{id:"plan-1",student_id:"student-1",student_name:"Aarav Sharma",service_date:"2026-09-01",mode:"guardian_pickup",state:"exception",revision:3,collector_name:"Pooja Sharma"}],
  map:{tile_url:"",attribution:""},
};
const acceptedSwap:AdminDeparture["swaps"][number]={id:"swap-1",school_id:"school-1",request_type:"cover",requester_trip_id:"trip-1",target_trip_id:null,requester_user_id:"collector-1",target_user_id:"collector-2",requester_trip_revision:2,target_trip_revision:null,reason:"Medical appointment",status:"accepted",response_note:"I can cover",decision_note:"",revision:2,requester_service_date:"2026-12-20",requester_departure_time:"15:30:00",requester_route_name:"South route",target_service_date:null,target_departure_time:null,target_route_name:null,requester_name:"Kavita Mehta",target_name:"Leena Bose"};

function show(path:string){
  return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter initialEntries={[path]}><PrincipalDeparturePage/></MemoryRouter></QueryClientProvider>);
}

beforeEach(()=>vi.mocked(getDepartureWorkspace).mockResolvedValue(workspace));
afterEach(()=>{cleanup();clearPendingTransportCommandsForTests();vi.clearAllMocks();});

describe("principal departure attention destinations",()=>{
  it("loads and focuses an exact historical departure plan",async()=>{
    show("/principal/departure?section=pickup&date=2026-09-01&student=student-1&plan=plan-1");
    expect(await screen.findByText("Aarav Sharma")).toBeVisible();
    const target=document.getElementById("attention-departure-plan-plan-1");
    expect(target).toHaveClass("is-attention-target");
    await waitFor(()=>expect(target).toHaveFocus());
    expect(getDepartureWorkspace).toHaveBeenCalledWith("school-1","plan-1",undefined);
  });

  it("does not focus a plan whose learner or date does not match",async()=>{
    show("/principal/departure?section=pickup&date=2026-09-02&student=student-1&plan=plan-1");
    expect(await screen.findByRole("alert")).toHaveTextContent("Departure plan unavailable");
    expect(document.getElementById("attention-departure-plan-plan-1")).not.toBeInTheDocument();
  });

  it("moves to the exact trip week and focuses the declined duty",async()=>{
    show("/principal/departure?section=roster&trip=trip-1");
    expect(await screen.findByText("South route")).toBeVisible();
    await waitFor(()=>expect(document.getElementById("attention-transport-trip-trip-1")).toHaveFocus());
    expect(document.getElementById("attention-transport-trip-trip-1")).toHaveClass("is-attention-target");
    expect(getDepartureWorkspace).toHaveBeenCalledWith("school-1",undefined,"trip-1");
  });

  it("shows an unavailable state instead of another trip when the target is stale",async()=>{
    vi.mocked(getDepartureWorkspace).mockResolvedValue({...workspace,trips:[]});
    show("/principal/departure?section=roster&trip=missing-trip");
    expect(await screen.findByRole("alert")).toHaveTextContent("Transport duty unavailable");
    expect(document.querySelector(".departure-duty-card.is-attention-target")).not.toBeInTheDocument();
  });

  it("shows truthful resolved states for requests and duty changes no longer in their queues",async()=>{
    const requestView=show("/principal/departure?section=requests&request=closed-request");
    expect(await screen.findByRole("alert")).toHaveTextContent("Departure request unavailable");
    requestView.unmount();
    show("/principal/departure?section=roster&swap=closed-swap");
    expect(await screen.findByRole("alert")).toHaveTextContent("Duty change unavailable");
    expect(document.querySelector(".departure-swap-queue .is-attention-target")).not.toBeInTheDocument();
  });

  it("acknowledges school swap approval only at the exact accepted revision",async()=>{
    vi.mocked(getDepartureWorkspace).mockResolvedValue({...workspace,swaps:[acceptedSwap]});
    show("/principal/departure?section=roster&swap=swap-1&swap_revision=2&attention_notification_id=10000000-0000-4000-a000-000000000001");
    expect(await screen.findByTestId("attention-opened")).toBeInTheDocument();
    expect(document.getElementById("attention-duty-swap-swap-1")).toHaveClass("is-attention-target");
    cleanup();
    vi.mocked(getDepartureWorkspace).mockResolvedValue({...workspace,swaps:[acceptedSwap]});
    show("/principal/departure?section=roster&swap=swap-1&swap_revision=3&attention_notification_id=10000000-0000-4000-a000-000000000001");
    expect(await screen.findByText(/changed after the alert/i)).toBeVisible();
    expect(screen.queryByTestId("attention-opened")).not.toBeInTheDocument();
  });

  it("reuses the school decision command after a response is lost and the page reloads",async()=>{
    vi.mocked(getDepartureWorkspace).mockResolvedValue({...workspace,swaps:[acceptedSwap]});
    vi.mocked(decideDutySwap).mockRejectedValueOnce(new TypeError("response lost")).mockResolvedValueOnce({status:"approved"});
    const path="/principal/departure?section=roster&swap=swap-1";
    show(path);
    const firstApprove=await screen.findByRole("button",{name:"Approve"});
    firstApprove.click();
    await waitFor(()=>expect(decideDutySwap).toHaveBeenCalledTimes(1));
    const firstCommand=(vi.mocked(decideDutySwap).mock.calls[0]?.[2] as {command_id:string}).command_id;
    expect(firstCommand).toMatch(/^[0-9a-f-]{36}$/i);

    cleanup();
    show(path);
    const retryApprove=await screen.findByRole("button",{name:"Approve"});
    retryApprove.click();
    await waitFor(()=>expect(decideDutySwap).toHaveBeenCalledTimes(2));
    expect((vi.mocked(decideDutySwap).mock.calls[1]?.[2] as {command_id:string}).command_id).toBe(firstCommand);
  });
});
