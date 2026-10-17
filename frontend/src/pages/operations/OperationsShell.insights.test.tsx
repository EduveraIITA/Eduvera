import {afterEach,describe,expect,it,vi} from "vitest";
import {cleanup,render,within} from "@testing-library/react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {MemoryRouter} from "react-router-dom";
import {OperationsShell} from "./OperationsShell";
const state=vi.hoisted(()=>({permissions:["attendance.view","timetable.view"]}));
vi.mock("../../features/auth/AuthContext",()=>({useOptionalAuth:()=>({memberships:[{role:"staff",school_id:"school-1",permissions:state.permissions}]})}));
vi.mock("../../features/auth/AccountMenu",()=>({AccountMenu:()=>null}));
vi.mock("../../features/notifications/NotificationCenter",()=>({NotificationCenter:()=>null}));
afterEach(()=>{cleanup();state.permissions=["attendance.view","timetable.view"];});
const renderShell=(route:string,shell:React.ReactNode)=>{
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[route]}>{shell}</MemoryRouter></QueryClientProvider>);
};
describe("principal Insights navigation",()=>{
  it("shows Insights in desktop and mobile navigation with an active state",()=>{
    const {container}=renderShell("/principal/insights",<OperationsShell portal="principal" active="insights" title="Insights">Content</OperationsShell>);
    const mobile=within(container.querySelector<HTMLElement>(".operations-mobile-nav")!);
    // JSDOM does not apply responsive media queries; browser QA checks visibility.
    expect(mobile.getAllByRole("link",{hidden:true}).map(link=>link.textContent)).toEqual(["Overview","Attendance","Insights","More"]);
    expect(mobile.queryByRole("button",{name:"Assistant",hidden:true})).not.toBeInTheDocument();
    expect([...container.querySelector(".operations-mobile-nav")!.children].map(item=>item.textContent)).toEqual(["Overview","Attendance","Insights","More"]);
    expect(mobile.getByRole("link",{name:"Insights",hidden:true})).toHaveAttribute("aria-current","page");
    expect(within(container.querySelector<HTMLElement>(".operations-sidebar")!).getByRole("link",{name:"Timetable"})).toHaveAttribute("href","/principal/timetable");
  });
  it("preserves the teacher timetable tab",()=>{
    const {container}=renderShell("/teacher",<OperationsShell portal="teacher" active="home" title="Today">Content</OperationsShell>);
    const mobile=within(container.querySelector<HTMLElement>(".operations-mobile-nav")!);
    expect(mobile.getByRole("link",{name:"Timetable",hidden:true})).toBeInTheDocument();
    expect(mobile.queryByRole("link",{name:"Insights",hidden:true})).not.toBeInTheDocument();
    expect(mobile.queryByRole("link",{name:"In & Out",hidden:true})).not.toBeInTheDocument();
  });
  it("adds the In & Out tab only when staff have gate permission",()=>{
    state.permissions.push('gate.manage');
    const {container}=renderShell('/teacher/gate',<OperationsShell portal="teacher" active="gate" title="In & Out">Content</OperationsShell>);
    const mobile=within(container.querySelector<HTMLElement>('.operations-mobile-nav')!);
    expect(mobile.getByRole('link',{name:'In & Out',hidden:true})).toHaveAttribute('href','/teacher/gate');
    expect(mobile.getByRole('link',{name:'In & Out',hidden:true})).toHaveAttribute('aria-current','page');
    expect([...container.querySelector('.operations-mobile-nav')!.children].map(item=>item.textContent)).toEqual(['Today','Attendance','Timetable','In & Out','More']);
  });
  it("gives map-like workspaces the complete viewport without duplicate app chrome",()=>{
    const {container}=renderShell('/principal/campus',<OperationsShell portal="principal" active="more" title="Campus view" layout="canvas"><span>Bounded campus canvas</span></OperationsShell>);
    expect(container.querySelector('.operations-app--canvas')).toBeInTheDocument();
    expect(container.querySelector('.operations-sidebar')).not.toBeInTheDocument();
    expect(container.querySelector('.operations-topbar')).not.toBeInTheDocument();
    expect(container.querySelector('.operations-mobile-nav')).not.toBeInTheDocument();
    expect(container.querySelector('.operations-main')).toHaveTextContent('Bounded campus canvas');
  });
});
