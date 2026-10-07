import { fireEvent,render,screen,within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe,expect,it,vi } from "vitest";
import { FamilyResultsPage } from "./AssessmentWorkspacePage";

vi.mock("../../pages/parent/ParentShell",()=>({ParentShell:({children}:{children:React.ReactNode})=><main>{children}</main>}));
vi.mock("../../pages/student/StudentShell",()=>({StudentShell:({children}:{children:React.ReactNode})=><main>{children}</main>}));

describe("published family results",()=>{
  it("shows the immutable release without an introductory banner",()=>{
    render(<MemoryRouter><FamilyResultsPage portal="student" children={[]} onSelect={()=>undefined} data={{student:{id:"student-1",first_name:"Aarav",last_name:"Sharma",admission_number:"A-1",class_name:"Class 7A"},results:[{id:"assessment-1",title:"English mid-term",assessment_kind:"exam",maximum_marks:"80.00",scheduled_at:"2026-10-12T03:30:00.000Z",subject_name:"English",color:"#2563eb",icon:"book",cycle_name:"Term 1 examinations",term_name:"Term 1",academic_year:"2026-27",publication_id:"publication-1",sequence:2,published_at:"2026-10-20T03:30:00.000Z",outcome:"scored",marks:"66.00",grade:"A",feedback:"Clear written work"}]}}/></MemoryRouter>);
    expect(screen.getByText("English mid-term")).toBeInTheDocument();
    expect(screen.getByText("Assessment report")).toBeInTheDocument();
    expect(screen.queryByText("Assessment record · Exam")).not.toBeInTheDocument();
    expect(screen.queryByText("Assessment marksheet")).not.toBeInTheDocument();
    expect(screen.getByText("82.50%")).toBeInTheDocument();
    expect(screen.getByText("66.00")).toBeInTheDocument();
    expect(screen.getByText("66.00/80.00")).toBeInTheDocument();
    expect(screen.getByText("Corrected release")).toBeInTheDocument();
    expect(screen.getByRole("button",{name:"Print / save marksheet"})).toBeInTheDocument();
    expect(screen.queryByText("PUBLISHED RESULTS")).not.toBeInTheDocument();
  });

  it("filters the marksheet gallery by search and academic year",()=>{
    const view=render(<MemoryRouter><FamilyResultsPage portal="student" children={[]} onSelect={()=>undefined} data={{student:{id:"student-1",first_name:"Aarav",last_name:"Sharma",admission_number:"A-1",class_name:"Class 7A"},results:[
      {id:"assessment-1",title:"English mid-term",assessment_kind:"exam",maximum_marks:"80.00",scheduled_at:"2026-10-12T03:30:00.000Z",subject_name:"English",color:"#2563eb",icon:"book",cycle_name:"Term 1 examinations",term_name:"Term 1",academic_year:"2026-27",publication_id:"publication-1",sequence:1,published_at:"2026-10-20T03:30:00.000Z",outcome:"scored",marks:"66.00",grade:"A",feedback:"Clear written work"},
      {id:"assessment-2",title:"Mathematics unit test",assessment_kind:"class_test",maximum_marks:"40.00",scheduled_at:"2025-09-12T03:30:00.000Z",subject_name:"Mathematics",color:"#0f766e",icon:"calculator",cycle_name:"Unit tests",term_name:"Term 2",academic_year:"2025-26",publication_id:"publication-2",sequence:1,published_at:"2025-09-20T03:30:00.000Z",outcome:"scored",marks:"35.00",grade:"A",feedback:"Accurate work"}
    ]}}/></MemoryRouter>);
    const page=within(view.container);
    expect(page.getByText("English mid-term")).toBeInTheDocument();
    expect(page.queryByText("Mathematics unit test")).not.toBeInTheDocument();
    fireEvent.change(page.getByLabelText("Academic year"),{target:{value:"all"}});
    expect(page.getByText("Mathematics unit test")).toBeInTheDocument();
    fireEvent.change(page.getByLabelText("Search marksheets"),{target:{value:"mathematics"}});
    expect(page.queryByText("English mid-term")).not.toBeInTheDocument();
    expect(page.getByText("Mathematics unit test")).toBeInTheDocument();
  });

  it("shows covered assessments once in All and provides a horizontal dot navigator",()=>{
    const view=render(<MemoryRouter><FamilyResultsPage portal="student" children={[]} onSelect={()=>undefined} data={{student:{id:"student-1",first_name:"Aarav",last_name:"Sharma",admission_number:"A-1",class_name:"Class 7A"},results:[
      {id:"assessment-1",title:"English mid-term",assessment_kind:"exam",maximum_marks:"80.00",scheduled_at:"2026-10-12T03:30:00.000Z",subject_name:"English",color:"#2563eb",icon:"book",cycle_name:"Term 1 examinations",term_name:"Term 1",academic_year:"2026-27",publication_id:"publication-1",sequence:1,published_at:"2026-10-20T03:30:00.000Z",outcome:"scored",marks:"66.00",grade:"A",feedback:"Clear written work"},
      {id:"assessment-2",title:"Mathematics class test",assessment_kind:"class_test",maximum_marks:"20.00",scheduled_at:"2026-10-15T03:30:00.000Z",subject_name:"Mathematics",color:"#0f766e",icon:"calculator",cycle_name:"Class tests",term_name:"Term 1",academic_year:"2026-27",publication_id:"publication-2",sequence:1,published_at:"2026-10-21T03:30:00.000Z",outcome:"scored",marks:"17.00",grade:"A",feedback:"Accurate work"}
    ]}} reportCards={{student:{id:"student-1",first_name:"Aarav",last_name:"Sharma",admission_number:"A-1",class_name:"Class 7A"},reports:[{report_student_id:"report-student-1",batch_id:"batch-1",sequence:1,published_at:"2026-10-20T03:30:00.000Z",correction_reason:"",scheme_id:"scheme-1",scheme_name:"Term 1 report",term_name:"Term 1",academic_year:"2026-27",outcome:"complete",overall_percentage:"82.50",overall_grade:"A",class_teacher_comment:"Consistent work.",principal_comment:"Keep progressing.",subjects:[{id:"subject-1",subject_name:"English",color:"#2563eb",icon:"book",outcome:"complete",percentage:"82.50",grade:"A",passed:true,assessment_ids:["assessment-1"]}]}]}}/></MemoryRouter>);
    const page=within(view.container);
    const reportCard=page.getByRole("heading",{name:"Term 1 report"}).closest("article");
    expect(reportCard).toHaveClass("marksheet");
    expect(within(reportCard as HTMLElement).getByText("Term report")).toBeInTheDocument();
    expect(reportCard?.querySelector(".marksheet__identity")).toBeInTheDocument();
    expect(reportCard?.querySelector(".marksheet__summary")).toBeInTheDocument();
    expect(reportCard?.querySelector(".marksheet__subjects")).toBeInTheDocument();
    expect(page.queryByText("English mid-term")).not.toBeInTheDocument();
    expect(page.getByText("Mathematics class test")).toBeInTheDocument();
    const dots=page.getAllByRole("button",{name:/Show marksheet/});
    expect(dots).toHaveLength(2);
    fireEvent.click(dots[1]!);
    expect(dots[1]).toHaveAttribute("aria-current","true");
    fireEvent.click(page.getByRole("tab",{name:"Assessments"}));
    const assessmentCard=page.getByRole("heading",{name:"English mid-term"}).closest("article");
    expect(assessmentCard).toHaveClass("marksheet","assessment-record-marksheet");
    expect(within(assessmentCard as HTMLElement).getByText("Assessment report")).toBeInTheDocument();
    expect(assessmentCard?.querySelector(".marksheet__identity")).toBeInTheDocument();
    expect(assessmentCard?.querySelector(".marksheet__summary")).toBeInTheDocument();
    expect(assessmentCard?.querySelector(".marksheet__subjects")).toBeInTheDocument();
    expect(page.queryByText("Term 1 report")).not.toBeInTheDocument();
  });

  it("renders a clear unpublished empty state",()=>{
    render(<MemoryRouter><FamilyResultsPage portal="student" children={[]} onSelect={()=>undefined} data={{student:{id:"student-1",first_name:"Aarav",last_name:"Sharma",admission_number:"A-1",class_name:"Class 7A"},results:[]}}/></MemoryRouter>);
    expect(screen.getByText("No published results")).toBeInTheDocument();
    expect(screen.queryByText(/Draft marks and moderation work stay private/i)).not.toBeInTheDocument();
  });
});
