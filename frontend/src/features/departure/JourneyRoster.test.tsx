import { cleanup,fireEvent,render,screen,waitFor } from "@testing-library/react";
import { afterEach,describe,expect,it,vi } from "vitest";
import type { CollectorTrip,Rider } from "./api";
import { JourneyRoster } from "./JourneyRoster";
const rider:Rider={student_id:"learner",state:"expected",revision:1,boarded_at:null,dropped_at:null,outcome_note:"",student_name:"Aarav",admission_number:"S1",stop_id:"stop",stop_name:"Library",stop_sequence:1,planned_time:null};
const trip={id:"trip",state:"planned",direction:"from_institution",collector_assignment_status:"accepted",roster:[rider]} as CollectorTrip;
afterEach(cleanup);
describe("journey rider controls",()=>{
  it("shows review only before boarding",()=>{render(<JourneyRoster trip={trip} pending={false} onRecord={vi.fn()}/>);expect(screen.queryByRole("button",{name:"Board",exact:true})).not.toBeInTheDocument();expect(screen.getByText(/recording opens/)).toBeVisible();});
  it("records boarding with one tap and no notes form",async()=>{
    const onRecord=vi.fn().mockResolvedValue(undefined);render(<JourneyRoster trip={{...trip,state:"boarding"}} pending={false} onRecord={onRecord}/>);
    fireEvent.click(screen.getByRole("button",{name:"Board",exact:true}));
    await waitFor(()=>expect(onRecord).toHaveBeenCalledWith(rider,"boarded",""));expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
  it.each(["from_institution","to_institution"])("records routine %s handover with one tap",async direction=>{
    const boarded={...rider,state:"boarded" as const,boarded_at:"2026-10-09T08:00:00Z"};const onRecord=vi.fn().mockResolvedValue(undefined);
    render(<JourneyRoster trip={{...trip,direction:direction as CollectorTrip["direction"],state:"in_progress",roster:[boarded]}} pending={false} onRecord={onRecord}/>);
    fireEvent.click(screen.getByRole("button",{name:direction==="to_institution"?"Confirm arrival":"Confirm handover"}));
    await waitFor(()=>expect(onRecord).toHaveBeenCalledWith(boarded,"dropped",""));expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
  it("records not riding immediately and prevents double submissions",async()=>{
    let finish!:()=>void;const onRecord=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;}));
    render(<JourneyRoster trip={{...trip,state:"boarding"}} pending={false} onRecord={onRecord}/>);
    const button=screen.getByRole("button",{name:"Not riding"});fireEvent.click(button);fireEvent.click(button);
    expect(onRecord).toHaveBeenCalledExactlyOnceWith(rider,"not_riding","");expect(button).toBeDisabled();expect(screen.getByRole("status")).toHaveTextContent("Saving");
    finish();await waitFor(()=>expect(button).not.toBeDisabled());
  });
  it("keeps a failed one-tap action retryable without claiming success",async()=>{
    const onRecord=vi.fn().mockRejectedValueOnce(new Error("Connection lost")).mockResolvedValue(undefined);
    render(<JourneyRoster trip={{...trip,state:"boarding"}} pending={false} onRecord={onRecord}/>);
    fireEvent.click(screen.getByRole("button",{name:"Board",exact:true}));await screen.findByRole("alert");expect(screen.queryByText(/on board recorded/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"Board",exact:true}));await waitFor(()=>expect(screen.getByRole("status")).toHaveTextContent("on board recorded"));
  });
  it("requires a note only for reporting or resolving a concern",()=>{
    const onRecord=vi.fn();render(<JourneyRoster trip={{...trip,state:"in_progress",roster:[{...rider,state:"boarded"}]}} pending={false} onRecord={onRecord}/>);
    fireEvent.click(screen.getByRole("button",{name:"Report concern"}));expect(screen.getByLabelText("What needs attention?")).toBeVisible();expect(screen.getByRole("button",{name:"Confirm needs help"})).toBeDisabled();expect(onRecord).not.toHaveBeenCalled();
  });
  it("keeps historical notes available without displaying their full text by default",()=>{
    render(<JourneyRoster trip={{...trip,roster:[{...rider,state:"boarded",outcome_note:"Historical evidence"}]}} pending={false} onRecord={vi.fn()}/>);
    expect(screen.getByText("Historical evidence").closest("details")).not.toHaveAttribute("open");
  });
  it("offers location focus, manual stop selection and the complete roster",()=>{
    const second={...rider,student_id:"other",student_name:"Ananya",stop_id:"other-stop",stop_name:"Road stop",stop_sequence:2};
    render(<JourneyRoster trip={{...trip,state:"in_progress",direction:"to_institution",roster:[rider,second],stops:[{id:"stop",name:"Library",direction:"to_institution",sequence:1,latitude:"32.111946",longitude:"77.164802",planned_time:null},{id:"other-stop",name:"Road stop",direction:"to_institution",sequence:2,latitude:"32.113298",longitude:"77.168612",planned_time:null}],latest_location:{latitude:"32.111946",longitude:"77.164802",accuracy_metres:"10",observed_at:new Date().toISOString()},location_fresh:true}} pending={false} onRecord={vi.fn()}/>);
    fireEvent.click(screen.getByRole("button",{name:"Stop focus"}));expect(screen.getByText("Aarav")).toBeVisible();expect(screen.queryByText("Ananya")).not.toBeInTheDocument();expect(screen.getByText("Nearby")).toBeVisible();
    fireEvent.change(screen.getByRole("combobox",{name:"Focused stop"}),{target:{value:"other-stop"}});expect(screen.getByText("Ananya")).toBeVisible();expect(screen.queryByText("Aarav")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"All riders · 2"}));expect(screen.getByText("Aarav")).toBeVisible();expect(screen.getByText("Ananya")).toBeVisible();
  });
  it("supports resolving a boarded concern while preserving the evidence on failure",async()=>{
    const onRecord=vi.fn().mockRejectedValue(new Error("Network error"));render(<JourneyRoster trip={{...trip,state:"in_progress",roster:[{...rider,state:"exception",boarded_at:"2026-10-09T10:00:00Z"}]}} pending={false} onRecord={onRecord}/>);
    fireEvent.click(screen.getByRole("button",{name:"Resolve & confirm handover"}));
    const note=screen.getByLabelText("How was the concern resolved?");fireEvent.change(note,{target:{value:"Approved receiver verified with school"}});
    fireEvent.click(screen.getByRole("button",{name:"Confirm handed over"}));await waitFor(()=>expect(onRecord).toHaveBeenCalled());expect(note).toHaveValue("Approved receiver verified with school");
  });
  it("uses arrival terminology for inbound journeys",()=>{render(<JourneyRoster trip={{...trip,state:"in_progress",direction:"to_institution",roster:[{...rider,state:"boarded",boarded_at:"2026-10-09T08:00:00Z"}]}} pending={false} onRecord={vi.fn()}/>);expect(screen.getByRole("button",{name:"Confirm arrival"})).toBeVisible();});
  it.each(["completed","cancelled"] as const)("has no write actions after %s",state=>{render(<JourneyRoster trip={{...trip,state}} pending={false} onRecord={vi.fn()}/>);expect(screen.queryByRole("button")).not.toBeInTheDocument();});
});
