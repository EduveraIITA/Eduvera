import { cleanup,fireEvent,render,screen } from "@testing-library/react";
import { afterEach,describe,expect,it,vi } from "vitest";
import type { CollectorTrip } from "./api";
import { CollectorRideCard } from "./CollectorRideCard";
vi.mock("./LiveMap",()=>({LiveMap:()=> <div role="img" aria-label="Journey map"/>}));
const trip:CollectorTrip={controls_open_at:"2026-10-09T09:30:00Z",controls_available:true,duty_change_available:false,id:"trip",school_id:"school",route_id:"route",school_name:"School",service_date:"2026-10-09",local_date:"2026-10-09",direction:"from_institution",service_pattern_id:null,service_pattern_label:null,scheduled_departure_time:"15:30",assigned_collector_user_id:"staff",backup_collector_user_id:null,collector_assignment_status:"accepted",assignment_note:"",state:"in_progress",revision:4,route_name:"South route",route_code:"S",vehicle_label:"Bus 14",backup_collector_name:null,provider_name:"",roster:[],latest_location:{latitude:"12.9",longitude:"77.6",accuracy_metres:"15",observed_at:"2026-10-09T10:10:00Z"},location_fresh:true};
const map={tile_url:"",attribution:""};
const tracker={status:"paused" as const,running:false,message:"",start:vi.fn(()=>Promise.resolve()),stop:vi.fn()};
afterEach(()=>{cleanup();vi.clearAllMocks();});
describe("staff ride summary",()=>{
  it("leads an active ride with its map",()=>{render(<CollectorRideCard trip={trip} map={map} tracker={tracker}/>);expect(screen.getByRole("img").compareDocumentPosition(screen.getByRole("heading",{name:"South route"})) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();expect(screen.getByText("On the way")).toBeVisible();});
  it.each(["planned","boarding","completed","cancelled"] as const)("does not show an old location in the %s state",state=>{render(<CollectorRideCard trip={{...trip,state}} map={map} tracker={tracker}/>);expect(screen.queryByRole("img")).not.toBeInTheDocument();expect(screen.queryByRole("button",{name:"Share location"})).not.toBeInTheDocument();});
  it("shows automatic startup without an empty map or extra sharing button",()=>{render(<CollectorRideCard trip={{...trip,latest_location:null}} map={map} tracker={tracker}/>);expect(screen.queryByRole("img")).not.toBeInTheDocument();expect(screen.getByRole("status")).toHaveTextContent("automatically");expect(screen.queryByRole("button")).not.toBeInTheDocument();});
  it("lets staff pause active sharing",()=>{render(<CollectorRideCard trip={trip} map={map} tracker={{...tracker,status:"sharing",running:true,message:"Location sharing is on."}}/>);expect(screen.getByRole("status")).toHaveTextContent("sharing is on");fireEvent.click(screen.getByRole("button",{name:"Pause location sharing"}));expect(tracker.stop).toHaveBeenCalledOnce();});
  it("offers an explicit retry for denied permission",()=>{render(<CollectorRideCard trip={trip} map={map} tracker={{...tracker,status:"unavailable",message:"Location permission was denied."}}/>);fireEvent.click(screen.getByRole("button",{name:"Retry location sharing"}));expect(tracker.start).toHaveBeenCalledOnce();});
});
