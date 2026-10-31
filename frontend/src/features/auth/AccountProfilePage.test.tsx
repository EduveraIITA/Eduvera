import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AccountProfilePage } from './AccountProfilePage';
import { setAppearance } from '../appearance';
import { ExecutionEnvironmentProvider } from '../simulation/ExecutionEnvironmentContext';

const { apiFetchMock, refreshMock }=vi.hoisted(()=>({apiFetchMock:vi.fn(),refreshMock:vi.fn()}));
const authUser=vi.hoisted(()=>({id:'person-1',email:'person@example.test',display_name:'Example Student',role:'admin',avatar_url:null as string|null}));
vi.mock('../../lib/api',()=>({apiFetch:apiFetchMock}));
vi.mock('./AuthContext',()=>({
  useAuth:()=>({status:'authenticated',memberships:[{role:'admin'}],user:authUser,refresh:refreshMock}),
  useOptionalAuth:()=>({user:authUser}),
  authDestination:()=>'/today',
}));

function Destination({forward=false}:{forward?:boolean}) {
  const location=useLocation();
  const navigate=useNavigate();
  return <><output data-testid="destination">{location.pathname}{location.search}{location.hash}</output>{forward?<button type="button" onClick={()=>void navigate(1)}>Forward</button>:null}</>;
}

beforeEach(()=>{
  authUser.avatar_url=null;
  setAppearance('system');
  apiFetchMock.mockReset();
  refreshMock.mockReset().mockResolvedValue(undefined);
  apiFetchMock.mockImplementation((path:string,init?:RequestInit)=>{
    if(path==='/api/v1/agent/channels')return Promise.resolve({providers:[]});
    if(path==='/api/v1/agent/memories')return Promise.resolve(init?.method==='DELETE'?{cleared:true,count:1}:{items:[],budget:{used_tokens:0,max_tokens:1200,used_items:0,max_items:32},contract:'2026-10-10.1'});
    if(path.startsWith('/api/v1/agent/memories/'))return Promise.resolve({deleted:true,id:path.split('/').at(-1)});
    return Promise.resolve({enabled:init?.method==='POST',preview:true});
  });
});
afterEach(cleanup);

it('identifies the signed-in account without inventing a campus profile or edit permission',async()=>{
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  render(<QueryClientProvider client={client}><MemoryRouter><AccountProfilePage presentation="workspace" includeConnections={false}/></MemoryRouter></QueryClientProvider>);
  const identity=within(screen.getByRole('region',{name:'Signed-in account'}));
  expect(identity.getByText('Example Student')).toBeVisible();
  expect(identity.getByLabelText('Sign-in email: person@example.test')).toHaveTextContent('person@example.test');
  expect(identity.queryByRole('link')).not.toBeInTheDocument();
  expect(identity.queryByRole('button')).not.toBeInTheDocument();
  expect(identity.getByText('ES')).toHaveAttribute('aria-hidden','true');
  await screen.findByRole('switch',{name:'Pro features'});
  expect(apiFetchMock.mock.calls.some(call=>String(call[0]).includes('/people/'))).toBe(false);
});

it('falls back to initials when the existing account image cannot load',()=>{
  authUser.avatar_url='/assets/account-avatar.png';
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  render(<QueryClientProvider client={client}><MemoryRouter><AccountProfilePage presentation="workspace" includeConnections={false}/></MemoryRouter></QueryClientProvider>);
  const identity=screen.getByRole('region',{name:'Signed-in account'});
  const image=identity.querySelector('img');
  expect(image).toHaveAttribute('src','/assets/account-avatar.png');
  fireEvent.error(image!);
  expect(identity.querySelector('img')).toBeNull();
  expect(within(identity).getByText('ES')).toBeVisible();
});

it('offers the same accessible appearance preference to every profile',async()=>{
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  render(<QueryClientProvider client={client}><MemoryRouter><AccountProfilePage/></MemoryRouter></QueryClientProvider>);
  expect(screen.getByRole('group',{name:'Appearance'})).toBeVisible();
  expect(screen.getByRole('radio',{name:'System'})).toBeChecked();
  await userEvent.click(screen.getByRole('radio',{name:'Dark'}));
  expect(screen.getByRole('radio',{name:'Dark'})).toBeChecked();
  expect(document.documentElement).toHaveAttribute('data-theme','dark');
  expect(window.localStorage.getItem('thatcampus:appearance')).toBe('dark');
});

it.each(['light','dark'] as const)('keeps Live-only assistant memory private in %s Simulation while appearance remains usable',async(theme)=>{
  setAppearance(theme);
  apiFetchMock.mockImplementation((path:string)=>Promise.resolve(path==='/api/v1/auth/pro-features/'?{enabled:true,preview:true}:{enabled:false,profiles:[]}));
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  client.setQueryData(['agent-memory','person-1'],{items:[{id:'private-live-memory',portal:'student',category:'communication_preference',topic:'response_length',content:'Private remembered Live preference.',expires_at:'2027-10-10T00:00:00Z'}],budget:{used_tokens:14,max_tokens:1200,used_items:1,max_items:32},contract:'2026-10-10.1'});
  render(<QueryClientProvider client={client}><ExecutionEnvironmentProvider environment={{mode:'simulation',namespaceId:'scenario:profile:run:profile',runId:'profile-run',virtualClock:{now:'2026-10-20T12:00:00Z',timeZone:'UTC'}}}><MemoryRouter><AccountProfilePage presentation="workspace" includeConnections={false}/></MemoryRouter></ExecutionEnvironmentProvider></QueryClientProvider>);
  expect(await screen.findByText('Assistant memory is available in Live.')).toBeVisible();
  expect(within(screen.getByRole('region',{name:'Signed-in account'})).getByText('Example Student')).toBeVisible();
  expect(screen.getByRole('switch',{name:'Pro features'})).toHaveAttribute('aria-checked','true');
  expect(screen.queryByText('Private remembered Live preference.')).not.toBeInTheDocument();
  expect(screen.queryByText(/Could not load assistant memory/)).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Clear memory'})).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:/Forget /})).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('radio',{name:theme==='light'?'Dark':'Light'}));
  expect(document.documentElement).toHaveAttribute('data-theme',theme==='light'?'dark':'light');
  expect(apiFetchMock.mock.calls.some(call=>String(call[0]).startsWith('/api/v1/agent/memories'))).toBe(false);
});

it('changes appearance without losing the exact Gate workspace in browser history',async()=>{
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  const origin='/gate?mode=visitors#pending';
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[origin,{pathname:'/account/profile',search:`?from=${encodeURIComponent(origin)}`,state:{accountReturnTo:origin,accountCanPop:true}}]} initialIndex={1}><Routes>
    <Route path="/account/profile" element={<AccountProfilePage/>}/>
    <Route path="/gate" element={<Destination forward/>}/>
  </Routes></MemoryRouter></QueryClientProvider>);
  await userEvent.click(screen.getByRole('radio',{name:'Dark'}));
  await userEvent.click(screen.getByRole('button',{name:'Back'}));
  expect(await screen.findByTestId('destination')).toHaveTextContent('/gate?mode=visitors#pending');
  await userEvent.click(screen.getByRole('button',{name:'Forward'}));
  expect(await screen.findByRole('heading',{name:'Profile'})).toBeVisible();
});

it('replaces a direct Profile link with its safe Gate return destination',async()=>{
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  const origin='/gate?mode=search#student';
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/account/profile?from=${encodeURIComponent(origin)}`]}><Routes>
    <Route path="/account/profile" element={<AccountProfilePage/>}/>
    <Route path="/gate" element={<Destination/>}/>
  </Routes></MemoryRouter></QueryClientProvider>);
  await userEvent.click(screen.getByRole('button',{name:'Back'}));
  expect(await screen.findByTestId('destination')).toHaveTextContent('/gate?mode=search#student');
});

it('uses the authenticated home when Profile has an unsafe return destination',async()=>{
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/account/profile?from=https%3A%2F%2Fevil.example%2Fgate']}><Routes>
    <Route path="/account/profile" element={<AccountProfilePage/>}/>
    <Route path="/today" element={<Destination/>}/>
  </Routes></MemoryRouter></QueryClientProvider>);
  await userEvent.click(screen.getByRole('button',{name:'Back'}));
  expect(await screen.findByTestId('destination')).toHaveTextContent('/today');
});

it('loads an off preference and enables the preview from Profile',async()=>{
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/account/profile?from=%2Fstudent%2Fattendance']}><AccountProfilePage/></MemoryRouter></QueryClientProvider>);
  const toggle=await screen.findByRole('switch',{name:'Pro features'});
  await waitFor(()=>expect(toggle).toHaveAttribute('aria-checked','false'));
  expect(screen.queryByText('Assistant memory')).not.toBeInTheDocument();
  expect(apiFetchMock).not.toHaveBeenCalledWith('/api/v1/agent/memories');
  await userEvent.click(toggle);
  await waitFor(()=>expect(toggle).toHaveAttribute('aria-checked','true'));
  expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/auth/pro-features/',{method:'POST',body:JSON.stringify({enabled:true})});
  expect(screen.getByRole('button',{name:'Back'})).toBeVisible();
});

it('shows remembered preferences and requires a second step before clearing them',async()=>{
  apiFetchMock.mockImplementation((path:string,init?:RequestInit)=>{
    if(path==='/api/v1/agent/memories'&&init?.method==='DELETE')return Promise.resolve({cleared:true,count:1});
    if(path==='/api/v1/agent/memories')return Promise.resolve({items:[{id:'memory-1',portal:'student',category:'communication_preference',topic:'response_length',content:'Concise answers with evidence first.',expires_at:'2027-10-10T00:00:00Z'}],budget:{used_tokens:14,max_tokens:1200,used_items:1,max_items:32},contract:'2026-10-10.1'});
    if(path==='/api/v1/auth/demo-profiles/')return Promise.resolve({enabled:false,profiles:[]});
    return Promise.resolve({enabled:true,preview:true});
  });
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  render(<QueryClientProvider client={client}><MemoryRouter><AccountProfilePage/></MemoryRouter></QueryClientProvider>);
  expect(await screen.findByText('Concise answers with evidence first.')).toBeInTheDocument();
  expect(screen.getByText('14 of 1,200 memory tokens used')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button',{name:'Clear memory'}));
  expect(screen.getByRole('button',{name:'Confirm clear'})).toBeInTheDocument();
  expect(apiFetchMock).not.toHaveBeenCalledWith('/api/v1/agent/memories',{method:'DELETE'});
  await userEvent.click(screen.getByRole('button',{name:'Confirm clear'}));
  await waitFor(()=>expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/agent/memories',{method:'DELETE'}));
});

it('shows four authenticated demo profiles and switches the session with one tap',async()=>{
  apiFetchMock.mockImplementation((path:string,init?:RequestInit)=>{
    if(path==='/api/v1/auth/demo-profiles/')return Promise.resolve({enabled:true,profiles:[
      {role:'student',username:'aarav.student',display_name:'Aarav Sharma',avatar_url:null,current:true},
      {role:'parent',username:'pooja.parent',display_name:'Pooja Sharma',avatar_url:'/assets/pooja-sharma.png',current:false},
      {role:'staff',username:'kavita.staff',display_name:'Kavita Mehta',avatar_url:'/assets/kavita-mehta.png',current:false},
      {role:'admin',username:'meera.principal',display_name:'Meera Kapoor',avatar_url:'/assets/meera-kapoor.png',current:false},
    ]});
    if(path==='/api/v1/auth/demo-profile-switch/'&&init?.method==='POST')return Promise.resolve({redirect_to:'/today'});
    if(path==='/api/v1/agent/memories')return Promise.resolve({items:[],budget:{used_tokens:0,max_tokens:1200,used_items:0,max_items:32},contract:'2026-10-10.1'});
    return Promise.resolve({enabled:false,preview:true});
  });
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/account/profile']}><Routes>
    <Route path="/account/profile" element={<AccountProfilePage/>}/>
    <Route path="/today" element={<div>Today workspace</div>}/>
  </Routes></MemoryRouter></QueryClientProvider>);
  expect(await screen.findByRole('heading',{name:'Demo profiles'})).toBeInTheDocument();
  expect(screen.getAllByRole('listitem')).toHaveLength(4);
  expect(screen.getByText('Current')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button',{name:'Switch to Meera Kapoor, Principal'}));
  await waitFor(()=>expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/auth/demo-profile-switch/',{method:'POST',body:JSON.stringify({role:'admin'})}));
  expect(refreshMock).toHaveBeenCalledOnce();
  expect(await screen.findByText('Today workspace')).toBeInTheDocument();
});

it('shows and revokes the linked Telegram assistant from Profile',async()=>{
  apiFetchMock.mockImplementation((path:string,init?:RequestInit)=>{
    if(path==='/api/v1/auth/pro-features/')return Promise.resolve({enabled:true,preview:true});
    if(path==='/api/v1/auth/demo-profiles/')return Promise.resolve({enabled:false,profiles:[]});
    if(path==='/api/v1/agent/memories')return Promise.resolve({items:[],budget:{used_tokens:0,max_tokens:1200,used_items:0,max_items:32},contract:'2026-10-10.1'});
    if(path==='/api/v1/agent/channels'&&init?.method!=='DELETE')return Promise.resolve({providers:[{name:'telegram',label:'Telegram',configured:true,username:'@ThatCampusBot',connection:{portal:'principal',student_id:null,linked_at:'2026-10-14T00:00:00Z',last_inbound_at:null,last_outbound_at:null}}]});
    if(path==='/api/v1/agent/channels/telegram'&&init?.method==='DELETE')return Promise.resolve({provider:'telegram',connected:false});
    return Promise.resolve({});
  });
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  render(<QueryClientProvider client={client}><MemoryRouter><AccountProfilePage/></MemoryRouter></QueryClientProvider>);
  expect(await screen.findByText('Connected to this workspace')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button',{name:'Disconnect'}));
  await waitFor(()=>expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/agent/channels/telegram',{method:'DELETE'}));
});
