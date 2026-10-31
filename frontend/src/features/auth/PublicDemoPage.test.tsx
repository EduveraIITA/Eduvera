import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import PublicDemoPage from './PublicDemoPage';

const auth=vi.hoisted((): {status:'authenticated'|'anonymous';publicDemo:boolean;logout:ReturnType<typeof vi.fn>;enterPublicDemo:ReturnType<typeof vi.fn>}=>({status:'authenticated',publicDemo:false,logout:vi.fn(()=>{auth.status='anonymous';return Promise.resolve();}),enterPublicDemo:vi.fn()}));
const apiFetch=vi.hoisted(()=>vi.fn());
vi.mock('./AuthContext',()=>({useAuth:()=>auth}));
vi.mock('../../lib/api',()=>({apiFetch}));

function show(){return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter initialEntries={['/demo']}><PublicDemoPage/></MemoryRouter></QueryClientProvider>);}
beforeEach(()=>{apiFetch.mockResolvedValue({enabled:true});});

afterEach(()=>{cleanup();vi.clearAllMocks();auth.status='authenticated';auth.publicDemo=false;});

it('protects an authenticated workspace before entering the isolated public demo',async()=>{
  const user=userEvent.setup();
  show();
  expect(await screen.findByRole('heading',{name:'Explore without changing your workspace.'})).toBeVisible();
  expect(screen.queryByRole('button',{name:/Principal/})).not.toBeInTheDocument();
  await user.click(screen.getByRole('button',{name:'Sign out and explore'}));
  expect(auth.logout).toHaveBeenCalledOnce();
  await waitFor(()=>expect(screen.getByRole('button',{name:/Meera Kapoor/})).toBeVisible());
});

it('does not offer profile entry or sign out an account when the public demo is disabled',async()=>{
  apiFetch.mockResolvedValue({enabled:false});show();
  expect(await screen.findByRole('heading',{name:'The sample campus isn’t available here.'})).toBeVisible();
  expect(screen.getByRole('link',{name:'Return to my workspace'})).toHaveAttribute('href','/today');
  expect(screen.queryByRole('button',{name:'Sign out and explore'})).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:/Meera Kapoor/})).not.toBeInTheDocument();
  expect(auth.logout).not.toHaveBeenCalled();expect(auth.enterPublicDemo).not.toHaveBeenCalled();
  expect(apiFetch).toHaveBeenCalledWith('/api/v1/auth/public-demo-config/');
});

it('offers signup and login for an unavailable anonymous demo',async()=>{
  auth.status='anonymous';apiFetch.mockResolvedValue({enabled:false});show();
  await screen.findByRole('heading',{name:'The sample campus isn’t available here.'});
  expect(screen.getByRole('link',{name:'Create an account'})).toHaveAttribute('href','/signup');
  expect(screen.getByRole('link',{name:'Sign in'})).toHaveAttribute('href','/login');
});

it('keeps profile buttons hidden until availability is confirmed and permits retry',async()=>{
  auth.status='anonymous';apiFetch.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({enabled:true});show();
  expect(await screen.findByRole('heading',{name:'We couldn’t check the sample campus.'})).toBeVisible();
  expect(screen.queryByRole('button',{name:/Meera Kapoor/})).not.toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole('button',{name:'Try again'}));
  expect(await screen.findByRole('button',{name:/Meera Kapoor/})).toBeVisible();
});
