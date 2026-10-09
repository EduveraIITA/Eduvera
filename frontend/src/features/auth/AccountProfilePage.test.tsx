import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AccountProfilePage } from './AccountProfilePage';

const { apiFetchMock }=vi.hoisted(()=>({apiFetchMock:vi.fn()}));
vi.mock('../../lib/api',()=>({apiFetch:apiFetchMock}));
vi.mock('./AuthContext',()=>({
  useAuth:()=>({user:{id:'person-1',email:'person@example.test',display_name:'Example Student'}}),
  useOptionalAuth:()=>({user:{id:'person-1',email:'person@example.test',display_name:'Example Student'}}),
}));

beforeEach(()=>{
  apiFetchMock.mockReset();
  apiFetchMock.mockImplementation((_path:string,init?:RequestInit)=>Promise.resolve({enabled:init?.method==='POST',preview:true}));
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
