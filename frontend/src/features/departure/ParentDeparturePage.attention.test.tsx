import { QueryClient,QueryClientProvider } from "@tanstack/react-query";
import { cleanup,render,screen,waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter,Route,Routes } from "react-router-dom";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import type { FamilyDeparture } from "./api";
import ParentDeparturePage from "./ParentDeparturePage";

const api=vi.hoisted(()=>({getFamilyDeparture:vi.fn()}));
vi.mock("./api",async()=>({...await vi.importActual("./api"),getFamilyDeparture:api.getFamilyDeparture}));
vi.mock("../auth/AuthContext",()=>({useAuth:()=>({user:{id:"guardian-1"},memberships:[]})}));
vi.mock("../../pages/parent/ParentShell",()=>({ParentShell:({children}:{children:ReactNode})=><main>{children}</main>}));
vi.mock("../../pages/student/StudentShell",()=>({StudentShell:({children}:{children:ReactNode})=><main>{children}</main>}));
vi.mock("../attention/AttentionOpenAcknowledgement",()=>({AttentionOpenAcknowledgement:()=> <output data-testid="attention-ack"/>}));

const fixture:FamilyDeparture={
  service_date:"2026-10-14",local_date:"2026-10-13",can_request:true,
  student:{id:"student-1",school_id:"school-1",first_name:"Aarav",last_name:"Sharma",admission_number:"CIS-071",avatar_url:"",grade:"7",section:"A",school_name:"School"},
  children:[{id:"student-1",first_name:"Aarav",last_name:"Sharma",avatar_url:"",grade:"7",section:"A"}],
  plan:{id:"plan-1",service_date:"2026-10-14",revision:4,mode:"guardian_pickup",state:"exception",authority_id:null,trip_id:null,stop_id:null,external_arrangement:""},
  request:null,
  requests:[{id:"request-1",service_date:"2026-10-14",status:"approved",requested_mode:"guardian_pickup",reason:"Appointment",decision_note:"Approved",revision:2,requester_user_id:"guardian-1",created_at:"2026-10-13T08:00:00Z"}],
  trip:null,
  journeys:[{id:"trip-1",state:"cancelled",revision:3,service_date:"2026-10-14",direction:"from_institution",scheduled_departure_time:"15:30",route_name:"South route",route_code:"S",vehicle_label:"Bus 14",provider_name:"",rider_state:"exception",rider_revision:5,stop_name:"Castle road",planned_time:"15:45",latitude:null,longitude:null,accuracy_metres:null,observed_at:null,location_fresh:false,boarded_at:null,dropped_at:null}],
  authorities:[],policy:{enabled:true,enabled_modes:["guardian_pickup"],change_cutoff:"13:00"},map:{tile_url:"",attribution:""},
};

function view(search:string,data:FamilyDeparture=fixture){
  api.getFamilyDeparture.mockResolvedValue(data);
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/parent/departure?student_id=student-1&date=2026-10-14&attention_notification_id=10000000-0000-4000-a000-000000000001&${search}`]}><Routes><Route path="/parent/departure" element={<ParentDeparturePage/>}/></Routes></MemoryRouter></QueryClientProvider>);
}

beforeEach(()=>api.getFamilyDeparture.mockReset());
afterEach(cleanup);

describe("parent departure typed-attention destinations",()=>{
  it.each([
    ["request_id=request-1&request_revision=2","attention-family-request-request-1"],
    ["trip_id=trip-1&trip_revision=3","attention-family-journey-trip-1"],
    ["trip_id=trip-1&rider_revision=5","attention-family-journey-trip-1"],
    ["plan_id=plan-1&plan_revision=4","attention-family-plan-plan-1"],
  ])("acknowledges only after %s resolves to its exact current record",async(search,targetId)=>{
    view(search);
    expect(await screen.findByTestId("attention-ack")).toBeInTheDocument();
    const target=document.getElementById(targetId);
    expect(target).toHaveClass("is-attention-target");
    await waitFor(()=>expect(target).toHaveFocus());
  });

  it("keeps stale attention unread and explains that its source changed",async()=>{
    view("request_id=request-1&request_revision=1");
    expect(await screen.findByText(/no longer matches/)).toBeVisible();
    expect(screen.queryByTestId("attention-ack")).not.toBeInTheDocument();
  });
});
