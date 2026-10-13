import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Link, MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PeoplePage from "./PeoplePage";
import { enrollmentOptions, listStudents } from "./api";

vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ memberships: [{ role: "admin", school_id: "school-1" }], hasPortal: (role: string) => role === "principal" }) }));
vi.mock("../../pages/operations/OperationsShell", () => ({ OperationsShell: ({ title, backTo, children }: {title:string;backTo:string;children:ReactNode}) => <><h1>{title}</h1><Link to={backTo}>Go back</Link>{children}</> }));
vi.mock("./api", () => ({ listStudents:vi.fn(), enrollmentOptions:vi.fn() }));
vi.mock("./GuardianAuthorityPanel", () => ({GuardianAuthorityPanel:({onClose}:{onClose:()=>void})=> <section><p>Permission editor</p><button type="button" onClick={onClose}>Close permissions</button></section>}));
vi.mock("./EnrollmentForm", () => ({EnrollmentForm:({onCancel,onSaved}:{onCancel:()=>void;onSaved:(name:string)=>void})=><form aria-label="Enrollment"><button onClick={onCancel} type="button">Cancel</button><button onClick={()=>onSaved("Mira Sen")} type="button">Save enrollment</button></form>}));
beforeEach(()=>{
  vi.mocked(listStudents).mockResolvedValue({results:[{id:"student-1",name:"Mira Sen",admission_number:"S001",avatar_url:"",date_of_birth:"2014-03-04",has_account:true,class_name:"Class 7A",roll_number:1,enrolled_on:"2026-04-01",guardians:[{id:"guardian-1",name:"Arun Sen",phone:"9000000000",relationship:"father",has_account:true}]}],next_cursor:null});
  vi.mocked(enrollmentOptions).mockResolvedValue({results:[{class_section_id:"class-1",term_id:"term-1",class_name:"Class 7A",term_name:"Term 1",starts_on:"2026-04-01",ends_on:"2027-03-31",today:"2026-10-08",next_roll:2}]});
});
afterEach(()=>{cleanup();vi.clearAllMocks();});
function NavigationProbe(){const location=useLocation();const navigate=useNavigate();return <><span data-testid="location">{location.pathname}{location.search}</span><button type="button" onClick={()=>navigate(-1)}>Browser back</button></>;}
function show(path="/principal/students") {render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter initialEntries={[path]}><NavigationProbe/><PeoplePage/></MemoryRouter></QueryClientProvider>);}
describe("student directory hierarchy",()=>{
  it("opens a focused profile and permissions page instead of expanding the directory",async()=>{
    const user=userEvent.setup();show();
    const row=await screen.findByRole("link",{name:"Open Mira Sen student profile"});
    expect(screen.queryByText("Arun Sen")).not.toBeInTheDocument();
    await user.click(row);
    expect(await screen.findByRole("heading",{name:"Guardians"})).toBeVisible();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button",{name:"Manage Arun Sen's permissions for Mira Sen"}));
    expect(screen.getByText("Permission editor")).toBeVisible();
    await user.click(screen.getByRole("link",{name:"Go back"}));
    expect(await screen.findByText("Arun Sen")).toBeVisible();
    await user.click(screen.getByRole("link",{name:"Go back"}));
    expect(await screen.findByRole("searchbox",{name:"Search students"})).toBeVisible();
  });
  it("resolves a direct profile link using the scoped admission lookup",async()=>{
    show("/principal/students?school=school-1&student=student-1&student_key=S001");
    expect(await screen.findByRole("heading",{name:"Mira Sen"})).toBeVisible();
    expect(listStudents).toHaveBeenCalledWith("school-1","S001");
  });
  it("does not reopen guardian permissions after closing them and using browser Back",async()=>{
    const user=userEvent.setup();show();
    await user.click(await screen.findByRole("link",{name:"Open Mira Sen student profile"}));
    await user.click(screen.getByRole("button",{name:"Manage Arun Sen's permissions for Mira Sen"}));
    await user.click(screen.getByRole("button",{name:"Close permissions"}));
    expect(await screen.findByRole("heading",{name:"Guardians"})).toBeVisible();
    await user.click(screen.getByRole("button",{name:"Browser back"}));
    expect(screen.getByRole("heading",{name:"Guardians"})).toBeVisible();
    expect(screen.queryByText("Permission editor")).not.toBeInTheDocument();
  });
  it("does not display a different student for an invalid profile id",async()=>{
    show("/principal/students?student=missing&student_key=S001");
    expect(await screen.findByRole("status")).toHaveTextContent("Loading student");
    expect(await screen.findByText(/Student not found/)).toBeVisible();
    expect(screen.queryByRole("heading",{name:"Mira Sen"})).not.toBeInTheDocument();
  });
  it("opens enrollment alone and returns to the directory on cancel",async()=>{
    const user=userEvent.setup();show();await screen.findByRole("link",{name:"Open Mira Sen student profile"});
    await user.click(screen.getByRole("button",{name:"Add student"}));
    expect(screen.getByRole("form",{name:"Enrollment"})).toBeVisible();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button",{name:"Cancel"}));
    expect(screen.getByRole("searchbox",{name:"Search students"})).toBeVisible();
    await user.click(screen.getByRole("button",{name:"Browser back"}));
    expect(screen.getByRole("searchbox",{name:"Search students"})).toBeVisible();
    expect(screen.queryByRole("form",{name:"Enrollment"})).not.toBeInTheDocument();
  });
  it("does not reopen enrollment after a successful save and browser Back",async()=>{
    const user=userEvent.setup();show();await screen.findByRole("link",{name:"Open Mira Sen student profile"});
    await user.click(screen.getByRole("button",{name:"Add student"}));
    await user.click(screen.getByRole("button",{name:"Save enrollment"}));
    expect(await screen.findByRole("status")).toHaveTextContent("Mira Sen is enrolled");
    await user.click(screen.getByRole("button",{name:"Browser back"}));
    expect(screen.getByRole("searchbox",{name:"Search students"})).toBeVisible();
    expect(screen.queryByRole("form",{name:"Enrollment"})).not.toBeInTheDocument();
  });
});
