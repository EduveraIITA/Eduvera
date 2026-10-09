import { cleanup,render,screen } from "@testing-library/react";
import { afterEach,describe,expect,it,vi } from "vitest";
import type { FamilyJourney } from "./api";
import { FamilyJourneyCard,journeyMessage } from "./FamilyJourneyCard";
vi.mock("./LiveMap",()=>({LiveMap:()=> <div role="img" aria-label="Journey map"/>}));
const journey:FamilyJourney={id:"trip",state:"in_progress",revision:1,service_date:"2026-10-09",direction:"from_institution",scheduled_departure_time:"15:30",route_name:"South route",route_code:"S",vehicle_label:"Bus 14",provider_name:"",rider_state:"boarded",stop_name:"Library",planned_time:null,latitude:"0",longitude:"0",accuracy_metres:"15",observed_at:"2026-10-09T10:10:00Z",location_fresh:true,boarded_at:"2026-10-09T10:00:00Z",dropped_at:null};
const map={tile_url:"",attribution:""};
afterEach(cleanup);
describe("family journey facts",()=>{
  it("renders valid zero coordinates and clarifies the source",()=>{render(<FamilyJourneyCard journey={journey} map={map}/>);expect(screen.getByRole("img")).toBeVisible();expect(screen.getByText(/phone's last observation/)).toBeVisible();});
  it.each(["expected","dropped","not_riding","exception"])("never shows location for %s riders",rider_state=>{render(<FamilyJourneyCard journey={{...journey,rider_state}} map={map}/>);expect(screen.queryByRole("img")).not.toBeInTheDocument();});
  it("clearly labels stale observations",()=>{render(<FamilyJourneyCard journey={{...journey,location_fresh:false}} map={map}/>);expect(screen.getByText("Location delayed")).toBeVisible();});
  it("places the map before the ride information without promising an ETA",()=>{render(<FamilyJourneyCard journey={journey} map={map}/>);expect(screen.getByRole("img").compareDocumentPosition(screen.getByRole("heading",{name:"South route"})) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();expect(screen.getByText("scheduled")).toBeVisible();expect(screen.queryByText(/arrives in/i)).not.toBeInTheDocument();});
  it.each(["planned","boarding","completed","cancelled"])("hides even retained coordinates on a %s journey",state=>{render(<FamilyJourneyCard journey={{...journey,state}} map={map}/>);expect(screen.queryByRole("img")).not.toBeInTheDocument();});
  it("shows the recorded handover after location sharing ends",()=>{render(<FamilyJourneyCard journey={{...journey,rider_state:"dropped",dropped_at:"2026-10-09T11:00:00Z"}} map={map}/>);expect(screen.queryByRole("img")).not.toBeInTheDocument();expect(screen.getByText("Handover recorded by the assigned attendant.")).toBeVisible();expect(screen.getByRole("list",{name:"Recorded journey progress"})).toHaveTextContent("Handed over");});
  it("distinguishes waiting for GPS from waiting for boarding",()=>{expect(journeyMessage({...journey,latitude:null})).toMatch(/Waiting for a location/);expect(journeyMessage({...journey,rider_state:"expected"})).toMatch(/boarding has not/);});
  it("does not call a cancelled trip not departed",()=>{expect(journeyMessage({...journey,state:"cancelled"})).toMatch(/cancelled/);});
});
