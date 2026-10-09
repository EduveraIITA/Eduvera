import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AccountProfilePage } from './AccountProfilePage';

const { apiFetchMock, refreshMock }=vi.hoisted(()=>({apiFetchMock:vi.fn(),refreshMock:vi.fn()}));
vi.mock('../../lib/api',()=>({apiFetch:apiFetchMock}));
vi.mock('./AuthContext',()=>({
  useAuth:()=>({user:{id:'person-1',email:'person@example.test',display_name:'Example Student'},refresh:refreshMock}),
  useOptionalAuth:()=>({user:{id:'person-1',email:'person@example.test',display_name:'Example Student'}}),
}));

beforeEach(()=>{
  apiFetchMock.mockReset();
  refreshMock.mockReset().mockResolvedValue(undefined);
  apiFetchMock.mockImplementation((path:string,init?:RequestInit)=>{
    if(path==='/api/v1/agent/memories')return Promise.resolve(init?.method==='DELETE'?{cleared:true,count:1}:{items:[],budget:{used_tokens:0,max_tokens:1200,used_items:0,max_items:32},contract:'2026-10-10.1'});
    if(path.startsWith('/api/v1/agent/memories/'))return Promise.resolve({deleted:true,id:path.split('/').at(-1)});
    return Promise.resolve({enabled:init?.method==='POST',preview:true});
  });
});
afterEach(cleanup);

it('loads an off preference and enables the preview from Profile',async()=>{
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/account/profile?from=%2Fstudent%2Fattendance']}><AccountProfilePage/></MemoryRouter></QueryClientProvider>);
  const toggle=await screen.findByRole('switch',{name:'Pro features'});
  await waitFor(()=>expect(toggle).toHaveAttribute('aria-checked','false'));
  await userEvent.click(toggle);
  await waitFor(()=>expect(toggle).toHaveAttribute('aria-checked','true'));
  expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/auth/pro-features/',{method:'POST',body:JSON.stringify({enabled:true})});
  expect(screen.getByRole('link',{name:'Back'})).toHaveAttribute('href','/student/attendance');
});

it('shows remembered preferences and requires a second step before clearing them',async()=>{
  apiFetchMock.mockImplementation((path:string,init?:RequestInit)=>{
    if(path==='/api/v1/agent/memories'&&init?.method==='DELETE')return Promise.resolve({cleared:true,count:1});
    if(path==='/api/v1/agent/memories')return Promise.resolve({items:[{id:'memory-1',portal:'student',category:'communication_preference',topic:'response_length',content:'Concise answers with evidence first.',expires_at:'2027-10-10T00:00:00Z'}],budget:{used_tokens:14,max_tokens:1200,used_items:1,max_items:32},contract:'2026-10-10.1'});
    return Promise.resolve({enabled:false,preview:true});
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
    if(path==='/api/v1/auth/demo-profile-switch/'&&init?.method==='POST')return Promise.resolve({redirect_to:'/principal'});
    if(path==='/api/v1/agent/memories')return Promise.resolve({items:[],budget:{used_tokens:0,max_tokens:1200,used_items:0,max_items:32},contract:'2026-10-10.1'});
    return Promise.resolve({enabled:false,preview:true});
  });
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/account/profile']}><Routes>
    <Route path="/account/profile" element={<AccountProfilePage/>}/>
    <Route path="/principal" element={<div>Principal home</div>}/>
  </Routes></MemoryRouter></QueryClientProvider>);
  expect(await screen.findByRole('heading',{name:'Demo profiles'})).toBeInTheDocument();
  expect(screen.getAllByRole('listitem')).toHaveLength(4);
  expect(screen.getByText('Current')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button',{name:'Switch to Meera Kapoor, Principal'}));
  await waitFor(()=>expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/auth/demo-profile-switch/',{method:'POST',body:JSON.stringify({role:'admin'})}));
  expect(refreshMock).toHaveBeenCalledOnce();
  expect(await screen.findByText('Principal home')).toBeInTheDocument();
});
