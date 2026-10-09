import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { LoginPage } from './AuthPages';

vi.mock('./AuthContext',()=>({useAuth:()=>({status:'anonymous',demoMode:true,serviceError:null}),authDestination:()=>'/'}));
afterEach(cleanup);
it('keeps private sign-in without any demo personas or published password even when an old server advertises demo mode',()=>{
  render(<MemoryRouter><LoginPage /></MemoryRouter>);
  expect(screen.getByRole('button',{name:/^Sign in/})).toBeVisible();
  expect(screen.queryByText(/OmniDemo|Principal demo|Teacher demo|Parent demo|Student demo|Try a demo/i)).not.toBeInTheDocument();
  expect(screen.getByLabelText(/password/i,{selector:'input'})).toHaveAttribute('type','password');
});
