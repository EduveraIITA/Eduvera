import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LoginPage, SignupPage } from './AuthPages';

const auth = vi.hoisted(() => ({
  status: 'anonymous' as const,
  demoMode: true,
  serviceError: null,
  register: vi.fn(),
  login: vi.fn(),
  completeMfa: vi.fn(),
}));
vi.mock('./AuthContext',()=>({useAuth:()=>auth,authDestination:()=>'/'}));
vi.mock('./GoogleSignInButton',()=>({GoogleSignInButton:()=>null}));
afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());
it('keeps private sign-in without any demo personas or published password even when an old server advertises demo mode',()=>{
  render(<MemoryRouter><LoginPage /></MemoryRouter>);
  expect(screen.getByRole('button',{name:/^Sign in/})).toBeVisible();
  expect(screen.getByRole('link', {name:'ThatCampus portal'})).toBeVisible();
  expect(screen.getByRole('heading', {name:'Welcome back'})).toBeVisible();
  expect(screen.getByText(/New to ThatCampus/)).toBeVisible();
  expect(screen.queryByText(/OmniDemo|Principal demo|Teacher demo|Parent demo|Student demo|Try a demo/i)).not.toBeInTheDocument();
  expect(screen.getByLabelText(/password/i,{selector:'input'})).toHaveAttribute('type','password');
});

it('creates a secure account without asking for a role, name, or institution', async () => {
  const user = userEvent.setup();
  function LocationProbe() {
    const location = useLocation();
    return <output data-testid="location">{location.pathname}{location.search}</output>;
  }
  render(<MemoryRouter initialEntries={['/signup']}><SignupPage /><LocationProbe /></MemoryRouter>);

  expect(screen.queryByText(/I'm joining as/i)).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/first name|last name|institution/i)).not.toBeInTheDocument();
  expect(screen.getByRole('heading', {name:'Start with what you need.'})).toBeVisible();
  expect(document.querySelector('.auth-story')).toBeNull();
  expect(screen.queryByLabelText('Confirm password')).not.toBeInTheDocument();
  await user.type(screen.getByLabelText('Email address'), 'owner@example.test');
  await user.type(screen.getByLabelText('Create password'), 'N1mble!RiverStone2026');
  await user.click(screen.getByRole('button', {name:'Show password'}));
  expect(screen.getByLabelText('Create password')).toHaveAttribute('type','text');
  await user.click(screen.getByRole('button', { name: 'Create account' }));

  expect(auth.register).toHaveBeenCalledWith({ email: 'owner@example.test', password: 'N1mble!RiverStone2026' });
  expect(screen.getByTestId('location')).toHaveTextContent('/account/security?from=%2Fonboarding%2Fstart');
  expect(screen.getByRole('link', { name: 'Use your invitation' })).toHaveAttribute('href', '/join');
});

it('keeps the authenticator challenge as one clear step and submits the exact challenge only after verification', async () => {
  auth.login.mockResolvedValue({challengeToken:'challenge-one'});
  auth.completeMfa.mockResolvedValue({});
  function LocationProbe(){const location=useLocation();return <output data-testid="location">{location.pathname}{location.search}</output>;}
  render(<MemoryRouter initialEntries={['/login?next=%2Fareas%2Fattendance']}><LoginPage/><LocationProbe/></MemoryRouter>);
  await userEvent.type(screen.getByLabelText('Email or username'),' owner@example.test ');
  await userEvent.type(screen.getByLabelText('Password',{selector:'input'}),'Private!Password2026');
  await userEvent.click(screen.getByRole('button',{name:'Sign in'}));
  expect(await screen.findByRole('heading',{level:1,name:'Two-step verification'})).toBeVisible();
  expect(screen.getAllByRole('heading',{level:1})).toHaveLength(1);
  expect(screen.queryByLabelText('Password',{selector:'input'})).not.toBeInTheDocument();
  expect(auth.login).toHaveBeenCalledWith({identifier:'owner@example.test',password:'Private!Password2026'});
  await userEvent.type(screen.getByLabelText('Verification code'),'123456');
  await userEvent.click(screen.getByRole('button',{name:'Verify and sign in'}));
  expect(auth.completeMfa).toHaveBeenCalledWith('challenge-one','123456');
  expect(screen.getByTestId('location')).toHaveTextContent('/areas/attendance');
});

it('preserves entered signup details after a failed request and exposes the next retry', async () => {
  auth.register.mockRejectedValueOnce(new Error('Account creation is temporarily unavailable.'));
  render(<MemoryRouter><SignupPage/></MemoryRouter>);
  await userEvent.type(screen.getByLabelText('Email address'),'owner@example.test');
  await userEvent.type(screen.getByLabelText('Create password'),'N1mble!RiverStone2026');
  await userEvent.click(screen.getByRole('button',{name:'Create account'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('temporarily unavailable');
  expect(screen.getByLabelText('Email address')).toHaveValue('owner@example.test');
  expect(screen.getByLabelText('Create password')).toHaveValue('N1mble!RiverStone2026');
  expect(screen.getByRole('button',{name:'Create account'})).toBeEnabled();
});
