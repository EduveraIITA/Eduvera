import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AccountNameEditor } from './AccountNameEditor';
import { ExecutionEnvironmentProvider } from '../simulation/ExecutionEnvironmentContext';
import { setAppearance } from '../appearance';

const { api, refresh, state } = vi.hoisted(() => ({ api:vi.fn(),refresh:vi.fn(),state:{publicDemo:false,user:{id:'account-1',first_name:' Legacy ',last_name:' Name ',display_name:'Legacy Name'}} }));
vi.mock('../../lib/api',()=>({apiFetch:api}));
vi.mock('./AuthContext',()=>({useAuth:()=>({...state,refresh})}));
beforeEach(()=>{api.mockReset().mockResolvedValue({scope:'account',changed:true});refresh.mockReset().mockResolvedValue({mode:'live'});state.publicDemo=false;state.user={id:'account-1',first_name:' Legacy ',last_name:' Name ',display_name:'Legacy Name'};});
afterEach(cleanup);

it.each([['live','light'],['live','dark'],['simulation','light'],['simulation','dark']] as const)('edits the same account name with explicit scope in %s %s',async(mode,theme)=>{
  setAppearance(theme);
  const environment=mode==='live'?{mode:'live' as const,namespaceId:'live:school'}:{mode:'simulation' as const,namespaceId:'scenario:profile:run:profile',runId:'profile',virtualClock:{now:'2026-10-25T00:00:00Z',timeZone:'UTC'}};
  render(<ExecutionEnvironmentProvider environment={environment}><AccountNameEditor/></ExecutionEnvironmentProvider>);
  expect(screen.getByText(/Used across your signed-in workspaces/)).toBeVisible();
  await userEvent.click(screen.getByRole('button',{name:'Edit name'}));
  const field=screen.getByRole('textbox',{name:'Name'});expect(field).toHaveFocus();expect(field).toHaveValue('Legacy   Name');
  await userEvent.clear(field);await userEvent.type(field,'  श्रुति  नायर  ');
  await userEvent.click(screen.getByRole('button',{name:'Save name'}));
  await waitFor(()=>expect(api).toHaveBeenCalledWith('/api/v1/auth/profile/',{method:'PATCH',body:JSON.stringify({first_name:'श्रुति  नायर',last_name:'',expected_first_name:' Legacy ',expected_last_name:' Name '})}));
  expect(await screen.findByText('Account name saved.')).toBeVisible();expect(refresh).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  await waitFor(()=>expect(screen.getByRole('button',{name:'Edit name'})).toHaveFocus());
  expect(document.documentElement).toHaveAttribute('data-theme',theme);
});
it('cancels an edit without writing account or campus data',async()=>{
  render(<AccountNameEditor/>);await userEvent.click(screen.getByRole('button',{name:'Edit name'}));
  await userEvent.clear(screen.getByRole('textbox',{name:'Name'}));await userEvent.type(screen.getByRole('textbox',{name:'Name'}),'Aditi Menon');
  await userEvent.click(screen.getByRole('button',{name:'Cancel'}));expect(api).not.toHaveBeenCalled();expect(refresh).not.toHaveBeenCalled();
});
it('retains the typed name on conflict and offers an explicit account reload',async()=>{
  api.mockRejectedValue(new Error('Your account name changed in another session. Reload it before saving again.'));
  render(<AccountNameEditor/>);await userEvent.click(screen.getByRole('button',{name:'Edit name'}));
  await userEvent.clear(screen.getByRole('textbox',{name:'Name'}));await userEvent.type(screen.getByRole('textbox',{name:'Name'}),'Aditi Menon');
  await userEvent.click(screen.getByRole('button',{name:'Save name'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('another session');expect(screen.getByRole('textbox')).toHaveValue('Aditi Menon');
  await userEvent.click(screen.getByRole('button',{name:'Reload account'}));await waitFor(()=>expect(screen.queryByRole('textbox')).not.toBeInTheDocument());
  expect(refresh).toHaveBeenCalledTimes(1);expect(api).toHaveBeenCalledTimes(1);
});
it('prevents duplicate saves while the accepted write is pending',async()=>{
  let finish!:(value:unknown)=>void;api.mockReturnValue(new Promise(resolve=>{finish=resolve;}));
  render(<AccountNameEditor/>);await userEvent.click(screen.getByRole('button',{name:'Edit name'}));await userEvent.click(screen.getByRole('button',{name:'Save name'}));
  expect(screen.getByRole('button',{name:'Saving…'})).toBeDisabled();expect(screen.getByRole('button',{name:'Cancel'})).toBeDisabled();expect(screen.getByRole('textbox')).toBeDisabled();
  finish({changed:true});expect(await screen.findByText('Account name saved.')).toBeVisible();expect(api).toHaveBeenCalledTimes(1);
});
it('keeps a completed save truthful if the account summary refresh fails',async()=>{
  refresh.mockRejectedValue(new Error('offline'));render(<AccountNameEditor/>);await userEvent.click(screen.getByRole('button',{name:'Edit name'}));await userEvent.click(screen.getByRole('button',{name:'Save name'}));
  expect(await screen.findByText('Account name saved. Refresh the page to update your account summary.')).toBeVisible();expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
it('does not offer account mutation in the read-only public demo',()=>{
  state.publicDemo=true;render(<AccountNameEditor/>);expect(screen.queryByRole('button')).not.toBeInTheDocument();expect(api).not.toHaveBeenCalled();
});
