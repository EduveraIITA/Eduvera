import { QueryClient,QueryClientProvider } from "@tanstack/react-query";
import { cleanup,fireEvent,render,screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter,Route,Routes } from "react-router-dom";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import type { CollectorDeparture,CollectorTrip } from "./api";
import CollectorJourneyPage from "./CollectorJourneyPage";
const api=vi.hoisted(()=>({getCollectorDeparture:vi.fn()}));
vi.mock("./api",async()=>({...await vi.importActual("./api"),getCollectorDeparture:api.getCollectorDeparture}));
vi.mock("../auth/AuthContext",()=>({useAuth:()=>({user:{id:"staff"},memberships:[]})}));
vi.mock("../../pages/operations/OperationsShell",()=>({OperationsShell:({children,title}:{children:ReactNode;title:string})=><main><h1>{title}</h1>{children}</main>}));
vi.mock("./useJourneyTracking",()=>({useJourneyTracking:()=>({status:"paused",running:false,message:"",start:vi.fn(),stop:vi.fn()})}));
vi.mock("./LiveMap",()=>({LiveMap:()=> <div role="img" aria-label="Journey map"/>}));
const trip:CollectorTrip={id:"trip",school_id:"school",route_id:"route",school_name:"School",service_date:"2026-10-09",local_date:"2026-10-09",direction:"from_institution",service_pattern_id:null,service_pattern_label:null,scheduled_departure_time:"15:30",assigned_collector_user_id:"staff",backup_collector_user_id:null,collector_assignment_status:"accepted",assignment_note:"",state:"planned",revision:2,route_name:"South route",route_code:"S",vehicle_label:"Bus 14",backup_collector_name:null,provider_name:"",roster:[],latest_location:null,controls_open_at:"2026-10-09T10:00:00Z",controls_available:false,duty_change_available:true};
const data:CollectorDeparture={trips:[trip],swaps:[],swap_candidates:[],colleagues:[],map:{tile_url:"",attribution:""},tracking:{foreground_only:true,min_interval_seconds:10}};
function view(path="/teacher/transport/trip") {const client=new QueryClient({defaultOptions:{queries:{retry:false}}});return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><Routes><Route path="/teacher/transport" element={<CollectorJourneyPage/>}/><Route path="/teacher/transport/:tripId" element={<CollectorJourneyPage/>}/></Routes></MemoryRouter></QueryClientProvider>);}
beforeEach(()=>api.getCollectorDeparture.mockResolvedValue(data));
afterEach(()=>{cleanup();vi.clearAllMocks();});
describe("staff ride navigation and timing",()=>{
  it("replaces the dropdown with dated ride links and a separate detail page",async()=>{view("/teacher/transport");expect(await screen.findByRole("heading",{name:"My rides"})).toBeVisible();expect(screen.getByRole("region",{name:"Today"})).toBeVisible();expect(screen.queryByRole("combobox")).not.toBeInTheDocument();fireEvent.click(screen.getByRole("link",{name:/15:30 South route/}));expect(await screen.findByRole("heading",{name:"Transport journey"})).toBeVisible();});
  it("keeps controls hidden before the operating window",async()=>{view();expect(await screen.findByRole("button",{name:"Request a duty change"})).toBeVisible();expect(screen.queryByRole("button",{name:"Open boarding"})).not.toBeInTheDocument();expect(screen.queryByRole("button",{name:"Cancel journey"})).not.toBeInTheDocument();});
  it("opens boarding and removes duty changes inside the operating window",async()=>{api.getCollectorDeparture.mockResolvedValue({...data,trips:[{...trip,controls_available:true,duty_change_available:false}]});view();expect(await screen.findByRole("button",{name:"Open boarding"})).toBeEnabled();expect(screen.queryByRole("button",{name:"Request a duty change"})).not.toBeInTheDocument();});
  it("does not silently open another ride for a missing link",async()=>{view("/teacher/transport/missing");expect(await screen.findByText("Ride unavailable")).toBeVisible();expect(screen.queryByRole("heading",{name:"South route"})).not.toBeInTheDocument();});
  it("keeps terminal rides read-only",async()=>{api.getCollectorDeparture.mockResolvedValue({...data,trips:[{...trip,state:"completed",duty_change_available:false}]});view();expect(await screen.findByRole("heading",{name:"South route"})).toBeVisible();expect(screen.queryByRole("region",{name:"Journey actions"})).not.toBeInTheDocument();expect(screen.queryByRole("button",{name:"Request a duty change"})).not.toBeInTheDocument();});
});
