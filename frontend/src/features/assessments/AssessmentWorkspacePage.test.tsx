import { render,screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe,expect,it,vi } from "vitest";
import { FamilyResultsPage } from "./AssessmentWorkspacePage";

vi.mock("../../pages/parent/ParentShell",()=>({ParentShell:({children}:{children:React.ReactNode})=><main>{children}</main>}));
vi.mock("../../pages/student/StudentShell",()=>({StudentShell:({children}:{children:React.ReactNode})=><main>{children}</main>}));

describe("published family results",()=>{
  it("shows the immutable release without an introductory banner",()=>{
    render(<MemoryRouter><FamilyResultsPage portal="student" children={[]} onSelect={()=>undefined} data={{student:{id:"student-1",first_name:"Aarav",last_name:"Sharma",admission_number:"A-1",class_name:"Class 7A"},results:[{id:"assessment-1",title:"English mid-term",assessment_kind:"exam",maximum_marks:"80.00",scheduled_at:"2026-10-12T03:30:00.000Z",subject_name:"English",color:"#2563eb",icon:"book",cycle_name:"Term 1",publication_id:"publication-1",sequence:2,published_at:"2026-10-20T03:30:00.000Z",outcome:"scored",marks:"66.00",grade:"A",feedback:"Clear written work"}]}}/></MemoryRouter>);
    expect(screen.getByText("English mid-term")).toBeInTheDocument();
    expect(screen.getByText("66.00")).toBeInTheDocument();
    expect(screen.getByText("Correction 2")).toBeInTheDocument();
    expect(screen.queryByText("PUBLISHED RESULTS")).not.toBeInTheDocument();
  });

  it("renders a clear unpublished empty state",()=>{
    render(<MemoryRouter><FamilyResultsPage portal="student" children={[]} onSelect={()=>undefined} data={{student:{id:"student-1",first_name:"Aarav",last_name:"Sharma",admission_number:"A-1",class_name:"Class 7A"},results:[]}}/></MemoryRouter>);
    expect(screen.getByText("No published results")).toBeInTheDocument();
    expect(screen.queryByText(/Draft marks and moderation work stay private/i)).not.toBeInTheDocument();
  });
});
