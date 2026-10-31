import { QueryClient,QueryClientProvider } from "@tanstack/react-query";
import { cleanup,render,screen,waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter,Route,Routes } from "react-router-dom";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import type { FamilyDeparture } from "./api";
import { WorkspaceDeparturePlanPage } from "./ParentDeparturePage";
import { RelationshipSurfaceResolver } from "../workspace/RelationshipSurfaceResolver";
import { useWorkspaceManifest } from "../workspace/useWorkspaceManifest";
import type { WorkspaceManifest } from "../workspace/types";

const api=vi.hoisted(()=>({getFamilyDeparture:vi.fn(),getStudentDeparture:vi.fn()}));
vi.mock("./api",async()=>({...await vi.importActual("./api"),getFamilyDeparture:api.getFamilyDeparture,getStudentDeparture:api.getStudentDeparture}));
vi.mock("../auth/AuthContext",()=>({useAuth:()=>({user:{id:"guardian-1"},memberships:[]})}));
vi.mock("../../pages/operations/OperationsShell",()=>({OperationsShell:({children}:{children:ReactNode})=><main>{children}</main>}));
vi.mock("../attention/AttentionOpenAcknowledgement",()=>({AttentionOpenAcknowledgement:()=> <output data-testid="attention-ack"/>}));
vi.mock("../workspace/useWorkspaceManifest",()=>({useWorkspaceManifest:vi.fn()}));
vi.mock("../simulation/ExecutionEnvironmentContext",()=>({useExecutionEnvironment:()=>({mode:"live",namespaceId:"live:school-1"})}));

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
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/areas/departure/plan?scope=dependent&student_id=student-1&date=2026-10-14&attention_notification_id=10000000-0000-4000-a000-000000000001&${search}`]}><Routes><Route path="/areas/departure/plan" element={<WorkspaceDeparturePlanPage relationship="dependent"/>}/></Routes></MemoryRouter></QueryClientProvider>);
}

beforeEach(()=>{api.getFamilyDeparture.mockReset();api.getStudentDeparture.mockReset();});
afterEach(cleanup);

describe("dependent departure workspace",()=>{
  it("keeps relationship-authorized gate pass actions without selecting a guardian portal",async()=>{
    view("");
    expect(await screen.findByRole("button",{name:"Student entry QR"})).toBeVisible();
    expect(screen.getByRole("button",{name:"My pickup QR"})).toBeVisible();
  });

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

describe("own future departure through the authorized workspace surface",()=>{
  const ownManifest:WorkspaceManifest={
    revision:"own-departure-1",generated_at:"2026-10-25T10:00:00Z",
    context:{institution_id:"school-1",environment:{kind:"live",namespace_id:"live:school-1"}},
    today:{now:[],next:[],attention:{total:0,overdue:0,due_soon:0}},work:{total:0,items:[]},
    areas:[{key:"departure",label:"Departure",href:"/areas/departure",capabilities:["departure.view"],
      scopes:[{kind:"self",id:"student-1",label:"My learner record"}],surfaces:[{
        key:"plan:self:student-1",label:"My departure",href:"/areas/departure/plan?scope=self&student_id=student-1",
        capabilities:["departure.view"],scopes:[{kind:"self",id:"student-1",label:"My learner record"}],
      }]}],more:{setup:[],other:[]},freshness:{state:"current",as_of:"10:00",source_revision:"own-departure-1"},
  };
  function ownView(studentId="student-1"){
    api.getStudentDeparture.mockResolvedValue({...fixture,service_date:"2026-10-28",local_date:"2026-10-25",can_request:false,
      plan:{...fixture.plan!,mode:"independent_departure",state:"planned",external_arrangement:"Synthetic future plan; no departure observed"},
      requests:[],request:null,journeys:[],authorities:[],policy:{enabled:true,enabled_modes:["independent_departure"],change_cutoff:"13:00"}});
    vi.mocked(useWorkspaceManifest).mockReturnValue({data:ownManifest,error:null,isPending:false,refetch:vi.fn()} as unknown as ReturnType<typeof useWorkspaceManifest>);
    const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
    return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[
      `/areas/departure/plan?scope=self&student_id=${studentId}&date=2026-10-28`,
    ]}><RelationshipSurfaceResolver areaKey="departure" surfacePrefix="plan" title="Departure plan">
      {({relationship})=><WorkspaceDeparturePlanPage relationship={relationship}/>}
    </RelationshipSurfaceResolver></MemoryRouter></QueryClientProvider>);
  }

  it("opens the exact future own plan using the self API with no receiver, change or management actions",async()=>{
    ownView();
    expect(await screen.findByRole("heading",{name:"Independent departure"})).toBeVisible();
    expect(screen.getByText("planned")).toBeVisible();
    expect(screen.getByText("Synthetic future plan; no departure observed")).toBeVisible();
    expect(screen.getByLabelText("Service date")).toHaveValue("2026-10-28");
    expect(api.getStudentDeparture).toHaveBeenCalledWith("2026-10-28");
    expect(api.getFamilyDeparture).not.toHaveBeenCalled();
    expect(screen.queryByRole("button",{name:/request a departure change|mark ready|handover|pickup qr|student entry qr/i})).not.toBeInTheDocument();
  });

  it.each(["other-learner",""])("does not fetch an explicit unauthorized own learner %s",studentId=>{
    ownView(studentId);
    expect(screen.getByRole("heading",{name:"Your workspace access changed"})).toBeVisible();
    expect(api.getStudentDeparture).not.toHaveBeenCalled();
    expect(api.getFamilyDeparture).not.toHaveBeenCalled();
  });
});
