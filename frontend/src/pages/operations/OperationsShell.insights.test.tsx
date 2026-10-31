import {afterEach,describe,expect,it,vi} from "vitest";
import {cleanup,render,within} from "@testing-library/react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {MemoryRouter} from "react-router-dom";
import {OperationsShell} from "./OperationsShell";
const state=vi.hoisted(()=>({permissions:["attendance.view","timetable.view"],onboarding:undefined as undefined|{status:"ready";resume:{step:"operating";goal:string;path:string}},proEnabled:false}));
vi.mock("../../features/auth/AuthContext",()=>({useOptionalAuth:()=>({memberships:[{role:"staff",school_id:"school-1",permissions:state.permissions}],onboarding:state.onboarding,user:state.proEnabled?{id:"principal"}:undefined})}));
vi.mock("../../features/auth/useProFeatures",()=>({useProFeatures:()=>({enabled:state.proEnabled})}));
vi.mock("../../features/auth/AccountMenu",()=>({AccountMenu:()=>null}));
vi.mock("../../features/notifications/NotificationCenter",()=>({NotificationCenter:()=>null}));
afterEach(()=>{cleanup();state.permissions=["attendance.view","timetable.view"];state.onboarding=undefined;state.proEnabled=false;});
const renderShell=(route:string,shell:React.ReactNode)=>{
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[route]}>{shell}</MemoryRouter></QueryClientProvider>);
};
describe("responsibility-composed operations navigation",()=>{
  it.each(["/areas/timetable", "/areas/calendar"])("does not inject a combined Timetable/Calendar navigation at %s", (route)=>{
    const {container}=renderShell(route,<OperationsShell active="areas" title="Area">Content</OperationsShell>);
    expect(within(container).queryByRole("navigation",{name:"Timetable and calendar"})).not.toBeInTheDocument();
    expect(container.querySelector(".planning-navigation")).not.toBeInTheDocument();
  });
  it("retains accessible destination names when tablet navigation hides the text labels",()=>{
    const {container}=renderShell("/more",<OperationsShell active="more" title="More">Content</OperationsShell>);
    const desktop=within(container.querySelector<HTMLElement>(".operations-sidebar")!);
    for(const label of ["Today","Work","Areas","More"]){
      const link=desktop.getByRole("link",{name:label,exact:true});
      expect(link).toHaveAttribute("aria-label",label);
      link.querySelector("span")!.style.display="none";
      expect(desktop.getByRole("link",{name:label,exact:true})).toBe(link);
    }
  });
  it.each(["/today", "/work", "/areas", "/more"])("does not show a redundant back action at primary destination %s", (route)=>{
    const {container}=renderShell(route,<OperationsShell active="today" title="Workspace">Content</OperationsShell>);
    expect(within(container).queryByRole("button",{name:"Go back"})).not.toBeInTheDocument();
    expect(within(container).getAllByRole("heading",{level:1})).toHaveLength(1);
  });
  it("lets a domain own its single page heading while retaining context and Back",()=>{
    const {container}=renderShell("/areas/people/participants",<OperationsShell active="areas" title="People" contentHasHeading><h1>People & groups</h1></OperationsShell>);
    expect(container.querySelector('.operations-app--content-heading')).toBeInTheDocument();
    expect(within(container).getAllByRole("heading",{level:1})).toHaveLength(1);
    expect(within(container).getByRole("button",{name:"Go back"})).toBeInTheDocument();
  });
  it("keeps one stable workspace navigation and maps domain screens to Areas",()=>{
    const {container}=renderShell("/principal/insights",<OperationsShell portal="principal" active="insights" title="Insights">Content</OperationsShell>);
    const mobile=within(container.querySelector<HTMLElement>(".operations-mobile-nav")!);
    // JSDOM does not apply responsive media queries; browser QA checks visibility.
    expect(mobile.getAllByRole("link",{hidden:true}).map(link=>link.textContent)).toEqual(["Today","Work","Areas","More"]);
    expect(mobile.queryByRole("button",{name:"Assistant",hidden:true})).not.toBeInTheDocument();
    expect([...container.querySelector(".operations-mobile-nav")!.children].map(item=>item.textContent)).toEqual(["Today","Work","Areas","More"]);
    expect(mobile.getByRole("link",{name:"Areas",hidden:true})).toHaveClass("is-active");
  });
  it("maps an old home screen to Today without restoring a persona menu",()=>{
    const {container}=renderShell("/teacher",<OperationsShell portal="teacher" active="home" title="Today">Content</OperationsShell>);
    const mobile=within(container.querySelector<HTMLElement>(".operations-mobile-nav")!);
    expect(mobile.getByRole("link",{name:"Today",hidden:true})).toHaveClass("is-active");
    expect(mobile.getAllByRole("link",{hidden:true}).map(link=>link.textContent)).toEqual(["Today","Work","Areas","More"]);
  });
  it("maps a retained gate screen to Areas",()=>{
    const {container}=renderShell('/gate',<OperationsShell portal="principal" active="gate" title="In & Out">Content</OperationsShell>);
    const desktop=within(container.querySelector<HTMLElement>('.operations-sidebar')!);
    const mobile=within(container.querySelector<HTMLElement>('.operations-mobile-nav')!);
    expect(desktop.getByRole('link',{name:'Areas'})).toHaveAttribute('href','/areas');
    expect(desktop.getByRole('link',{name:'Areas'})).toHaveClass("is-active");
    expect(mobile.getByRole('link',{name:'Areas',hidden:true})).toHaveClass("is-active");
  });
  it("keeps ThatCampus AI as a persistent action without changing the four destinations",()=>{
    state.onboarding={status:'ready',resume:{step:'operating',goal:'gate',path:'/gate'}};
    state.proEnabled=true;
    const {container}=renderShell('/principal',<OperationsShell portal="principal" active="home" title="Overview">Content</OperationsShell>);
    const mobile=within(container.querySelector<HTMLElement>('.operations-mobile-nav')!);
    expect(mobile.getAllByRole('link',{hidden:true}).map(link=>link.textContent)).toEqual(['Today','Work','Areas','More']);
    expect(mobile.getByRole('button',{name:'Assistant',hidden:true})).toBeInTheDocument();
    expect(container.querySelector('.operations-mobile-nav')?.children).toHaveLength(5);
    expect(mobile.getByRole('link',{name:'Today',hidden:true})).toHaveClass("is-active");
  });
  it("does not mutate primary navigation when a new responsibility becomes effective",()=>{
    state.permissions.push('gate.manage');
    const {container}=renderShell('/teacher/gate',<OperationsShell portal="teacher" active="gate" title="In & Out">Content</OperationsShell>);
    const mobile=within(container.querySelector<HTMLElement>('.operations-mobile-nav')!);
    expect(mobile.getByRole('link',{name:'Areas',hidden:true})).toHaveClass("is-active");
    expect(mobile.getAllByRole('link',{hidden:true}).map(link=>link.textContent)).toEqual(['Today','Work','Areas','More']);
  });
  it("gives map-like workspaces the complete viewport without duplicate app chrome",()=>{
    const {container}=renderShell('/more/virtual-campus',<OperationsShell portal="principal" active="more" title="Virtual campus" layout="canvas"><span>Bounded campus canvas</span></OperationsShell>);
    expect(container.querySelector('.operations-app--canvas')).toBeInTheDocument();
    expect(container.querySelector('.operations-sidebar')).not.toBeInTheDocument();
    expect(container.querySelector('.operations-topbar')).not.toBeInTheDocument();
    expect(container.querySelector('.operations-mobile-nav')).not.toBeInTheDocument();
    expect(container.querySelector('.operations-main')).toHaveTextContent('Bounded campus canvas');
  });
});
