import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {cleanup,fireEvent,render,screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {afterEach,describe,it,expect,vi} from "vitest";
import {EnrollmentForm} from "./EnrollmentForm";
import {commitEnrollment,reviewEnrollment,searchGuardians,type EnrollmentInput} from "./api";
vi.mock("./api",()=>({reviewEnrollment:vi.fn(),commitEnrollment:vi.fn(),searchGuardians:vi.fn()}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
const options=[{class_section_id:"class-7a",term_id:"term-1",class_name:"Class 7A",term_name:"Term 1",starts_on:"2026-07-01",ends_on:"2026-12-31",today:"2026-09-15",next_roll:26}];
function mount(){
  const onSaved=vi.fn();
  vi.mocked(reviewEnrollment).mockImplementation((input:EnrollmentInput)=>Promise.resolve({id:"review-1",expires_at:"2026-09-15T18:00:00Z",input,class_name:"Class 7A",term_name:"Term 1",guardian:{id:"",name:"Nandita Deshmukh",phone:"9000011001"},warnings:[]}));
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><EnrollmentForm schoolId="school-1" options={options} onCancel={vi.fn()} onSaved={onSaved}/></QueryClientProvider>);
  return onSaved;
}
function fill(){for(const [label,value] of Object.entries({"Student first name":"Ishaan","Student last name":"Deshmukh","Admission number":"CIS-2026-201","Date of birth":"2014-04-12","Guardian first name":"Nandita","Guardian last name":"Deshmukh","Contact phone":"9000011001"}))fireEvent.change(screen.getByLabelText(label),{target:{value}});}
describe("Reviewed student enrollment",()=>{
  it("does not save before an explicit review and confirmation",async()=>{
    mount();fill();const user=userEvent.setup();await user.click(screen.getByRole("button",{name:"Review enrollment"}));
    expect(await screen.findByRole("heading",{name:"Review before saving"})).toBeInTheDocument();
    expect(commitEnrollment).not.toHaveBeenCalled();expect(screen.getByRole("button",{name:"Confirm enrollment"})).toBeDisabled();
    expect(screen.getByText("Not granted")).toBeInTheDocument();expect(screen.getByText(/No login credentials or attendance marks/)).toBeInTheDocument();
  });
  it("keeps the review and idempotent review ID after an interrupted save",async()=>{
    const saved=mount();fill();const user=userEvent.setup();vi.mocked(commitEnrollment).mockRejectedValueOnce(new Error("Connection interrupted")).mockResolvedValueOnce({student_id:"student-201"});
    await user.click(screen.getByRole("button",{name:"Review enrollment"}));
    await user.click(await screen.findByLabelText("I have verified the student details and guardian relationship."));
    await user.click(screen.getByRole("button",{name:"Confirm enrollment"}));expect(await screen.findByRole("alert")).toHaveTextContent("Connection interrupted");
    await user.click(screen.getByRole("button",{name:"Confirm enrollment"}));
    expect(commitEnrollment).toHaveBeenNthCalledWith(1,"review-1");expect(commitEnrollment).toHaveBeenNthCalledWith(2,"review-1");expect(saved).toHaveBeenCalledWith("Ishaan Deshmukh");
  });
  it("requires explicit selection of an existing guardian instead of matching automatically",async()=>{
    mount();const user=userEvent.setup();vi.mocked(searchGuardians).mockResolvedValue({results:[{id:"guardian-1",name:"Pooja Sharma",phone:"9000011111",linked_admissions:"CIS-2023-071"}]});
    await user.selectOptions(screen.getByLabelText("Guardian record"),"existing");
    await user.type(screen.getByLabelText("Find guardian by name, phone or admission number"),"Pooja");await user.click(screen.getByRole("button",{name:"Search guardians"}));
    expect(await screen.findByLabelText("Choose the verified guardian")).toHaveValue("");expect(screen.getByRole("button",{name:"Review enrollment"})).toBeDisabled();
    await user.selectOptions(screen.getByLabelText("Choose the verified guardian"),"guardian-1");expect(screen.getByRole("button",{name:"Review enrollment"})).not.toBeDisabled();
  });
});
