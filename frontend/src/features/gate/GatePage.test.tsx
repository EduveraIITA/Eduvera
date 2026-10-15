import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GatePage from './GatePage';
const state=vi.hoisted(()=>({auth:{status:'authenticated',user:{id:'guard'},memberships:[{school_id:'school',school_name:'Test school',role:'staff',permissions:['gate.manage']}],logout:vi.fn()},command:vi.fn(),workspace:vi.fn(),find:vi.fn(),student:vi.fn()}));
vi.mock('../auth/AuthContext',()=>({useAuth:()=>state.auth,authDestination:()=>'/teacher'}));
vi.mock('./api',()=>({gateCommand:state.command,getGateWorkspace:state.workspace,findGateStudents:state.find,getGateStudent:state.student}));
vi.mock('../../pages/operations/OperationsShell',()=>({OperationsShell:({children}:{children:React.ReactNode})=><div data-testid="staff-shell">{children}</div>}));
vi.mock('./QRScanner',()=>({default:({onScan}:{onScan:(s:string)=>void})=><button onClick={()=>onScan('qr')}>Scan test pass</button>}));
function mount(){render(<MemoryRouter><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><GatePage/></QueryClientProvider></MemoryRouter>);}
describe('simple permission-scoped gate workspace',()=>{
 afterEach(cleanup);
 beforeEach(()=>{vi.clearAllMocks();localStorage.clear();state.workspace.mockResolvedValue({visitors:[],hosts:[],pending:0});state.command.mockReset();state.auth.memberships[0].permissions=['gate.manage'];state.find.mockResolvedValue([]);});
 it('shows three large actions and switches only the gate workspace to Hindi',async()=>{mount();expect(await screen.findByRole('button',{name:'Scan QR'})).toBeInTheDocument();expect(screen.getByRole('button',{name:'Find Student'})).toBeInTheDocument();expect(screen.getByRole('button',{name:'Visitor Entry'})).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Switch Hindi / English'}));expect(screen.getByRole('button',{name:'QR स्कैन करें'})).toBeInTheDocument();expect(localStorage.getItem('eduera:gate-language:guard:school')).toBe('hi');});
 it('requires identity verification before recording an entry',async()=>{state.command.mockResolvedValueOnce({kind:'student',student:{id:'student',name:'Aarav',admission_number:'100',class_label:'7 A',direction:'out',avatar_url:''}}).mockResolvedValueOnce({saved:true});mount();fireEvent.click(screen.getByRole('button',{name:'Scan QR'}));fireEvent.click(screen.getByText('Scan test pass'));const confirm=await screen.findByRole('button',{name:'Confirm Entry'});expect(confirm).toBeDisabled();fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(confirm);await waitFor(()=>expect(state.command).toHaveBeenCalledWith('school','movements',expect.objectContaining({direction:'in',identity_verified:true,qr:'qr'})));expect(await screen.findByText('Recorded successfully')).toBeInTheDocument();});
 it('shows a Hindi error when a pickup QR is no longer valid',async()=>{state.command.mockRejectedValue(new Error('expired'));mount();fireEvent.click(screen.getByRole('button',{name:'Switch Hindi / English'}));fireEvent.click(screen.getByRole('button',{name:'QR स्कैन करें'}));fireEvent.click(screen.getByText('Scan test pass'));expect(await screen.findByRole('alert')).toHaveTextContent('QR अमान्य');expect(screen.queryByRole('button',{name:'निकास दर्ज करें'})).not.toBeInTheDocument();});
 it('hides the entire gate workspace when access is missing',()=>{state.auth.memberships[0].permissions=[];mount();expect(screen.queryByRole('button',{name:'Scan QR'})).not.toBeInTheDocument();expect(state.workspace).not.toHaveBeenCalledWith('');});
 it('uses the school branded home for gate-only users and the staff shell for mixed access',()=>{mount();expect(screen.getByLabelText('Test school')).toBeInTheDocument();expect(screen.queryByTestId('staff-shell')).not.toBeInTheDocument();cleanup();state.auth.memberships[0].permissions=['gate.manage','attendance.view'];mount();expect(screen.getByTestId('staff-shell')).toBeInTheDocument();});
 it('searches while typing and reloads the selected student before identity confirmation',async()=>{
  state.find.mockResolvedValue([{id:'student',name:'Aarav',admission_number:'100',class_label:'7 A',avatar_url:'',plan_state:null}]);
  state.student.mockResolvedValue({id:'student',name:'Aarav',admission_number:'100',class_label:'7 A',direction:'out',avatar_url:''});
  mount();fireEvent.click(screen.getByRole('button',{name:'Find Student'}));
  const input=screen.getByRole('searchbox');fireEvent.change(input,{target:{value:'A'}});
  expect(state.find).not.toHaveBeenCalled();fireEvent.change(input,{target:{value:'Aarav'}});
  fireEvent.click(await screen.findByRole('button',{name:/Aarav/}));
  expect(state.find).toHaveBeenCalledWith('school','Aarav',expect.any(AbortSignal));
  expect(state.student).toHaveBeenCalledWith('school','student');
  expect(await screen.findByRole('button',{name:'Confirm Entry'})).toBeDisabled();
 });
 it('shows no matches and a retry action when student search fails',async()=>{
  mount();fireEvent.click(screen.getByRole('button',{name:'Find Student'}));fireEvent.change(screen.getByRole('searchbox'),{target:{value:'Absent'}});
  expect(await screen.findByText(/No students found/)).toBeInTheDocument();
  state.find.mockRejectedValueOnce(new Error('unavailable'));fireEvent.change(screen.getByRole('searchbox'),{target:{value:'Retry'}});
  expect(await screen.findByRole('alert')).toHaveTextContent('Search could not be completed');
  fireEvent.click(screen.getByRole('button',{name:'Try again'}));expect(await screen.findByText(/No students found/)).toBeInTheDocument();
 });
 it('cancels the old search and never displays its late results',async()=>{
  let finishOld!:(value:unknown[])=>void;
  state.find.mockImplementationOnce(()=>new Promise(resolve=>{finishOld=resolve;})).mockResolvedValueOnce([{id:'new',name:'New Student',class_label:'7 A',admission_number:'102',avatar_url:''}]);
  mount();fireEvent.click(screen.getByRole('button',{name:'Find Student'}));
  fireEvent.change(screen.getByRole('searchbox'),{target:{value:'Old'}});
  await waitFor(()=>expect(state.find).toHaveBeenCalledTimes(1));
  const signal=state.find.mock.calls[0][2] as AbortSignal;
  fireEvent.change(screen.getByRole('searchbox'),{target:{value:'New'}});
  expect(await screen.findByRole('button',{name:/New Student/})).toBeInTheDocument();
  expect(signal.aborted).toBe(true);
  finishOld([{id:'old',name:'Old Student',class_label:'7 A',admission_number:'101',avatar_url:''}]);
  await waitFor(()=>expect(screen.queryByRole('button',{name:/Old Student/})).not.toBeInTheDocument());
 });
});
