import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GatePage from './GatePage';
const state=vi.hoisted(()=>({auth:{status:'authenticated',user:{id:'guard'},memberships:[{school_id:'school',school_name:'Test school',role:'staff',permissions:['gate.manage']}],logout:vi.fn()},command:vi.fn(),workspace:vi.fn(),find:vi.fn()}));
vi.mock('../auth/AuthContext',()=>({useAuth:()=>state.auth,authDestination:()=>'/teacher'}));
vi.mock('./api',()=>({gateCommand:state.command,getGateWorkspace:state.workspace,findGateStudents:state.find}));
vi.mock('./QRScanner',()=>({default:({onScan}:{onScan:(s:string)=>void})=><button onClick={()=>onScan('qr')}>Scan test pass</button>}));
function mount(){render(<MemoryRouter><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><GatePage/></QueryClientProvider></MemoryRouter>);}
describe('simple permission-scoped gate workspace',()=>{
 afterEach(cleanup);
 beforeEach(()=>{vi.clearAllMocks();localStorage.clear();state.workspace.mockResolvedValue({visitors:[],hosts:[],pending:0});state.command.mockReset();state.auth.memberships[0].permissions=['gate.manage'];});
 it('shows three large actions and switches only the gate workspace to Hindi',async()=>{mount();expect(await screen.findByRole('button',{name:'Scan QR'})).toBeInTheDocument();expect(screen.getByRole('button',{name:'Find Student'})).toBeInTheDocument();expect(screen.getByRole('button',{name:'Visitor Entry'})).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Switch Hindi / English'}));expect(screen.getByRole('button',{name:'QR स्कैन करें'})).toBeInTheDocument();expect(localStorage.getItem('eduera:gate-language:guard:school')).toBe('hi');});
 it('requires identity verification before recording an entry',async()=>{state.command.mockResolvedValueOnce({kind:'student',student:{id:'student',name:'Aarav',admission_number:'100',class_label:'7 A',direction:'out',avatar_url:''}}).mockResolvedValueOnce({saved:true});mount();fireEvent.click(screen.getByRole('button',{name:'Scan QR'}));fireEvent.click(screen.getByText('Scan test pass'));const confirm=await screen.findByRole('button',{name:'Confirm Entry'});expect(confirm).toBeDisabled();fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(confirm);await waitFor(()=>expect(state.command).toHaveBeenCalledWith('school','movements',expect.objectContaining({direction:'in',identity_verified:true,qr:'qr'})));expect(await screen.findByText('Recorded successfully')).toBeInTheDocument();});
 it('shows a Hindi error when a pickup QR is no longer valid',async()=>{state.command.mockRejectedValue(new Error('expired'));mount();fireEvent.click(screen.getByRole('button',{name:'Switch Hindi / English'}));fireEvent.click(screen.getByRole('button',{name:'QR स्कैन करें'}));fireEvent.click(screen.getByText('Scan test pass'));expect(await screen.findByRole('alert')).toHaveTextContent('QR अमान्य');expect(screen.queryByRole('button',{name:'निकास दर्ज करें'})).not.toBeInTheDocument();});
 it('hides the entire gate workspace when access is missing',()=>{state.auth.memberships[0].permissions=[];mount();expect(screen.queryByRole('button',{name:'Scan QR'})).not.toBeInTheDocument();expect(state.workspace).not.toHaveBeenCalledWith('');});
});
