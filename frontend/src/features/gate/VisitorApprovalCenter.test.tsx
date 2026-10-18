import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VisitorApprovalCenter } from './VisitorApprovalCenter';
import { NotificationCenter } from '../notifications/NotificationCenter';

const state=vi.hoisted(()=>({auth:{status:'authenticated',publicDemo:false,user:{id:'host',email_verified:true,active_school_id:'school'},portals:['teacher'],memberships:[{role:'staff',school_id:'school',permissions:['messages.view'] as string[]}]},get:vi.fn(),command:vi.fn(),notification:vi.fn()}));
vi.mock('../auth/AuthContext',async importOriginal=>({
  ...await importOriginal<typeof import('../auth/AuthContext')>(),useOptionalAuth:()=>state.auth,
}));
vi.mock('./api',()=>({gateApprovalsQueryKey:(userId:string,schoolId:string)=>['gate-approvals',userId,schoolId],getVisitorApprovals:state.get,gateCommand:state.command}));
vi.mock('../../lib/api',async importOriginal=>({...await importOriginal<typeof import('../../lib/api')>(),apiFetch:state.notification}));
const requestId='10000000-0000-4000-a000-000000000001';
const visitor={id:requestId,school_id:'school',school_name:'Cambridge School',name:'Visitor Test',phone:'9876543210',purpose:'Document delivery',state:'pending',revision:1};
function NavigationProbe(){
  const location=useLocation();const navigate=useNavigate();
  return <><output data-testid="location">{location.pathname}{location.search}</output><output data-testid="return-state">{JSON.stringify(location.state)}</output><button onClick={()=>void navigate('/teacher/messages')}>Open messages</button><button onClick={()=>void navigate('/teacher')}>Open home</button><button onClick={()=>void navigate(`/?visitor_request=${requestId}`,{state:{portalReturnTo:'/teacher/messages'}})}>Open visitor notification</button></>;
}
function mount(path='/teacher',pending=[visitor],notifications=false){
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  // A cached queue must not cause a popup on a non-home page either.
  client.setQueryData(['gate-approvals','host','school'],pending);
  return render(<MemoryRouter initialEntries={[path]}><QueryClientProvider client={client}><VisitorApprovalCenter/>{notifications?<NotificationCenter buttonClassName="notification-trigger"/>:null}<NavigationProbe/></QueryClientProvider></MemoryRouter>);
}
beforeEach(()=>{vi.clearAllMocks();state.auth.status='authenticated';state.auth.publicDemo=false;state.auth.user.email_verified=true;state.auth.portals=['teacher'];state.auth.memberships=[{role:'staff',school_id:'school',permissions:['messages.view']}];state.get.mockResolvedValue([visitor]);state.command.mockResolvedValue({saved:true});});
afterEach(cleanup);
describe('home-only visitor approvals',()=>{
  it('opens a persisted request on home for a signed-in host without gate permission',async()=>{
    mount();expect(await screen.findByRole('dialog')).toHaveTextContent('Visitor Test');expect(screen.getByRole('button',{name:'Approve'})).toBeEnabled();expect(state.get).toHaveBeenCalledWith(expect.any(AbortSignal));
  });
  it.each(['/teacher/messages','/teacher/gate','/account/profile','/login','/account/security'])('does not interrupt %s even with a cached request',path=>{
    mount(path);expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(state.get).not.toHaveBeenCalled();
  });
  it.each([
    {home:'/workspace',portals:['teacher'],role:'staff',permissions:[]},
    {home:'/principal',portals:['principal'],role:'admin',permissions:[]},
    {home:'/gate',portals:['teacher'],role:'staff',permissions:['gate.manage']},
  ])('uses the actual $home landing page',async({home,portals,role,permissions})=>{
    state.auth.portals=portals;state.auth.memberships=[{role,school_id:'school',permissions}];mount(home);
    expect(await screen.findByRole('dialog')).toHaveTextContent('Visitor Test');
  });
  it('waits until home and hides the popup when navigating away',async()=>{
    mount('/teacher/messages');expect(state.get).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Open home'}));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Open messages'}));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(screen.getByTestId('location')).toHaveTextContent('/teacher/messages');
  });
  it.each([['Approve','approve','Visitor approved'],['Decline','deny','Visitor declined']])('confirms %s with an animation and stays home',async(label,action,confirmation)=>{
    state.get.mockResolvedValueOnce([visitor]).mockResolvedValue([]);mount(`/?visitor_request=${requestId}`);
    fireEvent.click(await screen.findByRole('button',{name:label}));
    await waitFor(()=>expect(state.command).toHaveBeenCalledWith('school',`visitors/${requestId}/${action}`,{expected_revision:1}));
    expect(await screen.findByRole('heading',{name:confirmation})).toBeVisible();
    expect(within(screen.getByRole('dialog')).getByRole('status')).toHaveClass(`gate-approval-result--${action}`);
    expect(screen.getByRole('button',{name:'Done'})).toHaveFocus();
    await waitFor(()=>expect(screen.getByTestId('location').textContent).toBe('/teacher'));expect(screen.getByTestId('return-state').textContent).toBe('null');
    fireEvent.click(screen.getByRole('button',{name:'Done'}));expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(screen.getByTestId('location').textContent).toBe('/teacher');
  });
  it('automatically closes the confirmation without leaving home',async()=>{
    state.get.mockResolvedValueOnce([visitor]).mockResolvedValue([]);mount();fireEvent.click(await screen.findByRole('button',{name:'Approve'}));
    expect(await screen.findByRole('heading',{name:'Visitor approved'})).toBeVisible();
    await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),{timeout:2500});expect(screen.getByTestId('location').textContent).toBe('/teacher');
  });
  it('keeps Later on home and reopens the pending request from a notification',async()=>{
    mount();fireEvent.click((await screen.findAllByRole('button',{name:'Review later'})).at(-1)!);expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(state.command).not.toHaveBeenCalled();
    expect(screen.getByTestId('location').textContent).toBe('/teacher');fireEvent.click(screen.getByRole('button',{name:'Open messages'}));
    fireEvent.click(screen.getByRole('button',{name:'Open visitor notification'}));expect(await screen.findByRole('dialog')).toHaveTextContent('Visitor Test');
    expect(screen.getByTestId('location').textContent).toBe(`/teacher?visitor_request=${requestId}`);
    fireEvent.click(screen.getAllByRole('button',{name:'Review later'}).at(-1)!);expect(screen.getByTestId('location').textContent).toBe('/teacher');expect(screen.getByTestId('return-state').textContent).toBe('null');
  });
  it.each(['Review later','Approve','Decline'])('opens a real bell notification on home and stays there after %s',async action=>{
    state.notification.mockImplementation((path:string)=>Promise.resolve(path.endsWith('/read/')?{id:'notice',read_at:'2026-10-15T17:00:00Z'}:{results:[{id:'notice',title:'Visitor approval requested',body:'Visitor Test is waiting at the gate.',kind:'general',link:`/?visitor_request=${requestId}`,created_at:'2026-10-15T17:00:00Z',read_at:null}],unread_count:1,next_cursor:null}));
    mount('/teacher/messages?notifications=open',[visitor],true);
    expect(screen.queryByRole('dialog',{name:'Approve this visitor?'})).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button',{name:/Visitor approval requested/}));
    expect(await screen.findByRole('dialog',{name:'Approve this visitor?'})).toBeVisible();
    expect(screen.getByTestId('location').textContent).toBe(`/teacher?visitor_request=${requestId}`);
    fireEvent.click(screen.getAllByRole('button',{name:action,exact:true}).at(-1)!);
    if(action!=='Review later')fireEvent.click(await screen.findByRole('button',{name:'Done'}));
    expect(screen.queryByRole('dialog',{name:'Approve this visitor?'})).not.toBeInTheDocument();
    expect(screen.getByTestId('location').textContent).toBe('/teacher');expect(screen.getByTestId('return-state').textContent).toBe('null');
    expect(state.notification).toHaveBeenCalledWith('/api/v1/notifications/notice/read/',{method:'POST'});
  });
  it('keeps the close icon and Escape on home without making a decision',async()=>{
    mount(`/?visitor_request=${requestId}`);fireEvent.click((await screen.findAllByRole('button',{name:'Review later'}))[0]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(screen.getByTestId('location').textContent).toBe('/teacher');expect(state.command).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'Open visitor notification'}));const dialog=await screen.findByRole('dialog');fireEvent(dialog,new Event('cancel',{bubbles:true,cancelable:true}));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(screen.getByTestId('location').textContent).toBe('/teacher');expect(state.command).not.toHaveBeenCalled();
  });
  it('never celebrates a failed decision and allows a safe retry',async()=>{
    state.command.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({saved:true});mount();fireEvent.click(await screen.findByRole('button',{name:'Approve'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not confirm your decision');expect(screen.queryByText('Visitor approved')).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Retry request'}));
    await waitFor(()=>expect(screen.getByRole('button',{name:'Approve'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'Approve'}));
    expect(await screen.findByRole('heading',{name:'Visitor approved'})).toBeVisible();expect(state.command.mock.calls[1]).toEqual(state.command.mock.calls[0]);
  });
  it('does not query on public-demo, anonymous or unverified sessions',()=>{
    state.auth.publicDemo=true;mount();expect(state.get).not.toHaveBeenCalled();cleanup();state.auth.publicDemo=false;state.auth.status='anonymous';mount();expect(state.get).not.toHaveBeenCalled();cleanup();state.auth.status='authenticated';state.auth.user.email_verified=false;mount();expect(state.get).not.toHaveBeenCalled();
  });
});
