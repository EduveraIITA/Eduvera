import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {MemoryRouter} from "react-router-dom";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {getPrincipalInsights,type PrincipalInsights} from "./api";
import {InsightContent,PrincipalInsightsDashboard} from "./PrincipalInsightsDashboard";
vi.mock("./api",()=>({getPrincipalInsights:vi.fn()}));
vi.mock("../auth/AuthContext",()=>({useOptionalAuth:()=>({status:"authenticated",user:{id:"admin",active_school_id:"school-1"},memberships:[{role:"admin",school_id:"school-1"}]})}));
export const fixture:PrincipalInsights={
  school_id:"school-1",school_name:"Test school",generated_at:"2026-10-07T12:00:00Z",timezone:"Asia/Kolkata",operational_date:"2026-10-07",class_section_id:null,threshold:50,
  period:{start:"2026-09-10",end:"2026-10-07",baseline_start:"2026-08-13",baseline_end:"2026-09-09",days:28},classes:[{id:"class-7",name:"Class 7A"}],
  attendance:{expected:200,recorded:180,scored:180,points:162,percentage:90,completeness:90,daily:[{date:"2026-10-05",expected:100,recorded:90,scored:90,points:81,percentage:90}],classes:[{id:"class-7",name:"Class 7A",expected:200,recorded:180,scored:180,points:162,percentage:90,completeness:90}]},
  engagement:{total:1,combined:1,without_followup:1,without_followup_students:[],students:[{id:"student-1",name:"Anaya Test",class_id:"class-7",class_name:"Class 7A",expected:10,recorded:10,scored:10,points:8,previous_expected:10,previous_recorded:10,previous_scored:10,previous_points:10,missing_homework:2,open_followups:0,current:80,previous:100,change:-20,combined:true}]},
  followups:{awaiting:1,review:0,resolved:2,overdue:1,details:[{id:"followup-1",student_name:"Anaya Test",class_id:"class-7",attendance_date:"2026-10-05",state:"awaiting_response",owner:"Teacher One",overdue:true}]},
  learning:[{id:"assessment-1",title:"Fractions assessment",class_name:"Class 7A",subject:"Mathematics",assessed:20,below:6,roster:22,published_at:"2026-10-05T12:00:00Z"}],
  schedule:[{date:"2026-10-07",planned:5,unassigned:1,cancelled:0}],deadlines:[{date:"2026-10-08",class_id:"class-7",class_name:"Class 7A",homework:2,assessments:1,total:3}],
  fees:[{band:"1–30 days",due_paise:10000,paid_paise:4000,balance_paise:6000}],
};
let client:QueryClient;
beforeEach(()=>{client=new QueryClient({defaultOptions:{queries:{retry:false}}});vi.mocked(getPrincipalInsights).mockResolvedValue(fixture);HTMLDialogElement.prototype.showModal=function(){this.setAttribute("open","");};HTMLDialogElement.prototype.close=function(){this.removeAttribute("open");};});
afterEach(()=>{cleanup();client.clear();vi.clearAllMocks();});
function mount(){return render(<QueryClientProvider client={client}><MemoryRouter><PrincipalInsightsDashboard date="2026-10-07"/></MemoryRouter></QueryClientProvider>);}
describe("principal insights",()=>{
  it("loads in the active institution and changes filters without discarding the selected date",async()=>{
    mount();await screen.findByText("90.0%",{selector:"strong"});expect(getPrincipalInsights).toHaveBeenCalledWith("school-1","2026-10-07",28,"",50);
    await userEvent.selectOptions(screen.getByLabelText("Review window"),"14");await waitFor(()=>expect(getPrincipalInsights).toHaveBeenCalledWith("school-1","2026-10-07",14,"",50));
    await screen.findByRole("option",{name:"Class 7A"});await userEvent.selectOptions(screen.getByLabelText("Class"),"class-7");await waitFor(()=>expect(getPrincipalInsights).toHaveBeenCalledWith("school-1","2026-10-07",14,"class-7",50));
  });
  it("explains evidence, opens source links and dismisses the dialog",async()=>{
    mount();await userEvent.click(await screen.findByRole("button",{name:/Students to check in with/}));
    const dialog=screen.getByRole("dialog");expect(dialog).toHaveTextContent("Anaya Test");expect(dialog).toHaveTextContent("10 percentage-point");expect(screen.getByRole("link",{name:"Review class register"})).toHaveAttribute("href","/principal/attendance?class_section_id=class-7&date=2026-10-07");
    fireEvent(dialog,new Event("cancel",{bubbles:true}));expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("shows missing records and published-assessment participation explicitly",async()=>{
    mount();expect(await screen.findByText(/20 student-days are unrecorded/)).toBeInTheDocument();
    await userEvent.click(screen.getByText("All assessments and participation"));expect(screen.getByText(/20\/22 scored/)).toBeInTheDocument();
    await userEvent.click(screen.getByText("Weekly values and completeness"));expect(screen.getByRole("table")).toHaveTextContent("90 / 100");
  });
  it("uses empty states instead of invented zero percentages",()=>{
    const empty={...fixture,attendance:{...fixture.attendance,expected:0,recorded:0,scored:0,points:0,percentage:null,completeness:null,daily:[],classes:[]},learning:[]};
    render(<MemoryRouter><InsightContent data={empty}/></MemoryRouter>);expect(screen.getByText("Not recorded",{selector:"strong"})).toBeInTheDocument();expect(screen.getByText(/No scored, published assessments/)).toBeInTheDocument();
  });
  it("keeps a recoverable error state",async()=>{
    vi.mocked(getPrincipalInsights).mockRejectedValue(new Error("Unavailable"));mount();expect(await screen.findByRole("alert",{}, {timeout:5000})).toHaveTextContent("Insights could not be loaded");expect(screen.getByRole("button",{name:"Try again"})).toBeInTheDocument();
  });
});
