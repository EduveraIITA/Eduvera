import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Link, MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PeopleImportPage from './PeopleImportPage';
import { enrollmentOptions } from './api';
import { getImports, getImport, stageImport } from './import-api';
vi.mock('../auth/AuthContext',()=>({useAuth:()=>({memberships:[{role:'admin',school_id:'school-1',school_name:'School'}],hasPortal:()=>true})}));
vi.mock('../../pages/operations/OperationsShell',()=>({OperationsShell:({title,backTo,children}:{title:string;backTo:string;children:ReactNode})=><><h1>{title}</h1><Link to={backTo}>Go back</Link>{children}</>}));
vi.mock('./api',async original=>({...await original<typeof import('./api')>(),enrollmentOptions:vi.fn()}));
vi.mock('./import-api',async original=>({...await original<typeof import('./import-api')>(),getImports:vi.fn(),getImport:vi.fn(),stageImport:vi.fn()}));
beforeEach(()=>{
  vi.mocked(enrollmentOptions).mockResolvedValue({results:[{class_section_id:'class-1',class_name:'Class 7A',term_id:'term-1',term_name:'Term 1',starts_on:'2026-04-01',ends_on:'2027-03-31',today:'2026-10-08',next_roll:1}]});
  vi.mocked(getImports).mockResolvedValue({results:[{id:'import-1',filename:'students.csv',state:'expired',revision:1,row_count:3,created_at:'2026-10-06T00:00:00Z',expires_at:'2026-10-07T00:00:00Z',term_name:'Term 1',created_by_name:'School office',summary:null}],next_cursor:null});
  vi.mocked(getImport).mockResolvedValue({id:'import-1',filename:'students.csv',state:'expired',revision:1,row_count:3,created_at:'2026-10-06T00:00:00Z',expires_at:'2026-10-07T00:00:00Z',receipt:null,review:null});
});
afterEach(()=>{cleanup();vi.clearAllMocks();});
function NavigationProbe(){const location=useLocation();const navigate=useNavigate();return <><span data-testid="location">{location.pathname}{location.search}</span><button type="button" onClick={()=>navigate(-1)}>Browser back</button></>;}
const show=(search='')=>render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter initialEntries={['/principal/students/import'+search]}><NavigationProbe/><PeopleImportPage/></MemoryRouter></QueryClientProvider>);
describe('student import navigation',()=>{
  it('opens a focused upload form and returns to the import list',async()=>{
    const user=userEvent.setup();show();await user.click(await screen.findByRole('button',{name:'New import'}));
    expect(await screen.findByLabelText('Academic term')).toBeVisible();
    expect(screen.queryByText('students.csv')).not.toBeInTheDocument();
    expect(screen.getByText(/No login accounts, leave-signing permissions/)).toBeVisible();
    await user.click(screen.getByRole('button',{name:'Cancel'}));
    expect(await screen.findByText('students.csv')).toBeVisible();expect(stageImport).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button',{name:'Browser back'}));
    expect(await screen.findByText('students.csv')).toBeVisible();
    expect(screen.queryByLabelText('Academic term')).not.toBeInTheDocument();
  });
  it('restores an upload URL with an authorized institution only',async()=>{
    show('?create=import&school=outside-school');await screen.findByLabelText('Academic term');
    expect(enrollmentOptions).toHaveBeenCalledWith('school-1');expect(stageImport).not.toHaveBeenCalled();
  });
  it('replaces the upload form after staging succeeds so Back cannot reopen it',async()=>{
    const user=userEvent.setup();vi.mocked(stageImport).mockResolvedValue({id:'import-1'});show();
    await user.click(await screen.findByRole('button',{name:'New import'}));
    await user.click(screen.getByText('Or paste CSV data'));
    await user.type(screen.getByLabelText('CSV data'),'header\nrow');
    await user.click(screen.getByRole('button',{name:'Upload & review'}));
    expect(await screen.findByRole('heading',{name:'Draft expired'})).toBeVisible();
    await user.click(screen.getByRole('button',{name:'Browser back'}));
    expect(await screen.findByText('students.csv')).toBeVisible();
    expect(screen.queryByLabelText('Academic term')).not.toBeInTheDocument();
  });
  it('opens a retained receipt/history record without the directory',async()=>{
    const user=userEvent.setup();show('?import=import-1&school=school-1');
    expect(await screen.findByRole('heading',{name:'Draft expired'})).toBeVisible();
    expect(screen.queryByRole('button',{name:'New import'})).not.toBeInTheDocument();
    await user.click(screen.getByRole('link',{name:'Go back'}));expect(await screen.findByText('students.csv')).toBeVisible();
  });
});
